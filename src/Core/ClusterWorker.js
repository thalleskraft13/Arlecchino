'use strict';

const { workerData, parentPort } = require('worker_threads');
const { clusterId, shards, totalShards, clientOptions } = workerData;

process.env.CLUSTER_ID   = String(clusterId);
process.env.SHARD_LIST   = shards.join(',');
process.env.TOTAL_SHARDS = String(totalShards);

const DiscordGatewayClient = require('../function/DiscordGatewayClient.js');

async function main() {
    const client = new DiscordGatewayClient({
        ...clientOptions,
        shards,
        totalShards,
        isPrimary: clusterId === 0,
    });

    // Escuta requests do ClusterManager
    parentPort.on('message', async (msg) => {
    if (msg?.type === 'GET_STATS') {
        const data = await client.getClusterInfo();
        parentPort.postMessage({
            type:      'STATS_RESPONSE',
            requestId: msg.requestId,
            data,
        });
    }

    if (msg?.type === 'ALL_STATS_RESPONSE') {
        // Repassa para o client resolver a Promise pendente
        client.emit('all_stats_response', msg);
    }
});
    
    client.once('ready', () => {
    parentPort.postMessage({ type: 'CLUSTER_READY' });
    console.log(`[ClusterWorker ${clusterId}] Pronto!`);
});



    await client.connect();
}

main().catch((err) => {
    console.error(`[ClusterWorker ${clusterId}] Fatal:`, err);
    process.exit(1);
});