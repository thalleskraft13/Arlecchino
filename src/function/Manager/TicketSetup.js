const GuildDb = require("../../Mongodb/guild");
const DiscordRequest = require("../DiscordRequest");
const PremiumManager = require("../Utils/PremiumManager");

class TicketSystem {

  constructor(client) {
    this.client = client;
  }

  /* ================= INTERACTIONS ================= */

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

  /* ================= DATABASE ================= */

  async getGuild(guildId) {
    let g = await GuildDb.findOne({ guildId });
    if (!g) g = await GuildDb.create({ guildId });
    return g;
  }

  async save(guild) {
    await guild.save();
  }

  getPanel(guild, id) {
    return guild.ticket.find(t => t.panelId === id);
  }

  extractId(text) {
    return text?.match(/\d{17,19}/)?.[0];
  }

  async isPremium(guildId) {
    const p = await PremiumManager.getGuildPremium(guildId);
    return p.status;
  }

  /* ================= UI ================= */

  btn(user, label, style, func) {
    return this.client.interactions.createButton({
      user,
      data: { label, style },
      funcao: func
    });
  }

  select(user, options, placeholder, func) {
    return this.client.interactions.createSelect({
      user,
      data: { placeholder, options },
      funcao: func
    });
  }

  row(...c) {
    return { type: 1, components: c };
  }

  /* ================= EMBEDS ================= */

  buildEmbeds(panel) {

    const tipoMap = {
      0: "Canal de Texto",
      1: "Thread Pública (Premium)",
      2: "Thread Privada (Premium)"
    };

    const config = {
      title: "⚙️ Configuração do Ticket",
      description:
        `📌 ID: ${panel.panelId}\n` +
        `📂 Categoria: ${panel.categoriaId ? `<#${panel.categoriaId}>` : "Não definida"}\n` +
        `💬 Canal: ${panel.canalId ? `<#${panel.canalId}>` : "Não definido"}\n` +
        `👮 Staff:\n${panel.cargosStaff.map(r => `<@&${r}>`).join("\n") || "Nenhum"}\n` +
        `🎫 Tipo: ${tipoMap[panel.tipoDeCriacao]}\n` +
        `📝 Nome: ${panel.ticketChatName || "Padrão"}`
    };

    const preview = panel.painelPrincipal || {
      title: "🎫 Painel de Tickets",
      description: "Crie seu ticket apertando no botão abaixo."
    };

    return [config, preview];
  }

  /* ================= MENU ================= */

  async startSetup(interaction) {

    const guild = await this.getGuild(interaction.guild_id);
    const user = interaction.member.user.id;

    const select = this.select(
      user,
      guild.ticket.length
        ? guild.ticket.map(p => ({ label: p.panelId, value: p.panelId }))
        : [{ label: "Nenhum painel", value: "none" }],
      "Selecionar painel",
      async (i) => {
        await this.deferUpdate(i);
        if (!guild.ticket.length) return;
        return this.panelMenu(i, guild, i.data.values[0], user);
      }
    );

    const create = this.btn(user, "➕ Criar Painel", 3,
      async (i) => {
        await this.deferUpdate(i);
        return this.createPanel(i, guild, user);
      }
    );

    return this.editOriginal(interaction, {
      embeds: [{
        title: "🎫 Sistema de Tickets",
        description: "Gerencie seus painéis"
      }],
      components: [
        this.row(select),
        this.row(create)
      ]
    });
  }

  /* ================= PANEL ================= */

  async createPanel(interaction, guild, user) {

    const id = "panel_" + Date.now();

    guild.ticket.push({
      panelId: id,
      contadorTicket: 0,
      tipoDeCriacao: 0,
      cargosStaff: []
    });

    await this.save(guild);

    return this.panelMenu(interaction, guild, id, user);
  }

  async panelMenu(interaction, guild, panelId, user) {

    const panel = this.getPanel(guild, panelId);
    const premium = await this.isPremium(guild.guildId);

    const select = this.select(
      user,
      [
        { label: "Cargos da Staff", value: "staff" },
        { label: "Canal de envio", value: "canal" },
        { label: premium ? "Tipo de Criação" : "🔒 Tipo (Premium)", value: "tipo" },
        { label: "Categoria", value: "categoria" },
        { label: premium ? "Nome do Ticket" : "🔒 Nome (Premium)", value: "nome" },
        { label: "Embed JSON", value: "json" },
        { label: "Enviar Painel", value: "send" },
        { label: "Excluir Painel", value: "delete" }
      ],
      "Configurar",
      async (i) => {

        await this.deferUpdate(i);
        const v = i.data.values[0];

        if (v === "staff") return this.setStaff(i, guild, panelId, user);
        if (v === "canal") return this.setCanal(i, guild, panelId, user);
        if (v === "categoria") return this.setCategoria(i, guild, panelId, user);
        if (v === "json") return this.setJson(i, guild, panelId, user);
        if (v === "send") return this.sendPanel(i, guild, panelId);
        if (v === "delete") return this.deletePanel(i, guild, panelId, user);
        if (v === "tipo") return this.setTipo(i, guild, panelId, user);
      }
    );

    return this.editOriginal(interaction, {
      embeds: this.buildEmbeds(panel),
      components: [
        this.row(select),
        this.row(this.btn(user, "⬅️ Voltar", 2, i => this.startSetup(i)))
      ]
    });
  }

  /* ================= TICKET CREATE ================= */
  async create(interaction) {
  try {

    const guild = await this.getGuild(interaction.guild_id);
    const panel = this.getPanel(guild, interaction.data.panelId);

    if (!panel) {
      return this.reply(interaction, {
        content: "❌ Painel não encontrado",
        flags: 64
      });
    }

    const userId = interaction.member.user.id;
    panel.contadorTicket++;

    let channel;

    // ================= CANAL NORMAL =================
    if (panel.tipoDeCriacao === 0) {

      const body = {
        name: `ticket-${panel.contadorTicket}`,
        type: 0
      };

      if (panel.categoriaId) {
        body.parent_id = panel.categoriaId;
      }

      channel = await DiscordRequest(
        `/guilds/${interaction.guild_id}/channels`,
        { method: "POST", body }
      );
    }

    // ================= THREAD =================
    else {

      if (!panel.canalId) {
        return this.reply(interaction, {
          content: "❌ Defina um canal base para threads",
          flags: 64
        });
      }

      const thread = await DiscordRequest(
        `/channels/${panel.canalId}/threads`,
        {
          method: "POST",
          body: {
            name: `ticket-${panel.contadorTicket}`,
            type: panel.tipoDeCriacao === 1 ? 11 : 12, // public/private
            auto_archive_duration: 1440
          }
        }
      );

      channel = thread;
    }

    // ================= MENSAGEM =================

    const staff = panel.cargosStaff.length
      ? panel.cargosStaff.map(r => `<@&${r}>`).join(" ")
      : "";

    await DiscordRequest(`/channels/${channel.id}/messages`, {
      method: "POST",
      body: {
        content: `<@${userId}> ${staff}`,
        embeds: [{
          title: "🎫 Ticket Criado",
          description: `Seu ticket foi aberto em <#${channel.id}>`
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            label: "Fechar Ticket",
            style: 4,
            custom_id: "close_ticket"
          }]
        }]
      }
    });

    await this.save(guild);

    return this.reply(interaction, {
      content: `✅ Ticket criado em <#${channel.id}>`,
      flags: 64
    });

  } catch (err) {
    console.error(err);

    return this.reply(interaction, {
      content: "❌ Erro ao criar ticket",
      flags: 64
    });
  }
}



  /* ================= CLOSE ================= */

  async close(interaction) {
  try {

    // ACK imediato (evita erro de interação)
    await this.reply(interaction, {
      content: "⛔ Ticket será fechado em 10 segundos...",
    });

    // delay de 10s
    setTimeout(async () => {
      try {
        await DiscordRequest(`/channels/${interaction.channel_id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Erro ao deletar canal:", err);
      }
    }, 10000);

  } catch (err) {
    console.error("close ticket error:", err);
  }
}

  /* ================= CONFIG ================= */

  async setJson(interaction, guild, panelId, user) {

    await this.followUpEphemeral(interaction, {
      content: "Cole o JSON da embed"
    });

    let msg;

    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId: user
      });
    } catch {
      return;
    }

    try {
      const json = JSON.parse(msg.content);
      const panel = this.getPanel(guild, panelId);
      panel.painelPrincipal = json.embeds?.[0] || json;
      await this.save(guild);
    } catch {
      return this.followUpEphemeral(interaction, {
        content: "JSON inválido"
      });
    }

    return this.panelMenu(interaction, guild, panelId, user);
  }

  async sendPanel(interaction, guild, panelId) {

    const panel = this.getPanel(guild, panelId);

    if (!panel.canalId) {
      return this.followUpEphemeral(interaction, {
        content: "Defina um canal primeiro"
      });
    }

    await DiscordRequest(`/channels/${panel.canalId}/messages`, {
      method: "POST",
      body: {
        embeds: [panel.painelPrincipal || {
          title: "🎫 Painel de Tickets",
          description: "Crie seu ticket apertando no botão abaixo."
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            label: "🎫 Criar Ticket",
            style: 3,
            custom_id: JSON.stringify({
  t: "create_ticket",
  p: panel.panelId
})
          }]
        }]
      }
    });

    return this.followUpEphemeral(interaction, {
      content: "✅ Painel enviado!"
    });
  }
  
 async setTipo(interaction, guild, panelId, user) {

  const premium = await this.isPremium(guild.guildId);

  const options = [
    { label: "Canal de Texto", value: "0" },
    { label: premium ? "Thread Pública" : "🔒 Thread Pública (Premium)", value: "1" },
    { label: premium ? "Thread Privada" : "🔒 Thread Privada (Premium)", value: "2" }
  ];

  const select = this.select(user, options, "Escolha o tipo", async (i) => {

    await this.deferUpdate(i);

    const value = Number(i.data.values[0]);

    if (!premium && value !== 0) {
      return this.followUpEphemeral(i, {
        content: "❌ Apenas usuários premium podem usar threads"
      });
    }

    const panel = this.getPanel(guild, panelId);
    panel.tipoDeCriacao = value;

    await this.save(guild);

    return this.panelMenu(i, guild, panelId, user);
  });

  return this.followUpEphemeral(interaction, {
    content: "Selecione o tipo de criação:",
    components: [this.row(select)]
  });
} 

  async setStaff(interaction, guild, panelId, user) {

    await this.followUpEphemeral(interaction, {
      content: "Envie o cargo"
    });

    let msg;

    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId: user
      });
    } catch {
      return;
    }

    const id = this.extractId(msg.content);
    if (!id) return;

    const panel = this.getPanel(guild, panelId);

    if (!panel.cargosStaff.includes(id)) {
      panel.cargosStaff.push(id);
    }

    await this.save(guild);

    return this.panelMenu(interaction, guild, panelId, user);
  }

  async setCanal(interaction, guild, panelId, user) {

    await this.followUpEphemeral(interaction, {
      content: "Envie o canal"
    });

    let msg;

    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId: user
      });
    } catch {
      return;
    }

    const id = this.extractId(msg.content);
    if (!id) return;

    const panel = this.getPanel(guild, panelId);
    panel.canalId = id;

    await this.save(guild);

    return this.panelMenu(interaction, guild, panelId, user);
  }

  async setCategoria(interaction, guild, panelId, user) {

    await this.followUpEphemeral(interaction, {
      content: "Envie a categoria"
    });

    let msg;

    try {
      msg = await this.client.NextMessageCollector.wait({
        channelId: interaction.channel_id,
        userId: user
      });
    } catch {
      return;
    }

    const id = this.extractId(msg.content);
    if (!id) return;

    const panel = this.getPanel(guild, panelId);
    panel.categoriaId = id;

    await this.save(guild);

    return this.panelMenu(interaction, guild, panelId, user);
  }

  async deletePanel(interaction, guild, panelId, user) {

    guild.ticket = guild.ticket.filter(p => p.panelId !== panelId);
    await this.save(guild);

    return this.startSetup(interaction);
  }

}

module.exports = TicketSystem;