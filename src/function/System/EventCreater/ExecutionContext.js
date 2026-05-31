'use strict';

const { PersistentVarModel } = require('../../../Mongodb/flow.js');

class ExecutionContext {

  constructor({ flow, discordCtx, client }) {
    this.flow    = flow;
    this.discord = discordCtx;
    this.client  = client;

    this._vars       = new Map();
    this._userVars   = new Map();
    this._persistent = new Map();

    for (const v of flow.variables || []) {
      this._vars.set(v.name, v.defaultValue ?? null);
    }

    this.cancelled     = false;
    this.stopExecution = false;
    this.lastMessageId = null;
    this.lastChannelId = discordCtx.channelId || null;
  }

  async loadPersistent() {
    const { PersistentVarModel, UserVarModel } = require('../../../Mongodb/flow.js');
    const defs = this.flow.variables || [];

    // variáveis de fluxo persistentes
    const flowDefs = defs.filter(v => v.persistent && v.scope === 'flow');
    if (flowDefs.length) {
      const docs = await PersistentVarModel.find({
        guildId: this.discord.guildId,
        name:    { $in: flowDefs.map(v => v.name) }
      });
      for (const doc of docs) {
        this._persistent.set(doc.name, doc.value);
        this._vars.set(doc.name, doc.value);
      }
    }

    // variáveis de usuário
    const userDefs = defs.filter(v => v.scope === 'user');
    if (userDefs.length && this.discord.userId) {
      const docs = await UserVarModel.find({
        guildId: this.discord.guildId,
        userId:  this.discord.userId,
        name:    { $in: userDefs.map(v => v.name) }
      });
      for (const doc of docs) {
        this._userVars.set(doc.name, doc.value);
        this._vars.set(doc.name, doc.value);
      }
    }
  }

  async savePersistent() {
    const { PersistentVarModel, UserVarModel } = require('../../../Mongodb/flow.js');
    const defs = this.flow.variables || [];

    // salva variáveis de fluxo persistentes
    for (const def of defs.filter(v => v.persistent && v.scope === 'flow')) {
      const current = this._vars.get(def.name);
      if (current === this._persistent.get(def.name)) continue;
      await PersistentVarModel.findOneAndUpdate(
        { guildId: this.discord.guildId, name: def.name },
        { value: current, updatedAt: new Date() },
        { upsert: true }
      );
      this._persistent.set(def.name, current);
    }

    // salva variáveis de usuário
    if (!this.discord.userId) return;
    for (const def of defs.filter(v => v.scope === 'user')) {
      const current = this._vars.get(def.name);
      if (current === this._userVars.get(def.name)) continue;
      await UserVarModel.findOneAndUpdate(
        { guildId: this.discord.guildId, userId: this.discord.userId, name: def.name },
        { value: current, updatedAt: new Date() },
        { upsert: true }
      );
      this._userVars.set(def.name, current);
    }
  }

  getVar(name) {
    return this._vars.has(name) ? this._vars.get(name) : null;
  }

  setVar(name, value) {
    this._vars.set(name, value);
  }

  addVar(name, value) {
    const current = Number(this._vars.get(name)) || 0;
    this._vars.set(name, current + Number(value));
  }

  subVar(name, value) {
    const current = Number(this._vars.get(name)) || 0;
    this._vars.set(name, current - Number(value));
  }

  mulVar(name, value) {
    const current = Number(this._vars.get(name)) || 0;
    this._vars.set(name, current * Number(value));
  }

  divVar(name, value) {
    const current = Number(this._vars.get(name)) || 0;
    const divisor = Number(value);
    if (divisor === 0) return;
    this._vars.set(name, current / divisor);
  }

  randomVar(name, min, max) {
    const val = Math.floor(Math.random() * (max - min + 1)) + min;
    this._vars.set(name, val);
  }

  _systemVars() {
    const d = this.discord;
    return {
      '{user}':         d.member?.user?.username || d.username || '',
      '{user_id}':      d.userId || '',
      '{user_mention}': d.userId ? `<@${d.userId}>` : '',
      '{guild}':        d.guildName || d.guildId || '',
      '{guild_id}':     d.guildId || '',
      '{channel}':      d.channelName ? `#${d.channelName}` : (d.channelId ? `<#${d.channelId}>` : ''),
      '{channel_id}':   d.channelId || '',
      '{message}':      d.message?.content || '',
      '{message_id}':   d.message?.id || '',
      '{role}':         d.role?.name || '',
      '{role_id}':      d.role?.id || '',
      '{count}':        String(d.customData?.count || 0),
      '{timestamp}':    String(Date.now()),
      '{date}':         new Date().toLocaleDateString('pt-BR'),
      '{time}':         new Date().toLocaleTimeString('pt-BR')
    };
  }

  interpolate(template) {
    if (typeof template !== 'string') return template;

    const sysVars = this._systemVars();

    let result = template;
    for (const [key, value] of Object.entries(sysVars)) {
      result = result.replaceAll(key, value);
    }

    result = result.replace(/\{var:([^}]+)\}/g, (_, name) => {
      // busca na ordem: vars locais → userVars → persistent
      const val = this._vars.get(name) ?? this._userVars.get(name) ?? this._persistent.get(name);
      return val !== null && val !== undefined ? String(val) : '';
    });

    return result;
  }

  interpolateParams(params) {
    if (typeof params === 'string') return this.interpolate(params);
    if (typeof params !== 'object' || params === null) return params;
    if (Array.isArray(params)) return params.map(v => this.interpolateParams(v));

    const result = {};
    for (const [key, value] of Object.entries(params)) {
      result[key] = this.interpolateParams(value);
    }
    return result;
  }

  cancel() {
    this.cancelled     = true;
    this.stopExecution = true;
  }

  stop() {
    this.stopExecution = true;
  }

  shouldStop() {
    return this.stopExecution || this.cancelled;
  }
}

module.exports = ExecutionContext;