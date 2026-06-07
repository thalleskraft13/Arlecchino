'use strict';

const LISTASHARDS = [0, 3, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77, 82, 87, 92, 97]
const { parentPort } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const { WebSocketManager, WebSocketShardEvents } = require('@discordjs/ws');
const { REST }    = require('@discordjs/rest');
const { Routes }  = require('discord-api-types/v10');

const DiscordRequest       = require('./DiscordRequest.js');
const connectMongo         = require('./ConnectMongo.js');
const InteractionManager   = require('./Manager/InteractionManager.js');
const NextMessageCollector = require('./Manager/MessageCollectorManager.js');
const GuildManager = require('./Manager/GuildManager.js');
const TicketSystem         = require('./System/Ticket/index.js');
const UidSystem            = require('./System/UidManager.js');
const TaskManager          = require('./Manager/TaskManager.js');
const UserGlobalDb         = require('../Mongodb/userglobal.js');
const sendDm               = require('./Utils/sendDm.js');
const MessageEmbed         = require('./Messages/EmbedBuild.js');
const GenshinLeaksManager  = require('./System/GenshinLeaksManager.js');
const LogicEngine = require('./System/EventCreater/LogicEngine.js')
const FlowUI = require('./System/EventCreater/FlowUI.js');
const BirthdayManager = require("./System/BirthdayManager.js");
const LibraryManager = require("./System/EventCreater/LibraryManager.js");
const MissionManager = require('./System/MissionManager.js');
const EventEmitter = require('events');





const MAX_ADVENTURE_LEVEL  = 60;
const XP_PER_INTERACTION   = 10;
const ROLLS_PER_LEVEL      = 5;
const PRIMOGEMAS_PER_ROLL  = 160;

const INTERACTION_TYPE = Object.freeze({
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT:   3,
    MODAL_SUBMIT:        5,
});

const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS  = 30_000;
const RECONNECT_MAX_ATTEMPTS  = 10;


class DiscordGatewayClient extends EventEmitter {



    constructor(options = {}) {
      super()
        this._validateEnv();

        this.token    = process.env.DISCORD_TOKEN;
        this.clientId = process.env.CLIENT_ID;
        this.options  = options;
        this.CLUSTERS_NAME = ["Knave", "Sweet Night"];

        this.commands = new Map();


        this.rest = new REST({ version: '10' }).setToken(this.token);

        this.manager = new WebSocketManager({
            token:    this.token,
            intents:  options.intents ?? 0,
            rest:     this.rest,
            presence: this._buildDefaultPresence(),
            shardIds:    options.shards      ?? undefined,
            shardCount:  options.totalShards ?? undefined,
        });


        this.interactions      = new InteractionManager(this);
        this.NextMessageCollector = new NextMessageCollector(this);
        this.ticketSystem      = new TicketSystem(this);
        this.taskManager       = new TaskManager(this);
        this.UidManager        = new UidSystem(this);
        this.GenshinLeaksManager = new GenshinLeaksManager(this);
        this.logicEngine = new LogicEngine(this);
        this.logicUI = new FlowUI(this);
        this.libraryManager = new LibraryManager(this);
        this.birthdayManager = new BirthdayManager(this);
        this.missionManager = new MissionManager(this);

        
        this.guilds = new GuildManager(this);

        this._reconnectAttempts = 0;
        this._isReconnecting    = false;
        this._reconnectTimer    = null;
        this._mongoConnected  = false;
        this._mongoConnecting = false;
        
     //   this._loadCommands();
        this._registerGatewayEvents();
        this._registerAntiCrash();
        
    }


    async connect() {
      console.log("\n\n|————————————————————————|\n")
        try {
            console.log('[Gateway] Connecting…');
            await this.manager.connect();
            this._resetReconnect();
            console.log('[Gateway] Connected.');
        } catch (err) {
            console.error('[Gateway] Connection error:', err);
            this._scheduleReconnect();
        }
    }

    /**
     * Sync slash commands with the Discord API.
     * Registers new, updates changed, deletes removed commands.
     */
    async registerSlashCommands() {
      //  console.log('[Deploy] Starting slash command sync…');

        const localCommands = [...this.commands.values()].map(c => c.data);
        const apiCommands   = await this.rest.get(Routes.applicationCommands(this.clientId));

        const apiMap   = new Map(apiCommands.map(c => [c.name, c]));
        const localMap = new Map(localCommands.map(c => [c.name, c]));

        const stats = { created: 0, updated: 0, deleted: 0, skipped: 0 };


        for (const apiCmd of apiCommands) {
            if (!localMap.has(apiCmd.name)) {
                await this.rest.delete(Routes.applicationCommand(this.clientId, apiCmd.id));
            //    console.log(`[Deploy] Deleted: /${apiCmd.name}`);
                stats.deleted++;
            }
        }


        for (const localCmd of localCommands) {
            const existing = apiMap.get(localCmd.name);

            if (!existing) {
                await this.rest.post(Routes.applicationCommands(this.clientId), { body: localCmd });
           //     console.log(`[Deploy] Created: /${localCmd.name}`);
                stats.created++;
                continue;
            }

            if (this._commandHasChanged(localCmd, existing)) {
                await this.rest.patch(
                    Routes.applicationCommand(this.clientId, existing.id),
                    { body: localCmd }
                );
           //     console.log(`[Deploy] Updated: /${localCmd.name}`);
                stats.updated++;
            } else {
                stats.skipped++;
            }
        }

    //    console.log(
    //        `[Deploy] Done — created: ${stats.created}, updated: ${stats.updated}, ` +
   //         `deleted: ${stats.deleted}, skipped: ${stats.skipped}.`
   //     );

        return stats;
    }

    /** Update the bot's presence/activity on all shards. */
    setPresence(shardId, opts = {}) {
    const payload = {
        op: 3,
        d: {
            since:      opts.since  ?? null,
            activities: [{
                name:    opts.name  ?? `🌙 Lua Carmesin | Cluster ${process.env.CLUSTER_ID ?? 0}`,
                type:    opts.type  ?? 0,
                url:     opts.url,
                state:   opts.state,
                details: opts.details,
            }],
            status: opts.status ?? 'online',
            afk:    opts.afk    ?? false,
        },
    };

    // Envia para todos os shards deste cluster
    
   if (shardId === "all"){
   const shards = process.env.SHARD_LIST?.split(',').map(Number) ?? [0];

    for (const shardId of shards) {
        this.manager.send(shardId, payload);
    }
   } else {
    this.manager.send(shardId, payload);
   }
  }

    _validateEnv() {
        for (const key of ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI']) {
            if (!process.env[key])
                throw new Error(`[DiscordGatewayClient] Missing env variable: ${key}`);
        }
    }

    _buildDefaultPresence() {
        return {
            status:   'online',
            activity: { name: '🌙 Lua Carmesin', type: 0 },
            afk:      false,
        };
    }


    _loadCommands() {
        const basePath = path.join(process.cwd(), 'src', 'Commands');
        if (!fs.existsSync(basePath)) return;

        let loaded = 0;

        for (const folder of fs.readdirSync(basePath)) {
            const folderPath = path.join(basePath, folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;

            for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
                try {
                    const command = require(path.join(folderPath, file));
                    if (!command?.data || !command?.execute) continue;
                    if (!command.info) command.info = {};
                    this.commands.set(command.data.name, command);
                    loaded++;
                } catch (err) {
                    console.error(`[Commands] Failed to load ${file}:`, err);
                }
            }
        }

        console.log(`[Commands] Loaded ${loaded} commands.`);
    }


    _registerGatewayEvents() {
        this.manager.on(WebSocketShardEvents.Dispatch, (payload) =>
            this._handleDispatch(payload)
        );

        this.manager.on(WebSocketShardEvents.Error, (err) => {
            console.error('[Gateway] Error:', err);
            this._scheduleReconnect();
        });

        this.manager.on(WebSocketShardEvents.Close, (event) => {
            console.warn('[Gateway] Closed — code:', event?.code);
            this._scheduleReconnect();
        });
    }



    _registerAntiCrash() {
        process.on('unhandledRejection',        (r)   => console.error('[AntiCrash] Unhandled Rejection:', r));
        process.on('uncaughtException',         (err) => console.error('[AntiCrash] Uncaught Exception:', err));
        process.on('uncaughtExceptionMonitor',  (err) => console.error('[AntiCrash] Exception Monitor:', err));
        process.on('warning',                   (w)   => console.warn('[AntiCrash] Warning:', w));
    }


    _resetReconnect() {
        this._reconnectAttempts = 0;
        this._isReconnecting    = false;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    _scheduleReconnect() {
        if (this._isReconnecting) return;

        if (this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error('[Reconnect] Maximum attempts reached. Giving up.');
            return;
        }

        this._isReconnecting = true;
        this._reconnectAttempts++;

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * this._reconnectAttempts,
            RECONNECT_MAX_DELAY_MS
        );

        console.log(
            `[Reconnect] Retrying in ${delay / 1000}s… ` +
            `(attempt ${this._reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`
        );

        this._reconnectTimer = setTimeout(() => this._attemptReconnect(), delay);
    }

    async _attemptReconnect() {
        try {
            await this.manager.connect();
            console.log('[Reconnect] Reconnected successfully.');
            this._resetReconnect();
        } catch (err) {
            console.error('[Reconnect] Attempt failed:', err);
            this._isReconnecting = false;
            this._scheduleReconnect();
        }
    }


    async _handleDispatch(payload) {
        try {
            this.NextMessageCollector.handle(payload);
            this.guilds.handleDispatch(payload);
            await this.logicEngine.handleGateway(payload);

            if (payload.t === 'READY')             return await this._onReady(payload.d);
            if (payload.t === 'INTERACTION_CREATE') return await this._onInteraction(payload.d);
            
            if (payload.t === 'VOICE_STATE_UPDATE')   return await this._onVoiceStateUpdate(payload.d);   
        if (payload.t === 'MESSAGE_REACTION_ADD') return await this._onReactionAdd(payload.d);        

        } catch (err) {
            console.error('[Dispatch] Unhandled error:', err);
        }
    }
    
    
    _onVoiceStateUpdate(d) {
    if (!d.user_id || d.user_id === this.clientId) return;

    if (!this._voiceSessions) this._voiceSessions = new Map();

    const key     = d.user_id;
    const guildId = d.guild_id;

    const wasInVoice = this._voiceSessions.has(key);
    const isInVoice  = !!d.channel_id;

    // Entrou em call
    if (!wasInVoice && isInVoice) {
        this._voiceSessions.set(key, { guildId, joinedAt: Date.now() });

        // Missão: entrar em call (goal = 1)
        this.missionManager.trackEvent(d.user_id, 'join_voice', 1, guildId).catch(() => {});
        return;
    }

    // Saiu ou trocou de canal — calcula minutos
    if (wasInVoice && !isInVoice) {
        const session = this._voiceSessions.get(key);
        this._voiceSessions.delete(key);

        const minutes = Math.floor((Date.now() - session.joinedAt) / 60_000);
        if (minutes > 0) {
            this.missionManager.trackEvent(d.user_id, 'voice_minutes', minutes, session.guildId).catch(() => {});
        }
    }

    // Trocou de canal (saiu de um e entrou em outro) — reinicia sessão
    if (wasInVoice && isInVoice) {
        const session = this._voiceSessions.get(key);
        const minutes = Math.floor((Date.now() - session.joinedAt) / 60_000);
        if (minutes > 0) {
            this.missionManager.trackEvent(d.user_id, 'voice_minutes', minutes, session.guildId).catch(() => {});
        }
        // Reinicia com o novo canal
        this._voiceSessions.set(key, { guildId, joinedAt: Date.now() });
    }
}

// ── Reação ───────────────────────────────────────────────
async _onReactionAdd(d) {
    const userId  = d.user_id;
    const guildId = d.guild_id;

    // Ignora bots
    if (!userId || !guildId) return;

    await this.missionManager.trackEvent(userId, 'add_reaction', 1, guildId).catch(() => {});
}



    async _onReady(d) {
    console.log(`\n----------> SHARD: ${d.shard[0]}`)
    await this._loadCommands();
  //  await this._connectMongo(); // todos conectam
    const shards = process.env.SHARD_LIST?.split(',').map(Number) ?? [0];
    

    if (LISTASHARDS.includes(d.shard[0])) {
        await this._connectMongo()
        await this._startTaskManager();
        await this.logicEngine.start();
        await this.libraryManager.start()
        await this.registerSlashCommands();
        console.log("\n|————————————————————————|")
        await this.emit('ready')
    }
   

    this.setPresence(d.shard[0],{
      name: `🌙 Assinatura Lua Carmesin por R$8,99 | Cluster ${this.CLUSTERS_NAME[process.env.CLUSTER_ID ?? 0]}, Shard: ${d.shard[0]}/4`
    });
    

}

    async _connectMongo() {
        if (this._mongoConnected || this._mongoConnecting) return;

        this._mongoConnecting = true;
        try {
            await connectMongo();
            this._mongoConnected  = true;
            this._mongoConnecting = false;
            console.log('[Ready] MongoDB connected.');
        } catch (err) {
            this._mongoConnecting = false;
            console.error('[Ready] MongoDB connection failed:', err);
        }
    }

    async _startTaskManager() {
        try {
            await this.taskManager.start();
            console.log('[Ready] TaskManager started.');
        } catch (err) {
            console.error('[Ready] TaskManager failed to start:', err);
        }
    }



    async _onInteraction(interaction) {
        // Always process XP first, regardless of interaction type
        await this._processAdventureRankXp(interaction);

        switch (interaction.type) {
            case INTERACTION_TYPE.APPLICATION_COMMAND:
                return this._executeCommand(interaction);
            case INTERACTION_TYPE.MESSAGE_COMPONENT:
                return this.interactions.handleComponent(interaction);
            case INTERACTION_TYPE.MODAL_SUBMIT:
                return this.interactions.handleModal(interaction);
        }
    }

    async _executeCommand(interaction) {
        const command = this.commands.get(interaction.data.name);
        if (!command) return;

        try {
            await command.execute(interaction, this);
        } catch (err) {
            console.error(`[Command] Error executing /${interaction.data.name}:`, err);
        }
    }



    async _processAdventureRankXp(interaction) {
        const userId = interaction.member?.user?.id;
        if (!userId) return;

        try {
            const user = await this._getOrCreateUser(userId);

            const levelBefore = user.rankaventureiro.nivelAtual;

            this._awardXp(user);
            this._recalculateLevel(user);

            const levelAfter   = user.rankaventureiro.nivelAtual;
            const levelsGained = levelAfter - levelBefore;

            if (levelsGained > 0) {
                this._applyLevelUpRewards(user, levelBefore, levelAfter);
            }

            this._updateXpRemaining(user);

            await user.save();

            if (levelsGained > 0 && user.dmNotificacoes) {
                await this._sendLevelUpDm(userId, user, levelBefore, levelAfter);
            }
        } catch (err) {
            console.error('[AdventureRank] Error processing XP:', err);
        }
    }

    async _getOrCreateUser(userId) {
        let user = await UserGlobalDb.findOne({ userId });

        if (!user) {
            user = await UserGlobalDb.create({
                userId,
                rankaventureiro: { nivelAtual: 0, xpTotal: 0, xpRestante: 1000 },
            });
        }

        if (!user.rankaventureiro) {
            user.rankaventureiro = { nivelAtual: 0, xpTotal: 0, xpRestante: 1000 };
        }

        return user;
    }

    _awardXp(user) {
        user.rankaventureiro.xpTotal += XP_PER_INTERACTION;
    }

    _recalculateLevel(user) {
        let { nivelAtual, xpTotal } = user.rankaventureiro;

        while (nivelAtual < MAX_ADVENTURE_LEVEL) {
            if (xpTotal >= (nivelAtual + 1) * 1000) {
                nivelAtual++;
            } else {
                break;
            }
        }

        user.rankaventureiro.nivelAtual = Math.min(nivelAtual, MAX_ADVENTURE_LEVEL);
    }

    _applyLevelUpRewards(user, levelBefore, levelAfter) {
        const levelsGained = levelAfter - levelBefore;
        const rolls        = levelsGained * ROLLS_PER_LEVEL;
        const primogemas   = rolls * PRIMOGEMAS_PER_ROLL;

        user.primogemas.atm += primogemas;

        if (!Array.isArray(user.primogemas.transacoes)) {
            user.primogemas.transacoes = [];
        }

        user.primogemas.transacoes.push({
            type:      'adventure_rank_reward',
            value:     primogemas,
            rolls,
            old_level: levelBefore,
            new_level: levelAfter,
            date:      Date.now(),
        });
    }

    _updateXpRemaining(user) {
        const { nivelAtual, xpTotal } = user.rankaventureiro;

        if (nivelAtual >= MAX_ADVENTURE_LEVEL) {
            user.rankaventureiro.xpRestante = 0;
            return;
        }

        user.rankaventureiro.xpRestante = ((nivelAtual + 1) * 1000) - xpTotal;
    }



    async _sendLevelUpDm(userId, user, levelBefore, levelAfter) {
        try {
            const levelsGained = levelAfter - levelBefore;
            const rolls        = levelsGained * ROLLS_PER_LEVEL;
            const primogemas   = rolls * PRIMOGEMAS_PER_ROLL;

            const userData = await DiscordRequest(`/users/${userId}`, { method: 'GET' });

            const embed = new MessageEmbed()
                .setTitle('Novo Rank de Aventureiro!')
                .setColor('Red')
                .setThumbnail(this._getAvatarUrl(userData))
                .setDescription(this._buildLevelUpDescription({
                    levelBefore,
                    levelAfter,
                    rolls,
                    primogemas,
                    xpTotal:    user.rankaventureiro.xpTotal,
                    xpRestante: user.rankaventureiro.xpRestante,
                }));

            await sendDm(userId, { embeds: [embed.build()] });
        } catch (err) {
            console.error('[DM] Failed to send level-up DM:', err);
        }
    }

    _getAvatarUrl(user) {
        if (!user.avatar) return 'https://cdn.discordapp.com/embed/avatars/0.png';
        const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=1024`;
    }

    _buildLevelUpDescription({ levelBefore, levelAfter, rolls, primogemas, xpTotal, xpRestante }) {
        return (
`Hm... então você evoluiu.

Do Rank de Aventureiro **#${levelBefore}** para **#${levelAfter}**.
Nada mal. Você começa a entender o peso do próprio crescimento.

Como reconhecimento pelo avanço, a Casa da Lareira concedeu a você **${rolls} giros**.

💎 Recompensa recebida:
**${primogemas.toLocaleString()} Primogemas**

Use-os com sabedoria… ou desperdice-os como tantos outros fazem.

Sua experiência atual é **${xpTotal}XP**.
Ainda faltam **${xpRestante}XP** para alcançar o Rank de Aventureiro **#${levelAfter + 1}**.

Não pense que isso é o suficiente.
O verdadeiro valor não está no número… mas no quanto você suporta para alcançá-lo.

Continue.

Eu estarei observando.`
        );
    }



    /**
     * Deep-compare the fields Discord accepts on a command PATCH.
     * Returns true when a local command differs from the API version.
     */
    _commandHasChanged(local, api) {
        const normalize = (cmd) => JSON.stringify({
            name:                       cmd.name,
            description:                cmd.description                ?? '',
            options:                    cmd.options                    ?? [],
            default_member_permissions: cmd.default_member_permissions ?? null,
            dm_permission:              cmd.dm_permission              ?? true,
            nsfw:                       cmd.nsfw                       ?? false,
        });

        return normalize(local) !== normalize(api);
    }
    
    // Retorna o shard responsável por uma guild
getShardId(guildId) {
    const totalShards = parseInt(process.env.TOTAL_SHARDS ?? '1');
    return Number(BigInt(guildId) >> 22n) % totalShards;
}

// Retorna os shards ativos neste cluster
getShards() {
    return process.env.SHARD_LIST?.split(',').map(Number) ?? [0];
}

// Retorna o cluster ID
getClusterId() {
    return parseInt(process.env.CLUSTER_ID ?? '0');
}

// Calcula o ping de um shard específico
async getShardPing(shardId) {
    try {
        const start = Date.now();
        await DiscordRequest(`/gateway`, { method: 'GET' });
        return Date.now() - start;
    } catch {
        return -1;
    }
}

// Retorna info completa de todos os shards do cluster
async getClusterInfo() {
    const shards  = this.getShards();
    const cluster = this.getClusterId();

    const shardInfos = await Promise.all(
        shards.map(async (shardId) => ({
            shardId,
            ping: await this.getShardPing(shardId),
        }))
    );

    return {
        clusterId: cluster,
        shards:    shardInfos,
        totalShards: parseInt(process.env.TOTAL_SHARDS ?? '1'),
        uptime:    process.uptime(),
        memory:    process.memoryUsage().heapUsed,
    };
}

requestAllStats() {
    return new Promise((resolve, reject) => {
        const requestId = `allstats_${Date.now()}`;
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10_000);

        this.once('all_stats_response', (msg) => {
            if (msg.requestId !== requestId) return;
            clearTimeout(timeout);
            resolve(msg.data);
        });

        parentPort.postMessage({ type: 'GET_ALL_STATS', requestId });
    });
}
}

module.exports = DiscordGatewayClient;
