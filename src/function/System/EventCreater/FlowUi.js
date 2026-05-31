'use strict';

const { randomUUID } = require('crypto');
const DiscordRequest  = require('../../DiscordRequest.js');
const FlowBuilder     = require('./FlowBuilder.js');
const CommandBuilder  = require('./CommandBuilder.js');

/**
 * FlowUI
 *
 * Painel de configuração do Logic Builder no Discord.
 * Ponto de entrada: client.logicUI.open(interaction)
 *
 * Hierarquia de telas:
 *   home → lista de fluxos → menu do fluxo → builder (trigger / condições / ações)
 *   home → lista de comandos → menu do comando
 */
class FlowUI {

  constructor(client) {
    this.client       = client;
    this.flowBuilder  = new FlowBuilder(client, this);
    this.cmdBuilder   = new CommandBuilder(client, this);
  }

  /* ═══════════════════════════════════════════
     HELPERS DE INTERACTION — espelham TicketSystem
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

  /* ═══════════════════════════════════════════
     HELPERS DE COMPONENTES
     ═══════════════════════════════════════════ */

  btn(user, label, style, func, opts = {}) {
    return this.client.interactions.createButton({
      user,
      data: { label, style, emoji: opts.emoji },
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

  row(...components) {
    return { type: 1, components };
  }

  extractId(text) {
    return text?.match(/\d{17,19}/)?.[0];
  }

  /* ═══════════════════════════════════════════
     TELA: HOME
     ═══════════════════════════════════════════ */

  async open(interaction) {
    const user    = interaction.member?.user?.id || interaction.user?.id;
    const guildId = interaction.guild_id;

    const engine = this.client.logicEngine;
    const flows  = await engine.getFlows(guildId);

    const { FlowModel, CustomCommandModel } = require('../../../Mongodb/flow.js');
    const cmdCount = await CustomCommandModel.countDocuments({ guildId });

    return this.editOriginal(interaction, this._homePayload(user, flows, cmdCount));
  }

  _homePayload(user, flows, cmdCount) {
    const enabled  = flows.filter(f => f.enabled).length;
    const disabled = flows.length - enabled;

    const btnFlows = this.btn(user, `Fluxos (${flows.length})`, 1, async (i) => {
      await this.deferUpdate(i);
      return this.flowList(i, user);
    });

    const btnCmds = this.btn(user, `Comandos (${cmdCount})`, 2, async (i) => {
      await this.deferUpdate(i);
      return this.commandList(i, user);
    });

    const btnNew = this.btn(user, '➕ Novo Fluxo', 3, async (i) => {
     // await this.deferUpdate(i);
      return this.flowBuilder.startCreate(i, user);
    });

    return {
      embeds: [{
        title:       '⚡ Logic Builder',
        description: 'Crie automações, eventos e comandos personalizados sem programar.',
        color:       0x5865F2,
        fields: [
          { name: '📊 Fluxos',    value: `Total: **${flows.length}** | Ativos: **${enabled}** | Desativados: **${disabled}**`, inline: false },
          { name: '🔧 Comandos', value: `Total: **${cmdCount}**`, inline: false }
        ],
        footer: { text: 'Logic Builder • Selecione uma opção abaixo' }
      }],
      components: [
        this.row(btnFlows, btnCmds, btnNew)
      ]
    };
  }

  /* ═══════════════════════════════════════════
     TELA: LISTA DE FLUXOS
     ═══════════════════════════════════════════ */

  async flowList(interaction, user) {
    const guildId = interaction.guild_id;
    const flows   = await this.client.logicEngine.getFlows(guildId);

    if (!flows.length) {
      const btnCreate = this.btn(user, '➕ Criar primeiro fluxo', 3, async (i) => {
      //  await this.deferUpdate(i);
        return this.flowBuilder.startCreate(i, user);
      });

      const btnBack = this.btn(user, '⬅️ Voltar', 2, async (i) => {
        await this.deferUpdate(i);
        return this.open(i);
      });

      return this.editOriginal(interaction, {
        embeds: [{
          title:       '📋 Fluxos',
          description: 'Nenhum fluxo criado ainda.\nClique abaixo para criar o primeiro!',
          color:       0x5865F2
        }],
        components: [this.row(btnCreate, btnBack)]
      });
    }

    // Pagina em grupos de 25 (limite do select)
    const options = flows.slice(0, 25).map(f => ({
      label:       f.name.slice(0, 100),
      value:       f.flowId,
      description: `${this._triggerLabel(f.trigger)} • ${f.enabled ? '🟢 Ativo' : '🔴 Desativado'}`,
      emoji:       { name: f.enabled ? '🟢' : '🔴' }
    }));

    const sel = this.select(user, options, 'Selecionar fluxo', async (i) => {
      await this.deferUpdate(i);
      return this.flowMenu(i, user, i.data.values[0]);
    });

    const btnCreate = this.btn(user, '➕ Novo Fluxo', 3, async (i) => {
      await this.deferUpdate(i);
      return this.flowBuilder.startCreate(i, user);
    });

    const btnBack = this.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.deferUpdate(i);
      return this.open(i);
    });

    return this.editOriginal(interaction, {
      embeds: [{
        title:       `📋 Fluxos (${flows.length})`,
        description: 'Selecione um fluxo para gerenciar.',
        color:       0x5865F2
      }],
      components: [
        this.row(sel),
        this.row(btnCreate, btnBack)
      ]
    });
  }

  /* ═══════════════════════════════════════════
     TELA: MENU DO FLUXO
     ═══════════════════════════════════════════ */

  async flowMenu(interaction, user, flowId) {
    const guildId = interaction.guild_id;
    const { FlowModel } = require('../../../Mongodb/flow.js');
    const flow = await FlowModel.findOne({ flowId, guildId }).lean();

    if (!flow) {
      return this.followUpEphemeral(interaction, { content: '❌ Fluxo não encontrado.' });
    }

    const status = flow.enabled ? '🟢 Ativo' : '🔴 Desativado';

    const btnTrigger = this.btn(user, '🎯 Trigger', 1, async (i) => {
      await this.deferUpdate(i);
      return this.flowBuilder.triggerMenu(i, user, flowId);
    });

    const btnConditions = this.btn(user, `🔍 Condições (${flow.conditions?.length || 0})`, 2, async (i) => {
      await this.deferUpdate(i);
      return this.flowBuilder.conditionsMenu(i, user, flowId);
    });

    const btnActions = this.btn(user, `⚡ Ações (${flow.actions?.length || 0})`, 2, async (i) => {
      await this.deferUpdate(i);
      return this.flowBuilder.actionsMenu(i, user, flowId);
    });

    const btnVars = this.btn(user, `📦 Variáveis (${flow.variables?.length || 0})`, 2, async (i) => {
      await this.deferUpdate(i);
      return this.flowBuilder.variablesMenu(i, user, flowId);
    });

    const btnSettings = this.btn(user, '⚙️ Configurações', 2, async (i) => {
      await this.deferUpdate(i);
      return this.flowBuilder.settingsMenu(i, user, flowId);
    });

    const btnToggle = this.btn(user, flow.enabled ? '⏸️ Desativar' : '▶️ Ativar', flow.enabled ? 4 : 3, async (i) => {
      await this.deferUpdate(i);
      await this.client.logicEngine.toggleFlow(flowId, guildId);
      return this.flowMenu(i, user, flowId);
    });

    const btnDelete = this.btn(user, '🗑️ Excluir', 4, async (i) => {
      await this.deferUpdate(i);
      return this._confirmDelete(i, user, flowId, flow.name);
    });

    const btnBack = this.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.deferUpdate(i);
      return this.flowList(i, user);
    });

    return this.editOriginal(interaction, {
      embeds: [this._flowEmbed(flow, status)],
      components: [
        this.row(btnTrigger, btnConditions, btnActions),
        this.row(btnVars, btnSettings),
        this.row(btnToggle, btnDelete, btnBack)
      ]
    });
  }

  _flowEmbed(flow, status) {
    const triggerLabel = this._triggerLabel(flow.trigger);
    const runs = flow.stats?.totalRuns || 0;
    const ok   = flow.stats?.successRuns || 0;
    const fail = flow.stats?.failedRuns || 0;

    return {
      title:       `⚡ ${flow.name}`,
      description: flow.description || '_Sem descrição_',
      color:       flow.enabled ? 0x57F287 : 0xED4245,
      fields: [
        { name: 'Status',         value: status,        inline: true  },
        { name: 'Trigger',        value: triggerLabel,  inline: true  },
        { name: 'Condições',      value: String(flow.conditions?.length || 0), inline: true },
        { name: 'Ações',          value: String(flow.actions?.length || 0),    inline: true },
        { name: 'Execuções',      value: `✅ ${ok}  ❌ ${fail}  Total: ${runs}`, inline: true },
        { name: 'Cooldown',       value: flow.cooldown > 0 ? `${flow.cooldown / 1000}s` : 'Nenhum', inline: true }
      ],
      footer: { text: `ID: ${flow.flowId}` },
      timestamp: flow.updatedAt
    };
  }

  /* ═══════════════════════════════════════════
     CONFIRMAR EXCLUSÃO
     ═══════════════════════════════════════════ */

  async _confirmDelete(interaction, user, flowId, flowName) {
    const btnConfirm = this.btn(user, '✅ Confirmar exclusão', 4, async (i) => {
      await this.deferUpdate(i);
      await this.client.logicEngine.deleteFlow(flowId, i.guild_id);
      await this.followUpEphemeral(i, { content: `✅ Fluxo **${flowName}** excluído.` });
      return this.flowList(i, user);
    });

    const btnCancel = this.btn(user, '❌ Cancelar', 2, async (i) => {
      await this.deferUpdate(i);
      return this.flowMenu(i, user, flowId);
    });

    return this.editOriginal(interaction, {
      embeds: [{
        title:       '⚠️ Confirmar exclusão',
        description: `Tem certeza que deseja excluir o fluxo **${flowName}**?\n\nEsta ação não pode ser desfeita.`,
        color:       0xED4245
      }],
      components: [this.row(btnConfirm, btnCancel)]
    });
  }

  /* ═══════════════════════════════════════════
     TELA: LISTA DE COMANDOS
     ═══════════════════════════════════════════ */

  async commandList(interaction, user) {
    const guildId = interaction.guild_id;
    const { CustomCommandModel } = require('../../../Mongodb/flow.js');
    const commands = await CustomCommandModel.find({ guildId }).lean();

    const btnCreate = this.btn(user, '➕ Novo Comando', 3, async (i) => {
     await this.deferUpdate(i);
      return this.cmdBuilder.startCreate(i, user);
    });

    const btnBack = this.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.deferUpdate(i);
      return this.open(i);
    });

    if (!commands.length) {
      return this.editOriginal(interaction, {
        embeds: [{
          title:       '🔧 Comandos Personalizados',
          description: 'Nenhum comando criado ainda.',
          color:       0x5865F2
        }],
        components: [this.row(btnCreate, btnBack)]
      });
    }

    const options = commands.slice(0, 25).map(c => ({
      label:       `${c.prefix}${c.name}`.slice(0, 100),
      value:       c.commandId,
      description: c.description?.slice(0, 100) || 'Sem descrição',
      emoji:       { name: c.enabled ? '🟢' : '🔴' }
    }));

    const sel = this.select(user, options, 'Selecionar comando', async (i) => {
      await this.deferUpdate(i);
      return this.cmdBuilder.commandMenu(i, user, i.data.values[0]);
    });

    return this.editOriginal(interaction, {
      embeds: [{
        title:       `🔧 Comandos (${commands.length})`,
        description: 'Selecione um comando para gerenciar.',
        color:       0x5865F2
      }],
      components: [
        this.row(sel),
        this.row(btnCreate, btnBack)
      ]
    });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  _triggerLabel(trigger) {
    if (!trigger) return 'Não configurado';
    const labels = {
      'message:message_created':        '💬 Mensagem criada',
      'message:message_edited':         '✏️ Mensagem editada',
      'message:message_deleted':        '🗑️ Mensagem apagada',
      'message:message_contains_text':  '🔍 Mensagem com texto',
      'message:message_contains_link':  '🔗 Mensagem com link',
      'member:member_joined':           '👋 Membro entrou',
      'member:member_left':             '🚪 Membro saiu',
      'member:member_banned':           '🔨 Membro banido',
      'member:member_unbanned':         '✅ Membro desbanido',
      'member:member_nick_changed':     '📝 Nick alterado',
      'reaction:reaction_added':        '😊 Reação adicionada',
      'reaction:reaction_removed':      '😶 Reação removida',
      'voice:voice_joined':             '🔊 Entrou em call',
      'voice:voice_left':               '🔇 Saiu da call',
      'voice:voice_moved':              '🔀 Mudou de call',
      'component:button_clicked':       '🖱️ Botão clicado',
      'component:select_used':          '📋 Select usado',
      'component:modal_submitted':      '📝 Modal enviado',
      'channel:channel_created':        '📁 Canal criado',
      'channel:channel_deleted':        '❌ Canal apagado',
      'internal:custom_event':          '⚡ Evento customizado'
    };
    return labels[`${trigger.category}:${trigger.type}`] || `${trigger.category}/${trigger.type}`;
  }
}

module.exports = FlowUI;
