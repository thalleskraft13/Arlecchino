'use strict';

const { GuildDb }    = require("../../Mongodb/guild.js");
const UserGuild      = require("../../Mongodb/userGuild.js");
const DiscordRequest = require("../DiscordRequest.js");
const PremiumManager = require("../Utils/PremiumManager.js");
const getPerm        = require("../Utils/GetPerm.js");

/* ID fixo do botão — nunca expira */
const BIRTHDAY_BTN_ID = 'birthday_register_btn';

class BirthdayManager {

  constructor(client) {
    this.client = client;
  }

  /* ═══════════════════════════════════════════
     CHECK ALL  —  chamado pelo TaskManager
     ═══════════════════════════════════════════ */

  async checkAll(guildId) {
    try {
      const now   = new Date();
      const day   = now.getDate();
      const month = now.getMonth() + 1;

      console.log(`[BirthdayManager] checkAll — guild: ${guildId} | dia: ${day}/${month}`);

      const guild = await GuildDb.findOne({ guildId }).lean();
      if (!guild) return;

      console.log(`[BirthdayManager] birthdayConfig:`, JSON.stringify(guild?.birthdayConfig));

      if (!guild?.birthdayConfig?.ativado)                        return;
      if (!guild?.birthdayConfig?.channel ||
           guild.birthdayConfig.channel === "0")                  return;

      await this._processGuild(guild, guildId, day, month);
    } catch (err) {
      console.error(`[BirthdayManager] checkAll error (${guildId}):`, err);
    }
  }

  /* ═══════════════════════════════════════════
     PROCESS GUILD
     ═══════════════════════════════════════════ */

  async _processGuild(guild, guildId, day, month) {
    console.log(`[BirthdayManager] Buscando — guildId: "${guildId}" | day: ${day} | month: ${month}`);

    const members = await UserGuild.find({
      guildId,
      "birthday.set":   true,
      "birthday.day":   day,
      "birthday.month": month
    }).lean();

    console.log(`[BirthdayManager] Encontrados: ${members.length}`);

    if (!members.length) return;

    for (const member of members) {
      await this._sendBirthdayMessage(guild, member).catch(err =>
        console.error(`[BirthdayManager] Erro ao enviar para ${member.userId}:`, err)
      );
    }

    /* Após enviar todos os parabéns, remandar o botão fixo */
    if (guild.birthdayConfig?.pinMessage) {
      await this._repostFixedButton(guildId, guild.birthdayConfig.channel);
    }
  }

  /* ═══════════════════════════════════════════
     SEND BIRTHDAY MESSAGE
     ═══════════════════════════════════════════ */

  async _sendBirthdayMessage(guild, member) {
    const cfg     = guild.birthdayConfig;
    const guildId = guild.guildId ?? member.guildId;
    const userId  = member.userId;

    /* Apaga o botão fixo antes de enviar a msg de parabéns */
    if (cfg.pinMessage && cfg._pinMsgId) {
      await DiscordRequest(
        `/channels/${cfg.channel}/messages/${cfg._pinMsgId}`,
        { method: "DELETE" }
      ).catch(() => {});
    }

    /* Ping */
    const ping = cfg.ping && cfg.ping !== "0" ? `<@&${cfg.ping}> ` : "";

    /* Idade */
    const age = member.birthday?.year
      ? new Date().getFullYear() - member.birthday.year
      : null;

    const texto = (cfg.messageText ?? "🎂 Hoje é o aniversário de {user}! Parabéns! 🎉")
      .replace(/{user}/g,  `<@${userId}>`)
      .replace(/{age}/g,   age ?? "")
      .replace(/{idade}/g, age ?? "");

    const content = ping + texto;

    /* Cargo temporário de aniversariante */
    if (cfg.birthdayRole && cfg.birthdayRole !== "0") {
      await DiscordRequest(
        `/guilds/${guildId}/members/${userId}/roles/${cfg.birthdayRole}`,
        { method: 'PUT' }
      ).catch(() => {});

      const meiaNiote = new Date();
      meiaNiote.setDate(meiaNiote.getDate() + 1);
      meiaNiote.setHours(0, 0, 0, 0);

      await this.client.taskManager.create({
        tipo:  'remove_role',
        delay: meiaNiote - Date.now(),
        dados: { guildId, userId, roleId: cfg.birthdayRole }
      }).catch(() => {});
    }

    /* Busca o username para o nome do tópico */
    let memberName = `<@${userId}>`;
    if (cfg.birthdayThread) {
      const memberData = await DiscordRequest(
        `/guilds/${guildId}/members/${userId}`,
        { method: 'GET' }
      ).catch(() => null);
      memberName = memberData?.nick
        || memberData?.user?.global_name
        || memberData?.user?.username
        || `<@${userId}>`;
    }

    let sentMsg = null;

    /* Webhook (Premium) */
    if (cfg.webhook) {
      const webhookName   = cfg.webhookName   || "🎂 Aniversários";
      const webhookAvatar = cfg.webhookAvatar || null;

      const webhook = await this._getOrCreateWebhook(cfg.channel, webhookName);
      if (webhook?.token) {
        sentMsg = await DiscordRequest(
          `/webhooks/${webhook.id}/${webhook.token}?wait=true`,
          {
            method: 'POST',
            body: {
              content,
              username:   webhookName,
              avatar_url: webhookAvatar || undefined
            }
          }
        ).catch(() => null);
      }
    }

    /* Mensagem normal */
    if (!sentMsg) {
      sentMsg = await DiscordRequest(
        `/channels/${cfg.channel}/messages`,
        {
          method: 'POST',
          body: {
            content,
            embeds: [{
              description: texto,
              color:       0xf4a8c7,
              footer:      { text: "🎂 Sistema de Aniversários" }
            }]
          }
        }
      ).catch(() => null);
    }

    /* Tópico público (Premium) */
    if (cfg.birthdayThread && sentMsg?.id) {
      await DiscordRequest(
        `/channels/${cfg.channel}/messages/${sentMsg.id}/threads`,
        {
          method: 'POST',
          body: {
            name:                  `🎂 Feliz aniversário, ${memberName}!`,
            auto_archive_duration: 1440 // fecha após 24h sem atividade
          }
        }
      ).catch(() => {});
    }
  }

  /* ═══════════════════════════════════════════
     REGISTER / REMOVE BIRTHDAY
     ═══════════════════════════════════════════ */

  async registerBirthday(guildId, userId, day, month, year = null) {
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      throw new Error('Data inválida');
    }

    await UserGuild.findOneAndUpdate(
      { guildId, userId },
      {
        $set: {
          "birthday.day":   day,
          "birthday.month": month,
          "birthday.year":  year,
          "birthday.set":   true
        }
      },
      { upsert: true }
    );
  }

  async removeBirthday(guildId, userId) {
    await UserGuild.findOneAndUpdate(
      { guildId, userId },
      {
        $set: {
          "birthday.day":   null,
          "birthday.month": null,
          "birthday.year":  null,
          "birthday.set":   false
        }
      }
    );
  }

  /* ═══════════════════════════════════════════
     SETUP PANEL
     ═══════════════════════════════════════════ */

  async startSetup(interaction) {
    const guild = await this.getGuild(interaction.guild_id);
    const user  = interaction.member.user.id;
    const cfg   = guild.birthdayConfig;

    return this.editOriginal(interaction, {
      embeds:     [this._buildEmbed(cfg)],
      components: [
        this.row(
          this.btn(user,
            cfg.ativado ? "✅ Sistema Ligado" : "❌ Sistema Desligado",
            cfg.ativado ? 3 : 4,
            async i => { await this.deferUpdate(i); return this.toggleSystem(i); }
          ),
          this.btn(user, "📣 Definir Canal", 1,
            async i => { await this.deferUpdate(i); return this.setChannel(i); }
          ),
          this.btn(user, "🔔 Definir Ping", 1,
            async i => { await this.deferUpdate(i); return this.setPing(i); }
          )
        ),
        this.row(
          this.btn(user, "✏️ Mensagem", 1,
            async i => { await this.deferUpdate(i); return this.setMensagem(i); }
          ),
          this.btn(user, "🕗 Horário", 1,
            async i => { await this.deferUpdate(i); return this.setHorario(i); }
          ),
          this.btn(user,
            cfg.webhook ? "🌐 Webhook Ligado" : "🌐 Webhook Desligado",
            cfg.webhook ? 3 : 2,
            async i => { await this.deferUpdate(i); return this.toggleWebhook(i); }
          ),
          this.btn(user,
            cfg.pinMessage ? "📌 Botão Fixo ON" : "📌 Botão Fixo OFF",
            cfg.pinMessage ? 3 : 2,
            async i => { await this.deferUpdate(i); return this.toggleButtonMode(i); }
          ),
          this.btn(user,
            cfg.birthdayThread ? "🧵 Tópico ON" : "🧵 Tópico OFF",
            cfg.birthdayThread ? 3 : 2,
            async i => { await this.deferUpdate(i); return this.toggleBirthdayThread(i); }
          )
        ),
        this.row(
          this.btn(user, "🖼️ Config Webhook", 1,
            async i => { await this.deferUpdate(i); return this.setupWebhookConfig(i); }
          )
        )
      ]
    });
  }

  /* ── TOGGLE SYSTEM ── */

  async toggleSystem(interaction) {
    const guild = await this.getGuild(interaction.guild_id);
    const cfg   = guild.birthdayConfig;

    if (!cfg.channel || cfg.channel === "0") {
      return this.followUpEphemeral(interaction, {
        content: "❌ Configure um canal antes de ativar o sistema."
      });
    }

    cfg.ativado = !cfg.ativado;

    if (cfg.ativado) {
      await this._ensureTask(guild);
    } else {
      await this._cancelTask(guild);
    }

    await guild.save();

    await this.followUpEphemeral(interaction, {
      content: cfg.ativado
        ? "✅ Sistema de aniversários ativado!"
        : "❌ Sistema desativado."
    });

    return this.startSetup(interaction);
  }

  /* ── SET CHANNEL ── */

  async setChannel(interaction) {
    await this.followUpEphemeral(interaction, {
      content: "📨 Envie o canal ou ID do canal de aniversários."
    });

    let msg;
    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId:    interaction.member.user.id
      });
    } catch { return; }

    const id = msg.content.match(/\d{17,20}/)?.[0];
    if (!id) {
      return this.followUpEphemeral(interaction, { content: "❌ Canal inválido." });
    }

    const perms    = await getPerm({ guildId: interaction.guild_id, channel: true, id, bot: true });
    const required = ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"];
    const missing  = required.filter(p => !perms.includes(p));

    if (missing.length) {
      const nomes = {
        VIEW_CHANNEL:  "Ver Canal",
        SEND_MESSAGES: "Enviar Mensagens",
        EMBED_LINKS:   "Inserir Links"
      };
      return this.followUpEphemeral(interaction, {
        content: "❌ Não tenho as permissões necessárias no canal:\n\n" +
          missing.map(p => `• ${nomes[p] || p}`).join("\n")
      });
    }

    const guild = await this.getGuild(interaction.guild_id);
    guild.birthdayConfig.channel = id;
    await guild.save();

    DiscordRequest(
      `/channels/${interaction.channel_id}/messages/${msg.id}`,
      { method: "DELETE" }
    ).catch(() => {});

    await this.followUpEphemeral(interaction, { content: `✅ Canal definido para <#${id}>` });
    return this.startSetup(interaction);
  }

  /* ── SET PING ── */

  async setPing(interaction) {
    await this.followUpEphemeral(interaction, {
      content: "📨 Envie o cargo ou ID do cargo que deseja pingar nos aniversários.\n\nEnvie `0` para desativar o ping."
    });

    let msg;
    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId:    interaction.member.user.id
      });
    } catch { return; }

    DiscordRequest(
      `/channels/${interaction.channel_id}/messages/${msg.id}`,
      { method: "DELETE" }
    ).catch(() => {});

    const guild = await this.getGuild(interaction.guild_id);

    if (msg.content.trim() === "0") {
      guild.birthdayConfig.ping = "0";
      await guild.save();
      await this.followUpEphemeral(interaction, { content: "✅ Ping desativado." });
      return this.startSetup(interaction);
    }

    const id = msg.content.match(/\d{17,20}/)?.[0];
    if (!id) {
      return this.followUpEphemeral(interaction, { content: "❌ Cargo inválido." });
    }

    guild.birthdayConfig.ping = id;
    await guild.save();

    await this.followUpEphemeral(interaction, { content: `✅ Ping definido para <@&${id}>` });
    return this.startSetup(interaction);
  }

  /* ── SET MENSAGEM ── */

  async setMensagem(interaction) {
    await this.followUpEphemeral(interaction, {
      content:
        "✏️ Envie a nova mensagem de aniversário.\n\n" +
        "Variáveis disponíveis:\n" +
        "`{user}` → menciona o aniversariante\n" +
        "`{age}` → exibe a idade (se o ano foi cadastrado)"
    });

    let msg;
    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId:    interaction.member.user.id
      });
    } catch { return; }

    const guild = await this.getGuild(interaction.guild_id);
    guild.birthdayConfig.messageText = msg.content.slice(0, 500);
    await guild.save();

    DiscordRequest(
      `/channels/${interaction.channel_id}/messages/${msg.id}`,
      { method: "DELETE" }
    ).catch(() => {});

    await this.followUpEphemeral(interaction, { content: "✅ Mensagem atualizada!" });
    return this.startSetup(interaction);
  }

  /* ── SET HORÁRIO ── */

  async setHorario(interaction) {
    await this.followUpEphemeral(interaction, {
      content:
        "🕗 Envie o horário em que os aniversários serão anunciados.\n\n" +
        "Formato: `HH:MM` (ex: `08:00`, `12:30`)"
    });

    let msg;
    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId:    interaction.member.user.id
      });
    } catch { return; }

    const match = msg.content.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return this.followUpEphemeral(interaction, {
        content: "❌ Formato inválido. Use `HH:MM` (ex: `08:00`)."
      });
    }

    const hour   = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);

    if (hour > 23 || minute > 59) {
      return this.followUpEphemeral(interaction, { content: "❌ Horário inválido." });
    }

    const guild = await this.getGuild(interaction.guild_id);
    guild.birthdayConfig.hour   = hour;
    guild.birthdayConfig.minute = minute;

    if (guild.birthdayConfig.ativado) {
      await this._cancelTask(guild);
      await guild.save();
      await this._ensureTask(guild);
    }

    await guild.save();

    DiscordRequest(
      `/channels/${interaction.channel_id}/messages/${msg.id}`,
      { method: "DELETE" }
    ).catch(() => {});

    await this.followUpEphemeral(interaction, {
      content: `✅ Horário definido para **${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}**`
    });

    return this.startSetup(interaction);
  }

  /* ── TOGGLE WEBHOOK ── */

  async toggleWebhook(interaction) {
    const premium = await this._isPremium(interaction.guild_id);

    if (!premium) {
      return this.followUpEphemeral(interaction, {
        content: "🔒 Apenas servidores premium podem usar webhook."
      });
    }

    const guild = await this.getGuild(interaction.guild_id);
    const cfg   = guild.birthdayConfig;

    if (!cfg.channel || cfg.channel === "0") {
      return this.followUpEphemeral(interaction, { content: "❌ Configure um canal primeiro." });
    }

    const perms    = await getPerm({ guildId: interaction.guild_id, channel: true, id: cfg.channel, bot: true });
    const required = ["VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_WEBHOOKS"];
    const missing  = required.filter(p => !perms.includes(p));

    if (missing.length) {
      const nomes = {
        VIEW_CHANNEL:    "Ver Canal",
        SEND_MESSAGES:   "Enviar Mensagens",
        MANAGE_WEBHOOKS: "Gerenciar Webhooks"
      };
      return this.followUpEphemeral(interaction, {
        content: "❌ Não tenho as permissões necessárias:\n\n" +
          missing.map(p => `• ${nomes[p] || p}`).join("\n")
      });
    }

    cfg.webhook = !cfg.webhook;
    await guild.save();

    await this.followUpEphemeral(interaction, {
      content: cfg.webhook ? "✅ Webhook ativado" : "❌ Webhook desativado"
    });

    return this.startSetup(interaction);
  }

  /* ── TOGGLE BUTTON MODE ── */

  async toggleButtonMode(interaction) {
    const premium = await this._isPremium(interaction.guild_id);

    if (!premium) {
      return this.followUpEphemeral(interaction, {
        content: "🔒 O botão fixo é uma funcionalidade premium."
      });
    }

    const guild = await this.getGuild(interaction.guild_id);
    const cfg   = guild.birthdayConfig;

    if (!cfg.channel || cfg.channel === "0") {
      return this.followUpEphemeral(interaction, { content: "❌ Configure um canal primeiro." });
    }

    cfg.pinMessage = !cfg.pinMessage;

    if (cfg.pinMessage) {
      const msgId = await this._postFixedButton(cfg.channel);
      cfg._pinMsgId = msgId;
    } else {
      if (cfg._pinMsgId) {
        DiscordRequest(
          `/channels/${cfg.channel}/messages/${cfg._pinMsgId}`,
          { method: "DELETE" }
        ).catch(() => {});
      }
      cfg._pinMsgId = null;
    }

    await guild.save();

    await this.followUpEphemeral(interaction, {
      content: cfg.pinMessage
        ? "✅ Botão fixo ativado no canal de aniversários!"
        : "❌ Botão fixo removido."
    });

    return this.startSetup(interaction);
  }

  /* ── TOGGLE BIRTHDAY THREAD ── */

  async toggleBirthdayThread(interaction) {
    const premium = await this._isPremium(interaction.guild_id);

    if (!premium) {
      return this.followUpEphemeral(interaction, {
        content: "🔒 Tópicos de aniversário são uma funcionalidade premium."
      });
    }

    const guild = await this.getGuild(interaction.guild_id);
    guild.birthdayConfig.birthdayThread = !guild.birthdayConfig.birthdayThread;
    await guild.save();

    await this.followUpEphemeral(interaction, {
      content: guild.birthdayConfig.birthdayThread
        ? "✅ Tópico público ativado! Um tópico será criado em cada mensagem de aniversário."
        : "❌ Tópico desativado."
    });

    return this.startSetup(interaction);
  }

  /* ── CONFIG WEBHOOK (nome + foto) ── */

  async setupWebhookConfig(interaction) {
    const guild = await this.getGuild(interaction.guild_id);
    const user  = interaction.member.user.id;
    const cfg   = guild.birthdayConfig;

    return this.editOriginal(interaction, {
      embeds: [{
        title:       "🌐 Configuração da Webhook",
        description:
          `**Nome atual:** ${cfg.webhookName   || "🎂 Aniversários"}\n` +
          `**Avatar atual:** ${cfg.webhookAvatar ? `[Link](${cfg.webhookAvatar})` : "Padrão"}`,
        color: 0xf4a8c7
      }],
      components: [
        this.row(
          this.btn(user, "✏️ Definir Nome", 1,
            async i => { await this.deferUpdate(i); return this.setWebhookName(i); }
          ),
          this.btn(user, "🖼️ Definir Avatar", 1,
            async i => { await this.deferUpdate(i); return this.setWebhookAvatar(i); }
          ),
          this.btn(user, "↩️ Voltar", 2,
            async i => { await this.deferUpdate(i); return this.startSetup(i); }
          )
        )
      ]
    });
  }

  async setWebhookName(interaction) {
    await this.followUpEphemeral(interaction, {
      content: "✏️ Envie o nome que a webhook usará nas mensagens de aniversário."
    });

    let msg;
    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId:    interaction.member.user.id
      });
    } catch { return; }

    const guild = await this.getGuild(interaction.guild_id);
    guild.birthdayConfig.webhookName = msg.content.slice(0, 80);
    await guild.save();

    /* Recria o webhook com o novo nome */
    if (guild.birthdayConfig.channel && guild.birthdayConfig.channel !== "0") {
      await this._deleteOldWebhook(guild.birthdayConfig.channel);
    }

    DiscordRequest(
      `/channels/${interaction.channel_id}/messages/${msg.id}`,
      { method: "DELETE" }
    ).catch(() => {});

    await this.followUpEphemeral(interaction, {
      content: `✅ Nome da webhook definido para **${guild.birthdayConfig.webhookName}**`
    });

    return this.setupWebhookConfig(interaction);
  }

  async setWebhookAvatar(interaction) {
    await this.followUpEphemeral(interaction, {
      content: "🖼️ Envie a URL da imagem que será usada como avatar da webhook.\n\nExemplo: `https://i.imgur.com/abc123.png`"
    });

    let msg;
    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId:    interaction.member.user.id
      });
    } catch { return; }

    const url = msg.content.trim();
    const isUrl = /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(url);

    DiscordRequest(
      `/channels/${interaction.channel_id}/messages/${msg.id}`,
      { method: "DELETE" }
    ).catch(() => {});

    if (!isUrl) {
      return this.followUpEphemeral(interaction, {
        content: "❌ URL inválida. Envie um link direto para uma imagem (png, jpg, gif, webp)."
      });
    }

    const guild = await this.getGuild(interaction.guild_id);
    guild.birthdayConfig.webhookAvatar = url;
    await guild.save();

    await this.followUpEphemeral(interaction, { content: "✅ Avatar da webhook atualizado!" });
    return this.setupWebhookConfig(interaction);
  }

  /* ═══════════════════════════════════════════
     BOTÃO FIXO  —  custom_id permanente
     ═══════════════════════════════════════════ */

  async _postFixedButton(channelId) {
    const msg = await DiscordRequest(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: {
          embeds: [{
            title:       "🎂 Aniversários",
            description: "Clique no botão abaixo para cadastrar seu aniversário e ser celebrado no servidor!",
            color:       0xf4a8c7
          }],
          components: [{
            type: 1,
            components: [{
              type:      2,
              style:     1,
              label:     "🎂 Cadastrar meu Aniversário",
              custom_id: BIRTHDAY_BTN_ID   // ID fixo, nunca expira
            }]
          }]
        }
      }
    );

    return msg.id;
  }

  /**
   * Apaga o botão antigo e remanда um novo no final do canal.
   * Chamado após o envio das mensagens de parabéns.
   */
  async _repostFixedButton(guildId, channelId) {
    const guild = await GuildDb.findOne({ guildId });
    if (!guild) return;

    const cfg = guild.birthdayConfig;
    if (!cfg.pinMessage) return;

    /* Apaga o antigo */
    if (cfg._pinMsgId) {
      await DiscordRequest(
        `/channels/${channelId}/messages/${cfg._pinMsgId}`,
        { method: "DELETE" }
      ).catch(() => {});
    }

    /* Posta um novo */
    const newMsgId = await this._postFixedButton(channelId);
    guild.birthdayConfig._pinMsgId = newMsgId;
    await guild.save();
  }

  /**
   * Mantém o botão fixo sempre no final do canal.
   * Chame no seu MESSAGE_CREATE quando a msg vier do canal configurado.
   */
  async refreshFixedButton(guildId, channelId) {
    const guild = await GuildDb.findOne({ guildId }).lean();
    const cfg   = guild?.birthdayConfig;

    if (!cfg?.pinMessage || cfg.channel !== channelId) return;

    /* Busca doc editável */
    const guildDoc = await GuildDb.findOne({ guildId });

    if (cfg._pinMsgId) {
      DiscordRequest(
        `/channels/${channelId}/messages/${cfg._pinMsgId}`,
        { method: "DELETE" }
      ).catch(() => {});
    }

    const newMsgId = await this._postFixedButton(channelId);
    guildDoc.birthdayConfig._pinMsgId = newMsgId;
    await guildDoc.save();
  }

  /* ═══════════════════════════════════════════
     HANDLER DO BOTÃO FIXO  —  abre modal
     Chamado pelo InteractionManager quando
     custom_id === BIRTHDAY_BTN_ID
     ═══════════════════════════════════════════ */

  async handleButtonRegister(interaction) {
    const userId = interaction.member.user.id;

    const modalData = this.client.interactions.createModal({
      user:  userId,
      title: "🎂 Cadastro de Aniversário",
      components: [
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   "birthday_day",
            label:       "Dia",
            style:       1,
            min_length:  1,
            max_length:  2,
            placeholder: "Ex: 25",
            required:    true
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   "birthday_month",
            label:       "Mês",
            style:       1,
            min_length:  1,
            max_length:  2,
            placeholder: "Ex: 12",
            required:    true
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   "birthday_year",
            label:       "Ano (opcional — para calcular sua idade)",
            style:       1,
            min_length:  4,
            max_length:  4,
            placeholder: "Ex: 2000",
            required:    false
          }]
        }
      ],
      funcao: async (modalInteraction, _client, fields) => {
        const day   = parseInt(fields.birthday_day,   10);
        const month = parseInt(fields.birthday_month, 10);
        const year  = fields.birthday_year ? parseInt(fields.birthday_year, 10) : null;

        if (
          isNaN(day)   || day   < 1 || day   > 31 ||
          isNaN(month) || month < 1 || month > 12 ||
          (year && (isNaN(year) || year < 1900 || year > new Date().getFullYear()))
        ) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { flags: 64, content: "❌ Data inválida." } } }
          );
        }

        await this.registerBirthday(
          modalInteraction.guild_id,
          modalInteraction.member.user.id,
          day, month, year
        );

        return DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          {
            method: 'POST',
            body: {
              type: 4,
              data: {
                flags:   64,
                content:
                  `✅ Aniversário cadastrado para **${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}**` +
                  `${year ? `/${year}` : ""}! 🎉`
              }
            }
          }
        );
      }
    });

    await this.client.interactions.showModal(interaction, modalData);
  }

  /* ═══════════════════════════════════════════
     HANDLER DO COMANDO  /aniversario
     ═══════════════════════════════════════════ */

  async handleCommand(interaction) {
    const opts  = this._getOptions(interaction);
    const day   = opts.day;
    const month = opts.month;
    const year  = opts.year ?? null;

    if (!day || !month) {
      return this.reply(interaction, { flags: 64, content: "❌ Informe pelo menos o dia e o mês." });
    }

    try {
      await this.registerBirthday(interaction.guild_id, interaction.member.user.id, day, month, year);
    } catch {
      return this.reply(interaction, { flags: 64, content: "❌ Data inválida." });
    }

    return this.reply(interaction, {
      flags:   64,
      content: `✅ Aniversário cadastrado para **${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}**${year ? `/${year}` : ""}! 🎉`
    });
  }

  /* ═══════════════════════════════════════════
     TASK MANAGER INTEGRATION
     ═══════════════════════════════════════════ */

  async _ensureTask(guild) {
    console.log(`[BirthdayManager] _ensureTask chamado — guild: ${guild.guildId}`);

    if (!this.client.taskManager) {
      console.log(`[BirthdayManager] taskManager não encontrado no client!`);
      return;
    }

    const hour   = guild.birthdayConfig.hour   ?? 8;
    const minute = guild.birthdayConfig.minute ?? 0;

    console.log(`[BirthdayManager] Criando task — ${hour}:${minute}`);

    await this.client.taskManager.createBirthdayCheck({
      guildId: guild.guildId,
      hour,
      minute
    });
  }

  async _cancelTask(guild) {
    if (!this.client.taskManager) return;

    const TaskModel = require("../../Mongodb/tarefas.js");

    await TaskModel.updateMany(
      {
        tipo:            'birthday_check',
        status:          'pending',
        'dados.guildId': guild.guildId
      },
      { $set: { status: 'cancelled' } }
    );
  }

  /* ═══════════════════════════════════════════
     HELPERS INTERNOS
     ═══════════════════════════════════════════ */

  async _getOrCreateWebhook(channelId, name = "🎂 Aniversários") {
    try {
      const hooks = await DiscordRequest(`/channels/${channelId}/webhooks`, { method: "GET" });
      const found = hooks.find(w => w.name === name);
      if (found) return found;
    } catch {}

    return DiscordRequest(
      `/channels/${channelId}/webhooks`,
      { method: "POST", body: { name } }
    ).catch(() => null);
  }

  async _deleteOldWebhook(channelId) {
    try {
      const hooks = await DiscordRequest(`/channels/${channelId}/webhooks`, { method: "GET" });
      for (const hook of hooks) {
        if (hook.name === "🎂 Aniversários" || hook.name === "🎂 Birthday") {
          await DiscordRequest(`/webhooks/${hook.id}`, { method: "DELETE" }).catch(() => {});
        }
      }
    } catch {}
  }

  async _isPremium(guildId) {
    const p = await PremiumManager.getGuildPremium(guildId);
    return p.status;
  }

  _getOptions(interaction) {
    const opts = {};
    for (const o of (interaction.data?.options ?? [])) opts[o.name] = o.value;
    return opts;
  }

  _buildEmbed(cfg) {
    const canal = cfg.channel && cfg.channel !== "0"
      ? `<#${cfg.channel}>` : "Não definido";

    const ping = cfg.ping && cfg.ping !== "0"
      ? `<@&${cfg.ping}>` : "Nenhum";

    const horario = cfg.hour != null
      ? `${String(cfg.hour).padStart(2,'0')}:${String(cfg.minute ?? 0).padStart(2,'0')}`
      : "08:00 (padrão)";

    return {
      title:       "🎂 Sistema de Aniversários",
      description:
        `Canal: ${canal}\n` +
        `Horário: \`${horario}\`\n` +
        `Ping: ${ping}\n` +
        `Cargo de Aniversariante: ${cfg.birthdayRole && cfg.birthdayRole !== "0" ? `<@&${cfg.birthdayRole}>` : "Nenhum"}\n` +
        `Webhook: ${cfg.webhook     ? "✅ Ativado"  : "❌ Desativado"}\n` +
        `Botão Fixo: ${cfg.pinMessage ? "✅ Ativado" : "❌ Desativado"} _(Premium)_\n` +
        `Sistema: ${cfg.ativado    ? "✅ Ligado"   : "❌ Desligado"}\n\n` +
        `**Mensagem atual:**\n${cfg.messageText ?? "Não definida"}`,
      color: 0xf4a8c7
    };
  }

  /* ═══════════════════════════════════════════
     HELPERS DE INTERAÇÃO
     ═══════════════════════════════════════════ */

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
    return this.followUp(interaction, { ...data, flags: 64 });
  }

  async getGuild(guildId) {
    let g = await GuildDb.findOne({ guildId });
    if (!g) g = await GuildDb.create({ guildId });

    if (!g.birthdayConfig) {
      g.birthdayConfig = {};
      await g.save();
    }

    return g;
  }

  btn(user, label, style, func) {
    return this.client.interactions.createButton({
      user,
      data:   { label, style },
      funcao: func
    });
  }

  row(...c) {
    return { type: 1, components: c };
  }
}

module.exports = BirthdayManager;
