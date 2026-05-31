'use strict';

const DiscordRequest = require('../../DiscordRequest.js');
const { FlowModel }  = require('../../../Mongodb/flow.js');
const { randomUUID } = require('crypto');

/* ─────────────────────────────────────────────
   CATÁLOGOS — label e metadados de cada tipo
   ───────────────────────────────────────────── */

const TRIGGER_CATALOG = [
  //Tenpo
  { category: 'time', type: 'scheduled_trigger', label: '🕐 Horário agendado', description: 'Dispara em um horário específico todo dia' },
  // Mensagens
  { category: 'command', type: 'command_executed', label: '🔧 Comando executado', description: 'Disparado quando um comando personalizado é usado' },
  { category: 'message', type: 'message_created',       label: '💬 Mensagem criada',          description: 'Qualquer mensagem enviada' },
  { category: 'message', type: 'message_edited',        label: '✏️ Mensagem editada',          description: 'Mensagem editada por alguém' },
  { category: 'message', type: 'message_deleted',       label: '🗑️ Mensagem apagada',          description: 'Mensagem deletada' },
  { category: 'message', type: 'message_contains_text', label: '🔍 Contém texto',              description: 'Mensagem com conteúdo específico' },
  { category: 'message', type: 'message_contains_link', label: '🔗 Contém link',               description: 'Mensagem com URL' },
  { category: 'message', type: 'message_contains_image',label: '🖼️ Contém imagem',             description: 'Mensagem com imagem anexada' },
  { category: 'message', type: 'message_contains_file', label: '📎 Contém arquivo',            description: 'Mensagem com arquivo anexado' },
  { category: 'message', type: 'message_contains_mention', label: '📣 Contém menção',          description: 'Mensagem que menciona alguém' },
  { category: 'message', type: 'message_contains_emoji',label: '😀 Contém emoji',              description: 'Mensagem com emoji unicode' },
  { category: 'message', type: 'message_contains_sticker', label: '🎭 Contém sticker',         description: 'Mensagem com sticker' },
  // Reações
  { category: 'reaction', type: 'reaction_added',       label: '➕ Reação adicionada',         description: 'Alguém reagiu a uma mensagem' },
  { category: 'reaction', type: 'reaction_removed',     label: '➖ Reação removida',           description: 'Reação foi removida' },
  // Membros
  { category: 'member', type: 'member_joined',          label: '👋 Membro entrou',             description: 'Novo membro no servidor' },
  { category: 'member', type: 'member_left',            label: '🚪 Membro saiu',               description: 'Membro saiu ou foi expulso' },
  { category: 'member', type: 'member_banned',          label: '🔨 Membro banido',             description: 'Membro foi banido' },
  { category: 'member', type: 'member_unbanned',        label: '✅ Membro desbanido',          description: 'Ban removido' },
  { category: 'member', type: 'member_nick_changed',    label: '📝 Nickname alterado',         description: 'Membro mudou o apelido' },
  // Canais
  { category: 'channel', type: 'channel_created',       label: '📁 Canal criado',              description: 'Novo canal no servidor' },
  { category: 'channel', type: 'channel_deleted',       label: '❌ Canal apagado',             description: 'Canal foi deletado' },
  { category: 'channel', type: 'channel_updated',       label: '🔧 Canal atualizado',          description: 'Canal teve configurações alteradas' },
  // Voz
  { category: 'voice', type: 'voice_joined',            label: '🔊 Entrou em call',            description: 'Usuário entrou em canal de voz' },
  { category: 'voice', type: 'voice_left',              label: '🔇 Saiu da call',              description: 'Usuário saiu de canal de voz' },
  { category: 'voice', type: 'voice_moved',             label: '🔀 Mudou de call',             description: 'Usuário trocou de canal de voz' },
  { category: 'voice', type: 'camera_on',               label: '📷 Câmera ligada',             description: 'Usuário ligou a câmera' },
  { category: 'voice', type: 'camera_off',              label: '📷 Câmera desligada',          description: 'Usuário desligou a câmera' },
  { category: 'voice', type: 'screen_share_start',      label: '🖥️ Tela compartilhada',        description: 'Usuário começou a compartilhar tela' },
  { category: 'voice', type: 'screen_share_stop',       label: '🖥️ Tela parada',               description: 'Usuário parou de compartilhar' },
  // Componentes
  { category: 'component', type: 'button_clicked',      label: '🖱️ Botão clicado',             description: 'Usuário clicou em um botão' },
  { category: 'component', type: 'select_used',         label: '📋 Select usado',              description: 'Usuário usou um select menu' },
  { category: 'component', type: 'modal_submitted',     label: '📝 Modal enviado',             description: 'Usuário enviou um modal' },
  // Interno
  { category: 'internal', type: 'custom_event',         label: '⚡ Evento customizado',        description: 'Disparado por outro fluxo' }
];

const CONDITION_CATALOG = [
  // Usuário
  { category: 'user', type: 'has_role',      label: '👤 Possui cargo',          params: ['roleId'] },
  { category: 'user', type: 'not_has_role',  label: '👤 Não possui cargo',      params: ['roleId'] },
  { category: 'user', type: 'is_bot',        label: '🤖 É bot',                 params: [] },
  { category: 'user', type: 'not_bot',       label: '🧑 Não é bot',             params: [] },
  { category: 'user', type: 'in_voice',      label: '🔊 Está em call',          params: [] },
  { category: 'user', type: 'account_age_gt',label: '📅 Conta criada há +X dias',params: ['days'] },
  { category: 'user', type: 'joined_gt',     label: '📅 Entrou há +X dias',     params: ['days'] },
  // Canal
  { category: 'channel', type: 'is_channel',    label: '📌 Canal específico',   params: ['channelId'] },
  { category: 'channel', type: 'not_channel',   label: '📌 Não é canal',        params: ['channelId'] },
  { category: 'channel', type: 'is_category',   label: '📂 Categoria específica', params: ['categoryId'] },
  // Mensagem
  { category: 'message', type: 'contains_text', label: '🔍 Mensagem contém texto', params: ['text'] },
  { category: 'message', type: 'not_contains',  label: '🔍 Não contém texto',    params: ['text'] },
  { category: 'message', type: 'contains_link', label: '🔗 Contém link',          params: [] },
  { category: 'message', type: 'length_gt',     label: '📏 Tamanho maior que X',  params: ['length'] },
  { category: 'message', type: 'length_lt',     label: '📏 Tamanho menor que X',  params: ['length'] },
  { category: 'message', type: 'matches_regex', label: '🔤 Regex',                params: ['pattern'] },
  //tempo
  { category: 'time', type: 'hour_eq', label: '🕐 Hora igual a', params: ['hour'] },
{ category: 'time', type: 'minute_eq', label: '🕐 Minuto igual a', params: ['minute'] },
  // Variável
  { category: 'variable', type: 'eq',  label: '🔢 Variável igual a',           params: ['name', 'value'] },
  { category: 'variable', type: 'neq', label: '🔢 Variável diferente de',      params: ['name', 'value'] },
  { category: 'variable', type: 'gt',  label: '🔢 Variável maior que',         params: ['name', 'value'] },
  { category: 'variable', type: 'lt',  label: '🔢 Variável menor que',         params: ['name', 'value'] },
  // Probabilidade
  { category: 'probability', type: 'chance', label: '🎲 Chance %', params: ['percent'] },
  // Data / Hora
  { category: 'date', type: 'before',  label: '📅 Antes de data',   params: ['date'] },
  { category: 'date', type: 'after',   label: '📅 Depois de data',  params: ['date'] },
  { category: 'date', type: 'between', label: '📅 Entre datas',     params: ['from', 'to'] },
  { category: 'time', type: 'before',  label: '⏰ Antes de horário', params: ['time'] },
  { category: 'time', type: 'after',   label: '⏰ Depois de horário',params: ['time'] },
  { category: 'time', type: 'between', label: '⏰ Entre horários',   params: ['from', 'to'] },
  // Permissão
  { category: 'permission', type: 'is_admin',        label: '🛡️ É administrador', params: [] },
  { category: 'permission', type: 'has_permission',  label: '🛡️ Tem permissão',   params: ['permission'] }
];

const ACTION_CATALOG = [
  // Mensagem
{ category: 'message', type: 'send_message', label: '💬 Enviar mensagem', params: ['content', 'channelId'] },
  { category: 'message', type: 'send_dm',       label: '📩 Enviar DM',           params: ['content'] },
  { category: 'message', type: 'reply_message', label: '↩️ Responder mensagem',   params: ['content'] },
  { category: 'message', type: 'delete_message',label: '🗑️ Apagar mensagem',      params: [] },
  { category: 'message', type: 'edit_message',  label: '✏️ Editar mensagem',      params: ['content'] },
  // Usuário
  { category: 'user', type: 'give_role',        label: '🏷️ Dar cargo',            params: ['roleId'] },
  { category: 'user', type: 'remove_role',      label: '🏷️ Remover cargo',        params: ['roleId'] },
  { category: 'user', type: 'give_temp_role',   label: '⏱️ Cargo temporário',     params: ['roleId', 'duration'] },
  { category: 'user', type: 'ban',              label: '🔨 Banir usuário',        params: ['reason'] },
  { category: 'user', type: 'kick',             label: '👢 Expulsar usuário',     params: [] },
  { category: 'user', type: 'timeout',          label: '⏸️ Timeout',             params: ['duration'] },
  { category: 'user', type: 'remove_timeout',   label: '▶️ Remover timeout',      params: [] },
  { category: 'user', type: 'change_nickname',  label: '📝 Alterar nickname',     params: ['nickname'] },
  // Variável
  { category: 'variable', type: 'set',    label: '📦 Definir variável',         params: ['name', 'value'] },
  { category: 'variable', type: 'add',    label: '➕ Somar variável',           params: ['name', 'value'] },
  { category: 'variable', type: 'sub',    label: '➖ Subtrair variável',        params: ['name', 'value'] },
  { category: 'variable', type: 'mul',    label: '✖️ Multiplicar variável',     params: ['name', 'value'] },
  { category: 'variable', type: 'random', label: '🎲 Valor aleatório',          params: ['name', 'min', 'max'] },
  // Tempo
  { category: 'time', type: 'wait_seconds', label: '⏱️ Aguardar segundos',      params: ['seconds'] },
  { category: 'time', type: 'wait_minutes', label: '⏱️ Aguardar minutos',       params: ['minutes'] },
  // Discord
  { category: 'discord', type: 'add_reaction',   label: '😀 Adicionar reação',  params: ['emoji'] },
  { category: 'discord', type: 'remove_reaction', label: '😶 Remover reação',   params: ['emoji'] },
  { category: 'discord', type: 'pin_message',     label: '📌 Fixar mensagem',   params: [] },
  // Canal
  { category: 'channel', type: 'create_channel',  label: '📁 Criar canal',      params: ['name'] },
  { category: 'channel', type: 'delete_channel',  label: '❌ Apagar canal',      params: ['channelId'] },
  { category: 'channel', type: 'rename_channel',  label: '✏️ Renomear canal',    params: ['channelId', 'name'] },
  { category: 'channel', type: 'lock_channel',   label: '🔒 Trancar canal',   params: ['channelId', 'roleId'] },
{ category: 'channel', type: 'unlock_channel', label: '🔓 Destrancar canal', params: ['channelId', 'roleId'] },
  // Sistema
  { category: 'system', type: 'run_flow',      label: '⚡ Executar fluxo',       params: ['flowId'] },
  { category: 'system', type: 'emit_event',    label: '📡 Disparar evento',      params: ['eventType'] },
  { category: 'system', type: 'cancel_flow',   label: '🛑 Cancelar fluxo',      params: [] },
  { category: 'system', type: 'stop_execution',label: '⏹️ Parar execução',       params: [] },
  // Webhook
  { category: 'webhook', type: 'send_webhook',   label: '🔗 Enviar webhook',     params: ['url', 'content'] },
  { category: 'webhook', type: 'http_request',   label: '🌐 Requisição HTTP',    params: ['url', 'method'] }
];

/* ─────────────────────────────────────────────
   FLOW BUILDER
   ───────────────────────────────────────────── */

class FlowBuilder {

  constructor(client, ui) {
    this.client = client;
    this.ui     = ui;
  }

  /* ═══════════════════════════════════════════
     CRIAR FLUXO
     ═══════════════════════════════════════════ */

  async startCreate(interaction, user) {
    const modal = this.client.interactions.createModal({
      user,
      title: 'Novo Fluxo',
      components: [
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'name',
            label:       'Nome do fluxo',
            style:       1,
            required:    true,
            max_length:  100,
            placeholder: 'Ex: Boas-vindas, Anti-link, Daily...'
          }]
        },
        {
          type: 1,
          components: [{
            type:        4,
            custom_id:   'description',
            label:       'Descrição (opcional)',
            style:       2,
            required:    false,
            max_length:  300,
            placeholder: 'Descreva o que este fluxo faz...'
          }]
        }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const name = fields.name?.trim();
        if (!name) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Nome inválido.', flags: 64 } } }
          );
        }

        // Cria o fluxo com um trigger placeholder
        const flow = await this.client.logicEngine.createFlow({
          guildId:     modalInteraction.guild_id,
          name,
          description: fields.description?.trim() || '',
          trigger:     { category: 'message', type: 'message_created', filters: {} },
          createdBy:   user
        });

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        await this.ui.followUpEphemeral(modalInteraction, {
          content: `✅ Fluxo **${name}** criado! Configure o trigger abaixo.`
        });

        return this.triggerMenu(modalInteraction, user, flow.flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     MENU: TRIGGER
     ═════════════════════════════���═════════════ */

  async triggerMenu(interaction, user, flowId) {
    const flow = await this._getFlow(interaction.guild_id, flowId);
    if (!flow) return this.ui.followUpEphemeral(interaction, { content: '❌ Fluxo não encontrado.' });

    // Divide o catálogo em páginas de 25 opções
    const page    = 0; // futura paginação
    

    const selectRows = [];

for (let i = 0; i < TRIGGER_CATALOG.length; i += 25) {
  const chunk = TRIGGER_CATALOG.slice(i, i + 25);

  const select = this.ui.select(
    user,
    chunk.map(a => ({
      label: a.label.slice(0, 100),
      value: `${a.category}:${a.type}`
    })),
    `➕ Adicionar ação (${Math.floor(i / 25) + 1})`,
    async (i) => {
      await this.ui.deferUpdate(i);
      const [cat, typ] = i.data.values[0].split(':');
      return this._setTrigger(i, user, flowId, cat, typ);
    }
  );

  selectRows.push(this.ui.row(select));
}

    const btnFilters = this.ui.btn(user, '🔧 Filtros do Trigger', 2, async (i) => {
      //await this.ui.deferUpdate(i);
      return this._triggerFilters(i, user, flowId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.flowMenu(i, user, flowId);
    });

    const current = this.ui._triggerLabel(flow.trigger);

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       '🎯 Configurar Trigger',
        description: `**Trigger atual:** ${current}\n\nEscolha o evento que vai disparar este fluxo:`,
        color:       0x5865F2
      }],
      components: [
         ...selectRows,
         this.ui.row(btnFilters, btnBack)
   ]
    });
  }

  async _setTrigger(interaction, user, flowId, category, type) {
    await this.client.logicEngine.updateFlow(flowId, interaction.guild_id, {
      trigger: { category, type, filters: {} }
    });

    await this.ui.followUpEphemeral(interaction, {
      content: `✅ Trigger definido: **${this.ui._triggerLabel({ category, type })}**`
    });

    return this.triggerMenu(interaction, user, flowId);
  }

  async _triggerFilters(interaction, user, flowId) {
    const flow = await this._getFlow(interaction.guild_id, flowId);
    if (!flow) return;

    // Filtros disponíveis dependem da categoria do trigger
    const category = flow.trigger?.category;
    let filterHint = '';

    if (category === 'message')   filterHint = 'channelId — limitar a um canal\ntext — texto específico (para contém texto)';
    if (category === 'member')    filterHint = 'roleId — limitar a usuários com cargo';
    if (category === 'component') filterHint = 'customId — ID do botão/select específico';
    if (category === 'reaction')  filterHint = 'emoji — emoji específico\nchannelId — canal específico';
   if (category === 'time') filterHint = 'hour — hora (0-23)\nminute — minuto (0-59, opcional)'; 

    const modal = this.client.interactions.createModal({
      user,
      title: 'Filtros do Trigger',
      components: [{
        type: 1,
        components: [{
          type:        4,
          custom_id:   'filters_json',
          label:       'Filtros (JSON)',
          style:       2,
          required:    false,
          max_length:  500,
          placeholder: filterHint ? `Disponíveis:\n${filterHint}` : '{ "channelId": "123456" }',
          value: (() => {
  const f = { ...flow.trigger.filters };
  delete f.taskId;
  return Object.keys(f).length ? JSON.stringify(f, null, 2) : '';
})()
        }]
      }],
      funcao: async (modalInteraction, client, fields) => {
        let filters = {};
        if (fields.filters_json?.trim()) {
          try { filters = JSON.parse(fields.filters_json); }
          catch {
            return DiscordRequest(
              `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
              { method: 'POST', body: { type: 4, data: { content: '❌ JSON inválido.', flags: 64 } } }
            );
          }
        }

        await this.client.logicEngine.updateFlow(flowId, modalInteraction.guild_id, {
          'trigger.filters': filters
        });

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        await this.ui.followUpEphemeral(modalInteraction, { content: '✅ Filtros salvos!' });
        return this.triggerMenu(modalInteraction, user, flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     MENU: CONDIÇÕES
     ═══════════════════════════════════════════ */

  async conditionsMenu(interaction, user, flowId) {
    const flow = await this._getFlow(interaction.guild_id, flowId);
    if (!flow) return;

    const conds  = flow.conditions || [];
    const lines  = conds.length
      ? conds.map((c, i) => {
          const meta    = CONDITION_CATALOG.find(x => x.category === c.category && x.type === c.type);
          const opLabel = i === 0 ? '' : ` **(${c.operator})**`;
          const neg     = c.negate ? ' ~~(negado)~~' : '';
          return `${i + 1}.${opLabel} ${meta?.label || c.type}${neg}`;
        }).join('\n')
      : '_Nenhuma condição — fluxo sempre executa_';

    

   
    const selectRows = [];

for (let i = 0; i < CONDITION_CATALOG.length; i += 25) {
  const chunk = CONDITION_CATALOG.slice(i, i + 25);

  const select = this.ui.select(
    user,
    chunk.map(a => ({
      label: a.label.slice(0, 100),
      value: `${a.category}:${a.type}`
    })),
    `➕ Adicionar ação (${Math.floor(i / 25) + 1})`,
    async (i) => {
      const [cat, typ] = i.data.values[0].split(':');
      return this._addCondition(i, user, flowId, cat, typ);
    }
  );

  selectRows.push(this.ui.row(select));
}

    const btnRemove = this.ui.btn(user, '🗑️ Remover última', 4, async (i) => {
      await this.ui.deferUpdate(i);
      if (!conds.length) return;
      const updated = conds.slice(0, -1);
      await this.client.logicEngine.updateFlow(flowId, i.guild_id, { conditions: updated });
      return this.conditionsMenu(i, user, flowId);
    });

    const btnClear = this.ui.btn(user, '🧹 Limpar tudo', 4, async (i) => {
      await this.ui.deferUpdate(i);
      await this.client.logicEngine.updateFlow(flowId, i.guild_id, { conditions: [] });
      return this.conditionsMenu(i, user, flowId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.flowMenu(i, user, flowId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       `🔍 Condições (${conds.length})`,
        description: `As condições são avaliadas antes de executar as ações.\nSe todas falharem, o fluxo é bloqueado.\n\n${lines}`,
        color:       0x5865F2
      }],
      components: [
              ...selectRows,
              this.ui.row(btnRemove, btnClear, btnBack)
       ]
    });
  }

  async _addCondition(interaction, user, flowId, category, type) {
    const meta = CONDITION_CATALOG.find(c => c.category === category && c.type === type);

    // Se não tem params, adiciona direto (sem modal)
    if (!meta?.params?.length) {
      const flow = await this._getFlow(interaction.guild_id, flowId);
      const conds = flow.conditions || [];
      conds.push({ id: this._uid(), category, type, params: {}, operator: 'AND', negate: false });
      await this.client.logicEngine.updateFlow(flowId, interaction.guild_id, { conditions: conds });
      await this.ui.followUpEphemeral(interaction, { content: `✅ Condição **${meta?.label}** adicionada.` });
      return this.conditionsMenu(interaction, user, flowId);
    }

    // Tem params — abre modal para preenchimento
    const components = meta.params.slice(0, 5).map(p => ({
      type: 1,
      components: [{
        type:        4,
        custom_id:   p,
        label:       this._paramLabel(p),
        style:       1,
        required:    true,
        max_length:  200,
        placeholder: this._paramPlaceholder(p)
      }]
    }));

    // Adiciona campo de operador (AND/OR) e negação
    components.push({
      type: 1,
      components: [{
        type:        4,
        custom_id:   '_meta',
        label: 'Operador',
placeholder: 'AND | OR | NOT AND | NOT OR',
        style:       1,
        required:    false,
        max_length:  10,
        
      }]
    });

    const modal = this.client.interactions.createModal({
      user,
      title: `Condição: ${meta.label.slice(0, 40)}`,
      components,
      funcao: async (modalInteraction, client, fields) => {
        const params   = {};
        for (const p of meta.params) {
          if (fields[p] !== undefined) params[p] = fields[p];
        }

        const metaRaw = (fields._meta || 'AND').toUpperCase();
        const negate  = metaRaw.startsWith('NOT');
        const operator = negate ? metaRaw.replace('NOT ', '') : metaRaw;
        const validOp  = ['AND', 'OR'].includes(operator) ? operator : 'AND';

        const flow  = await this._getFlow(modalInteraction.guild_id, flowId);
        const conds = flow.conditions || [];
        conds.push({ id: this._uid(), category, type, params, operator: validOp, negate });

        await this.client.logicEngine.updateFlow(flowId, modalInteraction.guild_id, { conditions: conds });
        
        

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        await this.ui.followUpEphemeral(modalInteraction, { content: `✅ Condição **${meta.label}** adicionada.` });
        return this.conditionsMenu(modalInteraction, user, flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     MENU: AÇÕES
     ═══════════════════════════════════════════ */

  async actionsMenu(interaction, user, flowId) {
    const flow    = await this._getFlow(interaction.guild_id, flowId);
    const actions = flow?.actions || [];

    const lines = actions.length
      ? actions
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((a, i) => {
            const meta = ACTION_CATALOG.find(x => x.category === a.category && x.type === a.type);
            return `${i + 1}. ${meta?.label || a.type}`;
          })
          .join('\n')
      : '_Nenhuma ação configurada_';

    const selectRows = [];

for (let i = 0; i < ACTION_CATALOG.length; i += 25) {
  const chunk = ACTION_CATALOG.slice(i, i + 25);

  const select = this.ui.select(
    user,
    chunk.map(a => ({
      label: a.label.slice(0, 100),
      value: `${a.category}:${a.type}`
    })),
    `➕ Adicionar ação (${Math.floor(i / 25) + 1})`,
    async (i) => {
      const [cat, typ] = i.data.values[0].split(':');
      return this._addAction(i, user, flowId, cat, typ);
    }
  );

  selectRows.push(this.ui.row(select));
}

    const btnRemove = this.ui.btn(user, '🗑️ Remover última', 4, async (i) => {
      await this.ui.deferUpdate(i);
      if (!actions.length) return;
      const sorted  = [...actions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const updated = sorted.slice(0, -1);
      await this.client.logicEngine.updateFlow(flowId, i.guild_id, { actions: updated });
      return this.actionsMenu(i, user, flowId);
    });

    const btnClear = this.ui.btn(user, '🧹 Limpar tudo', 4, async (i) => {
      await this.ui.deferUpdate(i);
      await this.client.logicEngine.updateFlow(flowId, i.guild_id, { actions: [] });
      return this.actionsMenu(i, user, flowId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.flowMenu(i, user, flowId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       `⚡ Ações (${actions.length})`,
        description: `Ações são executadas em ordem quando o fluxo dispara.\n\n${lines}`,
        color:       0x5865F2
      }],
      components: [
         ...selectRows,
         this.ui.row(btnRemove, btnClear, btnBack)
      ]
    });
  }

  async _addAction(interaction, user, flowId, category, type) {
    const meta = ACTION_CATALOG.find(a => a.category === category && a.type === type);

    // Sem params — adiciona imediatamente
    if (!meta?.params?.length) {
      const flow    = await this._getFlow(interaction.guild_id, flowId);
      const actions = flow.actions || [];
      const order   = actions.length;
      actions.push({ id: this._uid(), category, type, params: {}, order });
      await this.client.logicEngine.updateFlow(flowId, interaction.guild_id, { actions });
      await this.ui.followUpEphemeral(interaction, { content: `✅ Ação **${meta?.label}** adicionada.` });
      return this.actionsMenu(interaction, user, flowId);
    }

    // Com params — modal de preenchimento
    const components = meta.params.slice(0, 5).map(p => ({
      type: 1,
      components: [{
        type:        4,
        custom_id:   p,
        label:       this._paramLabel(p),
        style:       p === 'content' || p === 'reason' ? 2 : 1,
        required:    !['reason', 'description', 'channelId', 'userId'].includes(p),
        max_length:  p === 'content' ? 2000 : 200,
        placeholder: this._paramPlaceholder(p)
      }]
    }));

    const modal = this.client.interactions.createModal({
      user,
      title: `Ação: ${meta.label.slice(0, 40)}`,
      components,
      funcao: async (modalInteraction, client, fields) => {
        const params = {};
        for (const p of meta.params) {
          if (fields[p] !== undefined) params[p] = fields[p];
        }

        const flow    = await this._getFlow(modalInteraction.guild_id, flowId);
        const actions = flow.actions || [];
        actions.push({ id: this._uid(), category, type, params, order: actions.length });

        await this.client.logicEngine.updateFlow(flowId, modalInteraction.guild_id, { actions });

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        await this.ui.followUpEphemeral(modalInteraction, { content: `✅ Ação **${meta.label}** adicionada.` });
        return this.actionsMenu(modalInteraction, user, flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     MENU: VARIÁVEIS
     ═══════════════════════════════════════════ */

  async variablesMenu(interaction, user, flowId) {
    const flow = await this._getFlow(interaction.guild_id, flowId);
    const vars = flow?.variables || [];

    const lines = vars.length
  ? vars.map(v =>
      `• **${v.name}** (${v.type}) = \`${v.defaultValue ?? 'null'}\`` +
      `${v.persistent ? ' 💾' : ''}` +
      ` — ${v.scope === 'user' ? '👤 usuário' : '🌐 fluxo'}`
    ).join('\n')
  : '_Nenhuma variável definida_';

    const btnAdd = this.ui.btn(user, '➕ Adicionar', 1, i => this._addVariable(i, user, flowId));

    const btnRemove = this.ui.btn(user, '🗑️ Remover última', 4, async (i) => {
      await this.ui.deferUpdate(i);
      if (!vars.length) return;
      const updated = vars.slice(0, -1);
      await this.client.logicEngine.updateFlow(flowId, i.guild_id, { variables: updated });
      return this.variablesMenu(i, user, flowId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.flowMenu(i, user, flowId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       `📦 Variáveis (${vars.length})`,
        description: `Variáveis ficam disponíveis nas ações como \`{var:nome}\`.\nVariáveis 💾 são persistentes entre execuções.\n\n${lines}`,
        color:       0x5865F2
      }],
      components: [this.ui.row(btnAdd, btnRemove, btnBack)]
    });
  }

  async _addVariable(interaction, user, flowId) {
    const modal = this.client.interactions.createModal({
      user,
      title: 'Nova Variável',
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'name',  label: 'Nome da variável',           style: 1, required: true,  max_length: 50,  placeholder: 'contador, pontos, status...' }] },{
  type: 1,
  components: [{
    type:        4,
    custom_id:   'scope',
    label:       'Escopo',
    style:       1,
    required:    false,
    max_length:  4,
    placeholder: '(flow = todos | user = por usuário)'
  }]
},
        { type: 1, components: [{ type: 4, custom_id: 'type',  label: 'Tipo (string|number|boolean)',style: 1, required: true,  max_length: 10,  placeholder: 'number' }] },
        { type: 1, components: [{ type: 4, custom_id: 'value', label: 'Valor padrão',               style: 1, required: false, max_length: 200, placeholder: '0' }] },
        { type: 1, components: [{ type: 4, custom_id: 'persist', label: 'Persistente? (sim/não)',   style: 1, required: false, max_length: 3,   placeholder: 'não' }] }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const name = fields.name?.trim().replace(/\s+/g, '_');
        if (!name) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: '❌ Nome inválido.', flags: 64 } } }
          );
        }

        const validTypes  = ['string', 'number', 'boolean', 'list'];
        const type        = validTypes.includes(fields.type) ? fields.type : 'string';
        const persistent  = ['sim', 'yes', 's', 'true'].includes(fields.persist?.toLowerCase());
        const rawDefault  = fields.value?.trim() || null;
        const defaultValue = type === 'number' ? (Number(rawDefault) || 0) : rawDefault;

        const flow = await this._getFlow(modalInteraction.guild_id, flowId);
        const vars = flow.variables || [];
        const scope = ['user'].includes(fields.scope?.trim().toLowerCase()) ? 'user' : 'flow';



        // Evita duplicata de nome
        if (vars.find(v => v.name === name)) {
          return DiscordRequest(
            `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
            { method: 'POST', body: { type: 4, data: { content: `❌ Variável **${name}** já existe.`, flags: 64 } } }
          );
        }

        vars.push({ name, type, defaultValue, persistent, scope });
        await this.client.logicEngine.updateFlow(flowId, modalInteraction.guild_id, { variables: vars });

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.variablesMenu(modalInteraction, user, flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  /* ═══════════════════════════════════════════
     MENU: CONFIGURAÇÕES
     ═══════════════════════════════════════════ */

  async settingsMenu(interaction, user, flowId) {
    const flow = await this._getFlow(interaction.guild_id, flowId);

    const btnCooldown = this.ui.btn(user, '⏱️ Cooldown', 2, i => this._setCooldown(i, user, flowId));

    const btnMode = this.ui.btn(
      user,
      flow.executionMode === 'parallel' ? '🔀 Modo: Paralelo' : '➡️ Modo: Sequencial',
      2,
      async (i) => {
        await this.ui.deferUpdate(i);
        const newMode = flow.executionMode === 'parallel' ? 'sequential' : 'parallel';
        await this.client.logicEngine.updateFlow(flowId, i.guild_id, { executionMode: newMode });
        return this.settingsMenu(i, user, flowId);
      }
    );

    const btnRename = this.ui.btn(user, '✏️ Renomear', 2, i => this._rename(i, user, flowId));

    const btnLogs = this.ui.btn(user, '📊 Ver logs', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this._showLogs(i, user, flowId);
    });

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.ui.flowMenu(i, user, flowId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       '⚙️ Configurações do Fluxo',
        description:
          `**Nome:** ${flow.name}\n` +
          `**Descrição:** ${flow.description || '_Sem descrição_'}\n` +
          `**Modo de execução:** ${flow.executionMode === 'parallel' ? '🔀 Paralelo' : '➡️ Sequencial'}\n` +
          `**Cooldown:** ${flow.cooldown > 0 ? `${flow.cooldown / 1000}s por usuário` : 'Nenhum'}\n` +
          `**Criado por:** ${flow.createdBy ? `<@${flow.createdBy}>` : 'N/A'}`,
        color: 0x5865F2
      }],
      components: [
        this.ui.row(btnCooldown, btnMode, btnRename),
        this.ui.row(btnLogs, btnBack)
      ]
    });
  }

  async _setCooldown(interaction, user, flowId) {
    const modal = this.client.interactions.createModal({
      user,
      title: 'Definir Cooldown',
      components: [{
        type: 1,
        components: [{
          type:        4,
          custom_id:   'seconds',
          label:       'Cooldown em segundos (0 = sem cooldown)',
          style:       1,
          required:    true,
          max_length:  10,
          placeholder: '60'
        }]
      }],
      funcao: async (modalInteraction, client, fields) => {
        const secs = Number(fields.seconds) || 0;
        await this.client.logicEngine.updateFlow(flowId, modalInteraction.guild_id, {
          cooldown: secs * 1000
        });

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.settingsMenu(modalInteraction, user, flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async _rename(interaction, user, flowId) {
    const modal = this.client.interactions.createModal({
      user,
      title: 'Renomear Fluxo',
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'name',        label: 'Novo nome',      style: 1, required: true,  max_length: 100 }] },
        { type: 1, components: [{ type: 4, custom_id: 'description', label: 'Nova descrição', style: 2, required: false, max_length: 300 }] }
      ],
      funcao: async (modalInteraction, client, fields) => {
        const updates = {};
        if (fields.name?.trim())        updates.name        = fields.name.trim();
        if (fields.description !== undefined) updates.description = fields.description.trim();

        await this.client.logicEngine.updateFlow(flowId, modalInteraction.guild_id, updates);

        await DiscordRequest(
          `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
          { method: 'POST', body: { type: 6 } }
        );

        return this.settingsMenu(modalInteraction, user, flowId);
      }
    });

    return this.client.interactions.showModal(interaction, modal);
  }

  async _showLogs(interaction, user, flowId) {
    const { FlowRunLogModel } = require('../../logic-builder/schema/flow.schema.js');
    const logs = await FlowRunLogModel.find({ flowId }).sort({ runAt: -1 }).limit(10).lean();

    const lines = logs.length
      ? logs.map(l => {
          const icon = l.result === 'success' ? '✅' : l.result === 'failed' ? '❌' : '⚠️';
          const ts   = new Date(l.runAt).toLocaleString('pt-BR');
          return `${icon} \`${ts}\` — ${l.duration}ms${l.error ? `\n  > ${l.error.slice(0, 80)}` : ''}`;
        }).join('\n')
      : '_Nenhuma execução registrada_';

    const btnBack = this.ui.btn(user, '⬅️ Voltar', 2, async (i) => {
      await this.ui.deferUpdate(i);
      return this.settingsMenu(i, user, flowId);
    });

    return this.ui.editOriginal(interaction, {
      embeds: [{
        title:       '📊 Últimas Execuções',
        description: lines,
        color:       0x5865F2,
        footer:      { text: 'Logs são mantidos por 7 dias' }
      }],
      components: [this.ui.row(btnBack)]
    });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  async _getFlow(guildId, flowId) {
    return FlowModel.findOne({ flowId, guildId }).lean();
  }

  _uid() {
    return randomUUID().slice(0, 8);
  }

  _paramLabel(p) {
    const labels = {
      content:    'Mensagem (suporta {user}, {user_mention}...)',
      roleId:     'ID ou menção do cargo',
      channelId:  'ID ou menção do canal',
      userId:     'ID do usuário (vazio = autor)',
      text:       'Texto a verificar',
      percent:    'Porcentagem (0-100)',
      days:       'Número de dias',
      length:     'Tamanho em caracteres',
      pattern:    'Padrão regex (ex: ^olá)',
      name:       'Nome da variável',
      value:      'Valor',
      min:        'Valor mínimo',
      max:        'Valor máximo',
      seconds:    'Segundos',
      minutes:    'Minutos',
      duration:   'Duração em minutos',
      emoji:      'Emoji (ex: 👍 ou :nome:)',
      url:        'URL',
      method:     'Método HTTP (GET, POST...)',
      nickname:   'Novo nickname',
      reason:     'Motivo (opcional)',
      flowId:     'ID do fluxo',
      eventType:  'Nome do evento customizado',
      from:       'De (data ou horário)',
      to:         'Até (data ou horário)',
      date:       'Data (YYYY-MM-DD)',
      time:       'Horário (HH:MM)',
      permission: 'Permissão (ex: MANAGE_GUILD)',
      categoryId: 'ID da categoria',
      hour:   'Hora (0-23)',
      minute: 'Minuto (0-59)',
      roleId: 'ID do cargo (vazio = @everyone)'
    };
    return labels[p] || p;
  }

  _paramPlaceholder(p) {
    const ph = {
      content:    'Olá {user_mention}! Bem-vindo ao {guild}.',
      roleId:     '@Membro ou 123456789012345678',
      channelId:  '#geral ou 123456789012345678',
      percent:    '30',
      days:       '7',
      length:     '100',
      pattern:    '^olá',
      name:       'contador',
      value:      '0',
      min:        '1',
      max:        '100',
      seconds:    '5',
      minutes:    '1',
      duration:   '60',
      emoji:      '👍',
      url:        'https://...',
      method:     'POST',
      time:       '18:00',
      date:       '2025-12-31',
      from:       '08:00',
      to:         '22:00',
      eventType:  'meu_evento',
      hour:   '18',
      minute: '30'
    };
    return ph[p] || '';
  }
}

module.exports = FlowBuilder;
