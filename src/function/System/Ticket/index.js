'use strict';

/**
 * TicketSystem — versão expandida
 *
 * Mantém 100% da lógica existente.
 * Adiciona:
 *   1. Cargos Automáticos  (AutoRoleManager)
 *   2. Transcript          (TranscriptManager)
 *   3. Perguntas Sequenciais (SeqQuestionsManager)
 *   4. Select Menu Hub     (painel via select menu)
 *   5. Melhorias estruturais (sem quebrar nada)
 */

const {GuildDb}        = require('../../../Mongodb/guild.js');
const DiscordRequest = require('../../DiscordRequest.js');
const PremiumManager = require('../../Utils/PremiumManager.js');
const getPerm        = require('../../Utils/GetPerm.js');

const AutoRoleManager    = require('./AutoRoleManager.js');
const TranscriptManager  = require('./TranscriptManager.js');
const SeqQuestionsManager = require('./SeqQuestionsManager.js');

class TicketSystem {

  constructor(client) {
    this.client = client;

    // Sub-managers (injetam client para acesso ao NextMessageCollector etc.)
    this.autoRole    = new AutoRoleManager(client);
    this.transcript  = new TranscriptManager(client);
    this.seqQuestions = new SeqQuestionsManager(client);
  }

  /* ═══════════════════════════════════════════
     INTERACTIONS — sem alteração
     ═══════════════════════════════════════════ */

  async reply(interaction, data) {
    return DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: 'POST', body: { type: 4, data } }
    );
  }

  async deferUpdate(interaction) {
    return DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: 'POST', body: { type: 6 } }
    );
  }

  async editOriginal(interaction, data) {
    return DiscordRequest(
      `/webhooks/${this.client.clientId}/${interaction.token}/messages/@original`,
      { method: 'PATCH', body: data }
    );
  }

  async followUp(interaction, data) {
    return DiscordRequest(
      `/webhooks/${this.client.clientId}/${interaction.token}`,
      { method: 'POST', body: data }
    );
  }

  async followUpEphemeral(interaction, data) {
    return this.followUp(interaction, { ...data, flags: 64 });
  }
  
  async deferReply(interaction, ephemeral = false) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: 'POST',
      body: {
        type: 5,
        data: ephemeral ? { flags: 64 } : {}
      }
    }
  );
}

  /* ═══════════════════════════════════════════
     DATABASE — sem alteração
     ═══════════════════════════════════════════ */

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

  /* ═══════════════════════════════════════════
     UI HELPERS — sem alteração
     ═══════════════════════════════════════════ */

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

  /* ═══════════════════════════════════════════
     EMBEDS — expandido com novas configs
     ═══════════════════════════════════════════ */

  buildEmbeds(panel) {
    const tipoMap = {
      0: 'Canal de Texto',
      1: 'Thread Pública (Premium)',
      2: 'Thread Privada (Premium)'
    };

    const painelTipoMap = {
      0: 'Botão',
      1: 'Select Menu Hub'
    };

    const config = {
      title: '⚙️ Configuração do Ticket',
      description:
        `📌 ID: ${panel.panelId}\n` +
        `📂 Categoria: ${panel.categoriaId ? `<#${panel.categoriaId}>` : 'Não definida'}\n` +
        `💬 Canal: ${panel.canalId ? `<#${panel.canalId}>` : 'Não definido'}\n` +
        `👮 Staff:\n${panel.cargosStaff.map(r => `<@&${r}>`).join('\n') || 'Nenhum'}\n` +
        `🎫 Tipo de Canal: ${tipoMap[panel.tipoDeCriacao]}\n` +
        `📝 Nome: ${panel.ticketChatName || 'Padrão'}\n` +
        `🖥️ Painel: ${painelTipoMap[panel.selectMenuConfig?.enabled ? 1 : 0]}\n` +
        `📸 Transcript: ${panel.transcriptConfig?.enabled ? '🟢 Ativado' : '🔴 Desativado'}\n` +
        `🏷️ Cargos Auto: ${panel.autoRoleConfig?.enabled ? `🟢 (${panel.autoRoleConfig.roles?.length || 0} cargo(s))` : '🔴 Desativado'}\n` +
        `📋 Form. Sequencial: ${panel.seqQuestionsConfig?.enabled ? `🟢 (${panel.seqQuestionsConfig.questions?.length || 0} pergunta(s))` : '🔴 Desativado'}`
    };

    const preview = panel.painelPrincipal || {
      title:       '🎫 Painel de Tickets',
      description: 'Crie seu ticket apertando no botão abaixo.'
    };

    return [config, preview];
  }

  /* ═══════════════════════════════════════════
     MENU PRINCIPAL — sem alteração
     ═══════════════════════════════════════════ */

  async startSetup(interaction) {
    const guild = await this.getGuild(interaction.guild_id);
    const user  = interaction.member.user.id;

    const select = this.select(
      user,
      guild.ticket.length
        ? guild.ticket.map(p => ({ label: p.panelId, value: p.panelId }))
        : [{ label: 'Nenhum painel', value: 'none' }],
      'Selecionar painel',
      async (i) => {
        await this.deferUpdate(i);
        if (!guild.ticket.length) return;
        return this.panelMenu(i, guild, i.data.values[0], user);
      }
    );

    const create = this.btn(user, '➕ Criar Painel', 3, async (i) => {
      await this.deferUpdate(i);
      return this.createPanel(i, guild, user);
    });

    return this.editOriginal(interaction, {
      embeds: [{ title: '🎫 Sistema de Tickets', description: 'Gerencie seus painéis' }],
      components: [this.row(select), this.row(create)]
    });
  }

  /* ═══════════════════════════════════════════
     PANEL — expandido com novas opções
     ═══════════════════════════════════════════ */

  async createPanel(interaction, guild, user) {
    const id = 'panel_' + Date.now();
    guild.ticket.push({
      panelId:        id,
      contadorTicket: 0,
      tipoDeCriacao:  0,
      cargosStaff:    []
    });
    await this.save(guild);
    return this.panelMenu(interaction, guild, id, user);
  }

  async panelMenu(interaction, guild, panelId, user) {
    const panel   = this.getPanel(guild, panelId);
    const premium = await this.isPremium(guild.guildId);

    const select = this.select(
      user,
      [
        { label: 'Cargos da Staff',                                           value: 'staff'    },
        { label: 'Canal de envio',                                            value: 'canal'    },
        { label: premium ? 'Tipo de Criação' : '🔒 Tipo (Premium)',           value: 'tipo'     },
        { label: 'Categoria',                                                  value: 'categoria'},
        { label: premium ? 'Nome do Ticket'  : '🔒 Nome (Premium)',           value: 'nome'     },
        { label: premium ? 'Modal Personalizado' : '🔒 Modal (Premium)',      value: 'modal'    },
        { label: 'Embed JSON',                                                 value: 'json'     },
        // ── NOVAS OPÇÕES ──
        { label: premium ? 'Cargos Automáticos' : '🔒 Cargos Auto (Premium)',value: 'autorole' },
        { label: 'Transcript',                                                 value: 'transcript'},
        { label: premium ? 'Form. Sequencial' : '🔒 Form. Seq. (Premium)',    value: 'seqform'  },
        { label: 'Select Menu Hub',                                            value: 'selecthub'},
        // ── FIM NOVAS ──
        { label: 'Enviar Painel',                                              value: 'send'     },
        { label: 'Excluir Painel',                                             value: 'delete'   }
      ],
      'Configurar',
      async (i) => {
        const v = i.data.values[0];

        // opções que mostram modal (não devem ter deferUpdate antes)
        if (v === 'json') return this.setJson(i, guild, panelId, user);

        await this.deferUpdate(i);

        // opções originais
        if (v === 'staff')     return this.setStaff(i, guild, panelId, user);
        if (v === 'canal')     return this.setCanal(i, guild, panelId, user);
        if (v === 'categoria') return this.setCategoria(i, guild, panelId, user);
        if (v === 'send')      return this.sendPanel(i, guild, panelId);
        if (v === 'delete')    return this.deletePanel(i, guild, panelId, user);
        if (v === 'tipo')      return this.setTipo(i, guild, panelId, user);
        if (v === 'nome')      return this.setNome(i, guild, panelId, user);
        if (v === 'modal')     return this.modalMenu(i, guild, panelId, user);

        // novas opções
        if (v === 'autorole')   return this.autoRoleMenu(i, guild, panelId, user);
        if (v === 'transcript') return this.transcriptMenu(i, guild, panelId, user);
        if (v === 'seqform')    return this.seqFormMenu(i, guild, panelId, user);
        if (v === 'selecthub')  return this.selectHubMenu(i, guild, panelId, user);
      }
    );

    return this.editOriginal(interaction, {
      embeds: this.buildEmbeds(panel),
      components: [
        this.row(select),
        this.row(this.btn(user, '⬅️ Voltar', 2, async (i) => {
          await this.deferUpdate(i);
          return this.startSetup(i);
        }))
      ]
    });
  }

  /* ═══════════════════════════════════════════
     TICKET CREATE — expandido
     ═══════════════════════════════════════════ */

  async create(interaction) {
    try {
      const guild = await this.getGuild(interaction.guild_id);
      const data  = JSON.parse(interaction.data.custom_id);
      const panel = this.getPanel(guild, data.p);

      

      if (!panel) {
        return this.reply(interaction, { content: '❌ Painel não encontrado', flags: 64 });
      }

      // ── modal existente (tem precedência) ──
      if (panel.modalConfig?.enabled && panel.modalConfig.fields?.length > 0) {
        const modal = this.client.interactions.createModal({
          user:  interaction.member.user.id,
          title: panel.modalConfig.title || 'Formulário',
          components: panel.modalConfig.fields.map(f => ({
            type: 1,
            components: [{
              type:        4,
              custom_id:   f.customId,
              label:       f.label,
              style:       f.style,
              required:    f.required,
              placeholder: f.placeholder,
              min_length:  f.minLength,
              max_length:  f.maxLength
            }]
          })),
          funcao: async (modalInteraction, client, fields) => {
            return this.createAfterModal(modalInteraction, guild, panel, fields);
          }
        });

        return DiscordRequest(
          `/interactions/${interaction.id}/${interaction.token}/callback`,
          { method: 'POST', body: { type: 9, data: modal } }
        );
      }

      // ── fluxo normal ──
      await this.reply(interaction,{
        content: "Criando Ticket...",
        flags: 64
      })
      
      const permCheck = await this.checkBotPermissions(interaction, panel);
      if (!permCheck.ok) {
        return this.reply(interaction, {
          content: '❌ Não tenho as seguintes permissões:\n\n' +
                   permCheck.missing.map(p => `• ${p}`).join('\n'),
          flags: 64
        });
      }
      
      console.clear()
      console.log('tururu rururueu\n\n')

      const channel = await this.createTicketNormally(interaction, guild, panel);

      // Formulário sequencial (se ativado e sem modal) — não bloqueia o ACK
      if (panel.seqQuestionsConfig?.enabled && panel.seqQuestionsConfig.questions?.length > 0) {
        this.seqQuestions.run({
          interaction,
          panel,
          channelId: channel.id,
          userId:    interaction.member.user.id
        }).catch(err => console.error('[SeqQuestions] Erro:', err));
      }

      return this.editOriginal(interaction, {
  content: `✅ Ticket criado em <#${channel.id}>`
});

    } catch (err) {
      console.error(err);
      return this.reply(interaction, { content: '❌ Erro ao criar ticket', flags: 64 });
    }
  }

  async createAfterModal(interaction, guild, panel, fields) {
    try {
      const user    = interaction.member?.user || interaction.user;
      const channel = await this.createTicketNormally(interaction, guild, panel);

      if (!channel?.id) {
        return DiscordRequest(
          `/interactions/${interaction.id}/${interaction.token}/callback`,
          { method: 'POST', body: { type: 4, data: { content: '❌ Erro ao criar ticket', flags: 64 } } }
        );
      }

      const embed = {
        title: '📋 Respostas do Formulário',
        description: Object.entries(fields)
          .map(([key, value]) => {
            const fieldData = panel.modalConfig.fields.find(f => f.customId === key);
            return `**${fieldData?.label || key}**\n${value}`;
          })
          .join('\n\n')
      };

      if (panel.modalConfig?.sendMode === 0) {
        await DiscordRequest(`/channels/${channel.id}/messages`, {
          method: 'POST',
          body:   {
            content:    `<@${user.id}>`,
            embeds:     [embed],
            components: [{ type: 1, components: [{ type: 2, label: 'Fechar Ticket', style: 4, custom_id: 'close_ticket' }] }]
          }
        });
      }

      if (panel.modalConfig?.sendMode === 1 && panel.modalConfig?.logChannelId) {
        await DiscordRequest(`/channels/${panel.modalConfig.logChannelId}/messages`, {
          method: 'POST',
          body:   { content: `📥 Novo formulário de <@${user.id}>`, embeds: [embed] }
        });
      }

      return DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        { method: 'POST', body: { type: 4, data: { content: `✅ Ticket criado em <#${channel.id}>`, flags: 64 } } }
      );

    } catch (err) {
      console.error('Erro no modal:', err);
      return DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        { method: 'POST', body: { type: 4, data: { content: '❌ Erro ao processar formulário', flags: 64 } } }
      );
    }
  }

  async createTicketNormally(interaction, guild, panel) {
    const user = interaction.member?.user || interaction.user;
    if (!user?.id) throw new Error('User indefinido na interaction');

    panel.contadorTicket++;

    let ticketName = panel.ticketChatName || 'ticket-{count}';
    ticketName = ticketName
      .replace(/{user}/g, (user.username || 'user').toLowerCase())
      .replace(/{id}/g, user.id)
      .replace(/{count}/g, panel.contadorTicket)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 90);

    let channel;

    // ── Canal de Texto ──
    if (panel.tipoDeCriacao === 0) {
      const body = {
        name: ticketName,
        type: 0,
        permission_overwrites: [
          { id: interaction.guild_id, type: 0, deny: '1024' },
          { id: user.id,              type: 1, allow: '1024' }
        ]
      };

      for (const roleId of panel.cargosStaff || []) {
        body.permission_overwrites.push({ id: roleId, type: 0, allow: '1024' });
      }

      if (panel.categoriaId) body.parent_id = panel.categoriaId;

      channel = await DiscordRequest(`/guilds/${interaction.guild_id}/channels`, {
        method: 'POST',
        body
      });
    }

    // ── Thread Pública ──
    else if (panel.tipoDeCriacao === 1) {
      channel = await DiscordRequest(`/channels/${interaction.channel_id}/threads`, {
        method: 'POST',
        body:   { name: ticketName, type: 11, auto_archive_duration: 1440 }
      });
    }

    // ── Thread Privada ──
    else if (panel.tipoDeCriacao === 2) {
      channel = await DiscordRequest(`/channels/${interaction.channel_id}/threads`, {
        method: 'POST',
        body:   { name: ticketName, type: 12, auto_archive_duration: 1440, invitable: false }
      });
      await DiscordRequest(`/channels/${channel.id}/thread-members/${user.id}`, { method: 'PUT' });
    }

    if (!channel?.id) throw new Error('Falha ao criar canal/thread');

    await this.save(guild);

    // ── Mensagem de boas-vindas ──
    const staff = panel.cargosStaff.length
      ? panel.cargosStaff.map(r => `<@&${r}>`).join(' ')
      : '';

    await DiscordRequest(`/channels/${channel.id}/messages`, {
      method: 'POST',
      body:   {
        content:    `<@${user.id}> ${staff}`,
        embeds:     [{
          title:       '🎫 Ticket Criado',
          description: `Olá <@${user.id}>, seu ticket foi criado!\n\nA equipe irá te atender em breve.\n\n🔒 Use o botão abaixo para fechar o ticket.`,
          color:       0x2b2d31
        }],
        components: [{
          type: 1,
          components: [{ type: 2, label: 'Fechar Ticket', style: 4, custom_id: 'close_ticket' }]
        }]
      }
    });

    // ── Cargos Automáticos (novo) ──
    await this.autoRole.applyRoles({
      guildId:  interaction.guild_id,
      userId:   user.id,
      ticketId: channel.id,
      panel
    });

    return channel;
  }

  /* ═══════════════════════════════════════════
     CLOSE — expandido com transcript e cargos vinculados
     ═══════════════════════════════════════════ */

  async close(interaction) {
    try {
      await this.reply(interaction, { content: '⛔ Ticket será fechado em 10 segundos...' });

      // Recupera panel para transcript e cargos vinculados
      const guild  = await this.getGuild(interaction.guild_id).catch(() => null);
      const panel  = guild ? this._findPanelByChannelOrAny(guild, interaction.channel_id) : null;
      const userId = interaction.member?.user?.id || interaction.user?.id;

      setTimeout(async () => {
        try {
          // 1. Gera transcript ANTES de deletar
          if (panel) {
            await this.transcript.generate({
              interaction,
              panel,
              closedBy: userId
            });
          }

          // 2. Remove cargos vinculados
          if (userId && interaction.guild_id) {
            await this.autoRole.handleTicketClose({
              guildId:  interaction.guild_id,
              userId,
              ticketId: interaction.channel_id
            });
          }

          // 3. Deleta o canal
          await DiscordRequest(`/channels/${interaction.channel_id}`, { method: 'DELETE' });

        } catch (err) {
          console.error('Erro ao fechar ticket:', err);
        }
      }, 10_000);

    } catch (err) {
      console.error('close ticket error:', err);
    }
  }

  /**
   * Tenta encontrar o painel que corresponde a um canal de ticket.
   * Estratégia: percorre todos os painéis e tenta match pelo canal de envio
   * (não é garantido — é best-effort para transcript/autorole).
   */
  _findPanelByChannelOrAny(guild, channelId) {
    // tenta match pelo canalId de envio (embora seja o canal do painel, não do ticket)
    const byCanal = guild.ticket.find(p => p.canalId === channelId);
    if (byCanal) return byCanal;
    // fallback: retorna o primeiro painel disponível
    return guild.ticket[0] || null;
  }

  /* ═══════════════════════════════════════════
     CONFIG — métodos originais sem alteração
     ═══════════════════════════════════════════ */

  async setJson(interaction, guild, panelId, user) {
    const modal = this.client.interactions.createModal({
      user,
      title: 'Configurar Embed JSON',
      components: [{
        type: 1,
        components: [{
          type:        4,
          custom_id:   'embed_json',
          label:       'Cole o JSON da embed',
          style:       2,
          required:    true,
          max_length:  4000,
          placeholder: '{\n  "title": "Meu Painel",\n  "description": "Descrição aqui"\n}'
        }]
      }],
      funcao: async (modalInteraction, client, fields) => {
        try {
          let parsed;
          try { parsed = JSON.parse(fields.embed_json); }
          catch {
            return DiscordRequest(
              `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
              { method: 'POST', body: { type: 4, data: { content: '❌ JSON inválido.', flags: 64 } } }
            );
          }

          const embed = parsed.embeds?.[0] || parsed.embed || parsed;
          const hasEmbedData = embed.title || embed.description || embed.fields ||
                               embed.author || embed.footer || embed.image || embed.thumbnail;

          if (!hasEmbedData || typeof embed !== 'object') {
            return DiscordRequest(
              `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
              { method: 'POST', body: { type: 4, data: { content: '❌ O JSON enviado não parece ser uma embed válida.', flags: 64 } } }
            );
          }

          const panel        = this.getPanel(guild, panelId);
          panel.painelPrincipal = embed;
          await this.save(guild);

          await DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 6 } }
          );

          await this.followUpEphemeral(modalInteraction, { content: '✅ Embed configurada com sucesso!' });
          return this.panelMenu(modalInteraction, guild, panelId, user);

        } catch (err) {
          console.error(err);
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Erro ao processar JSON.', flags: 64 } } }
          );
        }
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async sendPanel(interaction, guild, panelId) {
    const panel = this.getPanel(guild, panelId);

    if (!panel.canalId) {
      return this.followUpEphemeral(interaction, { content: 'Defina um canal primeiro' });
    }

    const permCheck = await this.checkSendPanelPermissions(guild.guildId, panel.canalId);
    if (!permCheck.ok) {
      return this.followUpEphemeral(interaction, {
        content: '❌ Não tenho permissões suficientes no canal:\n\n' +
                 permCheck.missing.map(p => `• ${p}`).join('\n')
      });
    }

    // ── Select Menu Hub ──
    if (panel.selectMenuConfig?.enabled && panel.selectMenuConfig.options?.length > 0) {
      return this._sendPanelAsSelectMenu(interaction, guild, panel);
    }

    // ── Botão padrão (original) ──
    await DiscordRequest(`/channels/${panel.canalId}/messages`, {
      method: 'POST',
      body:   {
        embeds:     [panel.painelPrincipal || { title: '🎫 Painel de Tickets', description: 'Crie seu ticket apertando no botão abaixo.' }],
        components: [{
          type: 1,
          components: [{
            type:      2,
            label:     '🎫 Criar Ticket',
            style:     3,
            custom_id: JSON.stringify({ t: 'create_ticket', p: panel.panelId })
          }]
        }]
      }
    });

    return this.followUpEphemeral(interaction, { content: '✅ Painel enviado!' });
  }

  /** Envia o painel como select menu hub */
  async _sendPanelAsSelectMenu(interaction, guild, panel) {
    const cfg = panel.selectMenuConfig;

    const options = cfg.options.map(opt => {
      const o = {
        label: opt.label,
        value: JSON.stringify({ t: 'create_ticket', p: opt.panelId })
      };
      if (opt.description) o.description = opt.description.slice(0, 100);
      if (opt.emoji)       o.emoji = { name: opt.emoji };
      return o;
    });

    await DiscordRequest(`/channels/${panel.canalId}/messages`, {
      method: 'POST',
      body:   {
        embeds:     [panel.painelPrincipal || { title: '🎫 Painel de Tickets', description: 'Selecione o tipo de atendimento.' }],
        components: [{
          type: 1,
          components: [{
            type:        3,
            custom_id:   JSON.stringify({ t: 'hub_select', p: panel.panelId }),
            placeholder: cfg.placeholder || 'Selecione o tipo de atendimento',
            min_values:  1,
            max_values:  1,
            options
          }]
        }]
      }
    });

    return this.followUpEphemeral(interaction, { content: '✅ Painel enviado como Select Menu!' });
  }

  async setTipo(interaction, guild, panelId, user) {
    const premium = await this.isPremium(guild.guildId);

    const options = [
      { label: 'Canal de Texto',                                                              value: '0' },
      { label: premium ? 'Thread Pública'  : '🔒 Thread Pública (Premium)',                  value: '1' },
      { label: premium ? 'Thread Privada'  : '🔒 Thread Privada (Premium)',                  value: '2' }
    ];

    const select = this.select(user, options, 'Escolha o tipo', async (i) => {
      await this.deferUpdate(i);
      const value = Number(i.data.values[0]);

      if (!premium && value !== 0) {
        return this.followUpEphemeral(i, { content: '❌ Apenas usuários premium podem usar threads' });
      }

      const panel = this.getPanel(guild, panelId);
      panel.tipoDeCriacao = value;
      await this.save(guild);

      this.followUpEphemeral(i, { content: '✅ Tipo de canal configurado!' });
      return this.panelMenu(interaction, guild, panelId, user);
    });

    return this.followUpEphemeral(interaction, {
      content:    'Selecione o tipo de criação:',
      components: [this.row(select)]
    });
  }

  async setStaff(interaction, guild, panelId, user) {
    await this.followUpEphemeral(interaction, { content: 'Envie o cargo' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const id = this.extractId(msg.content);
    if (!id) return;

    const panel = this.getPanel(guild, panelId);
    if (!panel.cargosStaff.includes(id)) panel.cargosStaff.push(id);

    await this.save(guild);
    return this.panelMenu(interaction, guild, panelId, user);
  }

  async setCanal(interaction, guild, panelId, user) {
    await this.followUpEphemeral(interaction, { content: 'Envie o canal' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const id = this.extractId(msg.content);
    if (!id) return;

    const panel = this.getPanel(guild, panelId);
    panel.canalId = id;
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: '✅ Canal configurado!' });
    return this.panelMenu(interaction, guild, panelId, user);
  }

  async setNome(interaction, guild, panelId, user) {
    const premium = await this.isPremium(guild.guildId);
    if (!premium) {
      return this.followUpEphemeral(interaction, { content: '🔒 Apenas usuários premium podem personalizar o nome do ticket.' });
    }

    await this.followUpEphemeral(interaction, {
      content:
        'Envie o nome personalizado do ticket.\n\n' +
        'Você pode usar variáveis:\n' +
        '`{user}` → nome do usuário\n' +
        '`{id}` → ID do usuário\n' +
        '`{count}` → número do ticket\n\n' +
        'Exemplo:\n`ticket-{user}-{count}`'
    });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const panel = this.getPanel(guild, panelId);
    panel.ticketChatName = msg.content.slice(0, 90);
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: '✅ Nome do ticket configurado!' });
    return this.panelMenu(interaction, guild, panelId, user);
  }

  async setCategoria(interaction, guild, panelId, user) {
    await this.followUpEphemeral(interaction, { content: 'Envie a categoria' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const id = this.extractId(msg.content);
    if (!id) return;

    const panel = this.getPanel(guild, panelId);
    panel.categoriaId = id;
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: '✅ Categoria configurada!' });
    return this.panelMenu(interaction, guild, panelId, user);
  }

  /* ═══════════════════════════════════════════
     MODAL MENU — sem alteração
     ═══════════════════════════════════════════ */

  async modalMenu(interaction, guild, panelId, user) {
    const panel   = this.getPanel(guild, panelId);
    const premium = await this.isPremium(guild.guildId);

    if (!premium) {
      return this.followUpEphemeral(interaction, { content: '🔒 Função exclusiva premium.' });
    }

    if (!panel.modalConfig) {
      panel.modalConfig = { enabled: false, title: 'Formulário do Ticket', sendMode: 0, logChannelId: null, fields: [] };
    }

    const status = panel.modalConfig.enabled ? '🟢 Ativado' : '🔴 Desativado';

    return this.editOriginal(interaction, {
      embeds: [{
        title: '⚙️ Configuração do Modal',
        description:
          `Status: ${status}\n` +
          `Título: ${panel.modalConfig.title}\n` +
          `Campos: ${panel.modalConfig.fields.length}\n` +
          `Modo: ${panel.modalConfig.sendMode === 0 ? '📨 Ticket' : '📂 Log'}\n` +
          `Log: ${panel.modalConfig.logChannelId ? `<#${panel.modalConfig.logChannelId}>` : 'Não definido'}`
      }],
      components: [
        this.row(
          this.btn(user, 'Ativar/Desativar', 3, i => this.toggleModal(i, guild, panelId, user)),
          this.btn(user, 'Editar Título',    2, i => this.setModalTitle(i, guild, panelId, user))
        ),
        this.row(
          this.btn(user, '➕ Add Pergunta',    1, i => this.addModalField(i, guild, panelId, user)),
          this.btn(user, '🗑️ Deletar Última', 4, i => this.removeLastField(i, guild, panelId, user))
        ),
        this.row(
          this.btn(user, 'Modo de Envio', 2, i => this.setModalSendMode(i, guild, panelId, user)),
          this.btn(user, 'Canal de Log',  1, i => this.setModalLogChannel(i, guild, panelId, user)),
          this.btn(user, '⬅️ Voltar',     2, async (i) => { await this.deferUpdate(i); return this.panelMenu(i, guild, panelId, user); })
        )
      ]
    });
  }

  async addModalField(interaction, guild, panelId, user) {
    const panel = this.getPanel(guild, panelId);

    if (!panel.modalConfig) {
      panel.modalConfig = { enabled: false, title: 'Formulário do Ticket', sendMode: 0, logChannelId: null, fields: [] };
    }

    if (panel.modalConfig.fields.length >= 5) {
      return this.followUpEphemeral(interaction, { content: '❌ Você pode adicionar no máximo 5 perguntas.' });
    }

    const modal = this.client.interactions.createModal({
      user,
      title: 'Adicionar Pergunta',
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'label',       label: 'Pergunta (máx. 45 caracteres)', style: 1, required: true,  max_length: 45  }] },
        { type: 1, components: [{ type: 4, custom_id: 'placeholder', label: 'Placeholder (opcional)',         style: 1, required: false, max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: 'style',       label: 'Tipo (1=Curta | 2=Longa)',       style: 1, required: true,  max_length: 1   }] }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const panelAtual = this.getPanel(guild, panelId);

        if (panelAtual.modalConfig.fields.length >= 5) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Limite máximo de 5 perguntas atingido.', flags: 64 } } }
          );
        }

        const label = fields.label?.trim();
        if (!label || label.length > 45) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ A pergunta deve ter no máximo 45 caracteres.', flags: 64 } } }
          );
        }

        const style = Number(fields.style) === 2 ? 2 : 1;

        panelAtual.modalConfig.fields.push({
          label,
          customId:    'field_' + Date.now(),
          style,
          required:    true,
          placeholder: fields.placeholder?.slice(0, 100) || '',
          minLength:   0,
          maxLength:   4000
        });

        await this.save(guild);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.modalMenu(modalInteraction, guild, panelId, user);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async toggleModal(interaction, guild, panelId, user) {
    await this.deferUpdate(interaction);
    const panel = this.getPanel(guild, panelId);

    if (!panel.modalConfig) {
      panel.modalConfig = { enabled: false, title: 'Formulário do Ticket', sendMode: 0, logChannelId: null, fields: [] };
    }

    panel.modalConfig.enabled = !panel.modalConfig.enabled;
    await this.save(guild);
    return this.modalMenu(interaction, guild, panelId, user);
  }

  async setModalTitle(interaction, guild, panelId, user) {
    const panel = this.getPanel(guild, panelId);

    const modal = this.client.interactions.createModal({
      user,
      title: 'Editar Título do Modal',
      components: [{
        type: 1,
        components: [{
          type:      4,
          custom_id: 'title',
          label:     'Novo Título',
          style:     1,
          required:  true,
          max_length: 45,
          value:     panel.modalConfig?.title || ''
        }]
      }],
      funcao: async (modalInteraction, client, fields) => {
        const panelAtual = this.getPanel(guild, panelId);
        if (!panelAtual.modalConfig) panelAtual.modalConfig = { enabled: false, title: '', fields: [] };
        panelAtual.modalConfig.title = fields.title;
        await this.save(guild);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.modalMenu(modalInteraction, guild, panelId, user);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async setModalSendMode(interaction, guild, panelId, user) {
    await this.deferUpdate(interaction);
    const panel = this.getPanel(guild, panelId);
    panel.modalConfig.sendMode = panel.modalConfig.sendMode === 0 ? 1 : 0;
    await this.save(guild);
    return this.modalMenu(interaction, guild, panelId, user);
  }

  async setModalLogChannel(interaction, guild, panelId, user) {
    await this.deferUpdate(interaction);
    await this.followUpEphemeral(interaction, { content: 'Envie o canal de log (menção ou ID)' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const id = this.extractId(msg.content);
    if (!id) return this.followUpEphemeral(interaction, { content: '❌ Canal inválido' });

    const panel = this.getPanel(guild, panelId);
    if (!panel.modalConfig) panel.modalConfig = { enabled: false, title: 'Formulário do Ticket', sendMode: 0, logChannelId: null, fields: [] };
    panel.modalConfig.logChannelId = id;
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: '✅ Canal de log configurado!' });
    return this.panelMenu(interaction, guild, panelId, user);
  }

  async removeLastField(interaction, guild, panelId, user) {
    await this.deferUpdate(interaction);
    const panel = this.getPanel(guild, panelId);
    if (!panel.modalConfig?.fields?.length) return this.modalMenu(interaction, guild, panelId, user);
    panel.modalConfig.fields.pop();
    await this.save(guild);
    return this.modalMenu(interaction, guild, panelId, user);
  }

  /* ═══════════════════════════════════════════
     NOVO: MENU DE CARGOS AUTOMÁTICOS
     ═══════════════════════════════════════════ */

  async autoRoleMenu(interaction, guild, panelId, user) {
    const panel   = this.getPanel(guild, panelId);
    const premium = await this.isPremium(guild.guildId);

    if (!premium) {
      return this.followUpEphemeral(interaction, { content: '🔒 Cargos automáticos são exclusivos premium.' });
    }

    if (!panel.autoRoleConfig) {
      panel.autoRoleConfig = { enabled: false, roles: [] };
    }

    const status   = panel.autoRoleConfig.enabled ? '🟢 Ativado' : '🔴 Desativado';
    const tipoMap  = { 0: 'Permanente', 1: 'Temporário', 2: 'Vinculado' };
    const rolesStr = panel.autoRoleConfig.roles.length
      ? panel.autoRoleConfig.roles
          .map(r => `<@&${r.roleId}> — ${tipoMap[r.tipo]}${r.tipo === 1 ? ` (${Math.floor(r.duration / 60000)}min)` : ''}`)
          .join('\n')
      : 'Nenhum';

    return this.editOriginal(interaction, {
      embeds: [{
        title:       '🏷️ Cargos Automáticos',
        description: `Status: ${status}\n\n**Cargos configurados:**\n${rolesStr}`
      }],
      components: [
        this.row(
          this.btn(user, 'Ativar/Desativar', 3, async (i) => {
            await this.deferUpdate(i);
            panel.autoRoleConfig.enabled = !panel.autoRoleConfig.enabled;
            await this.save(guild);
            return this.autoRoleMenu(i, guild, panelId, user);
          }),
          this.btn(user, '➕ Adicionar Cargo', 1, i => this._addAutoRole(i, guild, panelId, user)),
          this.btn(user, '🗑️ Remover Último',  4, async (i) => {
            await this.deferUpdate(i);
            if (panel.autoRoleConfig.roles?.length) panel.autoRoleConfig.roles.pop();
            await this.save(guild);
            return this.autoRoleMenu(i, guild, panelId, user);
          })
        ),
        this.row(
          this.btn(user, '⬅️ Voltar', 2, async (i) => {
            await this.deferUpdate(i);
            return this.panelMenu(i, guild, panelId, user);
          })
        )
      ]
    });
  }

  async _addAutoRole(interaction, guild, panelId, user) {
    // usa modal para capturar roleId + tipo + duração
    const modal = this.client.interactions.createModal({
      user,
      title: 'Adicionar Cargo Automático',
      components: [
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'role_id',
            label:       'ID ou Menção do Cargo',
            style:       1,
            required:    true,
            max_length:  100,
            placeholder: '@Cargo ou 123456789012345678'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'tipo',
            label: 'Tipo: 0=P 1=T 2=V',
            style:       1,
            required:    true,
            max_length:  1,
            placeholder: 'Tipo (0=Permanente | 1=Temporário | 2=Vinculado)'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'duration',
            label:       'Duração em minutos (apenas para Temporário)',
            style:       1,
            required:    false,
            max_length:  10,
            placeholder: '60'
          }]
        }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const roleId = fields.role_id?.match(/\d{17,19}/)?.[0];

        if (!roleId) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ ID de cargo inválido.', flags: 64 } } }
          );
        }

        const tipo = Number(fields.tipo);
        if (![0, 1, 2].includes(tipo)) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Tipo inválido. Use 0, 1 ou 2.', flags: 64 } } }
          );
        }

        let duration = null;
        if (tipo === 1) {
          const mins = Number(fields.duration);
          if (!mins || mins <= 0) {
            return DiscordRequest(
              `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
              { method: 'POST', body: { type: 4, data: { content: '❌ Duração inválida para cargo temporário.', flags: 64 } } }
            );
          }
          duration = mins * 60_000;
        }

        const panelAtual = this.getPanel(guild, panelId);
        if (!panelAtual.autoRoleConfig) panelAtual.autoRoleConfig = { enabled: false, roles: [] };
        if (panelAtual.autoRoleConfig.roles.length >= 10) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Limite de 10 cargos automáticos atingido.', flags: 64 } } }
          );
        }

        panelAtual.autoRoleConfig.roles.push({ roleId, tipo, duration });
        await this.save(guild);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        await this.followUpEphemeral(modalInteraction, { content: `✅ Cargo <@&${roleId}> adicionado!` });
        return this.autoRoleMenu(modalInteraction, guild, panelId, user);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     NOVO: MENU DE TRANSCRIPT
     ═══════════════════════════════════════════ */

  async transcriptMenu(interaction, guild, panelId, user) {
    const panel = this.getPanel(guild, panelId);

    if (!panel.transcriptConfig) {
      panel.transcriptConfig = { enabled: false, channelId: null, format: 'html', sendToUser: false };
    }

    const cfg    = panel.transcriptConfig;
    const status = cfg.enabled ? '🟢 Ativado' : '🔴 Desativado';

    return this.editOriginal(interaction, {
      embeds: [{
        title:       '📄 Configuração de Transcript',
        description: `Status: ${status}\n` +
                     `Canal: ${cfg.channelId ? `<#${cfg.channelId}>` : 'Não definido'}\n` +
                     `Formato: ${cfg.format?.toUpperCase() || 'HTML'}\n` +
                     `Enviar ao usuário: ${cfg.sendToUser ? 'Sim' : 'Não'}`
      }],
      components: [
        this.row(
          this.btn(user, 'Ativar/Desativar', 3, async (i) => {
            await this.deferUpdate(i);
            panel.transcriptConfig.enabled = !panel.transcriptConfig.enabled;
            await this.save(guild);
            return this.transcriptMenu(i, guild, panelId, user);
          }),
          this.btn(user, 'Canal de Transcript', 1, async (i) => {
            await this.deferUpdate(i);
            return this._setTranscriptChannel(i, guild, panelId, user);
          })
        ),
        this.row(
          this.btn(user, 'Alternar Formato (HTML/TXT)', 2, async (i) => {
            await this.deferUpdate(i);
            panel.transcriptConfig.format = panel.transcriptConfig.format === 'html' ? 'txt' : 'html';
            await this.save(guild);
            return this.transcriptMenu(i, guild, panelId, user);
          }),
          this.btn(user, 'Enviar DM ao Usuário', 2, async (i) => {
            await this.deferUpdate(i);
            panel.transcriptConfig.sendToUser = !panel.transcriptConfig.sendToUser;
            await this.save(guild);
            return this.transcriptMenu(i, guild, panelId, user);
          })
        ),
        this.row(
          this.btn(user, '⬅️ Voltar', 2, async (i) => {
            await this.deferUpdate(i);
            return this.panelMenu(i, guild, panelId, user);
          })
        )
      ]
    });
  }

  async _setTranscriptChannel(interaction, guild, panelId, user) {
    await this.followUpEphemeral(interaction, { content: 'Envie o canal de transcript (menção ou ID)' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const id = this.extractId(msg.content);
    if (!id) return this.followUpEphemeral(interaction, { content: '❌ Canal inválido' });

    const panel = this.getPanel(guild, panelId);
    panel.transcriptConfig.channelId = id;
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: `✅ Canal de transcript definido como <#${id}>` });
    return this.transcriptMenu(interaction, guild, panelId, user);
  }

  /* ═══════════════════════════════════════════
     NOVO: MENU DE FORMULÁRIO SEQUENCIAL
     ═══════════════════════════════════════════ */

  async seqFormMenu(interaction, guild, panelId, user) {
    const panel   = this.getPanel(guild, panelId);
    const premium = await this.isPremium(guild.guildId);

    if (!premium) {
      return this.followUpEphemeral(interaction, { content: '🔒 Formulário sequencial é exclusivo premium.' });
    }

    if (!panel.seqQuestionsConfig) {
      panel.seqQuestionsConfig = { enabled: false, sendMode: 0, logChannelId: null, timeout: 120_000, questions: [] };
    }

    const cfg    = panel.seqQuestionsConfig;
    const status = cfg.enabled ? '🟢 Ativado' : '🔴 Desativado';

    return this.editOriginal(interaction, {
      embeds: [{
        title:       '📋 Formulário Sequencial (Chat)',
        description: `Status: ${status}\n` +
                     `Perguntas: ${cfg.questions.length}\n` +
                     `Modo: ${cfg.sendMode === 0 ? '📨 Ticket' : '📂 Log'}\n` +
                     `Log: ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Não definido'}\n` +
                     `Timeout por resposta: ${Math.floor((cfg.timeout || 120_000) / 1000)}s`
      }],
      components: [
        this.row(
          this.btn(user, 'Ativar/Desativar', 3, async (i) => {
            await this.deferUpdate(i);
            panel.seqQuestionsConfig.enabled = !panel.seqQuestionsConfig.enabled;
            await this.save(guild);
            return this.seqFormMenu(i, guild, panelId, user);
          }),
          this.btn(user, '➕ Adicionar Pergunta', 1, i => this._addSeqQuestion(i, guild, panelId, user)),
          this.btn(user, '🗑️ Remover Última',     4, async (i) => {
            await this.deferUpdate(i);
            if (cfg.questions?.length) cfg.questions.pop();
            await this.save(guild);
            return this.seqFormMenu(i, guild, panelId, user);
          })
        ),
        this.row(
          this.btn(user, 'Modo de Envio', 2, async (i) => {
            await this.deferUpdate(i);
            cfg.sendMode = cfg.sendMode === 0 ? 1 : 0;
            await this.save(guild);
            return this.seqFormMenu(i, guild, panelId, user);
          }),
          this.btn(user, 'Canal de Log', 1, async (i) => {
            await this.deferUpdate(i);
            return this._setSeqLogChannel(i, guild, panelId, user);
          })
        ),
        this.row(
          this.btn(user, '⬅️ Voltar', 2, async (i) => {
            await this.deferUpdate(i);
            return this.panelMenu(i, guild, panelId, user);
          })
        )
      ]
    });
  }

  async _addSeqQuestion(interaction, guild, panelId, user) {
    const panel = this.getPanel(guild, panelId);

    if (panel.seqQuestionsConfig.questions.length >= 10) {
      return this.followUpEphemeral(interaction, { content: '❌ Limite de 10 perguntas atingido.' });
    }

    const modal = this.client.interactions.createModal({
      user,
      title: 'Adicionar Pergunta Sequencial',
      components: [
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'label',
            label:       'Pergunta',
            style:       1,
            required:    true,
            max_length:  200,
            placeholder: 'Ex: Qual é o seu problema?'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'placeholder',
            label:       'Dica de resposta (opcional)',
            style:       1,
            required:    false,
            max_length:  200,
            placeholder: 'Ex: Descreva detalhadamente...'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'tipo',
            label:       'Tipo (text | number | yesno)',
            style:       1,
            required:    true,
            max_length:  10,
            placeholder: 'text'
          }]
        }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const label = fields.label?.trim();
        if (!label) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Pergunta inválida.', flags: 64 } } }
          );
        }

        const tiposValidos = ['text', 'number', 'yesno', 'attachment', 'select'];
        const tipo = tiposValidos.includes(fields.tipo?.trim()) ? fields.tipo.trim() : 'text';

        const panelAtual = this.getPanel(guild, panelId);
        panelAtual.seqQuestionsConfig.questions.push({
          id:          'q_' + Date.now(),
          label,
          tipo,
          required:    true,
          placeholder: fields.placeholder?.trim() || '',
          options:     [],
          maxLength:   2000
        });

        await this.save(guild);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.seqFormMenu(modalInteraction, guild, panelId, user);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async _setSeqLogChannel(interaction, guild, panelId, user) {
    await this.followUpEphemeral(interaction, { content: 'Envie o canal de log do formulário (menção ou ID)' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const id = this.extractId(msg.content);
    if (!id) return this.followUpEphemeral(interaction, { content: '❌ Canal inválido' });

    const panel = this.getPanel(guild, panelId);
    panel.seqQuestionsConfig.logChannelId = id;
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: `✅ Canal de log definido como <#${id}>` });
    return this.seqFormMenu(interaction, guild, panelId, user);
  }

  /* ═══════════════════════════════════════════
     NOVO: MENU SELECT MENU HUB
     ═══════════════════════════════════════════ */

  async selectHubMenu(interaction, guild, panelId, user) {
    const panel = this.getPanel(guild, panelId);

    if (!panel.selectMenuConfig) {
      panel.selectMenuConfig = { enabled: false, placeholder: 'Selecione o tipo de atendimento', options: [] };
    }

    const cfg    = panel.selectMenuConfig;
    const status = cfg.enabled ? '🟢 Ativado' : '🔴 Desativado';
    const opts   = cfg.options.length
      ? cfg.options.map((o, i) => `${i + 1}. **${o.label}** → painel \`${o.panelId}\``).join('\n')
      : 'Nenhuma opção';

    return this.editOriginal(interaction, {
      embeds: [{
        title:       '🎛️ Select Menu Hub',
        description: `Status: ${status}\n` +
                     `Placeholder: ${cfg.placeholder}\n\n` +
                     `**Opções:**\n${opts}`
      }],
      components: [
        this.row(
          this.btn(user, 'Ativar/Desativar', 3, async (i) => {
            await this.deferUpdate(i);
            panel.selectMenuConfig.enabled = !panel.selectMenuConfig.enabled;
            await this.save(guild);
            return this.selectHubMenu(i, guild, panelId, user);
          }),
          this.btn(user, '➕ Adicionar Opção', 1, i => this._addSelectOption(i, guild, panelId, user)),
          this.btn(user, '🗑️ Remover Última',  4, async (i) => {
            await this.deferUpdate(i);
            if (cfg.options?.length) cfg.options.pop();
            await this.save(guild);
            return this.selectHubMenu(i, guild, panelId, user);
          })
        ),
        this.row(
          this.btn(user, 'Editar Placeholder', 2, async (i) => {
            await this.deferUpdate(i);
            return this._setSelectPlaceholder(i, guild, panelId, user);
          }),
          this.btn(user, '⬅️ Voltar', 2, async (i) => {
            await this.deferUpdate(i);
            return this.panelMenu(i, guild, panelId, user);
          })
        )
      ]
    });
  }

  async _addSelectOption(interaction, guild, panelId, user) {
    const panel = this.getPanel(guild, panelId);

    if (panel.selectMenuConfig.options.length >= 25) {
      return this.followUpEphemeral(interaction, { content: '❌ Limite de 25 opções atingido.' });
    }

    const modal = this.client.interactions.createModal({
      user,
      title: 'Adicionar Opção ao Select Menu',
      components: [
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'label',
            label:       'Label (máx. 25 caracteres)',
            style:       1,
            required:    true,
            max_length:  25,
            placeholder: 'Ex: Suporte Técnico'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'description',
            label:       'Descrição (opcional, máx. 50 caracteres)',
            style:       1,
            required:    false,
            max_length:  50,
            placeholder: 'Ex: Para problemas técnicos'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'emoji',
            label:       'Emoji (opcional)',
            style:       1,
            required:    false,
            max_length:  10,
            placeholder: '🎫'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'panel_id',
            label:       'ID do Painel de destino',
            style:       1,
            required:    true,
            max_length:  100,
            placeholder: 'Ex: panel_1234567890'
          }]
        }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const label   = fields.label?.trim();
        const panelIdDest = fields.panel_id?.trim();

        if (!label || !panelIdDest) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Label e ID do painel são obrigatórios.', flags: 64 } } }
          );
        }

        // verifica se o painel de destino existe
        const destPanel = this.getPanel(guild, panelIdDest);
        if (!destPanel) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: `❌ Painel \`${panelIdDest}\` não encontrado.`, flags: 64 } } }
          );
        }

        const panelAtual = this.getPanel(guild, panelId);
        panelAtual.selectMenuConfig.options.push({
          label,
          description: fields.description?.trim() || '',
          emoji:       fields.emoji?.trim() || null,
          panelId:     panelIdDest
        });

        await this.save(guild);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.selectHubMenu(modalInteraction, guild, panelId, user);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async _setSelectPlaceholder(interaction, guild, panelId, user) {
    await this.followUpEphemeral(interaction, { content: 'Envie o novo placeholder do select menu:' });

    let msg;
    try { msg = await this.client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: user }); }
    catch { return; }

    const panel = this.getPanel(guild, panelId);
    panel.selectMenuConfig.placeholder = msg.content.slice(0, 150);
    await this.save(guild);

    this.followUpEphemeral(interaction, { content: '✅ Placeholder atualizado!' });
    return this.selectHubMenu(interaction, guild, panelId, user);
  }

  /* ═══════════════════════════════════════════
     DELETE PANEL — sem alteração
     ═══════════════════════════════════════════ */

  async deletePanel(interaction, guild, panelId, user) {
    guild.ticket = guild.ticket.filter(p => p.panelId !== panelId);
    await this.save(guild);
    return this.startSetup(interaction);
  }

  /* ═══════════════════════════════════════════
     PERMISSÕES — sem alteração
     ═══════════════════════════════════════════ */

  async checkBotPermissions(interaction, panel) {
    try {
      const guildId = interaction.guild_id;

      const guildPerms = await getPerm({ guildId, bot: true });

      const baseChannelId = panel.tipoDeCriacao === 0
        ? panel.categoriaId || interaction.channel_id
        : interaction.channel_id;

      const channelPerms = await getPerm({ guildId, channel: true, id: baseChannelId, bot: true });

      const required = new Set();

      if (panel.tipoDeCriacao === 0) {
        required.add('VIEW_CHANNEL');
        required.add('SEND_MESSAGES');
        required.add('MANAGE_CHANNELS');
      }

      if (panel.tipoDeCriacao === 1) {
        required.add('VIEW_CHANNEL');
        required.add('SEND_MESSAGES');
        required.add('CREATE_PUBLIC_THREADS');
        required.add('SEND_MESSAGES_IN_THREADS');
      }

      if (panel.tipoDeCriacao === 2) {
        required.add('VIEW_CHANNEL');
        required.add('SEND_MESSAGES');
        required.add('CREATE_PRIVATE_THREADS');
        required.add('SEND_MESSAGES_IN_THREADS');
        required.add('MANAGE_THREADS');
      }

      const missing = [];
      for (const perm of required) {
        if (!guildPerms.includes(perm) || !channelPerms.includes(perm)) {
          missing.push(perm);
        }
      }

      return { ok: missing.length === 0, missing: this.formatPermissions(missing) };

    } catch (err) {
      console.error('Erro ao verificar permissões:', err);
      return { ok: false, missing: ['Erro ao verificar permissões'] };
    }
  }

  formatPermissions(perms = []) {
    const translate = {
      VIEW_CHANNEL:              'Ver Canal',
      SEND_MESSAGES:             'Enviar Mensagens',
      MANAGE_CHANNELS:           'Gerenciar Canais',
      MANAGE_THREADS:            'Gerenciar Tópicos',
      CREATE_PUBLIC_THREADS:     'Criar Tópicos Públicos',
      CREATE_PRIVATE_THREADS:    'Criar Tópicos Privados',
      SEND_MESSAGES_IN_THREADS:  'Enviar Mensagens em Tópicos',
      MANAGE_ROLES:              'Gerenciar Cargos'
    };
    return perms.map(p => translate[p] || p);
  }

  async checkSendPanelPermissions(guildId, channelId) {
    try {
      const perms    = await getPerm({ guildId, channel: true, id: channelId, bot: true });
      const required = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS'];
      const missing  = required.filter(p => !perms.includes(p));
      return { ok: missing.length === 0, missing: this.formatPermissions(missing) };
    } catch (err) {
      console.error('Erro ao verificar permissões do painel:', err);
      return { ok: false, missing: ['Erro ao verificar permissões'] };
    }
  }
}

module.exports = TicketSystem;
