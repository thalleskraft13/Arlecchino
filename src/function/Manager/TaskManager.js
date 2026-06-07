'use strict';

const TaskModel      = require("../../Mongodb/tarefas.js");
const { GuildDb }    = require("../../Mongodb/guild.js");
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
      const tasks = [];

      for (let i = 0; i < this.batchSize; i++) {
        const task = await TaskModel.findOneAndUpdate(
          { status: 'pending', executeAt: { $lte: now } },
          { $set: { status: 'processing' } },
          { sort: { executeAt: 1 }, returnDocument: 'after' }
        );
        if (!task) break;
        tasks.push(task);
      }
      if (tasks.length > 0) {
      console.log(`[TaskManager] Tick — ${tasks.length} task(s):`, tasks.map(t => t.tipo));
    }
      for (const task of tasks) {
        await this.run(task);
      }
    } catch (err) {
      console.error('[TaskManager] Tick error:', err);
    }
  }

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

      // guild_mission_reset se reagenda dentro do execute
      if (task.tipo === 'guild_mission_reset') {
        await task.save();
        return;
      }

      // birthday_check se reagenda dentro do execute
      if (task.tipo === 'birthday_check') {
        await task.save();
        return;
      }

      if (task.repeat && task.repeatDelay) {
        task.executeAt = new Date(Date.now() + task.repeatDelay);
        task.status    = 'pending';
      } else {
        task.status = 'executed';
      }

      await task.save();

    } catch (err) {
      console.error('[TaskManager] Run error:', err);
      try {
        task.status = 'pending';
        await task.save();
      } catch {}
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

      // Roda todo dia no horário configurado pela guild:
      // varre os aniversariantes do dia e dispara um birthday_notify por membro
      case 'birthday_check': {
        const { guildId, hour, minute = 0 } = task.dados;
        if (this.client.birthdayManager) {
          await this.client.birthdayManager
            .checkAll(guildId)
            .catch(err => console.error('[TaskManager] birthday_check error:', err));
        }
        // Reagenda para amanhã no mesmo horário
        const nextCheck = new Date();
        nextCheck.setDate(nextCheck.getDate() + 1);
        nextCheck.setHours(hour, minute, 0, 0);
        task.executeAt = nextCheck;
        task.status    = 'pending';
        break;
      }

      // Enviado pelo checkAll — notifica um único aniversariante
      case 'birthday_notify': {
        const { guildId, userId } = task.dados;
        const guildDoc = await GuildDb.findOne({ guildId });
        if (guildDoc?.birthday?.enabled) {
          await this.client.birthdayManager
            ._sendBirthdayMessage(guildDoc, { userId, birthday: task.dados.birthday })
            .catch(err => console.error('[TaskManager] birthday_notify error:', err));
        }
        break;
      }

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

      case 'guild_event_expire': {
        const { guildId } = task.dados;
        if (this.client.missionManager) {
          await this.client.missionManager.expireGuildEvent(guildId).catch(() => {});
        }
        break;
      }

      case 'guild_mission_reset': {
        const { guildId } = task.dados;
        if (this.client.missionManager) {
          await this.client.missionManager.weeklyReset(guildId).catch(() => {});
        }
        task.executeAt = this._nextMonday();
        task.status    = 'pending';
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

    if (this.client.logicEngine) {
      await this.client.logicEngine.runById(flowId, {
        guildId,
        channelId: null,
        userId:    null
      }).catch(err => console.error('[TaskManager] scheduled_trigger error:', err));
    }

    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(hour, minute, 0, 0);
    task.executeAt = next;
    task.status    = 'pending';
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

  /**
   * Cria (ou recria) a task diária de birthday_check para uma guild.
   * Chame ao ativar o sistema ou mudar o horário.
   * Cancela qualquer task pendente anterior para evitar duplicata.
   */
  async createBirthdayCheck({ guildId, hour, minute = 0 }) {
  await TaskModel.updateMany(
    { tipo: 'birthday_check', 'dados.guildId': guildId, status: 'pending' },
    { $set: { status: 'cancelled' } }
  );

  const now       = new Date();
  const executeAt = new Date();
  executeAt.setHours(hour, minute, 0, 0);
  executeAt.setSeconds(0, 0);

  // Só manda pra amanhã se já passou mais de 1 minuto
  if (executeAt.getTime() < now.getTime() - 60_000) {
    executeAt.setDate(executeAt.getDate() + 1);
  }

  return TaskModel.create({
    taskId:      randomUUID(),
    tipo:        'birthday_check',
    executeAt,
    dados:       { guildId, hour, minute },
    repeat:      false,
    repeatDelay: null
  });
}
  /**
   * Agenda o reset semanal de missões de guilda.
   * Chame uma vez quando a guilda for registrada/configurada.
   * A task se reagenda automaticamente toda segunda-feira.
   */
  async scheduleGuildMissionReset(guildId) {
    await TaskModel.updateMany(
      { tipo: 'guild_mission_reset', 'dados.guildId': guildId, status: 'pending' },
      { $set: { status: 'cancelled' } }
    );

    return TaskModel.create({
      taskId:    randomUUID(),
      tipo:      'guild_mission_reset',
      executeAt: this._nextMonday(),
      dados:     { guildId },
      repeat:    false
    });
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

  _nextMonday() {
    const d   = new Date();
    const day = d.getDay();
    const daysUntil = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntil);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

module.exports = TaskManager;
