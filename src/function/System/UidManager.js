const GuildDb = require("../../Mongodb/guild.js");
const DiscordRequest = require("../DiscordRequest.js");
const PremiumManager = require("../Utils/PremiumManager.js");
const getPerm = require("../Utils/GetPerm.js");

class UidManager {

  constructor(client) {
    this.client = client;
  }

  async reply(interaction, data) {
    return DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: "POST", body: { type: 4, data } }
    );
  }

  async deferUpdate(interaction) {
    return DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: "POST", body: { type: 6 } }
    );
  }

  async editOriginal(interaction, data) {
    return DiscordRequest(
      `/webhooks/${this.client.clientId}/${interaction.token}/messages/@original`,
      { method: "PATCH", body: data }
    );
  }

  async followUp(interaction, data) {
    return DiscordRequest(
      `/webhooks/${this.client.clientId}/${interaction.token}`,
      { method: "POST", body: data }
    );
  }

  async followUpEphemeral(interaction, data) {
    return this.followUp(interaction, {
      ...data,
      flags: 64
    });
  }

  async getGuild(guildId) {
    let g = await GuildDb.findOne({ guildId });

    if (!g)
      g = await GuildDb.create({ guildId });

    return g;
  }

  async save(guild) {
    await guild.save();
  }

  btn(user, label, style, func) {
    return this.client.interactions.createButton({
      user,
      data: { label, style },
      funcao: func
    });
  }

  row(...c) {
    return {
      type: 1,
      components: c
    };
  }

  async isPremium(guildId) {
    const p = await PremiumManager.getGuildPremium(guildId);
    return p.status;
  }

  buildEmbed(config) {

    const canal =
      config.channel !== "0"
        ? `<#${config.channel}>`
        : "Nenhum canal definido";

    return [{
      title: "✨ Sistema de Compartilhamento de UID",
      description:
        `Canal: ${canal}\n` +
        `Webhook: ${config.webhook ? "Ativado" : "Desativado"}\n` +
        `Sistema: ${config.ativado ? "Ligado" : "Desligado"}`,
      color: 0x2b2d31
    }];
  }

  async startSetup(interaction) {

    const guild = await this.getGuild(interaction.guild_id);

    const user = interaction.member.user.id;

    return this.editOriginal(interaction, {
      embeds: this.buildEmbed(guild.uidSend),
      components: [
        this.row(

          this.btn(
            user,
            guild.uidSend.ativado
              ? "Desativar Sistema"
              : "Ativar Sistema",
            guild.uidSend.ativado ? 4 : 3,

            async (i) => {

              await this.deferUpdate(i);

              return this.toggleSystem(i);
            }
          ),

          this.btn(
            user,
            "Definir Canal",
            1,

            async (i) => {

              await this.deferUpdate(i);

              return this.setChannel(i);
            }
          )
        ),

        this.row(

          this.btn(
            user,
            guild.uidSend.webhook
              ? "Webhook Ligado"
              : "Webhook Desligado",
            guild.uidSend.webhook ? 3 : 2,

            async (i) => {

              await this.deferUpdate(i);

              return this.toggleWebhook(i);
            }
          )
        )
      ]
    });
  }

  async toggleSystem(interaction) {

    const guild = await this.getGuild(interaction.guild_id);

    guild.uidSend.ativado =
      !guild.uidSend.ativado;

    await this.save(guild);

    await this.followUpEphemeral(interaction, {
      content:
        guild.uidSend.ativado
          ? "✅ Sistema ativado"
          : "❌ Sistema desativado"
    });

    return this.startSetup(interaction);
  }

  async toggleWebhook(interaction) {

    const guild = await this.getGuild(interaction.guild_id);

    const premium =
      await this.isPremium(interaction.guild_id);

    if (!premium) {

      return this.followUpEphemeral(interaction, {
        content:
          "🔒 Apenas servidores premium podem usar webhook."
      });
    }
    
    if (!guild.uidSend.channel || guild.uidSend.channel === "0") {

    return this.followUpEphemeral(interaction, {
      content:
        "❌ Configure um canal primeiro."
    });
  }
    
    const perms = await getPerm({
    guildId: interaction.guild_id,
    channel: true,
    id: guild.uidSend.channel,
    bot: true
  });

    
    const required = [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
    "MANAGE_WEBHOOKS"
  ];

  const missing =
    required.filter(p => !perms.includes(p));

  if (missing.length) {

    const traduzido = {
      VIEW_CHANNEL: "Ver Canal",
      SEND_MESSAGES: "Enviar Mensagens",
      MANAGE_WEBHOOKS: "Gerenciar Webhooks"
    };

    return this.followUpEphemeral(interaction, {
      content:
        "❌ Não tenho as permissões necessárias:\n\n" +
        missing
          .map(p => `• ${traduzido[p] || p}`)
          .join("\n")
    });
  }

    guild.uidSend.webhook =
      !guild.uidSend.webhook;

    await this.save(guild);

    await this.followUpEphemeral(interaction, {
      content:
        guild.uidSend.webhook
          ? "✅ Webhook ativado"
          : "❌ Webhook desativado"
    });

    return this.startSetup(interaction);
  }

  async setChannel(interaction) {

    const guild = await this.getGuild(interaction.guild_id);

    await this.followUpEphemeral(interaction, {
      content:
        "📨 Envie o canal ou ID do canal."
    });

    let msg;

    try {

      msg =
        await this.client.NextMessageCollector.wait({
          channelId: interaction.channel_id,
          userId: interaction.member.user.id
        });

    } catch {
      return;
    }

    const id =
      msg.content.match(/\d{17,20}/)?.[0];

    if (!id) {

      return this.followUpEphemeral(interaction, {
        content: "❌ Canal inválido"
      });
    }
    
    const perms = await getPerm({
    guildId: interaction.guild_id,
    channel: true,
    id,
    bot: true
  });

  const required = [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
    "EMBED_LINKS"
  ];

  const missing =
    required.filter(p => !perms.includes(p));

  if (missing.length) {

    const traduzido = {
      VIEW_CHANNEL: "Ver Canal",
      SEND_MESSAGES: "Enviar Mensagens",
      EMBED_LINKS: "Inserir Links"
    };

    return this.followUpEphemeral(interaction, {
      content:
        "❌ Não tenho as permissões necessárias no canal:\n\n" +
        missing
          .map(p => `• ${traduzido[p] || p}`)
          .join("\n")
    });
  }

    guild.uidSend.channel = id;

    await this.save(guild);

    try {

      await DiscordRequest(
        `/channels/${interaction.channel_id}/messages/${msg.id}`,
        {
          method: "DELETE"
        }
      );

    } catch {}

    await this.followUpEphemeral(interaction, {
      content: "✅ Canal configurado"
    });

    return this.startSetup(interaction);
  }

  async sendUidMessage(data) {

    const guild =
      await this.getGuild(data.guildId);

    if (!guild.uidSend.ativado)
      return;

    if (
      !guild.uidSend.channel ||
      guild.uidSend.channel === "0"
    ) return;

    const avatar =
      data.user.avatar
        ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=1024`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

    const content =
      `UID: \`${data.uid}\`\n` +
      `Player: **${data.nickname || "Desconhecido"}**`;

    if (guild.uidSend.webhook) {

      let webhook;

      try {

        const hooks =
          await DiscordRequest(
            `/channels/${guild.uidSend.channel}/webhooks`,
            {
              method: "GET"
            }
          );

        webhook =
          hooks.find(w =>
            w.name === "UID SYSTEM"
          );

      } catch {}

      if (!webhook) {

        webhook =
          await DiscordRequest(
            `/channels/${guild.uidSend.channel}/webhooks`,
            {
              method: "POST",
              body: {
                name: "UID SYSTEM"
              }
            }
          );
      }

      if (!webhook?.token)
        return;

      return DiscordRequest(
        `/webhooks/${webhook.id}/${webhook.token}`,
        {
          method: "POST",

          body: {
            username: data.user.username,
            avatar_url: avatar,
            content
          }
        }
      );
    }

    return DiscordRequest(
      `/channels/${guild.uidSend.channel}/messages`,
      {
        method: "POST",

        body: {
          embeds: [{
            author: {
              name: data.user.username,
              icon_url: avatar
            },

            description: content,

            color: 0x2b2d31
          }]
        }
      }
    );
  }
  
  async checkAndSendUid(data) {

  const guild = await this.getGuild(data.guildId);

  if (!guild.uidSend?.ativado)
    return;

  if (
    !guild.uidSend.channel ||
    guild.uidSend.channel === "0"
  ) return;

  const avatar =
    data.user.avatar
      ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=1024`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const content =
    `✨ Novo UID salvo\n\n` +
    `👤 Usuário: <@${data.user.id}>\n` +
    `🎮 UID: \`${data.uid}\`\n` +
    `🌍 Servidor: \`${data.server}\``;

  if (guild.uidSend.webhook) {

    let webhook;

    try {

      const hooks = await DiscordRequest(
        `/channels/${guild.uidSend.channel}/webhooks`,
        {
          method: "GET"
        }
      );

      webhook =
        hooks.find(w =>
          w.name === "UID SYSTEM"
        );

    } catch {}

    if (!webhook) {

      webhook = await DiscordRequest(
        `/channels/${guild.uidSend.channel}/webhooks`,
        {
          method: "POST",

          body: {
            name: "UID SYSTEM"
          }
        }
      );
    }

    if (!webhook?.token)
      return;

    return DiscordRequest(
      `/webhooks/${webhook.id}/${webhook.token}`,
      {
        method: "POST",

        body: {
          username:
            data.user.global_name ||
            data.user.username,

          avatar_url: avatar,

          content
        }
      }
    );
  }

  return DiscordRequest(
    `/channels/${guild.uidSend.channel}/messages`,
    {
      method: "POST",

      body: {
        embeds: [{
          author: {
            name:
              data.user.global_name ||
              data.user.username,

            icon_url: avatar
          },

          description: content,

          color: 0x2b2d31
        }]
      }
    }
  );
}
}

module.exports = UidManager;