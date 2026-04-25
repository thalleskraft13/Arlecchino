require('dotenv').config();
const DiscordGatewayClient = require('./src/function/DiscordGatewayClient');

(async () => {
    const client = new DiscordGatewayClient({
        intents: 53608445
    });

    await client.registerSlashCommands();
    await client.connect();
})();