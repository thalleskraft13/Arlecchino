const GuildDb = require("../../Mongodb/guild.js");
const DiscordRequest = require("../DiscordRequest.js");
const PremiumManager = require("../Utils/PremiumManager.js");
const getPerm = require("../Utils/GetPerm.js");

class GenshinLeaksManager {

  constructor(client) {
    this.client = client;

    this.sourceChannels = {
      vazamentos: "1506706004165791754"
    };
  }

  async reply(interaction, data) {
    return DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        body: {
          type: 4,
          data
        }
      }
    );
  }

  async deferUpdate(interaction) {
    return DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        body: {
          type: 6
        }
      }
    );
  }

  async editOriginal(interaction, data) {
    return DiscordRequest(
      `/webhooks/${this.client.clientId}/${interaction.token}/messages/@original`,
      {
        method: "PATCH",
        body: data
      }
    );
  }

  async followUp(interaction, data) {
    return DiscordRequest(
      `/webhooks/${this.client.clientId}/${interaction.token}`,
      {
        method: "POST",
        body: data
      }
    );
  }

  async followUpEphemeral(interaction, data) {
    return this.followUp(interaction, {
      ...data,
      flags: 64
    });
  }

  async getGuild(guildId) {

    let guild =
      await GuildDb.findOne({ guildId });

    if (!guild)
      guild = await GuildDb.create({
        guildId
      });

    return guild;
  }

  async save(guild) {
    return guild.save();
  }

  btn(user, label, style, func) {

    return this.client.interactions.createButton({
      user,
      data: {
        label,
        style
      },
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

    const p =
      await PremiumManager.getGuildPremium(
        guildId
      );

    return p.status;
  }

  buildEmbed(config) {

    const canal =
      config.chat !== "0"
        ? `<#${config.chat}>`
        : "Nenhum canal definido";

    const ping =
      config.ping !== "0"
        ? `<@&${config.ping}>`
        : "Nenhum cargo definido";

    return [{
      title: "📰 Sistema de Vazamentos Genshin",
      description:
        `📨 Canal: ${canal}\n` +
        `🔔 Ping: ${ping}`,
      color: 0x2b2d31
    }];
  }

  async startSetup(interaction) {

    const guild =
      await this.getGuild(
        interaction.guild_id
      );

    const config =
      guild.genshinAnuncios.vazamentos;

    const user =
      interaction.member.user.id;

    return this.editOriginal(interaction, {
      embeds: this.buildEmbed(config),

      components: [

        this.row(

          this.btn(
            user,
            "Definir Canal",
            1,

            async (i) => {

              await this.deferUpdate(i);

              return this.setChannel(i);
            }
          ),

          this.btn(
            user,
            "Definir Cargo Ping",
            2,

            async (i) => {

              await this.deferUpdate(i);

              return this.setPing(i);
            }
          )
        )
      ]
    });
  }

  async setChannel(interaction) {

    const guild =
      await this.getGuild(
        interaction.guild_id
      );

    await this.followUpEphemeral(
      interaction,
      {
        content:
          "📨 Envie o canal ou ID."
      }
    );

    let msg;

    try {

      msg =
        await this.client
          .NextMessageCollector
          .wait({
            channelId:
              interaction.channel_id,

            userId:
              interaction.member.user.id
          });

    } catch {
      return;
    }

    const id =
      msg.content.match(/\d{17,20}/)?.[0];

    if (!id) {

      return this.followUpEphemeral(
        interaction,
        {
          content:
            "❌ Canal inválido."
        }
      );
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
      "EMBED_LINKS",
      "ATTACH_FILES"
    ];

    const missing =
      required.filter(
        p => !perms.includes(p)
      );

    if (missing.length) {

      return this.followUpEphemeral(
        interaction,
        {
          content:
            "❌ Estou sem permissões no canal."
        }
      );
    }

    guild.genshinAnuncios
      .vazamentos.chat = id;

    await this.save(guild);

    await this.followUpEphemeral(
      interaction,
      {
        content:
          "✅ Canal configurado."
      }
    );

    return this.startSetup(interaction);
  }

  async setPing(interaction) {

    const guild =
      await this.getGuild(
        interaction.guild_id
      );

    await this.followUpEphemeral(
      interaction,
      {
        content:
          "🔔 Envie o cargo ou ID."
      }
    );

    let msg;

    try {

      msg =
        await this.client
          .NextMessageCollector
          .wait({
            channelId:
              interaction.channel_id,

            userId:
              interaction.member.user.id
          });

    } catch {
      return;
    }

    const id =
      msg.content.match(/\d{17,20}/)?.[0];

    if (!id) {

      return this.followUpEphemeral(
        interaction,
        {
          content:
            "❌ Cargo inválido."
        }
      );
    }

    guild.genshinAnuncios
      .vazamentos.ping = id;

    await this.save(guild);

    await this.followUpEphemeral(
      interaction,
      {
        content:
          "✅ Cargo configurado."
      }
    );

    return this.startSetup(interaction);
  }

  async handleMessage(message) {

    if (message.author.bot)
      return;

    if (
      message.channel_id !==
      this.sourceChannels.vazamentos
    ) return;

    const guilds =
      await GuildDb.find({
        "genshinAnuncios.vazamentos.chat": {
          $ne: "0"
        }
      });

    for (const guild of guilds) {

      try {
        
        const config = guild.genshinAnuncios?.vazamentos;

if (!config?.chat || config.chat === "0") continue;

        const files =
          message.attachments?.length
            ? "\n" +
              message.attachments
                .map(a => a.url)
                .join("\n")
            : "";

        const content =
          (config.ping !== "0"
            ? `<@&${config.ping}>\n`
            : "") +

          (message.content || "") +
          files;

        await DiscordRequest(
          `/channels/${config.chat}/messages`,
          {
            method: "POST",

            body: {
              content,

              embeds:
                message.embeds || []
            }
          }
        );

        await new Promise(r =>
          setTimeout(r, 1200)
        );

      } catch (err) {

  console.log(
    `Erro em ${guild.guildId}`,
    err.message
  );

  const code =
    err?.rawError?.code;

  if (
    code === 10003 ||
    code === 50001
  ) {

    guild.genshinAnuncios.vazamentos.chat = "0";

    await guild.save();

    console.log(
      `Canal removido de ${guild.guildId}`
    )
      }
    }
  }
  }
}

module.exports = GenshinLeaksManager;