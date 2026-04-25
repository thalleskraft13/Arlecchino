const fs = require('fs');
const path = require('path');
const { WebSocketManager, WebSocketShardEvents } = require('@discordjs/ws');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const connectMongo = require('./ConnectMongo');
const InteractionManager = require("./InteractionManager")
const NextMessageCollector = require("./MessageCollectorManager")

class DiscordGatewayClient {

    constructor(options = {}) {

        this._validateEnv();

        this.token = process.env.DISCORD_TOKEN;
        this.clientId = process.env.CLIENT_ID;

        this.commands = new Map();
        this.shards = new Map();

        this.rest = new REST({ version: '10' }).setToken(this.token);

        this.manager = new WebSocketManager({
            token: this.token,
            intents: options.intents ?? 0,
            rest: this.rest,
            shardCount: 1
        });

        this._consoleSeparator("BOOT");
        this.interactions = new InteractionManager(this);
        this.NextMessageCollector = new NextMessageCollector(this);
        this._loadCommands();
        this._registerEvents();
    }

    /* ===============================
       ENV VALIDATION
    =============================== */
    _validateEnv() {

        if (!process.env.DISCORD_TOKEN)
            throw new Error('DISCORD_TOKEN is not defined.');

        if (!process.env.CLIENT_ID)
            throw new Error('CLIENT_ID is not defined.');

        if (!process.env.MONGO_URI)
            throw new Error('MONGO_URI is not defined.');
    }

    /* ===============================
       CONSOLE SEPARATOR
    =============================== */
    _consoleSeparator(title = "") {
        console.log("\n==============================================");
        console.log(`🚀 ${title}`);
        console.log("==============================================\n");
    }

    /* ===============================
       LOAD COMMAND FILES
    =============================== */
    _loadCommands() {

        this._consoleSeparator("LOADING COMMANDS");

        const basePath = path.join(process.cwd(), 'src', 'Commands');
        if (!fs.existsSync(basePath)) {
            console.warn("⚠ Commands folder not found.");
            return;
        }

        const folders = fs.readdirSync(basePath);

        for (const folder of folders) {

            const folderPath = path.join(basePath, folder);
            const files = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.js'));

            for (const file of files) {

                const command = require(path.join(folderPath, file));

                if (!command.data || !command.execute) {
                    console.warn(`❌ Invalid command file: ${file}`);
                    continue;
                }

                if (!command.info)
                    command.info = {};

                this.commands.set(command.data.name, command);
                console.log(`✔ Loaded: ${command.data.name}`);
            }
        }

        console.log(`\n✅ Total Commands: ${this.commands.size}`);
    }

    /* ===============================
       SMART GLOBAL SYNC
    =============================== */
    async registerSlashCommands() {

        this._consoleSeparator("SYNCING SLASH COMMANDS");

        const localCommands = [...this.commands.values()].map(cmd => cmd.data);

        const apiCommands = await this.rest.get(
            Routes.applicationCommands(this.clientId)
        );

        const apiMap = new Map(
            apiCommands.map(cmd => [cmd.name, cmd])
        );

        /* DELETE UNUSED */
        for (const apiCmd of apiCommands) {

            if (!this.commands.has(apiCmd.name)) {

                await this.rest.delete(
                    Routes.applicationCommand(this.clientId, apiCmd.id)
                );

                console.log(`🗑 Deleted: ${apiCmd.name}`);
            }
        }

        /* CREATE OR UPDATE */
        for (const localCmd of localCommands) {

            const existing = apiMap.get(localCmd.name);

            if (!existing) {

                await this.rest.post(
                    Routes.applicationCommands(this.clientId),
                    { body: localCmd }
                );

                console.log(`🆕 Created: ${localCmd.name}`);
                continue;
            }

            const localString = JSON.stringify(localCmd);

            const apiComparable = {
                name: existing.name,
                description: existing.description,
                options: existing.options ?? []
            };

            const apiString = JSON.stringify(apiComparable);

            if (localString !== apiString) {

                await this.rest.patch(
                    Routes.applicationCommand(this.clientId, existing.id),
                    { body: localCmd }
                );

                console.log(`🔄 Updated: ${localCmd.name}`);
            }
        }

        console.log("\n✅ Slash Commands synchronized.");
    }

    /* ===============================
       EVENT HANDLING
    =============================== */
    _registerEvents() {

        this._consoleSeparator("REGISTERING EVENTS");

        this.manager.on(WebSocketShardEvents.Ready, (data, shard) => {
            this.shards.set(shard.id, shard);
            console.log(`🟢 Shard ${shard.id} READY | Ping: ${shard.ping}ms`);
        });

        this.manager.on(WebSocketShardEvents.Dispatch, async (payload) => {
          
          this.NextMessageCollector.handle(payload)

            if (payload.t !== 'INTERACTION_CREATE') return;

            const interaction = payload.d;

            if (interaction.type !== 2) return;

            const command = this.commands.get(interaction.data.name);
            if (!command) return;

            try {

                

                await command.execute(interaction, this);

            } catch (error) {

                console.error(`❌ Error in command "${interaction.data.name}":`);
                console.error(error);
            }
        });
        
        this.interactions.run();
    }

    /* ===============================
       CONNECT SYSTEM
    =============================== */
    async connect() {

        this._consoleSeparator("CONNECTING SYSTEMS");

        await connectMongo();
        console.log("🗄 MongoDB Ready.");

        await this.manager.connect();
        console.log("🌐 Connected to Discord Gateway.");
    }

    /* ===============================
       GET SHARD PING
    =============================== */
    getPing(shardId = 0) {
        const shard = this.shards.get(shardId);
        return shard?.ping ?? null;
    }
}

module.exports = DiscordGatewayClient;