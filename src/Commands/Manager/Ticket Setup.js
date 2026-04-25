const getPerm = require("../../function/Utils/GetPerm");
const DiscordRequest = require("../../function/DiscordRequest");

module.exports = {

  data: {
    name: "configurar-ticket",
    description: "Configurar sistema de tickets"
  },

  info: {
    perm: ["MANAGE_GUILD"] // só organização/admin
  },

  async execute(interaction, client) {

    const guildId = interaction.guild_id;
    const userId = interaction.member.user.id;

    /* =========================================
       PERMISSÃO
    ========================================= */

const perms = await getPerm({
  id: interaction.member.user.id,
  guildId: interaction.guild_id
});

if (!perms || !perms.includes("MANAGE_GUILD")) {

  await DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: "POST",
      body: {
        type: 4,
        data: {
          content: "❌ Você precisa da permissão **Gerenciar Servidor** para usar este comando.",
          flags: 64
        }
      }
    }
  );

  return;
}
    
    /* =========================================
       INICIAR SETUP
    ========================================= */
   

    // 🔥 PRIMEIRA RESPOSTA (OBRIGATÓRIA)
    await client.ticketSystem.reply(interaction, {
      content: "⚙️ Configurando...",
      components: []
    });

    // 🔥 AGORA PODE EDITAR NORMAL
    return client.ticketSystem.startSetup(interaction);
  }
};