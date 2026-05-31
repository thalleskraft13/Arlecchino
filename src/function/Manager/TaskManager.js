'use strict';

const TaskModel      = require("../../Mongodb/tarefas.js");
const { randomUUID } = require("crypto");
const DiscordRequest = require("../DiscordRequest.js");

class TaskManager {

  constructor(client) {
    this.client    = client;
    this.interval  = null;
    this.batchSize = 10;
  }

  /* ═══════════════════════════════════════════
     START / STOP
     ═══════════════════════════════════════════ */

  async start() {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this._tick();
    }, 1_000);

    this._tick().catch(console.error);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /* ═══════════════════════════════════════════
     TICK
     ═══════════════════════════════════════════ */

  async _tick() {
  try {
    const now   = new Date();
    const tasks = await TaskModel.find({
      status:    'pending',
      executeAt: { $lte: now }
    })
    .sort({ executeAt: 1 })
    .limit(this.batchSize);

    

    for (const task of tasks) {
      await this.run(task);
    }
  } catch (eer){
    console.log(eer)
  }}

  /* ═══════════════════════════════════════════
     RUN
     ═══════════════════════════════════════════ */

  async run(task) {
    try {
      await this.execute(task);

      if (task.tipo === 'scheduled_trigger') {
        await task.save();
        return;
      }

      if (task.repeat && task.repeatDelay) {
        task.executeAt = new Date(Date.now() + task.repeatDelay);
      } else {
        task.status = 'executed';
      }

      await task.save();

    } catch (err) {
      console.error('[TaskManager] Run error:', err);
    }
  }

  /* ═══════════════════════════════════════════
     EXECUTE
     ═══════════════════════════════════════════ */

  async execute(task) {
    switch (task.tipo) {

      case 'lembrete':
        await this.handleLembrete(task.dados);
        break;

      case 'scheduled_trigger':
        await this.handleScheduledTrigger(task);
        break;

      case 'remove_role': {
        const { guildId, userId, roleId } = task.dados;
        await DiscordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
          method: 'DELETE'
        }).catch(() => {});
        break;
      }

      case 'run_flow':
      case 'time_trigger': {
        const { flowId, guildId, discordCtx } = task.dados;
        if (this.client.logicEngine) {
          await this.client.logicEngine.runById(
            flowId,
            discordCtx || { guildId, channelId: null, userId: null }
          );
        }
        break;
      }

      default:
        console.log('[TaskManager] Tipo desconhecido:', task.tipo);
    }
  }

  /* ═══════════════════════════════════════════
     SCHEDULED TRIGGER
     ═══════════════════════════════════════════ */

  async handleScheduledTrigger(task) {
    const { guildId, flowId, hour, minute = 0 } = task.dados;

   // console.log(`[TaskManager] Disparando scheduled_trigger — fluxo ${flowId} às ${hour}:${String(minute).padStart(2, '0')}`);

    if (this.client.logicEngine) {
      await this.client.logicEngine.runById(flowId, {
        guildId,
        channelId: null,
        userId:    null
      }).catch(err => console.error('[TaskManager] scheduled_trigger error:', err));
    }

    // agenda para amanhã no mesmo horário
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(hour, minute, 0, 0);
    task.executeAt = next;

   // console.log(`[TaskManager] Próxima execução: ${next.toISOString()}`);
  }

  /* ═══════════════════════════════════════════
     CREATE
     ═══════════════════════════════════════════ */

  async create({ tipo, delay, dados, repeat = false, repeatDelay = null }) {
    const task = await TaskModel.create({
      taskId:    randomUUID(),
      tipo,
      executeAt: new Date(Date.now() + delay),
      dados,
      repeat,
      repeatDelay
    });
    return task;
  }

  async createScheduled({ guildId, flowId, hour, minute = 0 }) {
    const delay = this._msAteHorario(hour, minute);

    //console.log(`[TaskManager] Criando scheduled_trigger — ${hour}:${String(minute).padStart(2, '0')} | delay: ${delay}ms`);

    const task = await TaskModel.create({
      taskId:      randomUUID(),
      tipo:        'scheduled_trigger',
      executeAt:   new Date(Date.now() + delay),
      dados:       { guildId, flowId, hour, minute },
      repeat:      false,
      repeatDelay: null
    });

    return task;
  }

  /* ═══════════════════════════════════════════
     LEMBRETE
     ═══════════════════════════════════════════ */

  async handleLembrete(dados) {
    const { userId, channelId, mensagem } = dados;
    await DiscordRequest(`/channels/${channelId}/messages`, {
      method: 'POST',
      body:   { content: `⏰ <@${userId}> Lembre-se de:\n${mensagem}` }
    });
  }

  /* ═══════════════════════════════════════════
     CANCEL
     ═══════════════════════════════════════════ */

  async cancel(taskId) {
    const task = await TaskModel.findOne({ taskId });
    if (!task) return false;
    task.status = 'cancelled';
    await task.save();
    return true;
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  _msAteHorario(hour, minute = 0) {
    const now  = new Date();
    const alvo = new Date();
    alvo.setHours(hour, minute, 0, 0);
    if (alvo <= now) alvo.setDate(alvo.getDate() + 1);
    return alvo - now;
  }
}

module.exports = TaskManager;