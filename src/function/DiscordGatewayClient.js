const fs = require('fs');
const path = require('path');
const { WebSocketManager, WebSocketShardEvents } = require('@discordjs/ws');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const connectMongo = require('./ConnectMongo');
const InteractionManager = require("./InteractionManager");
const NextMessageCollector = require("./MessageCollectorManager");
const TicketSystem = require("./Manager/TicketSetup");
const TaskManager = require("./TaskManager");

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
            shardCount: 1,
            presence: {
              status: "online",
                activities: [
                   {
                     name: "Assine 'Lua Carmesin' para beneficios por apenas R$6,99!",
                     type: 0
                   }
                ],
               afk: false
             }
        });

        this.interactions = new InteractionManager(this);
        this.NextMessageCollector = new NextMessageCollector(this);
        this.ticketSystem = new TicketSystem(this);
        this.TaskManager = new TaskManager(this);

        this._loadCommands();
        this._registerEvents();
    }

    _validateEnv() {

        if (!process.env.DISCORD_TOKEN)
            throw new Error('DISCORD_TOKEN is not defined.');

        if (!process.env.CLIENT_ID)
            throw new Error('CLIENT_ID is not defined.');

        if (!process.env.MONGO_URI)
            throw new Error('MONGO_URI is not defined.');
    }

    _loadCommands() {

        const basePath = path.join(process.cwd(), 'src', 'Commands');

        if (!fs.existsSync(basePath)) return;

        const folders = fs.readdirSync(basePath);

        for (const folder of folders) {

            const folderPath = path.join(basePath, folder);

            const files = fs.readdirSync(folderPath)
                .filter(file => file.endsWith('.js'));

            for (const file of files) {

                const command = require(path.join(folderPath, file));

                if (!command.data || !command.execute) continue;

                if (!command.info)
                    command.info = {};

                this.commands.set(command.data.name, command);
            }
        }
    }

    async registerSlashCommands() {

        const localCommands = [...this.commands.values()].map(cmd => cmd.data);

        const apiCommands = await this.rest.get(
            Routes.applicationCommands(this.clientId)
        );

        const apiMap = new Map(
            apiCommands.map(cmd => [cmd.name, cmd])
        );

        for (const apiCmd of apiCommands) {

            if (!this.commands.has(apiCmd.name)) {
                await this.rest.delete(
                    Routes.applicationCommand(this.clientId, apiCmd.id)
                );
            }
        }

        for (const localCmd of localCommands) {

            const existing = apiMap.get(localCmd.name);

            if (!existing) {

                await this.rest.post(
                    Routes.applicationCommands(this.clientId),
                    { body: localCmd }
                );

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
            }
        }
    }

    async _registerEvents() {

        this.manager.on(WebSocketShardEvents.Ready, (data, shard) => {
            this.shards.set(shard.id, shard);
        });

        this.manager.on(WebSocketShardEvents.Dispatch, async (payload) => {

            this.NextMessageCollector.handle(payload);

            if (payload.t === "READY") {
                await this.TaskManager.start();
                console.log("Client está ligado!")
                await connectMongo();
            }

            if (payload.t !== 'INTERACTION_CREATE') return;

            const interaction = payload.d;

            if (interaction.type === 3) {
                return this.interactions.handleComponent(interaction);
            }

            if (interaction.type === 5) {
                return this.interactions.handleModal(interaction);
            }

            if (interaction.type !== 2) return;

            const command = this.commands.get(interaction.data.name);
            if (!command) return;

            try {
                await command.execute(interaction, this);
            } catch (error) {
                console.error(error);
            }
        });
    }

    async connect() {

        await this.manager.connect();
    }

    getPing(shardId = 0) {
        const shard = this.shards.get(shardId);
        return shard?.ping ?? null;
    }
}

module.exports = DiscordGatewayClient;