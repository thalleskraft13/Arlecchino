const DiscordRequest = require("../../function/DiscordRequest");
const MessageEmbed = require("../../function/Messages/EmbedBuild");
const UserEconomy = require("../../function/Gacha/Economy");
const UserGlobal = require("../../Mongodb/userglobal");

/* =========================
   MS HELPER
========================== */
function MS(time) {
  const value = parseInt(time);
  const unit = time.replace(value, "").toLowerCase();

  const units = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  return value * (units[unit] || 1);
}

module.exports = {
  data: {
    name: 'primogemas',
    description: 'Comandos relacionados às Primogemas',
    type: 1,
    options: [
      {
        name: "saldo",
        description: "Veja o saldo de primogemas",
        type: 1,
        options: [{
          name: "user",
          description: "Mencione ou insira o ID do usuário",
          type: 6,
          required: false
        }]
      },
      {
        name: "daily",
        description: "Resgate suas primogemas diárias",
        type: 1
      }
    ]
  },

  async execute(interaction, client) {

    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        body: { type: 5 }
      }
    );

    const subcommand = interaction.data.options[0];
    const authorId = interaction.member.user.id;

    /* =========================
       SALDO
    ========================== */
    if (subcommand.name === "saldo") {

      const mentionedUser = subcommand.options?.[0]?.value;
      const targetId = mentionedUser || authorId;

      const economy = new UserEconomy(targetId);
      const data = await economy.getTotal();
      const saldo = data.currentBalance;

      const embed = new MessageEmbed()
        .setTitle("Saldo de Primogemas")
        .setColor("Gold")
        .setDescription(
          targetId === authorId
            ? `💎 **Você tem ${saldo} primogemas!**`
            : `💎 <@${targetId}> tem **${saldo} primogemas!**`
        )
        .setTimestamp()
        .build();

      return await DiscordRequest(
        `/webhooks/${interaction.application_id}/${interaction.token}`,
        { method: "POST", body: { embeds: [embed] } }
      );
    }

    /* =========================
       DAILY
    ========================== */
    if (subcommand.name === "daily") {

      const reward = 160;
      const now = Date.now();

      let user = await UserGlobal.findOne({ userId: authorId });

      if (!user) {
        user = await UserGlobal.create({ userId: authorId });
      }

      const expiresAt = user.primogemas.daily_tempo || 0;

      const button = client.interactions.createButton({
        user: authorId,
        tempo: MS("24h"),
        data: {
          label: "Resgatar Daily",
          style: 3
        },
        funcao: async (i) => {

          const nowClick = Date.now();

          const freshUser = await UserGlobal.findOne({ userId: authorId });
          const expires = freshUser.primogemas.daily_tempo || 0;

          /* =========================
             COOLDOWN CHECK
          ========================== */
          if (nowClick < expires) {

            const remaining = expires - nowClick;

            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);

            const embedCooldown = new MessageEmbed()
              .setTitle("⏳ Daily em cooldown")
              .setColor("Orange")
              .setDescription(
                `Volte em **${hours}h ${minutes}m**`
              )
              .setTimestamp()
              .build();

            return await DiscordRequest(
              `/interactions/${i.id}/${i.token}/callback`,
              {
                method: "POST",
                body: {
                  type: 7, // EDIT ORIGINAL MESSAGE
                  data: {
                    embeds: [embedCooldown],
                    components: []
                  }
                }
              }
            );
          }

          /* =========================
             GIVE REWARD
          ========================== */

          const newExpire = nowClick + MS("24h");

          const updated = await UserGlobal.findOneAndUpdate(
            { userId: authorId },
            {
              $inc: { "primogemas.atm": reward },
              $set: { "primogemas.daily_tempo": newExpire },
              $push: {
                "primogemas.transacoes": {
                  type: "daily",
                  value: reward,
                  date: nowClick
                }
              }
            },
            { new: true }
          );

          const embedSuccess = new MessageEmbed()
            .setTitle("🎁 Daily Resgatado!")
            .setColor("Green")
            .setDescription(
              `💎 Você recebeu **${reward} primogemas!**\n\n` +
              `📦 Saldo atual: **${updated.primogemas.atm}**`
            )
            .setTimestamp()
            .build();

          return await DiscordRequest(
            `/interactions/${i.id}/${i.token}/callback`,
            {
              method: "POST",
              body: {
                type: 7, // EDIT ORIGINAL MESSAGE
                data: {
                  embeds: [embedSuccess],
                  components: [] // remove botão
                }
              }
            }
          );
        }
      });

      const embed = new MessageEmbed()
        .setTitle("🎁 Daily de Primogemas")
        .setColor("Blue")
        .setDescription(
          `Clique no botão abaixo para resgatar **${reward} primogemas**.`
        )
        .setTimestamp()
        .build();

      return await DiscordRequest(
        `/webhooks/${interaction.application_id}/${interaction.token}`,
        {
          method: "POST",
          body: {
            embeds: [embed],
            components: [
              {
                type: 1,
                components: [button]
              }
            ]
          }
        }
      );
    }
  }
};