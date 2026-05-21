const TaskModel = require("../../Mongodb/tarefas.js");
const { randomUUID } = require("crypto");
const DiscordRequest = require("../DiscordRequest.js");

class TaskManager {

  constructor(client) {
    this.client = client;
    this.interval = null;

    this.tickRate = 1000;
    this.batchSize = 10;
  }

  async start() {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.tick();
    }, this.tickRate);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async create({ tipo, delay, dados, repeat = false, repeatDelay = null }) {

    const task = await TaskModel.create({
      taskId: randomUUID(),
      tipo,
      executeAt: new Date(Date.now() + delay),
      dados,
      repeat,
      repeatDelay
    });

    return task;
  }

  async tick() {

    try {

      const now = new Date();

      const tasks = await TaskModel.find({
        status: "pending",
        executeAt: { $lte: now }
      })
      .sort({ executeAt: 1 })
      .limit(this.batchSize);

      for (const task of tasks) {
        await this.run(task);
      }

    } catch (err) {
      console.error("Tick error:", err);
    }
  }

  async run(task) {

    try {

      await this.execute(task);

      if (task.repeat && task.repeatDelay) {
        task.executeAt = new Date(Date.now() + task.repeatDelay);
      } else {
        task.status = "executed";
      }

      await task.save();

    } catch (err) {
      console.error("Run error:", err);
    }
  }

  async execute(task) {

    switch (task.tipo) {

      case "lembrete":
        await this.handleLembrete(task.dados);
        break;

      default:
        console.log("Tipo desconhecido:", task.tipo);
    }
  }

  async handleLembrete(dados) {

    const { userId, channelId, mensagem } = dados;

    await DiscordRequest(`/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `⏰ <@${userId}> Lembre-se de:\n${mensagem}`
      }
    });
  }

  async cancel(taskId) {

    const task = await TaskModel.findOne({ taskId });
    if (!task) return false;

    task.status = "cancelled";
    await task.save();

    return true;
  }

}

module.exports = TaskManager;