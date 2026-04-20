const DiscordRequest = require("../../function/DiscordRequest");
const MessageEmbed = require("../../function/Messages/EmbedBuild");
const UserEconomy = require("../../function/Gacha/Economy");

module.exports = {
  data: {
    name: 'primogemas',
    description: 'Lista de comandos sobre Primogemas',
    type: 1,
    options: [{
      name: "saldo",
      description: "Veja seu saldo atual de Primogemas",
      type: 1,
      options: [{
        name: "user",
        description: "Mencione ou insira o ID do usuario",
        type: 6,
        required: false
      }]
    }]
  },

  async execute(interaction, client) {

    // Defer reply
    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        body: { type: 5 }
      }
    );

    let subcommand = interaction.data.options[0];

    if (subcommand.name === "saldo") {

      const authorId = interaction.member.user.id;
      const mentionedUser = subcommand.options?.[0]?.value;

      const targetId = mentionedUser || authorId;

      const economy = new UserEconomy(targetId);
      const data = await economy.getTotal();

      const saldo = data.currentBalance;

      let description;

      if (targetId === authorId) {
        description = `💎 **Você tem ${saldo} primogemas!**`;
      } else {
        description = `💎 <@${targetId}> tem **${saldo} primogemas!**`;
      }

      const embed = new MessageEmbed()
        .setTitle("💰 Saldo de Primogemas")
        .setColor("Gold")
        .setDescription(description)
        .setTimestamp()
        .build();

      await DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
                method: "POST",
          body: {
            embeds: [embed]
          }
        }
      );
    }
  }
};