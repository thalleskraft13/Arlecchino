'use strict';

const DiscordRequest = require('../../DiscordRequest.js');

/**
 * ConditionEvaluator
 *
 * Avalia o array de condições de um fluxo contra um ExecutionContext.
 * Suporta operadores AND/OR encadeados e negação individual.
 *
 * Categorias implementadas:
 *   user, channel, message, economy, variable,
 *   probability, date, time, permission, inventory, command
 */
class ConditionEvaluator {

  constructor(client) {
    this.client = client;
  }

  /* ═══════════════════════════════════════════
     ENTRY POINT
     ═══════════════════════════════════════════ */

  /**
   * Avalia todas as condições do fluxo.
   * Retorna true se o fluxo deve prosseguir, false se deve ser bloqueado.
   *
   * @param {object[]} conditions  — array de conditionSchema
   * @param {ExecutionContext} ctx
   * @returns {Promise<boolean>}
   */
  async evaluate(conditions, ctx) {
    if (!conditions || conditions.length === 0) return true;

    let result = await this._evalOne(conditions[0], ctx);

    for (let i = 1; i < conditions.length; i++) {
      const cond       = conditions[i];
      const condResult = await this._evalOne(cond, ctx);

      if (cond.operator === 'OR') {
        result = result || condResult;
      } else {
        result = result && condResult;
      }
    }

    return result;
  }

  /* ═══════════════════════════════════════════
     AVALIAÇÃO INDIVIDUAL
     ═══════════════════════════════════════════ */

  async _evalOne(cond, ctx) {
    let result;

    try {
      result = await this._dispatch(cond, ctx);
    } catch (err) {
      console.error(`[ConditionEvaluator] Erro na condição ${cond.type}:`, err);
      result = false;
    }

    return cond.negate ? !result : result;
  }

  async _dispatch(cond, ctx) {
    const p = ctx.interpolateParams(cond.params || {});

    switch (cond.category) {
      case 'user':        return this._user(cond.type, p, ctx);
      case 'channel':     return this._channel(cond.type, p, ctx);
      case 'message':     return this._message(cond.type, p, ctx);
      case 'economy':     return this._economy(cond.type, p, ctx);
      case 'variable':    return this._variable(cond.type, p, ctx);
      case 'probability': return this._probability(cond.type, p);
      case 'date':        return this._date(cond.type, p);
      case 'time':        return this._time(cond.type, p);
      case 'permission':  return this._permission(cond.type, p, ctx);
      case 'inventory':   return this._inventory(cond.type, p, ctx);
      case 'command':     return this._command(cond.type, p, ctx);
      default:
        console.warn(`[ConditionEvaluator] Categoria desconhecida: ${cond.category}`);
        return true;
    }
  }

  /* ═══════════════════════════════════════════
     USER CONDITIONS
     ═══════════════════════════════════════════ */

  async _user(type, p, ctx) {
    const { guildId, userId } = ctx.discord;

    switch (type) {

      case 'has_role': {
        const member = await this._getMember(guildId, userId);
        return member?.roles?.includes(p.roleId) ?? false;
      }

      case 'not_has_role': {
        const member = await this._getMember(guildId, userId);
        return !(member?.roles?.includes(p.roleId) ?? false);
      }

      case 'is_bot': {
        const member = await this._getMember(guildId, userId);
        return member?.user?.bot === true;
      }

      case 'not_bot': {
        const member = await this._getMember(guildId, userId);
        return member?.user?.bot !== true;
      }

      case 'in_voice': {
        // verifica se o usuário está em call via voiceState do evento ou API
        if (ctx.discord.voiceState) {
          return ctx.discord.voiceState.channel_id !== null;
        }
        return false;
      }

      case 'not_in_voice': {
        if (ctx.discord.voiceState) {
          return ctx.discord.voiceState.channel_id === null;
        }
        return true;
      }

      case 'account_age_gt': {
        // Snowflake → timestamp de criação
        const created = this._snowflakeToMs(userId);
        const ageDays = (Date.now() - created) / 86400000;
        return ageDays > Number(p.days);
      }

      case 'account_age_lt': {
        const created = this._snowflakeToMs(userId);
        const ageDays = (Date.now() - created) / 86400000;
        return ageDays < Number(p.days);
      }

      case 'joined_gt': {
        const member = await this._getMember(guildId, userId);
        if (!member?.joined_at) return false;
        const joinedDays = (Date.now() - new Date(member.joined_at)) / 86400000;
        return joinedDays > Number(p.days);
      }

      case 'joined_lt': {
        const member = await this._getMember(guildId, userId);
        if (!member?.joined_at) return false;
        const joinedDays = (Date.now() - new Date(member.joined_at)) / 86400000;
        return joinedDays < Number(p.days);
      }

      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     CHANNEL CONDITIONS
     ═══════════════════════════════════════════ */

  _channel(type, p, ctx) {
    const channelId = ctx.discord.channelId;

    switch (type) {
      case 'is_channel':      return channelId === p.channelId;
      case 'not_channel':     return channelId !== p.channelId;
      case 'is_category':     return ctx.discord.categoryId === p.categoryId;
      case 'not_category':    return ctx.discord.categoryId !== p.categoryId;
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     MESSAGE CONDITIONS
     ═══════════════════════════════════════════ */

  _message(type, p, ctx) {
    const content = ctx.discord.message?.content || '';

    switch (type) {
      case 'contains_text':    return content.toLowerCase().includes(String(p.text).toLowerCase());
      case 'not_contains':     return !content.toLowerCase().includes(String(p.text).toLowerCase());
      case 'contains_link':    return /https?:\/\/\S+/.test(content);
      case 'contains_image':   return (ctx.discord.message?.attachments || []).some(a => /\.(png|jpg|jpeg|gif|webp)/i.test(a.filename));
      case 'contains_file':    return (ctx.discord.message?.attachments || []).length > 0;
      case 'length_gt':        return content.length > Number(p.length);
      case 'length_lt':        return content.length < Number(p.length);
      case 'contains_mention': return /<@[!&]?\d+>/.test(content);
      case 'contains_emoji':   return /\p{Emoji}/u.test(content);
      case 'matches_regex':    {
        try { return new RegExp(p.pattern, p.flags || '').test(content); }
        catch { return false; }
      }
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     ECONOMY CONDITIONS
     ═══════════════════════════════════════════ */

  async _economy(type, p, ctx) {
    // Delega ao EconomyManager se existir no client
    const eco = this.client.economyManager;
    if (!eco) return true;

    const balance = await eco.getBalance(ctx.discord.guildId, ctx.discord.userId);

    switch (type) {
      case 'balance_gt': return balance > Number(p.amount);
      case 'balance_lt': return balance < Number(p.amount);
      case 'balance_eq': return balance === Number(p.amount);
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     VARIABLE CONDITIONS
     ═══════════════════════════════════════════ */

  _variable(type, p, ctx) {
    const val = ctx.getVar(p.name);
    const cmp = p.value;

    switch (type) {
      case 'eq':  return val == cmp;
      case 'neq': return val != cmp;
      case 'gt':  return Number(val) > Number(cmp);
      case 'lt':  return Number(val) < Number(cmp);
      case 'gte': return Number(val) >= Number(cmp);
      case 'lte': return Number(val) <= Number(cmp);
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     PROBABILITY CONDITIONS
     ═══════════════════════════════════════════ */

  _probability(type, p) {
    switch (type) {
      case 'chance':  return Math.random() * 100 < Number(p.percent);
      case 'random':  return Math.random() < 0.5;
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     DATE CONDITIONS
     ═══════════════════════════════════════════ */

  _date(type, p) {
    const now = Date.now();

    switch (type) {
      case 'before': return now < new Date(p.date).getTime();
      case 'after':  return now > new Date(p.date).getTime();
      case 'between': {
        const from = new Date(p.from).getTime();
        const to   = new Date(p.to).getTime();
        return now >= from && now <= to;
      }
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     TIME CONDITIONS (horário do dia)
     ═══════════════════════════════════════════ */

  _time(type, p) {
    // p.time: "HH:MM"
    const now      = new Date();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const toMins   = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

    switch (type) {
      case 'before':  return nowMins < toMins(p.time);
      case 'after':   return nowMins > toMins(p.time);
      case 'between': return nowMins >= toMins(p.from) && nowMins <= toMins(p.to);
      case 'hour_eq':   return new Date().getHours()   === Number(p.hour);
case 'minute_eq': return new Date().getMinutes() === Number(p.minute);
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     PERMISSION CONDITIONS
     ═══════════════════════════════════════════ */

  async _permission(type, p, ctx) {
    const getPerm = require('../../Utils/GetPerm.js');

    const perms = await getPerm({
      id:      ctx.discord.userId,
      guildId: ctx.discord.guildId
    }).catch(() => []);

    switch (type) {
      case 'is_admin':       return perms.includes('ADMINISTRATOR');
      case 'has_permission': return perms.includes(p.permission);
      case 'has_role': {
        const member = await this._getMember(ctx.discord.guildId, ctx.discord.userId);
        return member?.roles?.includes(p.roleId) ?? false;
      }
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     INVENTORY CONDITIONS
     ═══════════════════════════════════════════ */

  async _inventory(type, p, ctx) {
    const inv = this.client.inventoryManager;
    if (!inv) return true;

    const count = await inv.getItemCount(ctx.discord.guildId, ctx.discord.userId, p.itemId);

    switch (type) {
      case 'has_item':       return count > 0;
      case 'not_has_item':   return count === 0;
      case 'quantity_gt':    return count > Number(p.quantity);
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     COMMAND CONDITIONS
     ═══════════════════════════════════════════ */

  _command(type, p, ctx) {
    switch (type) {
      case 'cooldown_active': {
        const cmd = ctx.discord.customData?.command;
        if (!cmd) return false;
        const expires = cmd.cooldownMap?.get(ctx.discord.userId) || 0;
        return Date.now() < expires;
      }
      case 'cooldown_ended': {
        const cmd = ctx.discord.customData?.command;
        if (!cmd) return true;
        const expires = cmd.cooldownMap?.get(ctx.discord.userId) || 0;
        return Date.now() >= expires;
      }
      default: return true;
    }
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  async _getMember(guildId, userId) {
    try {
      return await DiscordRequest(`/guilds/${guildId}/members/${userId}`);
    } catch {
      return null;
    }
  }

  _snowflakeToMs(snowflake) {
    return Number(BigInt(snowflake) >> 22n) + 1420070400000;
  }
}

module.exports = ConditionEvaluator;
