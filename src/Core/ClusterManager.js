'use strict';

const { Worker, isMainThread } = require('worker_threads');
const path = require('path');

const DEFAULT_SHARDS_PER_CLUSTER = 2;
const RESTART_DELAY_MS           = 5_000;
const IPC_TIMEOUT_MS             = 5_000;
const CLUSTER_READY_TIMEOUT_MS   = 60_000; // 60s para o cluster ficar pronto

class ClusterManager {

    constructor(opts = {}) {
        if (!isMainThread)
            throw new Error('[ClusterManager] Must be instantiated on the main thread.');

        this.totalShards      = opts.totalShards      ?? 'auto';
        this.shardsPerCluster = opts.shardsPerCluster ?? DEFAULT_SHARDS_PER_CLUSTER;
        this.workerFile       = opts.workerFile       ?? path.join(process.cwd(), 'src', 'Core', 'ClusterWorker.js');
        this.clientOptions    = opts.clientOptions    ?? {};

        /** @type {Map<number, { worker: Worker, shards: number[] }>} */
        this._clusters = new Map();

        /** Pending stat requests: requestId → { resolve, reject, timeout } */
        this._pendingStats = new Map();

        /**
         * Pending CLUSTER_READY resolvers.
         * clusterId → { resolve, reject, timeout }
         */
        this._pendingReady = new Map();
    }

    async launch() {
        const totalShards  = await this._resolveShardCount();
        const shardBuckets = this._chunk(
            Array.from({ length: totalShards }, (_, i) => i),
            this.shardsPerCluster
        );

        console.log(`[ClusterManager] Launching ${shardBuckets.length} clusters with ${totalShards} total shards.`);

        for (let clusterId = 0; clusterId < shardBuckets.length; clusterId++) {
            console.log(`[ClusterManager] Spawning cluster ${clusterId} — shards [${shardBuckets[clusterId].join(', ')}]...`);
            await this._spawnCluster(clusterId, shardBuckets[clusterId], totalShards);
            console.log(`[ClusterManager] Cluster ${clusterId} ready. Moving to next...\n`);
        }

        console.log('[ClusterManager] All clusters spawned and ready.');
    }

    /**
     * Solicita stats de todos os clusters e retorna agregado.
     * @returns {Promise<object[]>}
     */
    async getAllStats() {
        const requests = [];

        for (const [clusterId, { worker }] of this._clusters) {
            requests.push(this._requestStats(clusterId, worker));
        }

        const results = await Promise.allSettled(requests);

        return results.map((r, i) =>
            r.status === 'fulfilled'
                ? r.value
                : { clusterId: i, error: 'Timeout ou cluster offline' }
        );
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _requestStats(clusterId, worker) {
        return new Promise((resolve, reject) => {
            const requestId = `stats_${clusterId}_${Date.now()}`;

            const timeout = setTimeout(() => {
                this._pendingStats.delete(requestId);
                reject(new Error('Timeout'));
            }, IPC_TIMEOUT_MS);

            this._pendingStats.set(requestId, { resolve, timeout });

            worker.postMessage({ type: 'GET_STATS', requestId });
        });
    }

    _handleWorkerMessage(clusterId, msg) {
        // CLUSTER_READY: shard(s) conectaram ao Discord com sucesso
        if (msg?.type === 'CLUSTER_READY') {
            const pending = this._pendingReady.get(clusterId);
            if (!pending) return;

            clearTimeout(pending.timeout);
            this._pendingReady.delete(clusterId);
            pending.resolve();
            return;
        }

        // Stats response para getAllStats()
        if (msg?.type === 'STATS_RESPONSE') {
            const pending = this._pendingStats.get(msg.requestId);
            if (!pending) return;

            clearTimeout(pending.timeout);
            this._pendingStats.delete(msg.requestId);
            pending.resolve(msg.data);
            return;
        }
        if (msg?.type === 'GET_ALL_STATS') {
    // Coleta stats de todos os clusters e devolve para quem pediu
    this.getAllStats().then((data) => {
        const { worker } = this._clusters.get(clusterId) ?? {};
        if (!worker) return;
        worker.postMessage({
            type:      'ALL_STATS_RESPONSE',
            requestId: msg.requestId,
            data,
        });
    });
    return;
}

        if (msg?.type === 'log') {
            console.log(`[Cluster ${clusterId}]`, msg.data);
        }
    }

    /**
     * Spawna o cluster e aguarda o sinal CLUSTER_READY antes de resolver.
     * Isso garante que o próximo cluster só sobe quando as shards do atual
     * estiverem conectadas ao Discord.
     */
    _spawnCluster(clusterId, shards, totalShards) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(this.workerFile, {
                workerData: {
                    clusterId,
                    shards,
                    totalShards,
                    clientOptions: this.clientOptions,
                },
            });

            this._clusters.set(clusterId, { worker, shards });

            // Timeout de segurança: se o cluster não ficar pronto a tempo, continua mesmo assim
            const readyTimeout = setTimeout(() => {
                if (this._pendingReady.has(clusterId)) {
                    console.warn(
                        `[ClusterManager] Cluster ${clusterId} não enviou CLUSTER_READY em ${CLUSTER_READY_TIMEOUT_MS / 1000}s. ` +
                        `Continuando mesmo assim...`
                    );
                    this._pendingReady.delete(clusterId);
                    resolve();
                }
            }, CLUSTER_READY_TIMEOUT_MS);

            this._pendingReady.set(clusterId, {
                resolve: () => { clearTimeout(readyTimeout); resolve(); },
                reject,
                timeout: readyTimeout,
            });

            worker.on('online', () => {
                console.log(`[Cluster ${clusterId}] Processo iniciado — shards [${shards.join(', ')}]`);
            });

            worker.on('message', (msg) => this._handleWorkerMessage(clusterId, msg));

            worker.on('error', (err) => {
                console.error(`[Cluster ${clusterId}] Error:`, err);

                // Se ainda aguardando ready, rejeita para não travar o launch()
                const pending = this._pendingReady.get(clusterId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this._pendingReady.delete(clusterId);
                    pending.reject(err);
                }
            });

            worker.on('exit', (code) => {
                console.warn(`[Cluster ${clusterId}] Exited (${code}). Restarting in ${RESTART_DELAY_MS / 1000}s…`);
                this._clusters.delete(clusterId);
                setTimeout(
                    () => this._spawnCluster(clusterId, shards, totalShards).catch(console.error),
                    RESTART_DELAY_MS
                );
            });
        });
    }

    async _resolveShardCount() {
        if (typeof this.totalShards === 'number') return this.totalShards;
        const res  = await fetch('https://discord.com/api/v10/gateway/bot', {
            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
        });
        const data = await res.json();
        return data.shards;
    }

    _chunk(arr, size) {
        const result = [];
        for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
        return result;
    }

    _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = ClusterManager;
