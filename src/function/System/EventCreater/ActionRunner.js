'use strict';

const DiscordRequest = require('../../DiscordRequest.js');

/**
 * ActionRunner
 *
 * Executa as ações de um fluxo contra um ExecutionContext.
 * Ações são executadas na ordem definida pelo campo `order`.
 * Respeita ctx.shouldStop() — para imediatamente se o fluxo for cancelado.
 *
 * Categorias implementadas:
 *   message, embed, user, economy, variable,
 *   inventory, channel, voice, time, system, discord, webhook
 */
class ActionRunner {

  constructor(client) {
    this.client = client;
  }

  /* ═══════════════════════════════════════════
     ENTRY POINT
     ═══════════════════════════════════════════ */

  /**
   * Executa todas as ações do fluxo.
   *
   * @param {object[]}         actions  — array de actionSchema, já ordenados
   * @param {ExecutionContext}  ctx
   * @param {'sequential'|'parallel'} mode
   */
  async run(actions, ctx, mode = 'sequential') {
    const sorted = [...actions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (mode === 'parallel') {
      await Promise.all(sorted.map(a => this._runOne(a, ctx)));
      return;
    }

    for (const action of sorted) {
      if (ctx.shouldStop()) break;
      await this._runOne(action, ctx);
    }
  }

  /* ═══════════════════════════════════════════
     EXECUÇÃO INDIVIDUAL
     ═══════════════════════════════════════════ */

  async _runOne(action, ctx) {
    try {
      const params = await ctx.interpolateParams(action.params || {});
      await this._dispatch(action.category, action.type, params, ctx);
    } catch (err) {
      console.error(`[ActionRunner] Erro na ação ${action.category}/${action.type}:`, err);
    }
  }

  async _dispatch(category, type, params, ctx) {
    switch (category) {
      case 'message':   return this._message(type, params, ctx);
      case 'embed':     return this._embed(type, params, ctx);
      case 'user':      return this._user(type, params, ctx);
      case 'economy':   return this._economy(type, params, ctx);
      case 'variable':  return this._variable(type, params, ctx);
      case 'inventory': return this._inventory(type, params, ctx);
      case 'channel':   return this._channel(type, params, ctx);
      case 'voice':     return this._voice(type, params, ctx);
      case 'time':      return this._time(type, params, ctx);
      case 'system':    return this._system(type, params, ctx);
      case 'discord':   return this._discord(type, params, ctx);
      case 'webhook':   return this._webhook(type, params, ctx);
      default:
        console.warn(`[ActionRunner] Categoria desconhecida: ${category}`);
    }
  }

  /* ═══════════════════════════════════════════
     MESSAGE ACTIONS
     ═══════════════════════════════════════════ */

  async _message(type, p, ctx) {
    const channelId = p.channelId || ctx.discord.channelId;
    // valida se o canal pertence ao mesmo servidor
    if (channelId) {
      try {
        const ch = await DiscordRequest(`/channels/${channelId}`);
        if (ch?.guild_id && ch.guild_id !== ctx.discord.guildId) {
          console.warn(`[ActionRunner] Canal ${channelId} pertence a outro servidor — bloqueado.`);
          return;
        }
      } catch {
        return;
      }
    }

    switch (type) {

      case 'send_message': {
        const body = this._buildMessageBody(p);
        const msg  = await DiscordRequest(`/channels/${channelId}/messages`, {
          method: 'POST',
          body
        });
        if (msg?.id) {
          ctx.lastMessageId = msg.id;
          ctx.lastChannelId = channelId;
        }
        break;
      }

      case 'edit_message': {
        const targetId = p.messageId || ctx.lastMessageId;
        if (!targetId) break;
        const body = this._buildMessageBody(p);
        await DiscordRequest(`/channels/${channelId}/messages/${targetId}`, {
          method: 'PATCH',
          body
        });
        break;
      }

      case 'delete_message': {
        const targetId = p.messageId || ctx.discord.message?.id;
        if (!targetId) break;
        await DiscordRequest(`/channels/${channelId}/messages/${targetId}`, {
          method: 'DELETE'
        });
        break;
      }

      case 'reply_message': {
        const ephemeral = p.ephemeral === true || p.ephemeral === 'true';
        const flags     = ephemeral ? 64 : undefined;

        if (ctx.discord.interaction) {
          const interaction = ctx.discord.interaction;
          const state       = this.client.interactions._getState?.(interaction.id);
          const body        = this._buildMessageBody(p);
          if (flags) body.flags = flags;

          if (state && !state.replied && !state.deferred) {
            await DiscordRequest(
              `/interactions/${interaction.id}/${interaction.token}/callback`,
              { method: 'POST', body: { type: 4, data: body } }
            );
          } else {
            await DiscordRequest(
              `/webhooks/${this.client.clientId}/${interaction.token}`,
              { method: 'POST', body }
            );
          }
          break;
        }

        const refId = p.messageId || ctx.discord.message?.id;
        const body  = { ...this._buildMessageBody(p) };
        if (refId) body.message_reference = { message_id: refId };
        if (flags) body.flags = flags;

        const msg = await DiscordRequest(`/channels/${channelId}/messages`, {
          method: 'POST',
          body
        });
        if (msg?.id) ctx.lastMessageId = msg.id;
        break;
      }

      case 'send_dm': {
        const targetUserId = p.userId || ctx.discord.userId;
        if (!targetUserId) break;
        const dm = await DiscordRequest('/users/@me/channels', {
          method: 'POST',
          body:   { recipient_id: targetUserId }
        });
        if (!dm?.id) break;
        await DiscordRequest(`/channels/${dm.id}/messages`, {
          method: 'POST',
          body:   this._buildMessageBody(p)
        });
        break;
      }

      case 'delete_bot_message': {
        const cid = p.channelId || ctx.lastChannelId || ctx.discord.channelId;
        const mid = p.messageId || ctx.lastMessageId;
        if (!cid || !mid) break;
        try {
          const msg   = await DiscordRequest(`/channels/${cid}/messages/${mid}`);
          const botId = process.env.CLIENT_ID;
          if (msg?.author?.id !== botId) break;
          await DiscordRequest(`/channels/${cid}/messages/${mid}`, { method: 'DELETE' });
        } catch { break; }
        break;
      }
    }
  }

  _buildMessageBody(p) {
    const body = {};
    if (p.content) body.content = p.content;

    if (p.embed) {
      try {
        const raw = typeof p.embed === 'string' ? JSON.parse(p.embed) : p.embed;
        body.embeds = [this._buildEmbed(raw)];
      } catch {
        console.warn('[ActionRunner] Embed JSON inválido — ignorado.');
      }
    }

    return body;
  }

  _buildEmbed(e) {
    const embed = {};
    if (e.title)       embed.title       = e.title;
    if (e.description) embed.description = e.description;
    if (e.color)       embed.color       = typeof e.color === 'string'
                                             ? parseInt(e.color.replace('#', ''), 16)
                                             : e.color;
    if (e.footer)      embed.footer      = { text: e.footer };
    if (e.image)       embed.image       = { url: e.image };
    if (e.thumbnail)   embed.thumbnail   = { url: e.thumbnail };
    if (e.fields)      embed.fields      = e.fields;
    if (e.author)      embed.author      = { name: e.author };
    return embed;
  }

  /* ═══════════════════════════════════════════
     EMBED ACTIONS (alias de message)
     ═══════════════════════════════════════════ */

  async _embed(type, p, ctx) {
    switch (type) {
      case 'send_embed': return this._message('send_message', p, ctx);
      case 'edit_embed': return this._message('edit_message', p, ctx);
    }
  }

  /* ═══════════════════════════════════════════
     USER ACTIONS
     ═══════════════════════════════════════════ */

  async _user(type, p, ctx) {
    const guildId = ctx.discord.guildId;
    const userId  = p.userId || ctx.discord.userId;

    switch (type) {

      case 'give_role':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${p.roleId}`, { method: 'PUT' });
        break;

      case 'remove_role':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${p.roleId}`, { method: 'DELETE' });
        break;

      case 'give_temp_role': {
        await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${p.roleId}`, { method: 'PUT' });
        const durationMs = (Number(p.duration) || 60) * 60_000;
        if (this.client.taskManager) {
          await this.client.taskManager.create({
            tipo:  'remove_role',
            delay: durationMs,
            dados: { guildId, userId, roleId: p.roleId }
          });
        }
        break;
      }

      case 'toggle_role': {
        const roleId = p.roleId;
        if (!roleId) break;
        const member  = await DiscordRequest(`/guilds/${guildId}/members/${userId}`);
        if (!member) break;
        const hasRole = member.roles?.includes(roleId);
        await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
          method: hasRole ? 'DELETE' : 'PUT'
        });
        break;
      }

      case 'ban':
        await DiscordRequest(`/guilds/${guildId}/bans/${userId}`, {
          method: 'PUT',
          body:   { reason: p.reason || 'Automação Logic Builder' }
        });
        break;

      case 'kick':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, { method: 'DELETE' });
        break;

      case 'timeout': {
        const until = new Date(Date.now() + (Number(p.duration) || 60) * 1000).toISOString();
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, {
          method: 'PATCH',
          body:   { communication_disabled_until: until }
        });
        break;
      }

      case 'remove_timeout':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, {
          method: 'PATCH',
          body:   { communication_disabled_until: null }
        });
        break;

      case 'change_nickname':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, {
          method: 'PATCH',
          body:   { nick: p.nickname || null }
        });
        break;
    }
  }

  /* ═══════════════════════════════════════════
     ECONOMY ACTIONS
     ═══════════════════════════════════════════ */

  async _economy(type, p, ctx) {
    const eco = this.client.economyManager;
    if (!eco) return;

    const userId  = p.userId || ctx.discord.userId;
    const guildId = ctx.discord.guildId;
    const amount  = Number(p.amount) || 0;

    switch (type) {
      case 'add_coins':    await eco.addBalance(guildId, userId, amount); break;
      case 'remove_coins': await eco.removeBalance(guildId, userId, amount); break;
      case 'set_balance':  await eco.setBalance(guildId, userId, amount); break;
    }
  }

  /* ═══════════════════════════════════════════
     VARIABLE ACTIONS
     ═══════════════════════════════════════════ */

  async _variable(type, p, ctx) {
    switch (type) {
      case 'set':          ctx.setVar(p.name, p.value); break;
      case 'add':          ctx.addVar(p.name, p.value); break;
      case 'sub':          ctx.subVar(p.name, p.value); break;
      case 'mul':          ctx.mulVar(p.name, p.value); break;
      case 'div':          ctx.divVar(p.name, p.value); break;
      case 'random':       ctx.randomVar(p.name, Number(p.min) || 0, Number(p.max) || 100); break;
      case 'create':       ctx.setVar(p.name, p.defaultValue ?? null); break;
      case 'push':         ctx.pushVar(p.name, p.value); break;
      case 'remove_item':  ctx.removeVarItem(p.name, p.value); break;
      case 'remove_index': ctx.removeVarIndex(p.name, p.value); break;
      case 'random_from':  ctx.setVar(p.saveAs || p.name + '_random', ctx.randomFromVar(p.name)); break;
      case 'show_ranking': await this._showRanking(p, ctx); break;
    }
  }

  /* ═══════════════════════════════════════════
     INVENTORY ACTIONS
     ═══════════════════════════════════════════ */

  async _inventory(type, p, ctx) {
    const inv = this.client.inventoryManager;
    if (!inv) return;

    const userId  = p.userId || ctx.discord.userId;
    const guildId = ctx.discord.guildId;

    switch (type) {
      case 'give_item':    await inv.giveItem(guildId, userId, p.itemId, Number(p.quantity) || 1); break;
      case 'remove_item':  await inv.removeItem(guildId, userId, p.itemId, Number(p.quantity) || 1); break;
      case 'consume_item': await inv.consumeItem(guildId, userId, p.itemId); break;
    }
  }

  /* ═══════════════════════════════════════════
     CHANNEL ACTIONS
     ═══════════════════════════════════════════ */

  async _channel(type, p, ctx) {
    const guildId = ctx.discord.guildId;

    switch (type) {

      case 'create_channel':
        await DiscordRequest(`/guilds/${guildId}/channels`, {
          method: 'POST',
          body:   { name: p.name, type: p.type ?? 0, parent_id: p.categoryId || undefined }
        });
        break;

      case 'delete_channel': {
        const cid = p.channelId || ctx.discord.channelId;
        await DiscordRequest(`/channels/${cid}`, { method: 'DELETE' });
        break;
      }

      case 'rename_channel': {
        const cid = p.channelId || ctx.discord.channelId;
        await DiscordRequest(`/channels/${cid}`, {
          method: 'PATCH',
          body:   { name: p.name }
        });
        break;
      }

      case 'edit_permissions': {
        const cid = p.channelId || ctx.discord.channelId;
        await DiscordRequest(`/channels/${cid}/permissions/${p.targetId}`, {
          method: 'PUT',
          body:   { allow: p.allow || '0', deny: p.deny || '0', type: p.targetType ?? 1 }
        });
        break;
      }

      case 'lock_channel': {
        const cid    = p.channelId;
        const target = p.roleId || ctx.discord.guildId;
        if (!cid) break;
        await DiscordRequest(`/channels/${cid}/permissions/${target}`, {
          method: 'PUT',
          body:   { allow: '0', deny: '2048', type: 0 }
        });
        break;
      }

      case 'unlock_channel': {
        const cid    = p.channelId;
        const target = p.roleId || ctx.discord.guildId;
        if (!cid) break;
        await DiscordRequest(`/channels/${cid}/permissions/${target}`, {
          method: 'PUT',
          body:   { allow: '2048', deny: '0', type: 0 }
        });
        break;
      }
    }
  }

  /* ═══════════════════════════════════════════
     VOICE ACTIONS
     ═══════════════════════════════════════════ */

  async _voice(type, p, ctx) {
    const guildId = ctx.discord.guildId;
    const userId  = p.userId || ctx.discord.userId;

    switch (type) {

      case 'move_user':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, {
          method: 'PATCH',
          body:   { channel_id: p.channelId }
        });
        break;

      case 'disconnect_user':
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, {
          method: 'PATCH',
          body:   { channel_id: null }
        });
        break;

      case 'create_voice':
        await DiscordRequest(`/guilds/${guildId}/channels`, {
          method: 'POST',
          body:   { name: p.name || 'call', type: 2, parent_id: p.categoryId || undefined }
        });
        break;

      case 'delete_voice': {
        const cid = p.channelId;
        if (!cid) break;
        await DiscordRequest(`/channels/${cid}`, { method: 'DELETE' });
        break;
      }
    }
  }

  /* ═══════════════════════════════════════════
     TIME ACTIONS
     ═══════════════════════════════════════════ */

  async _time(type, p, ctx) {
    switch (type) {

      case 'wait_seconds':
        await this._sleep(Number(p.seconds) * 1000);
        break;

      case 'wait_minutes':
        await this._sleep(Number(p.minutes) * 60_000);
        break;

      case 'schedule': {
        if (!this.client.taskManager) break;
        await this.client.taskManager.create({
          tipo:  'run_flow',
          delay: Number(p.delayMs) || 60_000,
          dados: { flowId: ctx.flow.flowId, discordCtx: ctx.discord }
        });
        break;
      }
    }
  }

  /* ═══════════════════════════════════════════
     SYSTEM ACTIONS
     ═══════════════════════════════════════════ */

  async _system(type, p, ctx) {
    switch (type) {

      case 'run_flow': {
        const engine = this.client.logicEngine;
        if (!engine) break;

        // ── CORREÇÃO: salva variáveis persistentes ANTES de rodar o fluxo filho
        // Garante que o filho leia os valores já atualizados do banco
        await ctx.savePersistent();

        await engine.runById(p.flowId, ctx.discord);
        break;
      }

      case 'emit_event': {
        const engine = this.client.logicEngine;
        if (!engine) break;

        // ── CORREÇÃO: salva variáveis persistentes ANTES de emitir o evento
        // O fluxo ouvinte do evento vai carregar do banco — precisa estar salvo
        await ctx.savePersistent();

        engine.triggerRegistry.emit('internal', {
          eventType: p.eventType,
          guildId:   ctx.discord.guildId,
          data:      ctx.interpolateParams(p.data || {})
        });
        break;
      }

      case 'cancel_flow':
        ctx.cancel();
        break;

      case 'stop_execution':
        ctx.stop();
        break;
    }
  }

  /* ═══════════════════════════════════════════
     DISCORD ACTIONS
     ═══════════════════════════════════════════ */

  async _discord(type, p, ctx) {
    const channelId = p.channelId || ctx.discord.channelId;
    const messageId = p.messageId || ctx.discord.message?.id;

    switch (type) {

      case 'add_reaction':
        if (!messageId) break;
        await DiscordRequest(
          `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(p.emoji)}/@me`,
          { method: 'PUT' }
        );
        break;

      case 'remove_reaction':
        if (!messageId) break;
        await DiscordRequest(
          `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(p.emoji)}/@me`,
          { method: 'DELETE' }
        );
        break;

      case 'pin_message':
        if (!messageId) break;
        await DiscordRequest(`/channels/${channelId}/pins/${messageId}`, { method: 'PUT' });
        break;

      case 'unpin_message':
        if (!messageId) break;
        await DiscordRequest(`/channels/${channelId}/pins/${messageId}`, { method: 'DELETE' });
        break;
    }
  }

  /* ═══════════════════════════════════════════
     WEBHOOK / HTTP ACTIONS
     ═══════════════════════════════════════════ */

  async _webhook(type, p, ctx) {
    switch (type) {

      case 'send_webhook': {
        if (!p.url) break;
        const body = { username: p.username, avatar_url: p.avatarUrl };
        if (p.content) body.content = p.content;
        if (p.embed)   body.embeds  = [this._buildEmbed(p.embed)];

        await fetch(p.url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body)
        });
        break;
      }

      case 'http_request': {
        if (!p.url) break;
        const response = await fetch(p.url, {
          method:  p.method || 'GET',
          headers: p.headers || { 'Content-Type': 'application/json' },
          body:    p.body ? JSON.stringify(p.body) : undefined
        });

        const data = await response.json().catch(() => null);

        if (p.saveAs && data !== null) {
          ctx.setVar(p.saveAs, data);
        }
        break;
      }
    }
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _showRanking(p, ctx) {
    const { UserVarModel } = require('../../../Mongodb/flow.js');
    const guildId   = ctx.discord.guildId;
    const channelId = ctx.discord.channelId;
    const varName   = p.varName  || 'money';
    const title     = p.title    || '🏆 Ranking';
    const ephemeral = p.ephemeral === 'true' || p.ephemeral === true;
    const flags     = ephemeral ? 64 : undefined;

    const docs = await UserVarModel.find({ guildId, name: varName })
      .lean()
      .sort({ value: -1 })
      .limit(100);

    if (!docs.length) {
      const msg         = '❌ Nenhum dado encontrado para este ranking.';
      const interaction = ctx.discord.interaction;
      if (interaction) {
        await DiscordRequest(`/webhooks/${this.client.clientId}/${interaction.token}`, {
          method: 'POST', body: { content: msg, flags: 64 }
        });
      } else if (channelId) {
        await DiscordRequest(`/channels/${channelId}/messages`, {
          method: 'POST', body: { content: msg }
        });
      }
      return;
    }

    const PER_PAGE   = 10;
    const totalPages = Math.ceil(docs.length / PER_PAGE);
    const medals     = ['🥇', '🥈', '🥉'];

    function buildEmbed(page) {
      const start   = page * PER_PAGE;
      const entries = docs.slice(start, start + PER_PAGE);
      const desc    = entries.map((doc, idx) => {
        const pos   = start + idx + 1;
        const medal = medals[pos - 1] || `**${pos}.**`;
        return `${medal} <@${doc.userId}> — \`${doc.value}\``;
      }).join('\n');
      return {
        title,
        description: desc,
        color:  0x5865F2,
        footer: { text: `Página ${page + 1} de ${totalPages} • ${docs.length} usuários` }
      };
    }

    function buildComponents(page) {
      const buttons = [];
      if (page > 0)
        buttons.push({ type: 2, style: 2, label: '◀ Anterior', custom_id: `rank_prev_${page}` });
      if (page < totalPages - 1)
        buttons.push({ type: 2, style: 2, label: 'Próxima ▶',  custom_id: `rank_next_${page}` });
      return buttons.length ? [{ type: 1, components: buttons }] : [];
    }

    const interaction = ctx.discord.interaction;
    let messageId;

    if (interaction) {
      const msg = await DiscordRequest(`/webhooks/${this.client.clientId}/${interaction.token}`, {
        method: 'POST',
        body: { embeds: [buildEmbed(0)], components: buildComponents(0), flags }
      });
      messageId = msg?.id;
    } else if (channelId) {
      const msg = await DiscordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: { embeds: [buildEmbed(0)], components: buildComponents(0) }
      });
      messageId = msg?.id;
    }

    if (!messageId || totalPages <= 1) return;

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) {
        this.client.interactions._cache.set(`rank_prev_${page}`, {
          expires: Date.now() + 10 * 60_000,
          funcao: async (i) => {
            const newPage = page - 1;
            await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
              method: 'POST',
              body: { type: 7, data: { embeds: [buildEmbed(newPage)], components: buildComponents(newPage) } }
            });
          }
        });
      }
      if (page < totalPages - 1) {
        this.client.interactions._cache.set(`rank_next_${page}`, {
          expires: Date.now() + 10 * 60_000,
          funcao: async (i) => {
            const newPage = page + 1;
            await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
              method: 'POST',
              body: { type: 7, data: { embeds: [buildEmbed(newPage)], components: buildComponents(newPage) } }
            });
          }
        });
      }
    }
  }
}

module.exports = ActionRunner;
