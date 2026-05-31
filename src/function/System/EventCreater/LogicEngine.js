'use strict';

const mongoose = require('mongoose');

const { FlowModel, CustomCommandModel, FlowRunLogModel, PersistentVarModel} = require('../../../Mongodb/flow.js');
const TriggerRegistry    = require('./TriggerRegistry.js');
const ConditionEvaluator = require('./ConditionEvaluator.js');
const ActionRunner       = require('./ActionRunner.js');
const ExecutionContext   = require('./ExecutionContext.js');

const MAX_CONCURRENT_FLOWS = 50; // por guild, evita flood

/**
 * LogicEngine
 *
 * Orquestra o pipeline completo:
 *   TriggerRegistry → FlowModel lookup → ConditionEvaluator → ActionRunner
 *
 * Integra com o TaskManager existente para triggers de tempo.
 * Integra com NextMessageCollector para comandos personalizados.
 *
 * Exposição no client:
 *   client.logicEngine = new LogicEngine(client);
 *   client.logicEngine.start();
 */
class LogicEngine {

  constructor(client) {
    this.client    = client;
    this._running  = false;

    // Sub-sistemas
    this.triggerRegistry = new TriggerRegistry(client);
    this.conditionEval   = new ConditionEvaluator(client);
    this.actionRunner    = new ActionRunner(client);

    // Rastreamento de execuções concorrentes por guild
    this._concurrentMap = new Map();  // guildId → count

    // Cache de fluxos em memória (TTL 30s para reduzir queries)
    this._flowCache    = new Map();   // `${guildId}:${category}:${type}` → { flows, expires }
    this._CACHE_TTL_MS = 30_000;
  }

  /* ════════════════════������══════════════════════
     INICIALIZAÇÃO
     ═══════════════════════════════════════════ */

  start() {
    if (this._running) return;
    this._running = true;

    // Escuta todos os eventos normalizados pelo TriggerRegistry
    this.triggerRegistry.on('trigger', ({ triggerCategory, triggerType, guildId, discordCtx }) => {
      this._onTrigger(triggerCategory, triggerType, guildId, discordCtx)
        .catch(err => console.error('[LogicEngine] Erro no pipeline de trigger:', err));
    });

    // Registra o handler de comandos personalizados no NextMessageCollector existente
    this._hookCustomCommands();

    // Registra tarefas de tempo no TaskManager existente
    this._hookTaskManager();

    console.log('[LogicEngine] Iniciado.');
  }

  stop() {
    this._running = false;
    this.triggerRegistry.removeAllListeners();
    console.log('[LogicEngine] Parado.');
  }

  /* ═══════════════════════════════════════════
     GATEWAY HANDLER
     Chamado pelo gateway handler do bot para cada evento
     ═══════════════════════════════════════════ */

  handleGateway(payload) {
    this.triggerRegistry.handle(payload);
  }

  /* ═══════════════════════════════════════════
     PIPELINE PRINCIPAL
     ═══════════════════════════════════════════ */

  async _onTrigger(triggerCategory, triggerType, guildId, discordCtx) {
    if (!guildId) return;

    // Limita concorrência por guild
    const current = this._concurrentMap.get(guildId) || 0;
    if (current >= MAX_CONCURRENT_FLOWS) {
      console.warn(`[LogicEngine] Guild ${guildId} atingiu limite de fluxos concorrentes.`);
      return;
    }

    const flows = await this._findFlows(guildId, triggerCategory, triggerType);
    if (!flows.length) return;

    this._concurrentMap.set(guildId, current + flows.length);

    const promises = flows.map(flow =>
      this._runFlow(flow, discordCtx)
        .finally(() => {
          const c = this._concurrentMap.get(guildId) || 1;
          this._concurrentMap.set(guildId, c - 1);
        })
    );

    await Promise.allSettled(promises);
  }

  /* ═══════════════════════════════════════════
     EXECUÇÃO DE UM FLUXO
     ═══════════════════════════════════════════ */

  async _runFlow(flow, discordCtx) {
    const start = Date.now();
    let result  = 'success';
    let errorMsg = null;

    try {
      // ── Cooldown check ──
      if (flow.cooldown > 0 && discordCtx.userId) {
        const expires = flow.cooldownMap?.get(discordCtx.userId) || 0;
        if (Date.now() < expires) {
          return; // silencioso — cooldown ativo
        }
      }

      // ── Contexto de execução ──
      const ctx = new ExecutionContext({ flow, discordCtx, client: this.client });
     ctx.runtimeVars = await this._loadGlobalVars(discordCtx.guildId); 
      await ctx.loadPersistent();
      

      // ── Avaliação de condições ──
      const condOk = await this.conditionEval.evaluate(flow.conditions, ctx);
      if (!condOk) {
        result = 'condition_blocked';
        return;
      }

      // ── Execução de ações ──
      await this.actionRunner.run(flow.actions, ctx, flow.executionMode);

      // ── Salva variáveis persistentes ──
      await ctx.savePersistent();

      // ── Atualiza cooldown ──
      if (flow.cooldown > 0 && discordCtx.userId) {
        flow.cooldownMap.set(discordCtx.userId, Date.now() + flow.cooldown);
        await FlowModel.updateOne(
          { flowId: flow.flowId },
          { $set: { [`cooldownMap.${discordCtx.userId}`]: Date.now() + flow.cooldown } }
        );
      }

      // ── Invalida cache deste fluxo (stats) ──
      this._invalidateCache(discordCtx.guildId, flow.trigger.category, flow.trigger.type);

    } catch (err) {
      result   = 'failed';
      errorMsg = err?.message || String(err);
      console.error(`[LogicEngine] Fluxo ${flow.flowId} falhou:`, err);
    } finally {
      const duration = Date.now() - start;

      // Atualiza stats no banco (fire-and-forget)
      const statsUpdate = { $inc: { 'stats.totalRuns': 1 }, $set: { 'stats.lastRunAt': new Date() } };
      if (result === 'success') statsUpdate.$inc['stats.successRuns'] = 1;
      if (result === 'failed')  statsUpdate.$inc['stats.failedRuns']  = 1;

      FlowModel.updateOne({ flowId: flow.flowId }, statsUpdate).catch(() => {});

      // Log de execução (apenas se falhou ou debug ativo)
      if (result !== 'condition_blocked') {
        FlowRunLogModel.create({
          flowId:   flow.flowId,
          guildId:  discordCtx.guildId,
          result,
          context:  { userId: discordCtx.userId, channelId: discordCtx.channelId },
          error:    errorMsg,
          duration
        }).catch(() => {});
      }
    }
  }

  /* ═══════════════════════════════════════════
     EXECUÇÃO PÚBLICA (por ID)
     Usado por ações "run_flow" e TaskManager
     ═══════════════════════════════════════════ */

  async runById(flowId, discordCtx) {
    const flow = await FlowModel.findOne({ flowId, enabled: true }).lean();
    if (!flow) return;
    return this._runFlow(flow, discordCtx);
  }

  /* ═══════════════════════════════════════════
     LOOKUP DE FLUXOS COM CACHE
     ═══════════════════════════════════════════ */

  async _findFlows(guildId, triggerCategory, triggerType) {
    const key    = `${guildId}:${triggerCategory}:${triggerType}`;
    const cached = this._flowCache.get(key);

    if (cached && cached.expires > Date.now()) {
      return cached.flows;
    }

    const flows = await FlowModel.find({
      guildId,
      'trigger.category': triggerCategory,
      'trigger.type':     triggerType,
      enabled:            true
    }).lean();

    this._flowCache.set(key, { flows, expires: Date.now() + this._CACHE_TTL_MS });
    return flows;
  }

  _invalidateCache(guildId, category, type) {
    const key = `${guildId}:${category}:${type}`;
    this._flowCache.delete(key);
  }

  /**
   * Invalida todo o cache de uma guild.
   * Chamado quando um fluxo é criado/editado/deletado.
   */
  invalidateGuildCache(guildId) {
    for (const key of this._flowCache.keys()) {
      if (key.startsWith(`${guildId}:`)) this._flowCache.delete(key);
    }
  }

  /* ═══════════════════════════════════════════
     HOOK: COMANDOS PERSONALIZADOS
     Integra com o NextMessageCollector existente
     ═══════════════════════════════════════════ */

  _hookCustomCommands() {
    // NextMessageCollector chama _runPipeline em cada mensagem.
    // Adicionamos nosso handler sem alterar o arquivo original —
    // basta que o gateway handler chame handleGateway() com MESSAGE_CREATE.
    // O LogicEngine processa triggers de comando via _handleCustomCommand.

    // Adiciona handler especial para comandos customizados
    this.triggerRegistry.on('trigger', async ({ triggerCategory, triggerType, guildId, discordCtx }) => {
      if (triggerCategory !== 'message' || triggerType !== 'message_created') return;

      const content = discordCtx.message?.content;
      if (!content) return;

      await this._handleCustomCommand(guildId, discordCtx, content)
        .catch(err => console.error('[LogicEngine] Erro em comando customizado:', err));
    });
  }

  async _handleCustomCommand(guildId, discordCtx, content) {
  const commands = await this._getCustomCommands(guildId);
  if (!commands.length) return;

  for (const cmd of commands) {
    if (!cmd.enabled) continue;

    const prefix  = cmd.prefix || '!';
    const names   = [cmd.name, ...(cmd.aliases || [])];
    const matched = names.find(n =>
      content.toLowerCase() === `${prefix}${n}`.toLowerCase() ||
      content.toLowerCase().startsWith(`${prefix}${n} `)
    );

    if (!matched) continue;

    // cooldown
    if (cmd.cooldown > 0) {
      const expires = cmd.cooldownMap?.[discordCtx.userId] || 0;
      if (Date.now() < expires) return;
    }

    // executa apenas o fluxo vinculado a este comando
    await this.runById(cmd.flowId, {
      ...discordCtx,
      customData: {
        command: cmd,
        args: content.slice(prefix.length + matched.length).trim().split(/ +/)
      }
    });

    // atualiza cooldown
    if (cmd.cooldown > 0) {
      CustomCommandModel.updateOne(
        { commandId: cmd.commandId },
        { $set: { [`cooldownMap.${discordCtx.userId}`]: Date.now() + cmd.cooldown } }
      ).catch(() => {});
    }

    break;
  }
}

async _getCustomCommands(guildId) {
  const key    = `cmd:${guildId}`;
  const cached = this._flowCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.flows;

  const commands = await CustomCommandModel.find({ guildId, enabled: true }).lean();
  this._flowCache.set(key, { flows: commands, expires: Date.now() + 60_000 });
  return commands;
}

  /* ═══════════════════════════════════════════
     HOOK: TASK MANAGER (triggers de tempo)
     Registra novos tipos de task no TaskManager existente
     ═══════════════════════════════════════════ */

  _hookTaskManager() {
    const tm = this.client.taskManager;
    if (!tm) return;

    // Estende o execute() do TaskManager para reconhecer os novos tipos
    const originalExecute = tm.execute.bind(tm);

    tm.execute = async (task) => {
      switch (task.tipo) {

        case 'run_flow': {
          const { flowId, discordCtx } = task.dados;
          await this.runById(flowId, discordCtx || {});
          break;
        }

        case 'remove_role': {
          const { guildId, userId, roleId } = task.dados;
          await require('../../DiscordRequest.js')(
            `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
            { method: 'DELETE' }
          ).catch(() => {});
          break;
        }

        case 'time_trigger': {
          // Trigger de tempo: dispara um fluxo específico
          const { flowId, guildId } = task.dados;
          await this.runById(flowId, { guildId, channelId: null, userId: null });
          break;
        }

        default:
          // Repassa para os handlers originais do TaskManager
          await originalExecute(task);
      }
    };

    console.log('[LogicEngine] TaskManager hooked.');
  }

  /* ═══════════════════════════════════════════
     GERENCIAMENTO DE FLUXOS (CRUD)
     ═══════════════════════════════════════════ */

  /**
   * Cria um novo fluxo.
   * @param {{ guildId, name, trigger, conditions?, actions?, variables?, options? }} data
   */
  async createFlow(data) {
    const { randomUUID } = require('crypto');
    const flow = await FlowModel.create({
      flowId:        randomUUID(),
      guildId:       data.guildId,
      name:          data.name,
      description:   data.description || '',
      trigger:       data.trigger,
      conditions:    data.conditions || [],
      actions:       data.actions || [],
      variables:     data.variables || [],
      executionMode: data.executionMode || 'sequential',
      cooldown:      data.cooldown || 0,
      createdBy:     data.createdBy || null
    });

    this.invalidateGuildCache(data.guildId);
    return flow;
  }

  async updateFlow(flowId, guildId, updates) {
    const flow = await FlowModel.findOneAndUpdate(
      { flowId, guildId },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
    if (flow) this.invalidateGuildCache(guildId);
    return flow;
  }

  async deleteFlow(flowId, guildId) {
    await FlowModel.deleteOne({ flowId, guildId });
    this.invalidateGuildCache(guildId);
  }

  async getFlows(guildId) {
    return FlowModel.find({ guildId }).lean();
  }

  async toggleFlow(flowId, guildId) {
  const flow = await FlowModel.findOne({ flowId, guildId });
  if (!flow) return null;
  flow.enabled = !flow.enabled;
  await flow.save();

  // ── Horário agendado ──
  if (flow.trigger?.type === 'scheduled_trigger') {
    if (flow.enabled) {
      // ativa — cria a task
      const { hour = 0, minute = 0 } = flow.trigger.filters || {};
      const task = await this.client.taskManager.createScheduled({
        guildId,
        flowId,
        hour:   Number(hour),
        minute: Number(minute)
      });
      // salva o taskId no fluxo para poder cancelar depois
      await FlowModel.updateOne(
  { flowId },
  { $set: { 'trigger.filters.taskId': task.taskId } }
);
    } else {
      // desativa — cancela a task
      const taskId = flow.trigger.filters?.taskId;
      if (taskId) await this.client.taskManager.cancel(taskId);
    }
  }

  this.invalidateGuildCache(guildId);
  return flow;
}

  /* ═══════════════════════════════════════════
     GERENCIAMENTO DE COMANDOS PERSONALIZADOS
     ═══════════════════════════════════════════ */

  async createCommand(data) {
    const { randomUUID } = require('crypto');
    const cmd = await CustomCommandModel.create({
      commandId:     randomUUID(),
      guildId:       data.guildId,
      name:          data.name,
      aliases:       data.aliases || [],
      description:   data.description || '',
      prefix:        data.prefix || '!',
      flowId:        data.flowId,
      cooldown:      data.cooldown || 0,
      permissions:   data.permissions || [],
      requiredRoles: data.requiredRoles || []
    });

    this._flowCache.delete(`cmd:${data.guildId}`);
    return cmd;
  }

  async deleteCommand(commandId, guildId) {
    const cmd = await CustomCommandModel.findOne({ commandId, guildId });
    if (!cmd) return false;
    await cmd.deleteOne();
    this._flowCache.delete(`cmd:${guildId}`);
    return true;
  }
  
  async _loadGlobalVars(guildId) {
  const vars = await PersistentVarModel.find({ guildId });

  const map = {};
  for (const v of vars) {
    map[v.name] = v.value;
  }

  return map;
}
}

module.exports = LogicEngine;
