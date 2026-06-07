'use strict';

const DiscordRequest = require('../../function/DiscordRequest.js');

const COLORS = {
  personal: 0xF59E0B,
  group:    0x10B981,
  guild:    0x3B82F6,
  event:    0xF97316,
  success:  0x57F287,
  danger:   0xED4245,
  default:  0x5865F2
};

/* ═══════════════════════════════════════════════════════════
   COMANDO /missoes
   ═══════════════════════════════════════════════════════════ */

module.exports = {
  data: {
    name:        'missoes',
    description: 'Visualize suas missões pessoais, de grupo e de guilda',
    options: [
      {
        type:        1,
        name:        'ver',
        description: 'Veja suas missões diárias e semanais pessoais'
      },
      {
        type:        1,
        name:        'guilda',
        description: 'Missões semanais e eventos do servidor'
      },
      {
        type:        2,
        name:        'grupo',
        description: 'Gerencie seu Grupo de Aventureiros',
        options: [
          {
            type:        1,
            name:        'criar',
            description: 'Cria um novo grupo de aventureiros'
          },
          {
            type:        1,
            name:        'convidar',
            description: 'Convida um usuário para o seu grupo',
            options: [
              { type: 6, name: 'usuario', description: 'Usuário a convidar', required: true }
            ]
          },
          {
            type:        1,
            name:        'aceitar',
            description: 'Aceita um convite pendente de grupo'
          },
          {
            type:        1,
            name:        'sair',
            description: 'Sai do grupo atual (líderes dissolvem o grupo)'
          },
          {
            type:        1,
            name:        'ver',
            description: 'Vê as missões e membros do seu grupo'
          }
        ]
      }
    ]
  },

  async execute(interaction, client) {
    const userId  = interaction.member?.user?.id || interaction.user?.id;
    const guildId = interaction.guild_id;
    const sub     = interaction.data.options?.[0]?.name;
    const subSub  = interaction.data.options?.[0]?.options?.[0]?.name;
    const opts    = _opts(interaction);

    await _defer(interaction);

    try {
      switch (sub) {
        case 'ver':    return await _renderPersonal(interaction, client, userId, 'daily');
        case 'guilda': return await _renderGuildMissions(interaction, client, userId, guildId, 'weekly');
        case 'grupo': {
          switch (subSub) {
            case 'criar':    return await _grupoCriar(interaction, client, userId);
            case 'convidar': return await _grupoConvidar(interaction, client, userId, opts.usuario);
            case 'aceitar':  return await _grupoAceitar(interaction, client, userId);
            case 'sair':     return await _grupoSair(interaction, client, userId);
            case 'ver':      return await _grupoVer(interaction, client, userId);
          }
        }
        default: return await _renderPersonal(interaction, client, userId, 'daily');
      }
    } catch (err) {
      console.error('[missoes]', err);
      return _edit(interaction, client, {
        embeds: [{ title: '❌ Erro', description: err.message || 'Erro inesperado.', color: COLORS.danger }]
      });
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   MISSÕES PESSOAIS
   ═══════════════════════════════════════════════════════════ */

async function _renderPersonal(interaction, client, userId, period) {
  const missions    = await client.missionManager.getPersonalMissions(userId);
  const data        = missions[period];
  const list        = data?.list || [];
  const doneCount   = list.filter(m => m.done).length;
  const totalReward = list.reduce((acc, m) => acc + m.reward, 0);
  const timeLeft    = _formatTimeLeft(data?.expiresAt || 0);

  const lines = list.map(m => {
    const bar    = _bar(m.progress, m.goal);
    const status = m.done ? '✅' : '🔹';
    const pct    = Math.floor((m.progress / m.goal) * 100);
    return `${status} **${m.label}**\n${bar} \`${m.progress}/${m.goal}\` (${pct}%) — 🔮 ${m.reward}`;
  }).join('\n\n');

  const btnDaily = client.interactions.createButton({
    user: userId,
    data: { label: '☀️ Diárias', style: period === 'daily' ? 1 : 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderPersonal(i, client, userId, 'daily'); }
  });

  const btnWeekly = client.interactions.createButton({
    user: userId,
    data: { label: '📅 Semanais', style: period === 'weekly' ? 1 : 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderPersonal(i, client, userId, 'weekly'); }
  });

  const btnGroup = client.interactions.createButton({
    user: userId,
    data: { label: '👥 Grupo', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _grupoVer(i, client, userId); }
  });

  const btnGuild = client.interactions.createButton({
    user: userId,
    data: { label: '🏰 Guilda', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderGuildMissions(i, client, userId, i.guild_id, 'weekly'); }
  });

  const btnRefresh = client.interactions.createButton({
    user: userId,
    data: { label: '🔄', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderPersonal(i, client, userId, period); }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       `${period === 'daily' ? '☀️ Diárias' : '📅 Semanais'} — Missões Pessoais`,
      description: lines || '_Nenhuma missão disponível._',
      color:       COLORS.personal,
      fields: [
        { name: '📊 Progresso',        value: `${doneCount}/${list.length} concluídas`, inline: true },
        { name: '🔮 Recompensa total', value: `${totalReward} Primogemas`,              inline: true },
        { name: '⏰ Reseta em',         value: timeLeft,                                 inline: true }
      ],
      footer:    { text: 'O progresso atualiza conforme você age no servidor' },
      timestamp: new Date().toISOString()
    }],
    components: [{ type: 1, components: [btnDaily, btnWeekly, btnGroup, btnGuild, btnRefresh] }]
  });
}

/* ═══════════════════════════════════════════════════════════
   GRUPO DE AVENTUREIROS
   ═══════════════════════════════════════════════════════════ */

async function _grupoCriar(interaction, client, userId) {
  const group = await client.missionManager.createGroup(userId);
  return _edit(interaction, client, {
    embeds: [{
      title:       '⚔️ Grupo criado!',
      description: `Seu grupo foi criado com sucesso!\n\n🆔 **ID:** \`${group.groupId}\`\nUse \`/missoes grupo convidar\` para chamar até 3 amigos.`,
      color:       COLORS.group
    }]
  });
}

async function _grupoConvidar(interaction, client, userId, targetId) {
  if (!targetId) {
    return _edit(interaction, client, {
      embeds: [{ title: '❌ Informe o usuário', color: COLORS.danger }]
    });
  }

  const group = await client.missionManager.inviteToGroup(userId, targetId);
  _notifyInvite(client, targetId, userId, group.groupId).catch(() => {});

  return _edit(interaction, client, {
    embeds: [{
      title:       '📨 Convite enviado!',
      description: `<@${targetId}> foi convidado para o grupo **${group.groupId}**.\nO convite expira em **10 minutos**.\n\nEle(a) pode aceitar com \`/missoes grupo aceitar\`.`,
      color:       COLORS.group
    }]
  });
}

async function _grupoAceitar(interaction, client, userId) {
  const group = await client.missionManager.acceptInvite(userId);
  return _edit(interaction, client, {
    embeds: [{
      title:       '✅ Você entrou no grupo!',
      description: `Bem-vindo(a) ao grupo **${group.groupId}**!\n👥 Membros: ${group.members.length}/4\n\nAs missões foram atualizadas para ${group.members.length} membro(s).`,
      color:       COLORS.group
    }]
  });
}

async function _grupoSair(interaction, client, userId) {
  const btnConfirm = client.interactions.createButton({
    user: userId,
    data: { label: '✅ Confirmar', style: 4 },
    funcao: async (i) => {
      await _deferUpdate(i);
      const result = await client.missionManager.leaveGroup(userId);
      const msg = result.dissolved
        ? '🗑️ Você era o líder — o grupo foi dissolvido.'
        : `✅ Você saiu do grupo **${result.group.groupId}**.`;
      return _edit(i, client, { embeds: [{ title: msg, color: COLORS.danger }], components: [] });
    }
  });

  const btnCancel = client.interactions.createButton({
    user: userId,
    data: { label: '❌ Cancelar', style: 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _edit(i, client, { embeds: [{ title: '↩️ Cancelado', color: COLORS.default }], components: [] });
    }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       '⚠️ Sair do grupo?',
      description: 'Se você for o **líder**, o grupo será **dissolvido** para todos os membros.',
      color:       COLORS.danger
    }],
    components: [{ type: 1, components: [btnConfirm, btnCancel] }]
  });
}

async function _grupoVer(interaction, client, userId) {
  const result = await client.missionManager.getGroupMissions(userId);

  if (!result) {
    const btnCriar = client.interactions.createButton({
      user: userId,
      data: { label: '⚔️ Criar grupo', style: 1 },
      funcao: async (i) => { await _deferUpdate(i); return _grupoCriar(i, client, userId); }
    });
    const btnPersonal = client.interactions.createButton({
      user: userId,
      data: { label: '👤 Pessoais', style: 2 },
      funcao: async (i) => { await _deferUpdate(i); return _renderPersonal(i, client, userId, 'daily'); }
    });
    return _edit(interaction, client, {
      embeds: [{
        title:       '👥 Grupo de Aventureiros',
        description: 'Você não está em nenhum grupo.\nCrie um e convide até **3 amigos** para missões com recompensas multiplicadas!\n\n✨ **Bônus:** recompensa base × número de membros.',
        color:       COLORS.group
      }],
      components: [{ type: 1, components: [btnCriar, btnPersonal] }]
    });
  }

  const { group, missions } = result;
  return _renderGroupMissions(interaction, client, userId, group, missions, 'daily');
}

async function _renderGroupMissions(interaction, client, userId, group, missions, period) {
  const data     = missions[period];
  const list     = data?.list || [];
  const members  = group.members.length;
  const timeLeft = _formatTimeLeft(data?.expiresAt || 0);

  const memberMentions = group.members
    .map((id, i) => `${i === 0 ? '👑' : '⚔️'} <@${id}>`)
    .join('\n');

  const lines = list.map(m => {
    const bar    = _bar(m.progress, m.goal);
    const status = m.done ? '✅' : '🔹';
    const pct    = Math.floor((m.progress / m.goal) * 100);
    const reward = m.baseReward * members;
    return `${status} **${m.label}**\n${bar} \`${m.progress}/${m.goal}\` (${pct}%) — 🔮 ${reward} cada`;
  }).join('\n\n');

  const doneCount   = list.filter(m => m.done).length;
  const totalReward = list.reduce((acc, m) => acc + (m.baseReward * members), 0);

  const btnDaily = client.interactions.createButton({
    user: userId,
    data: { label: '☀️ Diárias', style: period === 'daily' ? 1 : 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      const r = await client.missionManager.getGroupMissions(userId);
      if (!r) return;
      return _renderGroupMissions(i, client, userId, r.group, r.missions, 'daily');
    }
  });

  const btnWeekly = client.interactions.createButton({
    user: userId,
    data: { label: '📅 Semanais', style: period === 'weekly' ? 1 : 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      const r = await client.missionManager.getGroupMissions(userId);
      if (!r) return;
      return _renderGroupMissions(i, client, userId, r.group, r.missions, 'weekly');
    }
  });

  const btnPersonal = client.interactions.createButton({
    user: userId,
    data: { label: '👤 Pessoais', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderPersonal(i, client, userId, 'daily'); }
  });

  const btnRefresh = client.interactions.createButton({
    user: userId,
    data: { label: '🔄', style: 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      const r = await client.missionManager.getGroupMissions(userId);
      if (!r) return;
      return _renderGroupMissions(i, client, userId, r.group, r.missions, period);
    }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       `${period === 'daily' ? '☀️ Diárias' : '📅 Semanais'} — Grupo ${group.groupId}`,
      description: lines || '_Nenhuma missão de grupo disponível._',
      color:       COLORS.group,
      fields: [
        { name: `👥 Membros (${members}/4)`,   value: memberMentions,                                            inline: true },
        { name: '📊 Progresso',                value: `${doneCount}/${list.length} concluídas`,                  inline: true },
        { name: '🔮 Recompensa (cada)',         value: `${totalReward} Primogemas`,                               inline: true },
        { name: '✨ Bônus de grupo',            value: `**${members}×** recompensa base`,                         inline: true },
        { name: '⏰ Reseta em',                 value: timeLeft,                                                  inline: true }
      ],
      footer:    { text: `ID do grupo: ${group.groupId}` },
      timestamp: new Date().toISOString()
    }],
    components: [{ type: 1, components: [btnDaily, btnWeekly, btnPersonal, btnRefresh] }]
  });
}

/* ═══════════════════════════════════════════════════════════
   MISSÕES DE GUILDA
   ═══════════════════════════════════════════════════════════ */

async function _renderGuildMissions(interaction, client, userId, guildId, tab) {
  const doc = await client.missionManager.getGuildMissions(guildId);
  if (tab === 'event') return _renderEventMission(interaction, client, userId, guildId, doc);
  return _renderWeeklyMissions(interaction, client, userId, guildId, doc);
}

async function _renderWeeklyMissions(interaction, client, userId, guildId, doc) {
  const list         = doc.missions.weekly?.list || [];
  const timeLeft     = _formatTimeLeft(doc.missions.weekly?.expiresAt || 0);
  const doneCount    = list.filter(m => m.done).length;
  const pendingTotal = doc.pendingRewards
    .filter(r => r.userId === userId)
    .reduce((acc, r) => acc + r.amount, 0);

  const lines = list.map(m => {
    const bar      = _bar(m.progress, m.goal);
    const status   = m.done ? '✅' : '🔷';
    const pct      = Math.floor((m.progress / m.goal) * 100);
    const contribs = Object.keys(m.contributors || {}).length;
    return (
      `${status} **${m.label}**\n` +
      `${bar} \`${m.progress}/${m.goal}\` (${pct}%) — 🔮 ${m.reward} • 👤 ${contribs} contribuidor(es)`
    );
  }).join('\n\n');

  const btnWeekly = client.interactions.createButton({
    user: userId,
    data: { label: '📅 Semanais', style: 1 }
  });

  const btnEvent = client.interactions.createButton({
    user: userId,
    data: { label: '⚡ Evento', style: doc.missions.event?.active ? 3 : 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderGuildMissions(i, client, userId, guildId, 'event'); }
  });

  const btnPersonal = client.interactions.createButton({
    user: userId,
    data: { label: '👤 Pessoais', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderPersonal(i, client, userId, 'daily'); }
  });

  const btnCollect = client.interactions.createButton({
    user: userId,
    data: { label: `🎁 Coletar (${pendingTotal} 🔮)`, style: pendingTotal > 0 ? 3 : 2, disabled: pendingTotal === 0 },
    funcao: async (i) => {
      await _deferUpdate(i);
      const collected = await client.missionManager.collectGuildRewards(guildId, userId);
      return _edit(i, client, {
        embeds: [{
          title:       '✅ Recompensas coletadas!',
          description: `Você recebeu **${collected} 🔮 Primogemas** das missões de guilda!`,
          color:       COLORS.success
        }],
        components: []
      });
    }
  });

  const btnRefresh = client.interactions.createButton({
    user: userId,
    data: { label: '🔄', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderGuildMissions(i, client, userId, guildId, 'weekly'); }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       '🏰 Missões de Guilda — Semanais',
      description: lines || '_Nenhuma missão disponível._',
      color:       COLORS.guild,
      fields: [
        { name: '📊 Progresso',       value: `${doneCount}/${list.length} concluídas`, inline: true },
        { name: '⏰ Reseta em',        value: timeLeft,                                 inline: true },
        { name: '🎁 Suas recompensas', value: `${pendingTotal} 🔮 pendentes`,           inline: true }
      ],
      footer:    { text: 'Todos os membros do servidor contribuem para o progresso' },
      timestamp: new Date().toISOString()
    }],
    components: [
      { type: 1, components: [btnWeekly, btnEvent, btnPersonal] },
      { type: 1, components: [btnCollect, btnRefresh] }
    ]
  });
}

async function _renderEventMission(interaction, client, userId, guildId, doc) {
  const ev = doc.missions.event;

  const btnBack = client.interactions.createButton({
    user: userId,
    data: { label: '⬅️ Semanais', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderGuildMissions(i, client, userId, guildId, 'weekly'); }
  });

  if (!ev?.active || !ev.mission) {
    return _edit(interaction, client, {
      embeds: [{
        title:       '⚡ Evento Especial',
        description: '_Nenhum evento ativo no momento._\nEventos especiais aparecem toda semana com recompensas maiores!',
        color:       COLORS.event
      }],
      components: [{ type: 1, components: [btnBack] }]
    });
  }

  const m            = ev.mission;
  const bar          = _bar(m.progress || 0, m.goal);
  const pct          = Math.floor(((m.progress || 0) / m.goal) * 100);
  const timeLeft     = _formatTimeLeft(ev.expiresAt || 0);
  const contribs     = Object.keys(m.contributors || {}).length;
  const status       = m.done ? '✅ **CONCLUÍDO**' : '🔶 **Em andamento**';
  const pendingTotal = doc.pendingRewards
    .filter(r => r.userId === userId)
    .reduce((acc, r) => acc + r.amount, 0);

  const btnCollect = client.interactions.createButton({
    user: userId,
    data: { label: `🎁 Coletar (${pendingTotal} 🔮)`, style: pendingTotal > 0 ? 3 : 2, disabled: pendingTotal === 0 },
    funcao: async (i) => {
      await _deferUpdate(i);
      const collected = await client.missionManager.collectGuildRewards(guildId, userId);
      return _edit(i, client, {
        embeds: [{
          title:       '✅ Recompensas coletadas!',
          description: `Você recebeu **${collected} 🔮 Primogemas** do evento!`,
          color:       COLORS.success
        }],
        components: []
      });
    }
  });

  const btnRefresh = client.interactions.createButton({
    user: userId,
    data: { label: '🔄', style: 2 },
    funcao: async (i) => { await _deferUpdate(i); return _renderGuildMissions(i, client, userId, guildId, 'event'); }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       `⚡ Evento — ${m.label}`,
      description: `${status}\n\n${bar} \`${m.progress || 0}/${m.goal}\` (${pct}%)`,
      color:       m.done ? COLORS.success : COLORS.event,
      fields: [
        { name: '🔮 Recompensa',       value: `${m.reward} Primogemas por contribuidor`, inline: true },
        { name: '👥 Contribuidores',   value: String(contribs),                           inline: true },
        { name: '⏰ Expira em',         value: timeLeft,                                  inline: true },
        { name: '🎁 Suas recompensas', value: `${pendingTotal} 🔮 pendentes`,             inline: true }
      ],
      footer:    { text: 'Eventos têm duração de 48h — participe antes que expire!' },
      timestamp: new Date().toISOString()
    }],
    components: [{ type: 1, components: [btnBack, btnCollect, btnRefresh] }]
  });
}

/* ═══════════════════════════════════════════════════════════
   NOTIFICAÇÃO DE CONVITE VIA DM
   ═══════════════════════════════════════════════════════════ */

async function _notifyInvite(client, targetId, leaderId, groupId) {
  try {
    const dm = await DiscordRequest('/users/@me/channels', {
      method: 'POST',
      body:   { recipient_id: targetId }
    });
    if (!dm?.id) return;

    await DiscordRequest(`/channels/${dm.id}/messages`, {
      method: 'POST',
      body: {
        embeds: [{
          title:       '⚔️ Convite para Grupo de Aventureiros!',
          description: `<@${leaderId}> te convidou para o grupo **${groupId}**.\n\nUse \`/missoes grupo aceitar\` para entrar.\n> O convite expira em **10 minutos**.`,
          color:       COLORS.group,
          footer:      { text: 'Lynette • Grupos de Aventureiros' },
          timestamp:   new Date().toISOString()
        }]
      }
    });
  } catch {}
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

function _bar(current, goal) {
  const filled = Math.min(Math.round((current / goal) * 10), 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function _formatTimeLeft(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Resetando...';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
  return `${h}h ${m}m`;
}

function _opts(interaction) {
  const sub    = interaction.data.options?.[0];
  const subSub = sub?.options?.[0];
  const opts   = {};
  for (const o of subSub?.options || sub?.options || []) {
    if (o.type !== 1 && o.type !== 2) opts[o.name] = o.value;
  }
  return opts;
}

async function _defer(interaction) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: 'POST', body: { type: 5, data: { flags: 64 } } }
  );
}

async function _deferUpdate(interaction) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: 'POST', body: { type: 6 } }
  );
}

async function _edit(interaction, client, data) {
  return DiscordRequest(
    `/webhooks/${client.clientId}/${interaction.token}/messages/@original`,
    { method: 'PATCH', body: data }
  );
}
