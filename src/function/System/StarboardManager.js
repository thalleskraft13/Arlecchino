const DiscordRequest = require("../DiscordRequest.js");
const GuildConfig = require("../../Mongodb/guild.js"); // ajuste se necessário
const GuildUser = require("../../Mongodb/guilduser.js")
class StarBoard {

  constructor(client) {
    this.client = client;
    this.minStars = 1;
  }

  /* ========================= */
  /* CONFIG PADRÃO             */
  /* ========================= */

  async getConfig(guildId) {

    let data = await GuildConfig.findOne({ guildId });

    if (!data) {
      data = await GuildConfig.create({
        guildId,
        starboard: {
          enabled: false,
          channelId: null,
          emoji: "⭐",
          savePoints: false
        }
      });
    }

    return data.starboard;
  }

  async updateConfig(guildId, update) {

    await GuildConfig.updateOne(
      { guildId },
      { $set: { starboard: update } },
      { upsert: true }
    );

  }

  /* ========================= */
  /* PAINEL SETUP              */
  /* ========================= */

  async startSetup(interaction) {

    const guildId = interaction.guild_id;
    const user = interaction.member.user.id;

    const config = await this.getConfig(guildId);

    const embed = {
      title: "⭐ Configuração do StarBoard",
      description: [
        `**Status:** ${config.enabled ? "🟢 Ativado" : "🔴 Desativado"}`,
        `**Canal:** ${config.channelId ? `<#${config.channelId}>` : "Não definido"}`,
        `**Emoji:** ${config.emoji}`,
        `**Salvar Pontos:** ${config.savePoints ? "Sim" : "Não"}`
      ].join("\n"),
      color: 0x2b2d31
    };

    const toggleBtn = this.client.interactions.createButton({
      user,
      data: {
        label: config.enabled ? "Desativar" : "Ativar",
        style: config.enabled ? 4 : 3
      },
      funcao: async (i) => {
        config.enabled = !config.enabled;
        await this.updateConfig(guildId, config);
        await this.startSetup(i);
      }
    });

    const emojiBtn = this.client.interactions.createButton({
      user,
      data: {
        label: "Configurar Emoji",
        style: 2
      },
      funcao: async (i) => {

        await DiscordRequest(
          `/interactions/${i.id}/${i.token}/callback`,
          {
            method: "POST",
            body: {
              type: 9,
              data: {
                title: "Configurar Emoji",
                custom_id: `star_emoji_modal`,
                components: [
                  {
                    type: 1,
                    components: [
                      {
                        type: 4,
                        custom_id: "emoji",
                        label: "Emoji (⭐ ou custom)",
                        style: 1,
                        required: true
                      }
                    ]
                  }
                ]
              }
            }
          }
        );

      }
    });

    const saveBtn = this.client.interactions.createButton({
      user,
      data: {
        label: "Salvar Pontos",
        style: config.savePoints ? 3 : 2
      },
      funcao: async (i) => {
        config.savePoints = !config.savePoints;
        await this.updateConfig(guildId, config);
        await this.startSetup(i);
      }
    });

    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        body: {
          type: interaction.message ? 7 : 4,
          data: {
            embeds: [embed],
            components: [
              {
                type: 1,
                components: [toggleBtn, emojiBtn, saveBtn]
              }
            ]
          }
        }
      }
    );

  }

  /* ========================= */
  /* REACTION ADD              */
  /* ========================= */

  async onReactionAdd(data) {

  const { guild_id, channel_id, message_id, user_id, emoji } = data;

  if (!guild_id) return;

  const config = await this.getConfig(guild_id);
  if (!config.enabled) return;

  // Verifica emoji (padrão ou custom)
  const emojiMatch =
    emoji.name === config.emoji ||
    emoji.id === config.emoji ||
    `${emoji.name}:${emoji.id}` === config.emoji;

  if (!emojiMatch) return;

  // Busca mensagem
  const message = await DiscordRequest(
    `/channels/${channel_id}/messages/${message_id}`,
    { method: "GET" }
  );

  if (!message) return;
  if (message.author.bot) return;
  if (message.author.id === user_id) return;

  // ================================
  // 🔥 SALVAR PONTOS NO DB
  // ================================
  if (config.savePoints) {

    await GuildUser.updateOne(
      {
        userId: message.author.id,
        guildId: guild_id
      },
      {
        $inc: { starboard: 1 }
      },
      {
        upsert: true
      }
    );

  }

  // ================================
  // ENVIA PARA STARBOARD
  // ================================

  if (!config.channelId) return;

  const embed = {
    author: {
      name: message.author.username,
      icon_url: message.author.avatar
        ? `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png`
        : undefined
    },
    description: message.content || "*Sem conteúdo*",
    footer: {
      text: `⭐ ${config.emoji}`
    },
    color: 0xffc83d
  };

  await DiscordRequest(
    `/channels/${config.channelId}/messages`,
    {
      method: "POST",
      body: {
        embeds: [embed],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "Ir para mensagem",
                url: `https://discord.com/channels/${guild_id}/${channel_id}/${message_id}`
              }
            ]
          }
        ]
      }
    }
  );

}

async onReactionRemove(data) {

  const { guild_id, channel_id, message_id, user_id, emoji } = data;
  if (!guild_id) return;

  const config = await this.getConfig(guild_id);
  if (!config.enabled) return;

  const emojiMatch =
    emoji.name === config.emoji ||
    emoji.id === config.emoji ||
    `${emoji.name}:${emoji.id}` === config.emoji;

  if (!emojiMatch) return;

  // Busca mensagem original
  const message = await DiscordRequest(
    `/channels/${channel_id}/messages/${message_id}`,
    { method: "GET" }
  );

  if (!message) return;

  // Pega contagem real da reação
  const reaction = message.reactions?.find(r =>
    r.emoji.name === emoji.name || r.emoji.id === emoji.id
  );

  const count = reaction ? reaction.count : 0;

  // Se ainda tem estrelas, não faz nada
  if (count > 0) return;

  // Busca registro no banco
  const starData = await StarboardMessage.findOne({
    guildId: guild_id,
    messageId: message_id
  });

  if (!starData) return;

  // Deleta mensagem do canal starboard
  await DiscordRequest(
    `/channels/${config.channelId}/messages/${starData.starboardMessageId}`,
    { method: "DELETE" }
  );

  // Remove do banco
  await StarboardMessage.deleteOne({
    guildId: guild_id,
    messageId: message_id
  });

}
}

module.exports = StarBoard;