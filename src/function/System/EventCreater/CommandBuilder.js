'use strict';

const DiscordRequest = require('../../DiscordRequest.js');
const { CustomCommandModel, FlowModel } = require('../../../Mongodb/flow.js');

/**
 * CommandBuilder
 *
 * Gerencia criação e edição de comandos de prefixo personalizados.
 * Cada comando aponta para um fluxo existente.
 */
class CommandBuilder {

  constructor(client, ui) {
    this.client = client;
    this.ui     = ui;
  }

  /* ═══════════════════════════════════════════
     CRIAR COMANDO
     ═══════════════════════════════════════════ */

  async startCreate(interaction, user) {
    // Primeiro precisa existir pelo menos um fluxo
    const flows = await FlowModel.find({ guildId: interaction.guild_id }).lean();

    if (!flows.length) {
      return this.ui.followUpEphemeral(interaction, {
        content: '❌ Crie pelo menos um fluxo antes de criar um comando personalizado.'
      });
    }

    // Passo 1: seleciona o fluxo que o comando vai executar
    const options = flows.slice(0, 25).map(f => ({
      label:       f.name.slice(0, 100),
      value:       f.flowId,
      description: `${f.enabled ? '🟢' : '🔴'} ${this.ui._triggerLabel(f.trigger)}`
    }));

    const sel = this.ui.select(user, options, 'Selecione o fluxo do comando', async (i) => {
     // await this.ui.deferUpdate(i);
      return this._createStep2(i, user, i.data.values[0]);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.commandList(i, user);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       '🔧 Novo Comando — Passo 1',
        description: 'Selecione o fluxo que será executado quando o comando for usado:',
        color:       0x5865F2
      }],
      components: [this.ui.row(sel), this.ui.row(btnBack)]
    });
  }

  async _createStep2(interaction, user, flowId) {
    const modal = this.client.interactions.createModal({
      user,
      title: 'Novo Comando — Detalhes',
      components: [
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'name',
            label:       'Nome do comando (sem prefixo)',
            style:       1,
            required:    true,
            max_length:  30,
            placeholder: 'daily, pescar, abrir, caçar...'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'aliases',
            label:       'Aliases (separados por vírgula)',
            style:       1,
            required:    false,
            max_length:  200,
            placeholder: 'dy, dia, diario'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'prefix',
            label:       'Prefixo (padrão: !)',
            style:       1,
            required:    false,
            max_length:  5,
            placeholder: '!'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'cooldown',
            label:       'Cooldown em segundos (0 = sem cooldown)',
            style:       1,
            required:    false,
            max_length:  10,
            placeholder: '86400'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'description',
            label:       'Descrição',
            style:       2,
            required:    false,
            max_length:  200,
            placeholder: 'Colete sua recompensa diária.'
          }]
        }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const name = fields.name?.trim().toLowerCase().replace(/\s+/g, '_');
        if (!name) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Nome inválido.', flags: 64 } } }
          );
        }

        // Verifica duplicata
        const existing = await CustomCommandModel.findOne({
          guildId: modalInteraction.guild_id,
          name
        });

        if (existing) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: `❌ Comando **${name}** já existe.`, flags: 64 } } }
          );
        }

        const aliases = fields.aliases
          ? fields.aliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
          : [];

        const cmd = await this.client.logicEngine.createCommand({
          guildId:     modalInteraction.guild_id,
          name,
          aliases,
          description: fields.description?.trim() || '',
          prefix:      fields.prefix?.trim() || '!',
          flowId,
          cooldown:    (Number(fields.cooldown) || 0) * 1000
        });

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        await this.ui.followUpEphemeral(modalInteraction, {
          content: `✅ Comando **${cmd.prefix}${name}** criado!`
        });

        return this.commandMenu(modalInteraction, user, cmd.commandId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     MENU DO COMANDO
     ═══════════════════════════════════════════ */

  async commandMenu(interaction, user, commandId) {
    const guildId = interaction.guild_id;
    const cmd = await CustomCommandModel.findOne({ commandId, guildId }).lean();

    if (!cmd) {
      return this.ui.followUpEphemeral(interaction, { content: '❌ Comando não encontrado.' });
    }

    const flow = await FlowModel.findOne({ flowId: cmd.flowId }).lean();
    const flowLabel = flow ? flow.name : '⚠️ Fluxo não encontrado';

    const btnToggle = this.ui.btn(
      user,
      cmd.enabled ? '⏸️ Desativar' : '▶️ Ativar',
      cmd.enabled ? 4 : 3,
      async (i) => {
        await this.ui.deferUpdate(i);
        await CustomCommandModel.updateOne({ commandId }, { enabled: !cmd.enabled });
        this.client.logicEngine._flowCache?.delete(`cmd:${guildId}`);
        return this.commandMenu(i, user, commandId);
      }
    );

    const btnEdit = this.ui.btn(user, '✏️ Editar', 2, i => this._editCommand(i, user, commandId));

    const btnChangeFlow = this.ui.btn(user, '🔀 Trocar Fluxo', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this._changeFlow(i, user, commandId);
    });

    const btnRoles = this.ui.btn(user, '🛡️ Cargos Necessários', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this._manageRoles(i, user, commandId);
    });

    const btnDelete = this.ui.btn(user, '🗑️ Excluir', 4, async (i) => {
      await this.ui.deferUpdate(i);
      return this._confirmDeleteCommand(i, user, commandId, cmd.name);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.commandList(i, user);
    });

    const aliasStr = cmd.aliases?.length ? cmd.aliases.join(', ') : '_Nenhum_';
    const rolesStr = cmd.requiredRoles?.length ? cmd.requiredRoles.map(r => `<@&${r}>`).join(', ') : '_Qualquer um_';
    const coolStr  = cmd.cooldown > 0 ? `${cmd.cooldown / 1000}s` : 'Nenhum';

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       `🔧 ${cmd.prefix}${cmd.name}`,
        description: cmd.description || '_Sem descrição_',
        color:       cmd.enabled ? 0x57F287 : 0xED4245,
        fields: [
          { name: 'Status',    value: cmd.enabled ? '🟢 Ativo' : '🔴 Desativado', inline: true },
          { name: 'Prefixo',   value: cmd.prefix,   inline: true },
          { name: 'Cooldown',  value: coolStr,       inline: true },
          { name: 'Aliases',   value: aliasStr,      inline: false },
          { name: 'Fluxo',     value: flowLabel,     inline: false },
          { name: 'Cargos',    value: rolesStr,      inline: false }
        ],
        footer: { text: `ID: ${cmd.commandId}` }
      }],
      components: [
        this.ui.row(btnToggle, btnEdit, btnChangeFlow),
        this.ui.row(btnRoles, btnDelete, btnBack)
      ]
    });
  }

  async _editCommand(interaction, user, commandId) {
    const cmd = await CustomCommandModel.findOne({ commandId }).lean();

    const modal = this.client.interactions.createModal({
      user,
      title: 'Editar Comando',
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'name',        label: 'Nome',          style: 1, required: true,  max_length: 30,  value: cmd.name }] },
        { type: 1, components: [{ type: 4, custom_id: 'aliases',     label: 'Aliases',       style: 1, required: false, max_length: 200, value: cmd.aliases?.join(', ') || '' }] },
        { type: 1, components: [{ type: 4, custom_id: 'prefix',      label: 'Prefixo',       style: 1, required: false, max_length: 5,   value: cmd.prefix }] },
        { type: 1, components: [{ type: 4, custom_id: 'cooldown',    label: 'Cooldown (s)',  style: 1, required: false, max_length: 10,  value: String(cmd.cooldown / 1000 || 0) }] },
        { type: 1, components: [{ type: 4, custom_id: 'description', label: 'Descrição',     style: 2, required: false, max_length: 200, value: cmd.description || '' }] }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const updates = {
          name:        fields.name?.trim().toLowerCase() || cmd.name,
          aliases:     fields.aliases ? fields.aliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean) : [],
          prefix:      fields.prefix?.trim() || '!',
          cooldown:    (Number(fields.cooldown) || 0) * 1000,
          description: fields.description?.trim() || ''
        };

        await CustomCommandModel.updateOne({ commandId }, updates);
        this.client.logicEngine._flowCache?.delete(`cmd:${modalInteraction.guild_id}`);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.commandMenu(modalInteraction, user, commandId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async _changeFlow(interaction, user, commandId) {
    const flows = await FlowModel.find({ guildId: interaction.guild_id }).lean();

    if (!flows.length) {
      return this.ui.followUpEphemeral(interaction, { content: '❌ Nenhum fluxo disponível.' });
    }

    const options = flows.slice(0, 25).map(f => ({
      label:       f.name.slice(0, 100),
      value:       f.flowId,
      description: `${f.enabled ? '🟢' : '🔴'} ${this.ui._triggerLabel(f.trigger)}`
    }));

    const sel = this.ui.select(user, options, 'Selecione o novo fluxo', async (i) => {
      await this.ui.deferUpdate(i);
      await CustomCommandModel.updateOne({ commandId }, { flowId: i.data.values[0] });
      this.client.logicEngine._flowCache?.delete(`cmd:${i.guild_id}`);
      await this.ui.followUpEphemeral(i, { content: '✅ Fluxo do comando atualizado!' });
      return this.commandMenu(i, user, commandId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.commandMenu(i, user, commandId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{ title: '🔀 Trocar Fluxo do Comando', color: 0x5865F2 }],
      components: [this.ui.row(sel), this.ui.row(btnBack)]
    });
  }

  async _manageRoles(interaction, user, commandId) {
    const cmd = await CustomCommandModel.findOne({ commandId }).lean();
    const rolesStr = cmd.requiredRoles?.length
      ? cmd.requiredRoles.map(r => `<@&${r}>`).join('\n')
      : '_Nenhum — qualquer usuário pode usar_';

    const btnAdd = this.ui.btn(user, '➕ Adicionar Cargo', 1, async (i) => {
      await this.ui.deferUpdate(i);
      await this.ui.followUpEphemeral(i, { content: 'Envie o cargo (menção ou ID):' });

      let msg;
      try {
        msg = await this.client.NextMessageCollector.wait({
          channelId: i.channel_id,
          userId:    user
        });
      } catch { return; }

      const id = msg.content?.match(/\d{17,19}/)?.[0];
      if (!id) return this.ui.followUpEphemeral(i, { content: '❌ Cargo inválido.' });

      const roles = cmd.requiredRoles || [];
      if (!roles.includes(id)) roles.push(id);

      await CustomCommandModel.updateOne({ commandId }, { requiredRoles: roles });
      this.client.logicEngine._flowCache?.delete(`cmd:${i.guild_id}`);
      return this._manageRoles(i, user, commandId);
    });

    const btnClear = this.ui.btn(user, '🧹 Limpar', 4, async (i) => {
      await this.ui.deferUpdate(i);
      await CustomCommandModel.updateOne({ commandId }, { requiredRoles: [] });
      this.client.logicEngine._flowCache?.delete(`cmd:${i.guild_id}`);
      return this._manageRoles(i, user, commandId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.commandMenu(i, user, commandId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       '🛡️ Cargos Necessários',
        description: `Apenas usuários com estes cargos podem usar o comando:\n\n${rolesStr}`,
        color:       0x5865F2
      }],
      components: [this.ui.row(btnAdd, btnClear, btnBack)]
    });
  }

  async _confirmDeleteCommand(interaction, user, commandId, name) {
    const btnConfirm = this.ui.btn(user, '✅ Confirmar', 4, async (i) => {
      await this.ui.deferUpdate(i);
      await this.client.logicEngine.deleteCommand(commandId, i.guild_id);
      await this.ui.followUpEphemeral(i, { content: `✅ Comando **${name}** excluído.` });
      return this.ui.commandList(i, user);
    });

    const btnCancel = this.ui.btn(user, '❌ Cancelar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.commandMenu(i, user, commandId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       '⚠️ Excluir Comando',
        description: `Excluir **${name}**? Esta ação não pode ser desfeita.`,
        color:       0xED4245
      }],
      components: [this.ui.row(btnConfirm, btnCancel)]
    });
  }
}

module.exports = CommandBuilder;
