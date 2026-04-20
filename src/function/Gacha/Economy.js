const UserGlobalSchema = require("../../Mongodb/userglobal");
const DiscordRequest = require("../DiscordRequest");
const MessageEmbed = require("../Messages/EmbedBuild");

class Economy {

  constructor(userId) {
    this.userId = userId;
    this.logChannel = process.env.ECONOMY_LOG_CHANNEL_ID;
  }

  // Ensure user exists
  async _getOrCreate() {
    let user = await UserGlobalSchema.findOne({ userId: this.userId });

    if (!user) {
      user = await UserGlobalSchema.create({
        userId: this.userId
      });
    }

    return user;
  }

  // Send log to Discord (Portuguese)
  async _sendLog(logData) {
    if (!this.logChannel) return;

    const embed = new MessageEmbed()
      .setTitle("💰 Registro de Economia")
      .setColor(this._getColor(logData.action))
      .addField("👤 Usuário", `\`${logData.userId}\``, true)
      .addField("📌 Ação", `\`${this._formatAction(logData.action)}\``, true)
      .addField("💎 Quantidade", `\`${logData.amount}\``, true)
      .addField("📉 Saldo Anterior", `\`${logData.previousBalance}\``, true)
      .addField("📈 Saldo Atual", `\`${logData.currentBalance}\``, true)
      .addField("📊 Diferença", `\`${logData.difference}\``, true)
      .setTimestamp()
      .build();

    await DiscordRequest(`/channels/${this.logChannel}/messages`, {
      method: "POST",
      body: {
        embeds: [embed]
      }
    });
  }

  // Color based on action
  _getColor(action) {
    switch (action) {
      case "add":
        return MessageEmbed.colors.Green;
      case "remove":
        return MessageEmbed.colors.Red;
      case "reset":
        return MessageEmbed.colors.Orange;
      case "get":
        return MessageEmbed.colors.DiscordBlurple;
      default:
        return MessageEmbed.colors.Gray;
    }
  }

  // Translate action name
  _formatAction(action) {
    switch (action) {
      case "add": return "Adição";
      case "remove": return "Remoção";
      case "reset": return "Reset";
      case "get": return "Consulta";
      default: return action;
    }
  }

  // Build log object
  _buildLog({ action, previous, amount, current }) {
    return {
      userId: this.userId,
      action,
      previousBalance: previous,
      amount,
      currentBalance: current,
      difference: current - previous,
      timestamp: Date.now()
    };
  }

  // Get total balance
  async getTotal() {
    const user = await this._getOrCreate();

    const log = this._buildLog({
      action: "get",
      previous: user.primogemas.atm,
      amount: 0,
      current: user.primogemas.atm
    });

    await this._sendLog(log);
    return log;
  }

  // Add balance (atomic)
  async add(amount) {
    if (amount <= 0)
      throw new Error("Quantidade deve ser maior que 0.");

    const userBefore = await this._getOrCreate();
    const previous = userBefore.primogemas.atm;

    const updated = await UserGlobalSchema.findOneAndUpdate(
      { userId: this.userId },
      {
        $inc: { "primogemas.atm": amount },
        $push: {
          "primogemas.transacoes": {
            type: "add",
            value: amount,
            date: Date.now()
          }
        }
      },
      { new: true }
    );

    const log = this._buildLog({
      action: "add",
      previous,
      amount,
      current: updated.primogemas.atm
    });

    await this._sendLog(log);
    return log;
  }

  // Remove balance (atomic + safe)
  async remove(amount) {
    if (amount <= 0)
      throw new Error("Quantidade deve ser maior que 0.");

    const userBefore = await this._getOrCreate();
    const previous = userBefore.primogemas.atm;

    const updated = await UserGlobalSchema.findOneAndUpdate(
      {
        userId: this.userId,
        "primogemas.atm": { $gte: amount }
      },
      {
        $inc: { "primogemas.atm": -amount },
        $push: {
          "primogemas.transacoes": {
            type: "remove",
            value: amount,
            date: Date.now()
          }
        }
      },
      { new: true }
    );

    if (!updated)
      throw new Error("Saldo insuficiente.");

    const log = this._buildLog({
      action: "remove",
      previous,
      amount,
      current: updated.primogemas.atm
    });

    await this._sendLog(log);
    return log;
  }

  // Reset balance
  async reset() {
    const userBefore = await this._getOrCreate();
    const previous = userBefore.primogemas.atm;

    const updated = await UserGlobalSchema.findOneAndUpdate(
      { userId: this.userId },
      {
        $set: {
          "primogemas.atm": 0,
          "primogemas.transacoes": []
        }
      },
      { new: true }
    );

    const log = this._buildLog({
      action: "reset",
      previous,
      amount: previous,
      current: 0
    });

    await this._sendLog(log);
    return log;
  }

  async save() {
    await this._getOrCreate();
    return true;
  }
}

module.exports = Economy;