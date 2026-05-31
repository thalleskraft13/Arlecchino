const UserGlobalDb = require("../../Mongodb/userglobal.js");
const {GuildDb} = require("../../Mongodb/guild.js");
const PremiumKey = require("../../Mongodb/premiumKey.js");

class PremiumManager {

  async addUserPremium(userId, dias) {

    const tempoMs = dias * 86400000;

    let user = await UserGlobalDb.findOne({ userId });

    if (!user)
      user = await UserGlobalDb.create({ userId });

    const agora = Date.now();

    if (user.premium > agora)
      user.premium += tempoMs;
    else
      user.premium = agora + tempoMs;

    await user.save();

    return {
      status: true,
      expireAt: user.premium
    };
  }

  async getUserPremium(userId) {

    const user = await UserGlobalDb.findOne({ userId });

    if (!user || user.premium === 0)
      return { status: false };

    const agora = Date.now();

    if (user.premium > agora) {
      return {
        status: true,
        tempo: user.premium - agora,
        expireAt: user.premium
      };
    }

    user.premium = 0;
    await user.save();

    return { status: false };
  }

  async addGuildPremium(guildId, userId) {

    const user = await UserGlobalDb.findOne({ userId });
    if (!user) return { status: false, motivo: "Usuário não encontrado" };

    const premium = await this.getUserPremium(userId);
    if (!premium.status)
      return { status: false, motivo: "Sem premium ativo" };

    if (!user.premium_guilds)
      user.premium_guilds = [];

    if (user.premium_guilds.length >= user.premium_guild_limit) {
      return {
        status: false,
        motivo: `Limite atingido (${user.premium_guild_limit})`
      };
    }

    let guild = await GuildDb.findOne({ guildId });

    if (!guild)
      guild = await GuildDb.create({ guildId });

    const expireAt = Date.now() + premium.tempo;

    guild.premiumUser = userId;
    guild.premiumTime = expireAt;

    await guild.save();

    const exists = user.premium_guilds.find(g => g.guildId === guildId);

    if (exists) {
      exists.expireAt = expireAt;
    } else {
      user.premium_guilds.push({
        guildId,
        expireAt
      });
    }

    await user.save();

    return {
      status: true,
      expireAt
    };
  }

  async addGuildPremiumDirect(guildId, dias) {

    let guild = await GuildDb.findOne({ guildId });

    if (!guild)
      guild = await GuildDb.create({ guildId });

    const tempoMs = dias * 86400000;
    const agora = Date.now();

    if (guild.premiumTime > agora)
      guild.premiumTime += tempoMs;
    else
      guild.premiumTime = agora + tempoMs;

    await guild.save();

    return {
      status: true,
      expireAt: guild.premiumTime
    };
  }

  async getGuildPremium(guildId) {

    const guild = await GuildDb.findOne({ guildId });

    if (!guild || !guild.premiumTime)
      return { status: false };

    const agora = Date.now();

    if (guild.premiumTime <= agora) {

      guild.premiumUser = null;
      guild.premiumTime = 0;
      await guild.save();

      return { status: false };
    }

    return {
      status: true,
      tempo: guild.premiumTime - agora,
      expireAt: guild.premiumTime,
      userId: guild.premiumUser
    };
  }

  async removeGuildPremium(guildId, userId) {

    const guild = await GuildDb.findOne({ guildId });
    const user = await UserGlobalDb.findOne({ userId });

    if (!guild || !user)
      return { status: false };

    guild.premiumUser = null;
    guild.premiumTime = 0;

    await guild.save();

    user.premium_guilds = user.premium_guilds
      .filter(g => g.guildId !== guildId);

    await user.save();

    return { status: true };
  }

  async listUserGuilds(userId) {

    const user = await UserGlobalDb.findOne({ userId });

    if (!user || !user.premium_guilds)
      return [];

    const agora = Date.now();

    const valid = user.premium_guilds.filter(g => g.expireAt > agora);

    user.premium_guilds = valid;
    await user.save();

    return valid;
  }

  async redeemKey(userId, guildId, code) {

    const key = await PremiumKey.findOne({ code });

    if (!key)
      return { status: false, motivo: "Key inválida" };

    if (key.used)
      return { status: false, motivo: "Key já utilizada" };

    if (key.type === "USER") {

      const dias = key.duration / 86400000;
      await this.addUserPremium(userId, dias);

    } else if (key.type === "GUILD") {

      const dias = key.duration / 86400000;
      await this.addGuildPremiumDirect(guildId, dias);
    }

    key.used = true;
    key.usedBy = userId;
    key.usedAt = Date.now();

    await key.save();

    return { status: true };
  }

  async createKey(type, dias) {

    const crypto = require("crypto");

    const code = "LUA-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    await PremiumKey.create({
      code,
      type,
      duration: dias * 86400000
    });

    return code;
  }
}

module.exports = new PremiumManager();