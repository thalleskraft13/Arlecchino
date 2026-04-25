const DiscordRequest = require("../../function/DiscordRequest");

module.exports = {
    data: {
        name: 'lembrete',
        description: 'Receba um lembrete',
        options: [
            {
                name: "tempo",
                description: "Tempo do lembrete (ex: 10s, 5m, 1h30m, 2d)",
                type: 3,
                required: true
            },
            {
                name: "mensagem",
                description: "Mensagem do lembrete",
                type: 3,
                required: true
            }
        ]
    },

    async execute(interaction, client) {
      
      await DiscordRequest(`/interactions/${interaction.id}/${interaction.token}/callback`,{
        method: "POST",
        body: {
            "type": 5
        }
      })

        const tempoInput = interaction.data.options.find(o => o.name === "tempo")?.value;
        const mensagem = interaction.data.options.find(o => o.name === "mensagem")?.value;

        function parseTime(input) {

            if (!input) return null;

            const regex = /(\d+)([smhd])/g;
            let total = 0;

            let match;

            while ((match = regex.exec(input)) !== null) {

                const value = parseInt(match[1]);
                const unit = match[2];

                switch (unit) {
                    case "s": total += value * 1000; break;
                    case "m": total += value * 60000; break;
                    case "h": total += value * 3600000; break;
                    case "d": total += value * 86400000; break;
                }
            }

            return total || null;
        }

        const delay = parseTime(tempoInput);

        if (!delay) {
            return await DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
                method: "POST",
                body: { 
                   content: "❌ Tempo inválido. Use: 10s, 5m, 1h, 2d, 1h30m",
                  }
               });
            
            
        }

        await client.TaskManager.create({
            tipo: "lembrete",
            delay,
            dados: {
                userId: interaction.member.user.id,
                channelId: interaction.channel_id,
                mensagem
            }
        });
        
        return await DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
                method: "POST",
                body: { 
                   content: `⏰ Lembrete criado para **${tempoInput}**`
                  }
               });

    }
};