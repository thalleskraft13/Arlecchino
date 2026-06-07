'use strict';

const { randomUUID }       = require('crypto');
const UserGlobalDb         = require('../../Mongodb/userglobal.js');
const AdventureGroupModel  = require('../../Mongodb/AdventureGroup.js');
const GuildMissionModel    = require('../../Mongodb/GuildMission.js');
const DiscordRequest       = require('../DiscordRequest.js');

/* ═══════════════════════════════════════════════════════════
   POOLS DE MISSÕES
   ═══════════════════════════════════════════════════════════ */

// ── Pessoais ─────────────────────────────────────────────

const DAILY_POOL = [
  { id: 'send_10',       label: 'Envie 10 mensagens',          type: 'send_message',  goal: 10,  reward: 60  },
  { id: 'send_20',       label: 'Envie 20 mensagens',          type: 'send_message',  goal: 20,  reward: 100 },
  { id: 'send_30',       label: 'Envie 30 mensagens',          type: 'send_message',  goal: 30,  reward: 160 },
  { id: 'do_daily',      label: 'Faça o /daily',               type: 'do_daily',      goal: 1,   reward: 80  },
  { id: 'join_voice',    label: 'Entre em um canal de voz',    type: 'join_voice',    goal: 1,   reward: 60  },
  { id: 'voice_10',      label: 'Fique 10 min em call',        type: 'voice_minutes', goal: 10,  reward: 100 },
  { id: 'react_5',       label: 'Reaja a 5 mensagens',         type: 'add_reaction',  goal: 5,   reward: 60  },
  { id: 'explore_1',     label: 'Faça uma exploração',         type: 'explore',       goal: 1,   reward: 80  },
  { id: 'xp_50',         label: 'Ganhe 50 XP de aventureiro',  type: 'earn_xp',       goal: 50,  reward: 80  },
  { id: 'xp_100',        label: 'Ganhe 100 XP de aventureiro', type: 'earn_xp',       goal: 100, reward: 160 },
];

const WEEKLY_POOL = [
  { id: 'w_send_150',    label: 'Envie 150 mensagens',          type: 'send_message',  goal: 150, reward: 400 },
  { id: 'w_send_300',    label: 'Envie 300 mensagens',          type: 'send_message',  goal: 300, reward: 800 },
  { id: 'w_streak_3',    label: 'Faça o /daily 3 dias seguidos',type: 'daily_streak',  goal: 3,   reward: 480 },
  { id: 'w_streak_5',    label: 'Faça o /daily 5 dias seguidos',type: 'daily_streak',  goal: 5,   reward: 800 },
  { id: 'w_xp_300',      label: 'Ganhe 300 XP de aventureiro',  type: 'earn_xp',       goal: 300, reward: 480 },
  { id: 'w_xp_500',      label: 'Ganhe 500 XP de aventureiro',  type: 'earn_xp',       goal: 500, reward: 800 },
  { id: 'w_voice_60',    label: 'Fique 60 min em call',         type: 'voice_minutes', goal: 60,  reward: 480 },
  { id: 'w_explore_5',   label: 'Faça 5 explorações',           type: 'explore',       goal: 5,   reward: 400 },
  { id: 'w_react_30',    label: 'Reaja a 30 mensagens',         type: 'add_reaction',  goal: 30,  reward: 400 },
  { id: 'w_voice_5',     label: 'Entre em call 5 vezes',        type: 'join_voice',    goal: 5,   reward: 480 },
];

// ── Grupo (meta = pool_base × membros, reward = base × membros) ──

const GROUP_DAILY_POOL = [
  { id: 'g_send',     label: 'Enviem {goal} mensagens juntos',   type: 'send_message',  baseGoal: 40,  baseReward: 80  },
  { id: 'g_xp',       label: 'Ganhem {goal} XP juntos',          type: 'earn_xp',       baseGoal: 150, baseReward: 100 },
  { id: 'g_react',    label: 'Façam {goal} reações juntos',       type: 'add_reaction',  baseGoal: 15,  baseReward: 80  },
  { id: 'g_explore',  label: 'Façam {goal} explorações juntos',   type: 'explore',       baseGoal: 2,   baseReward: 100 },
  { id: 'g_voice',    label: 'Fiquem {goal} min em call juntos',  type: 'voice_minutes', baseGoal: 20,  baseReward: 80  },
];

const GROUP_WEEKLY_POOL = [
  { id: 'gw_send',    label: 'Enviem {goal} mensagens juntos',    type: 'send_message',  baseGoal: 300,  baseReward: 600  },
  { id: 'gw_xp',      label: 'Ganhem {goal} XP juntos',           type: 'earn_xp',       baseGoal: 800,  baseReward: 700  },
  { id: 'gw_explore', label: 'Façam {goal} explorações juntos',   type: 'explore',       baseGoal: 10,   baseReward: 600  },
  { id: 'gw_voice',   label: 'Fiquem {goal} min em call juntos',  type: 'voice_minutes', baseGoal: 120,  baseReward: 700  },
  { id: 'gw_daily',   label: 'Façam o /daily {goal} vezes juntos',type: 'do_daily',       baseGoal: 5,   baseReward: 500  },
];

// ── Guilda ────────────────────────────────────────────────

const GUILD_WEEKLY_POOL = [
  // Atividade do servidor
  { id: 'guild_msgs_500',    label: 'Membros enviem 500 mensagens no servidor',     type: 'send_message',  goal: 500,  reward: 1200 },
  { id: 'guild_msgs_1000',   label: 'Membros enviem 1000 mensagens no servidor',    type: 'send_message',  goal: 1000, reward: 2400 },
  { id: 'guild_xp_1000',     label: 'Membros ganhem 1000 XP de aventureiro',        type: 'earn_xp',       goal: 1000, reward: 1600 },
  { id: 'guild_xp_2000',     label: 'Membros ganhem 2000 XP de aventureiro',        type: 'earn_xp',       goal: 2000, reward: 3200 },
  { id: 'guild_explore_20',  label: 'Membros façam 20 explorações',                 type: 'explore',       goal: 20,   reward: 1600 },
  { id: 'guild_voice_200',   label: 'Membros fiquem 200 min em calls',              type: 'voice_minutes', goal: 200,  reward: 1600 },
  { id: 'guild_react_100',   label: 'Membros façam 100 reações',                    type: 'add_reaction',  goal: 100,  reward: 1200 },
  // Eventos especiais (sorteados para o slot de evento)
  { id: 'guild_event_daily', label: 'Todos os membros ativos fazem o /daily hoje',  type: 'guild_all_daily', goal: 1, reward: 2000, isEvent: true },
  { id: 'guild_event_voice', label: 'Boss de Voz — fiquem 30 min em call juntos',   type: 'voice_minutes', goal: 30,   reward: 2400, isEvent: true },
  { id: 'guild_event_msgs',  label: 'Chuva de Mora — enviem 200 msgs em 24h',       type: 'send_message',  goal: 200,  reward: 3200, isEvent: true },
];

const GUILD_WEEKLY_COUNT = 4; // 3 de atividade + 1 de evento

/* ═══════════════════════════════════════════════════════════
   MISSION MANAGER
   ═══════════════════════════════════════════════════════════ */

class MissionManager {

  constructor(client) {
    this.client = client;
  }

  /* ══════════════════════════════════════════════════════
     TRACK EVENT — ponto central chamado pelo bot
     ══════════════════════════════════════════════════════ */

  /**
   * Registra um evento para um usuário.
   * Atualiza missões pessoais, do grupo e da guilda simultaneamente.
   *
   * @param {string} userId
   * @param {string} eventType
   * @param {number} [amount=1]
   * @param {string} [guildId]   — necessário para missões de guilda
   */
  async trackEvent(userId, eventType, amount = 1, guildId = null) {
    await Promise.all([
      this._trackPersonal(userId, eventType, amount),
      this._trackGroup(userId, eventType, amount),
      guildId ? this._trackGuild(guildId, userId, eventType, amount) : Promise.resolve()
    ]);
  }

  /* ══════════════════════════════════════════════════════
     PESSOAIS
     ══════════════════════════════════════════════════════ */

  async _trackPersonal(userId, eventType, amount) {
    try {
      const user = await this._getOrCreateUser(userId);
      await this._ensurePersonalMissions(user);

      let changed = false;
      for (const period of ['daily', 'weekly']) {
        const list = user.missions?.[period]?.list;
        if (!Array.isArray(list)) continue;

        for (const m of list) {
          if (m.done || m.type !== eventType) continue;
          m.progress = Math.min(m.progress + amount, m.goal);
          if (m.progress >= m.goal) {
            m.done = true;
            await this._rewardUser(user, m.reward, m.label, `mission_${period}`);
          }
          changed = true;
        }
      }

      if (changed) {
        user.markModified('missions');
        await user.save();
      }
    } catch (err) {
      console.error('[MissionManager] _trackPersonal error:', err);
    }
  }

  async _ensurePersonalMissions(user) {
    const now = Date.now();
    if (!user.missions) user.missions = {};

    let changed = false;

    if (!user.missions.daily || !Array.isArray(user.missions.daily?.list) || now > user.missions.daily.expiresAt) {
      user.missions.daily = {
        generatedAt: now,
        expiresAt:   this._nextMidnight(),
        list:        this._pickPool(DAILY_POOL, 3)
      };
      changed = true;
    }

    if (!user.missions.weekly || !Array.isArray(user.missions.weekly?.list) || now > user.missions.weekly.expiresAt) {
      user.missions.weekly = {
        generatedAt: now,
        expiresAt:   this._nextMonday(),
        list:        this._pickPool(WEEKLY_POOL, 3)
      };
      changed = true;
    }

    if (changed) {
      user.markModified('missions');
      await user.save();
    }
  }

  /* ══════════════════════════════════════════════════════
     GRUPO DE AVENTUREIROS
     ══════════════════════════════════════════════════════ */

  async _trackGroup(userId, eventType, amount) {
    try {
      const group = await AdventureGroupModel.findOne({ members: userId });
      if (!group) return;

      await this._ensureGroupMissions(group);

      let changed = false;
      for (const period of ['daily', 'weekly']) {
        const list = group.missions?.[period]?.list;
        if (!Array.isArray(list)) continue;

        for (const m of list) {
          if (m.done || m.type !== eventType) continue;

          m.progress = Math.min(m.progress + amount, m.goal);

          // Registra contribuição individual
          if (!m.contributors) m.contributors = {};
          m.contributors[userId] = (m.contributors[userId] || 0) + amount;

          if (m.progress >= m.goal) {
            m.done = true;
            // Recompensa todos os membros (base × nº membros cada um recebe a base)
            await this._rewardGroupMembers(group, m.baseReward, m.label, `mission_group_${period}`);
          }

          changed = true;
        }
      }

      if (changed) {
        group.markModified('missions');
        await group.save();
      }
    } catch (err) {
      console.error('[MissionManager] _trackGroup error:', err);
    }
  }

  async _ensureGroupMissions(group) {
    const now     = Date.now();
    const members = group.members.length;
    let changed   = false;

    if (!group.missions.daily || !Array.isArray(group.missions.daily?.list) || now > group.missions.daily.expiresAt) {
      group.missions.daily = {
        generatedAt: now,
        expiresAt:   this._nextMidnight(),
        list:        this._pickGroupPool(GROUP_DAILY_POOL, 2, members)
      };
      changed = true;
    }

    if (!group.missions.weekly || !Array.isArray(group.missions.weekly?.list) || now > group.missions.weekly.expiresAt) {
      group.missions.weekly = {
        generatedAt: now,
        expiresAt:   this._nextMonday(),
        list:        this._pickGroupPool(GROUP_WEEKLY_POOL, 2, members)
      };
      changed = true;
    }

    if (changed) {
      group.markModified('missions');
      await group.save();
    }
  }

  async _rewardGroupMembers(group, baseReward, label, type) {
    const memberCount = group.members.length;
    // Cada membro recebe baseReward × memberCount
    const rewardEach  = baseReward * memberCount;

    for (const memberId of group.members) {
      try {
        const user = await this._getOrCreateUser(memberId);
        await this._rewardUser(user, rewardEach, label, type);
        await user.save();
      } catch {}
    }
  }

  /* ══════════════════════════════════════════════════════
     MISSÕES DE GUILDA
     ══════════════════════════════════════════════════════ */

  async _trackGuild(guildId, userId, eventType, amount) {
    try {
      let doc = await GuildMissionModel.findOne({ guildId });
      if (!doc) doc = await GuildMissionModel.create({ guildId });

      await this._ensureGuildMissions(doc);

      let changed = false;

      // Missões semanais
      for (const m of doc.missions.weekly.list) {
        if (m.done || m.type !== eventType) continue;
        m.progress = Math.min(m.progress + amount, m.goal);
        if (!m.contributors) m.contributors = {};
        m.contributors[userId] = (m.contributors[userId] || 0) + amount;

        if (m.progress >= m.goal) {
          m.done = true;
          // Divide a recompensa igualmente entre todos os contribuidores
          await this._distributeGuildReward(doc, m.reward, m.label);
        }
        changed = true;
      }

      // Missão de evento ativo
      const ev = doc.missions.event;
      if (ev?.active && ev.mission && !ev.mission.done) {
        const em = ev.mission;
        if (em.type === eventType && Date.now() <= ev.expiresAt) {
          em.progress = Math.min((em.progress || 0) + amount, em.goal);
          if (!em.contributors) em.contributors = {};
          em.contributors[userId] = (em.contributors[userId] || 0) + amount;

          if (em.progress >= em.goal) {
            em.done = true;
            await this._distributeGuildReward(doc, em.reward, em.label);
          }
          changed = true;
        }
      }

      if (changed) {
        doc.markModified('missions');
        await doc.save();
      }
    } catch (err) {
      console.error('[MissionManager] _trackGuild error:', err);
    }
  }

  async _ensureGuildMissions(doc) {
    const now = Date.now();

    if (!doc.missions.weekly || now > doc.missions.weekly.expiresAt) {
      const regular = GUILD_WEEKLY_POOL.filter(m => !m.isEvent);
      const events  = GUILD_WEEKLY_POOL.filter(m => m.isEvent);

      const picked = this._pickPool(regular, GUILD_WEEKLY_COUNT - 1);
      const event  = this._pickPool(events, 1)[0];

      doc.missions.weekly = {
        generatedAt: now,
        expiresAt:   this._nextMonday(),
        list:        picked.map(m => ({ ...m, progress: 0, done: false, contributors: {} }))
      };

      // Evento especial com duração de 48h
      doc.missions.event = {
        active:      true,
        generatedAt: now,
        expiresAt:   now + 48 * 60 * 60 * 1000,
        mission:     { ...event, progress: 0, done: false, contributors: {} }
      };
    }
  }

  async _distributeGuildReward(doc, totalReward, label) {
    // Recompensa todos que contribuíram para a missão
    // Cada contribuidor recebe a recompensa total (é generoso para incentivar participação)
    const allUserIds = new Set();

    for (const m of doc.missions.weekly.list) {
      if (m.contributors) Object.keys(m.contributors).forEach(id => allUserIds.add(id));
    }
    if (doc.missions.event?.mission?.contributors) {
      Object.keys(doc.missions.event.mission.contributors).forEach(id => allUserIds.add(id));
    }

    for (const userId of allUserIds) {
      doc.pendingRewards.push({
        userId,
        amount: totalReward,
        label,
        date: Date.now()
      });
    }
  }

  /* ══════════════════════════════════════════════════════
     COLETAR RECOMPENSAS DE GUILDA
     ══════════════════════════════════════════════════════ */

  /**
   * Coleta todas as recompensas pendentes de guilda para um usuário.
   * Chamado por /guilda missoes → botão "Coletar".
   */
  async collectGuildRewards(guildId, userId) {
    const doc = await GuildMissionModel.findOne({ guildId });
    if (!doc) return 0;

    const pending = doc.pendingRewards.filter(r => r.userId === userId);
    if (!pending.length) return 0;

    const total = pending.reduce((acc, r) => acc + r.amount, 0);
    const user  = await this._getOrCreateUser(userId);

    await this._rewardUser(user, total, 'Missões de Guilda coletadas', 'guild_collect');
    await user.save();

    // Remove as recompensas coletadas
    doc.pendingRewards = doc.pendingRewards.filter(r => r.userId !== userId);
    await doc.save();

    return total;
  }

  /* ══════════════════════════════════════════════════════
     CRUD — GRUPO DE AVENTUREIROS
     ══════════════════════════════════════════════════════ */

  async createGroup(leaderId) {
    const existing = await AdventureGroupModel.findOne({ members: leaderId });
    if (existing) throw new Error('Você já está em um grupo. Saia primeiro.');

    return AdventureGroupModel.create({
      groupId: randomUUID().slice(0, 8).toUpperCase(),
      leaderId,
      members: [leaderId]
    });
  }

  async inviteToGroup(leaderId, targetId) {
    const group = await AdventureGroupModel.findOne({ leaderId });
    if (!group) throw new Error('Você não é líder de nenhum grupo.');
    if (group.members.length >= 4) throw new Error('Grupo cheio (máx 4 membros).');

    const alreadyIn = await AdventureGroupModel.findOne({ members: targetId });
    if (alreadyIn) throw new Error('Este usuário já está em um grupo.');

    // Remove convite expirado se existir
    group.pendingInvites = group.pendingInvites.filter(
      i => i.userId !== targetId && i.expiresAt > Date.now()
    );

    group.pendingInvites.push({
      userId:    targetId,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutos
    });

    await group.save();
    return group;
  }

  async acceptInvite(userId) {
    const group = await AdventureGroupModel.findOne({
      pendingInvites: { $elemMatch: { userId, expiresAt: { $gt: Date.now() } } }
    });
    if (!group) throw new Error('Nenhum convite pendente encontrado ou convite expirado.');
    if (group.members.length >= 4) throw new Error('Grupo está cheio agora.');

    const alreadyIn = await AdventureGroupModel.findOne({ members: userId });
    if (alreadyIn) throw new Error('Você já está em um grupo.');

    group.members.push(userId);
    group.pendingInvites = group.pendingInvites.filter(i => i.userId !== userId);

    // Regenera missões com nova contagem de membros
    group.missions.daily  = {};
    group.missions.weekly = {};

    group.markModified('missions');
    await group.save();
    return group;
  }

  async leaveGroup(userId) {
    const group = await AdventureGroupModel.findOne({ members: userId });
    if (!group) throw new Error('Você não está em nenhum grupo.');

    if (group.leaderId === userId) {
      // Líder sai — dissolve o grupo
      await AdventureGroupModel.deleteOne({ _id: group._id });
      return { dissolved: true, group };
    }

    group.members = group.members.filter(id => id !== userId);
    await group.save();
    return { dissolved: false, group };
  }

  async getGroup(userId) {
    return AdventureGroupModel.findOne({ members: userId });
  }

  /* ══════════════════════════════════════════════════════
     GETTERS PÚBLICOS
     ══════════════════════════════════════════════════════ */

  async getPersonalMissions(userId) {
    const user = await this._getOrCreateUser(userId);
    await this._ensurePersonalMissions(user);
    user.markModified('missions');
    await user.save();
    return user.missions;
  }

  async getGroupMissions(userId) {
    const group = await AdventureGroupModel.findOne({ members: userId });
    if (!group) return null;
    await this._ensureGroupMissions(group);
    group.markModified('missions');
    await group.save();
    return { group, missions: group.missions };
  }

  async getGuildMissions(guildId) {
    let doc = await GuildMissionModel.findOne({ guildId });
    if (!doc) doc = await GuildMissionModel.create({ guildId });
    await this._ensureGuildMissions(doc);
    doc.markModified('missions');
    await doc.save();
    return doc;
  }

  /* ══════════════════════════════════════════════════════
     HELPERS INTERNOS
     ══════════════════════════════════════════════════════ */

  async _getOrCreateUser(userId) {
    let user = await UserGlobalDb.findOne({ userId });
    if (!user) user = new UserGlobalDb({ userId });
    if (!user.missions) user.missions = {};
    return user;
  }

  async _rewardUser(user, amount, label, type) {
    user.primogemas.atm += amount;
    if (!Array.isArray(user.primogemas.transacoes)) user.primogemas.transacoes = [];
    user.primogemas.transacoes.push({ type, value: amount, label, date: Date.now() });

    if (user.dmNotificacoes) {
      this._sendRewardDm(user.userId, amount, label).catch(() => {});
    }
  }

  async _sendRewardDm(userId, amount, label) {
    try {
      const dm = await DiscordRequest('/users/@me/channels', {
        method: 'POST',
        body:   { recipient_id: userId }
      });
      if (!dm?.id) return;

      await DiscordRequest(`/channels/${dm.id}/messages`, {
        method: 'POST',
        body: {
          embeds: [{
            title:       '✅ Missão concluída!',
            description: `**${label}**\n\n🔮 +**${amount} Primogemas**`,
            color:       0xA855F7,
            footer:      { text: 'Lynette • Missões' },
            timestamp:   new Date().toISOString()
          }]
        }
      });
    } catch {}
  }

  /** Sorteia N itens únicos do pool */
  _pickPool(pool, count) {
    return [...pool]
      .sort(() => Math.random() - 0.5)
      .slice(0, count)
      .map(m => ({ ...m, progress: 0, done: false, contributors: {} }));
  }

  /** Sorteia missões de grupo escalando meta e reward pelo nº de membros */
  _pickGroupPool(pool, count, memberCount) {
    return [...pool]
      .sort(() => Math.random() - 0.5)
      .slice(0, count)
      .map(m => ({
        ...m,
        goal:        m.baseGoal  * memberCount,
        baseReward:  m.baseReward,
        label:       m.label.replace('{goal}', m.baseGoal * memberCount),
        progress:    0,
        done:        false,
        contributors: {}
      }));
  }

  _nextMidnight() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  _nextMonday() {
    const d   = new Date();
    const day = d.getDay();
    const daysUntil = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntil);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
}

module.exports = MissionManager;
