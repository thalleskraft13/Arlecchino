'use strict';

const DiscordRequest = require('../../function/DiscordRequest.js');
const getPerm        = require('../../function/Utils/GetPerm.js');

/* ═══════════════════════════════════════════════════════════
   CONSTANTES
   ═══════════════════════════════════════════════════════════ */

const CATEGORIES = [
  'Moderação','Economia','Automação','Logs','Tickets',
  'Recompensas','Eventos','RPG','Utilidade','Comunidade',
  'Diversão','Outros'
];

const CATEGORY_EMOJI = {
  'Moderação':   '🛡️',
  'Economia':    '💰',
  'Automação':   '⚙️',
  'Logs':        '📋',
  'Tickets':     '🎫',
  'Recompensas': '🎁',
  'Eventos':     '🎉',
  'RPG':         '⚔️',
  'Utilidade':   '🔧',
  'Comunidade':  '👥',
  'Diversão':    '🎮',
  'Outros':      '📦'
};

const COLORS = {
  default:  0x5865F2,
  success:  0x57F287,
  warning:  0xFEE75C,
  danger:   0xED4245,
  library:  0x9B59B6
};

// Canal público de anúncios da biblioteca no servidor de suporte
const SUPPORT_ANNOUNCE_CHANNEL = '1508910999753850910';

/* ═══════════════════════════════════════════════════════════
   DEFINIÇÃO DO COMANDO
   ═══════════════════════════════════════════════════════════ */

module.exports = {
  data: {
    name:        'biblioteca',
    description: 'Biblioteca de Fluxos — explore, publique e instale sistemas prontos',
    options: [
      {
        type:        1,
        name:        'pesquisar',
        description: 'Pesquisa fluxos disponíveis na biblioteca',
        options: [
          { type: 3, name: 'nome',      description: 'Filtrar por nome',      required: false },
          { type: 3, name: 'categoria', description: 'Filtrar por categoria', required: false,
            choices: CATEGORIES.map(c => ({ name: c, value: c })) },
          { type: 3, name: 'tag',       description: 'Filtrar por tag',       required: false },
          { type: 3, name: 'autor',     description: 'ID do autor',           required: false },
          { type: 3, name: 'ordenar',   description: 'Ordenação dos resultados', required: false,
            choices: [
              { name: '📥 Mais instalados', value: 'installs' },
              { name: '⭐ Melhor avaliados', value: 'rating'   },
              { name: '🔥 Tendência',        value: 'trending' },
              { name: '🕐 Mais recentes',    value: 'recent'   }
            ]
          }
        ]
      },
      {
        type:        1,
        name:        'ver',
        description: 'Exibe detalhes de uma entrada da biblioteca',
        options: [
          { type: 3, name: 'id', description: 'ID da entrada (libId)', required: true }
        ]
      },
      {
        type:        1,
        name:        'instalar',
        description: 'Instala um sistema da biblioteca neste servidor',
        options: [
          { type: 3, name: 'id', description: 'ID da entrada (libId)', required: true }
        ]
      },
      {
        type:        1,
        name:        'publicar',
        description: 'Publica seus fluxos na biblioteca para a comunidade'
      },
      {
        type:        1,
        name:        'atualizar',
        description: 'Publica uma nova versão de uma entrada sua',
        options: [
          { type: 3, name: 'id', description: 'ID da entrada (libId)', required: true }
        ]
      },
      {
        type:        1,
        name:        'editar',
        description: 'Edita os metadados de uma entrada sua (nome, descrição, tags...)',
        options: [
          { type: 3, name: 'id', description: 'ID da entrada (libId)', required: true }
        ]
      },
      {
        type:        1,
        name:        'apagar',
        description: 'Remove uma entrada sua da biblioteca',
        options: [
          { type: 3, name: 'id', description: 'ID da entrada (libId)', required: true }
        ]
      },
      {
        type:        1,
        name:        'minhas',
        description: 'Lista todas as suas publicações na biblioteca'
      },
      {
        type:        1,
        name:        'perfil',
        description: 'Exibe o perfil de um criador',
        options: [
          { type: 6, name: 'usuario', description: 'Usuário (vazio = você mesmo)', required: false }
        ]
      },
      {
        type:        1,
        name:        'destaques',
        description: 'Exibe os destaques da semana na biblioteca'
      }
    ]
  },

  /* ═══════════════════════════════════════════
     EXECUTE
     ═══════════════════════════════════════════ */

  async execute(interaction, client) {
    const sub     = interaction.data.options?.[0]?.name;
    const opts    = _opts(interaction);
    const userId  = interaction.member?.user?.id || interaction.user?.id;
    const guildId = interaction.guild_id;
    const lib     = client.libraryManager;

    const MODAL_SUBS = ['publicar', 'atualizar', 'editar'];
    if (!MODAL_SUBS.includes(sub)) {
      await _defer(interaction);
    }

    try {
      switch (sub) {
        case 'pesquisar': return await _pesquisar(interaction, client, lib, opts, userId);
        case 'ver':       return await _ver(interaction, client, lib, opts, userId);
        case 'instalar':  return await _instalar(interaction, client, lib, opts, userId, guildId);
        case 'publicar':  return await _publicar(interaction, client, lib, userId, guildId);
        case 'atualizar': return await _atualizar(interaction, client, lib, opts, userId, guildId);
        case 'editar':    return await _editar(interaction, client, lib, opts, userId);
        case 'apagar':    return await _apagar(interaction, client, lib, opts, userId);
        case 'minhas':    return await _minhas(interaction, client, lib, userId);
        case 'perfil':    return await _perfil(interaction, client, lib, opts, userId);
        case 'destaques': return await _destaques(interaction, client, lib);
        default:
          return _edit(interaction, client, { content: '❌ Subcomando desconhecido.' });
      }
    } catch (err) {
      console.error(`[biblioteca/${sub}]`, err);
      return _edit(interaction, client, {
        embeds: [{
          title:       '❌ Erro',
          description: err.message || 'Ocorreu um erro inesperado.',
          color:       COLORS.danger
        }]
      });
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   HELPER — resolve nome de autor
   Tenta buscar no perfil de criador; fallback para Discord API.
   ═══════════════════════════════════════════════════════════ */

async function _resolveAuthorName(lib, authorId, fallback = null) {
  // 1. Usa o nome já gravado na entrada (mais rápido)
  if (fallback && fallback !== authorId) return fallback;

  // 2. Tenta o perfil de criador
  try {
    const profile = await lib.getCreatorProfile(authorId);
    if (profile?.username && profile.username !== authorId) return profile.username;
  } catch {}

  // 3. Fallback para Discord API
  try {
    const userData = await DiscordRequest(`/users/${authorId}`);
    return userData?.global_name || userData?.username || `Usuário ${authorId.slice(-4)}`;
  } catch {}

  return `Usuário ${authorId.slice(-4)}`;
}

/* ═══════════════════════════════════════════════════════════
   SUBCOMANDOS
   ═══════════════════════════════════════════════════════════ */

/* ── /biblioteca pesquisar ─────────────────────────────── */

async function _pesquisar(interaction, client, lib, opts, userId) {
  const { results } = await lib.search({
    query:    opts.nome,
    category: opts.categoria,
    tag:      opts.tag,
    authorId: opts.autor,
    sort:     opts.ordenar || 'installs',
    page:     0,
    limit:    10
  });

  if (!results.length) {
    return _edit(interaction, client, {
      embeds: [{
        title:       '🔍 Nenhum resultado',
        description: 'Nenhum fluxo foi encontrado com esses filtros.\nTente outros termos ou remova alguns filtros.',
        color:       COLORS.library
      }]
    });
  }

  return _renderSearchPage(interaction, client, lib, {
    query:    opts.nome,
    category: opts.categoria,
    tag:      opts.tag,
    authorId: opts.autor,
    sort:     opts.ordenar || 'installs'
  }, 0, userId);
}

async function _renderSearchPage(interaction, client, lib, filters, page, userId) {
  const { results, total, pages } = await lib.search({ ...filters, page, limit: 8 });

  // Resolve nomes de autor para todos os resultados em paralelo
  const authorNames = await Promise.all(
    results.map(e => _resolveAuthorName(lib, e.authorId, e.authorName))
  );

  // Atualiza authorName nos resultados para uso posterior
  results.forEach((e, i) => { e._resolvedAuthor = authorNames[i]; });

  const filterDesc = [];
  if (filters.query)    filterDesc.push(`🔎 \`${filters.query}\``);
  if (filters.category) filterDesc.push(`${CATEGORY_EMOJI[filters.category] || '📦'} ${filters.category}`);
  if (filters.tag)      filterDesc.push(`🏷️ \`${filters.tag}\``);
  const filterLine = filterDesc.length ? `**Filtros:** ${filterDesc.join('  •  ')}\n\n` : '';

  const sortLabels = { installs: '📥 Mais instalados', rating: '⭐ Melhor avaliados', trending: '🔥 Tendência', recent: '🕐 Mais recentes' };
  const sortLine   = `**Ordem:** ${sortLabels[filters.sort] || '📥 Mais instalados'}\n`;

  const lines = results.map((e, i) => {
    const emoji = CATEGORY_EMOJI[e.category] || '📦';
    const stars = _stars(e.stats.avgRating, e.stats.ratingCount);
    const num   = page * 8 + i + 1;
    return (
      `**${num}.** ${emoji} **${e.name}** \`v${e.version}\`\n` +
      `👤 ${e._resolvedAuthor}  •  📥 ${e.stats.installs.toLocaleString('pt-BR')} instalações  •  ${stars}\n` +
      `_${e.shortDesc || 'Sem descrição'}_`
    );
  }).join('\n\n');

  const selectOptions = results.map(e => ({
    label:       e.name.slice(0, 100),
    value:       e.libId,
    description: (`v${e.version} • ${e._resolvedAuthor} • ${e.stats.installs} instalações`).slice(0, 100),
    emoji:       { name: (CATEGORY_EMOJI[e.category] || '📦').replace(/\uFE0F/g, '') }
  }));

  const components = [];

  const sel = client.interactions.createSelect({
    user: userId,
    data: { placeholder: '🔍 Selecione para ver detalhes...', options: selectOptions },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _renderDetail(i, client, lib, i.data.values[0], userId);
    }
  });
  components.push({ type: 1, components: [sel] });

  const navBtns = [];
  if (page > 0) {
    navBtns.push(client.interactions.createButton({
      user: userId,
      data: { label: '◀ Anterior', style: 2 },
      funcao: async (i) => {
        await _deferUpdate(i);
        return _renderSearchPage(i, client, lib, filters, page - 1, userId);
      }
    }));
  }
  navBtns.push(client.interactions.createButton({
    user: userId,
    data: { label: `${page + 1} / ${pages}`, style: 2 },
    funcao: async (i) => { await _deferUpdate(i); }
  }));
  if (page < pages - 1) {
    navBtns.push(client.interactions.createButton({
      user: userId,
      data: { label: 'Próxima ▶', style: 2 },
      funcao: async (i) => {
        await _deferUpdate(i);
        return _renderSearchPage(i, client, lib, filters, page + 1, userId);
      }
    }));
  }
  if (navBtns.length) components.push({ type: 1, components: navBtns });

  return _edit(interaction, client, {
    embeds: [{
      title:       `📚 Biblioteca de Fluxos`,
      description: `${filterLine}${sortLine}\n${lines}`,
      color:       COLORS.library,
      footer:      { text: `${total} resultado${total !== 1 ? 's' : ''} • Página ${page + 1} de ${pages}` }
    }],
    components
  });
}

/* ── /biblioteca ver ───────────────────────────────────── */

async function _ver(interaction, client, lib, opts, userId) {
  const entry = await lib.getById(opts.id);
  if (!entry) {
    return _edit(interaction, client, {
      embeds: [{ title: '❌ Não encontrado', description: 'Entrada não encontrada na biblioteca.', color: COLORS.danger }]
    });
  }
  return _renderDetail(interaction, client, lib, opts.id, userId, entry);
}

async function _renderDetail(interaction, client, lib, libId, userId, entry = null) {
  entry = entry || await lib.getById(libId);
  if (!entry) return;

  // Resolve nome do autor corretamente
  const authorName = await _resolveAuthorName(lib, entry.authorId, entry.authorName);

  const userRating   = await lib.getUserRating(libId, userId);
  const emoji        = CATEGORY_EMOJI[entry.category] || '📦';
  const stars        = _stars(entry.stats.avgRating, entry.stats.ratingCount);
  const tags         = entry.tags?.length ? entry.tags.map(t => `\`${t}\``).join(' ') : '_Sem tags_';
  const vars         = entry.templateVars?.length
    ? entry.templateVars.map(v => `\`{${v}}\``).join(', ')
    : '_Nenhuma_';
  const likeStyle    = userRating?.vote === 'like'    ? 3 : 2;
  const dislikeStyle = userRating?.vote === 'dislike' ? 4 : 2;

  const btnInstall = client.interactions.createButton({
    user: userId,
    data: { label: '📥 Instalar', style: 3 },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _startInstallWizard(i, client, lib, entry, userId, i.guild_id);
    }
  });

  const btnLike = client.interactions.createButton({
    user: userId,
    data: { label: `👍 ${entry.stats.likes}`, style: likeStyle },
    funcao: async (i) => {
      await _deferUpdate(i);
      await lib.vote(libId, userId, 'like');
      const updated = await lib.getById(libId);
      return _renderDetail(i, client, lib, libId, userId, updated);
    }
  });

  const btnDislike = client.interactions.createButton({
    user: userId,
    data: { label: `👎 ${entry.stats.dislikes}`, style: dislikeStyle },
    funcao: async (i) => {
      await _deferUpdate(i);
      await lib.vote(libId, userId, 'dislike');
      const updated = await lib.getById(libId);
      return _renderDetail(i, client, lib, libId, userId, updated);
    }
  });

  const btnRate = client.interactions.createButton({
    user: userId,
    data: { label: '⭐ Avaliar', style: 2 },
    funcao: async (i) => _openRateModal(i, client, lib, libId, userId)
  });

  const btnAuthor = client.interactions.createButton({
    user: userId,
    data: { label: '👤 Ver Autor', style: 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _renderProfile(i, client, lib, entry.authorId, userId);
    }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       `${emoji} ${entry.name} \`v${entry.version}\``,
      description: entry.fullDesc || entry.shortDesc || '_Sem descrição_',
      color:       COLORS.library,
      fields: [
        { name: '👤 Autor',       value: authorName,                                         inline: true },
        { name: '📂 Categoria',   value: entry.category,                                     inline: true },
        { name: '📥 Instalações', value: entry.stats.installs.toLocaleString('pt-BR'),       inline: true },
        { name: '⭐ Avaliação',   value: `${stars} (${entry.stats.ratingCount} avaliações)`, inline: true },
        { name: '🔗 Fluxos',      value: String(entry.flows?.length || 0),                  inline: true },
        { name: '🏷️ Tags',        value: tags,                                               inline: false },
        { name: '🔧 Variáveis',   value: vars,                                               inline: false },
        { name: '🆔 ID',          value: `\`${entry.libId}\``,                              inline: false }
      ],
      footer:    { text: `Publicado por ${authorName}` },
      timestamp: entry.updatedAt
    }],
    components: [
      { type: 1, components: [btnInstall, btnLike, btnDislike, btnRate, btnAuthor] }
    ]
  });
}

/* ── /biblioteca instalar ──────────────────────────────── */

async function _instalar(interaction, client, lib, opts, userId, guildId) {
  const entry = await lib.getById(opts.id);
  if (!entry) {
    return _edit(interaction, client, {
      embeds: [{ title: '❌ Não encontrado', description: 'Entrada não encontrada na biblioteca.', color: COLORS.danger }]
    });
  }
  return _startInstallWizard(interaction, client, lib, entry, userId, guildId);
}

/* ─────────────────────────────────────────────────────────
   INSTALL WIZARD
   Pergunta APENAS channelId e roleId que estão faltando em
   ações E condições. Sistemas sem essas dependências instalam
   direto, sem nenhuma pergunta.
   ───────────────────────────────────────────────────────── */

async function _startInstallWizard(interaction, client, lib, entry, userId, guildId) {
  guildId = guildId || interaction.guild_id;
  const channelId = interaction.channel_id;

  // ── 1. Verifica MANAGE_GUILD ──────────────────────────
  let perms = [];
  try {
    perms = await getPerm({ guildId, id: userId });
  } catch (err) {
    console.error('[instalar] getPerm error:', err);
  }

  if (!perms.includes('MANAGE_GUILD') && !perms.includes('ADMINISTRATOR')) {
    return _edit(interaction, client, {
      embeds: [{
        title:       '❌ Sem permissão',
        description: 'Você precisa da permissão **Gerenciar Servidor** para instalar sistemas.',
        color:       COLORS.danger
      }]
    });
  }

  // ── 2. Monta perguntas APENAS para channelId/roleId ausentes ──
  const questions = _buildInstallQuestions(entry);

  if (!questions.length) {
    // Nenhuma variável necessária — instala imediatamente
    return _executeInstall(interaction, client, lib, entry, userId, guildId, {});
  }

  // ── 3. Anuncia o wizard ───────────────────────────────
  await _edit(interaction, client, {
    embeds: [{
      title:       `⚙️ Configuração — ${entry.name}`,
      description: (
        `Este sistema precisa de **${questions.length} configuração(ões)** antes de instalar.\n\n` +
        `Responda as próximas mensagens neste canal.\n` +
        `Você tem **2 minutos** para cada resposta.\n\n` +
        `> Envie \`cancelar\` a qualquer momento para abortar.`
      ),
      color:       COLORS.library,
      fields: questions.map((q, i) => ({
        name:   `${i + 1}. ${q.label}`,
        value:  `_${q.actionLabel}_`,
        inline: true
      })),
      footer: { text: `${entry.flows?.length || 0} fluxo(s) serão instalados` }
    }],
    components: []
  });

  // ── 4. Coleta sequencial ──────────────────────────────
  const collected = {};

  for (let i = 0; i < questions.length; i++) {
    const q        = questions[i];
    const progress = `(${i + 1}/${questions.length})`;

    await DiscordRequest(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: {
        embeds: [{
          title:       `❓ ${progress} ${q.label}`,
          description: q.description,
          color:       COLORS.library,
          footer:      { text: `Para: ${q.actionLabel}` }
        }]
      }
    });

    let msg;
    try {
      msg = await client.NextMessageCollector.wait({ channelId, userId, time: 120_000 });
    } catch {
      await DiscordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: {
          embeds: [{
            title:       '⏰ Tempo esgotado',
            description: 'A instalação foi cancelada por inatividade.',
            color:       COLORS.danger
          }]
        }
      });
      return;
    }

    const content = msg.content?.trim();

    if (!content || content.toLowerCase() === 'cancelar') {
      await DiscordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: {
          embeds: [{
            title:       '↩️ Instalação cancelada',
            description: 'Você cancelou a instalação.',
            color:       COLORS.default
          }]
        }
      });
      return;
    }

    // Aceita menção #canal, @cargo ou ID puro
    const rawId = content.replace(/[<#@&!>]/g, '').trim();
    collected[q.storeKey] = rawId || content;
  }

  // ── 5. Instala ────────────────────────────────────────
  return _executeInstall(interaction, client, lib, entry, userId, guildId, collected, channelId);
}

async function _executeInstall(interaction, client, lib, entry, userId, guildId, varValues, channelId = null) {
  try {
    const flowIds = await lib.install({ libId: entry.libId, guildId, userId, varValues });

    const configLines = Object.keys(varValues).length
      ? Object.entries(varValues).map(([k, v]) => `• \`${k}\` → ${v}`).join('\n')
      : '_Nenhuma configuração necessária_';

    const embed = {
      title:       `✅ ${entry.name} instalado!`,
      description: `**${flowIds.length}** fluxo(s) criado(s) neste servidor.\n\n**Configurações aplicadas:**\n${configLines}`,
      color:       COLORS.success,
      footer:      { text: 'Logic Builder • Biblioteca de Fluxos' }
    };

    if (channelId) {
      return DiscordRequest(`/channels/${channelId}/messages`, { method: 'POST', body: { embeds: [embed] } });
    }
    return _edit(interaction, client, { embeds: [embed] });
  } catch (err) {
    const embed = { title: '❌ Erro na instalação', description: err.message, color: COLORS.danger };

    if (channelId) {
      return DiscordRequest(`/channels/${channelId}/messages`, { method: 'POST', body: { embeds: [embed] } });
    }
    return _edit(interaction, client, { embeds: [embed] });
  }
}

/**
 * Ações/condições que EXIGEM channelId informado para funcionar.
 * Ações como reply_message, variable/add, show_ranking usam o contexto
 * da execução — não precisam de canal externo.
 */
const REQUIRES_CHANNEL_ID = new Set([
  'message:send_message',       // enviar mensagem num canal específico
  'message:delete_bot_message', // apagar msg do bot num canal específico
  'channel:delete_channel',     // apagar canal específico
  'channel:rename_channel',     // renomear canal específico
  'channel:lock_channel',       // trancar canal específico
  'channel:unlock_channel',     // destrancar canal específico
  'channel:is_channel',         // condição: é canal específico
  'channel:not_channel',        // condição: não é canal específico
]);

/**
 * Ações/condições que EXIGEM roleId informado para funcionar.
 */
const REQUIRES_ROLE_ID = new Set([
  'user:give_role',
  'user:remove_role',
  'user:give_temp_role',
  'user:toggle_role',
  'user:has_role',
  'user:not_has_role',
  'channel:lock_channel',   // precisa de roleId para saber qual cargo bloquear
  'channel:unlock_channel',
]);

/**
 * Varre ações E condições dos fluxos da entry.
 * Só gera pergunta se a ação/condição estiver no whitelist E
 * o valor ainda não tiver sido preenchido no template.
 * Sistemas sem essas dependências retornam array vazio → instala direto.
 */
function _buildInstallQuestions(entry) {
  const questions = [];
  const seen      = new Set();
  const flows     = entry.flows || [];

  for (const flow of flows) {
    for (const action of (flow.actions || [])) {
      _checkParamsForQuestion(action, questions, seen);
    }
    for (const cond of (flow.conditions || [])) {
      _checkParamsForQuestion(cond, questions, seen);
    }
  }

  return questions;
}

/**
 * Só adiciona pergunta se:
 * 1. O tipo de ação/condição está no whitelist (realmente precisa do ID)
 * 2. O valor ainda não foi preenchido no template (está vazio/ausente)
 */
function _checkParamsForQuestion(item, questions, seen) {
  const params   = item.params || {};
  const category = item.category || '';
  const type     = item.type     || '';
  const key      = `${category}:${type}`;

  // channelId — só pergunta se a ação realmente precisa de um canal explícito
  if (REQUIRES_CHANNEL_ID.has(key)) {
    const val = params.channelId;
    if (!val || val === '') {
      const dedupKey = `${key}:channelId`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        questions.push({
          storeKey:    'channelId',
          actionLabel: _actionLabel(category, type),
          label:       '📌 Canal',
          description: `Mencione ou envie o ID do canal para **${_actionLabel(category, type)}**.\nExemplo: \`#geral\` ou \`123456789012345678\``
        });
      }
    }
  }

  // roleId — só pergunta se a ação realmente precisa de um cargo explícito
  if (REQUIRES_ROLE_ID.has(key)) {
    const val = params.roleId;
    if (!val || val === '') {
      const dedupKey = `${key}:roleId`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        questions.push({
          storeKey:    'roleId',
          actionLabel: _actionLabel(category, type),
          label:       '🏷️ Cargo',
          description: `Mencione ou envie o ID do cargo para **${_actionLabel(category, type)}**.\nExemplo: \`@Membro\` ou \`123456789012345678\``
        });
      }
    }
  }
}

function _actionLabel(category, type) {
  const map = {
    'message:send_message':       '💬 Enviar mensagem',
    'message:send_dm':            '📩 Enviar DM',
    'message:reply_message':      '↩️ Responder mensagem',
    'message:delete_message':     '🗑️ Apagar mensagem',
    'message:delete_bot_message': '🗑️ Apagar mensagem do bot',
    'user:give_role':             '🏷️ Dar cargo',
    'user:remove_role':           '🏷️ Remover cargo',
    'user:give_temp_role':        '⏱️ Cargo temporário',
    'user:toggle_role':           '🔄 Alternar cargo',
    'channel:lock_channel':       '🔒 Trancar canal',
    'channel:unlock_channel':     '🔓 Destrancar canal',
    'channel:delete_channel':     '❌ Apagar canal',
    'channel:rename_channel':     '✏️ Renomear canal',
    'user:has_role':              '👤 Possui cargo',
    'user:not_has_role':          '👤 Não possui cargo',
    'channel:is_channel':         '📌 Canal específico',
    'channel:not_channel':        '📌 Não é canal',
  };
  return map[`${category}:${type}`] || `${category}/${type}`;
}

/* ── /biblioteca publicar — PAINEL INTERATIVO ──────────── */

async function _publicar(interaction, client, lib, userId, guildId) {
  const { FlowModel } = require('../../Mongodb/flow.js');
  const flows = await FlowModel.find({ guildId }).lean();

  if (!flows.length) {
    return _reply(interaction, {
      embeds: [{ title: '❌ Sem fluxos', description: 'Crie pelo menos um fluxo antes de publicar.', color: COLORS.danger }]
    });
  }

  let authorName = 'Anônimo';
  try {
    const userData = await DiscordRequest(`/users/${userId}`);
    authorName = userData.global_name || userData.username || 'Anônimo';
  } catch {}

  const state = { selectedFlowIds: [] };
  return _renderPublishPanel(interaction, client, lib, flows, userId, guildId, authorName, state);
}

async function _renderPublishPanel(interaction, client, lib, flows, userId, guildId, authorName, state, isReply = true) {
  const selectedNames = state.selectedFlowIds
    .map(id => flows.find(f => f.flowId === id)?.name || id)
    .map((n, i) => `${i + 1}. **${n}**`)
    .join('\n') || '_Nenhum fluxo adicionado ainda_';

  const available = flows.filter(f => !state.selectedFlowIds.includes(f.flowId));
  const selectRows = [];

  if (available.length) {
    const options = available.slice(0, 25).map(f => ({
      label:       f.name.slice(0, 100),
      value:       f.flowId,
      description: `${f.enabled ? '🟢' : '🔴'} ${_triggerLabel(f.trigger)}`.slice(0, 100)
    }));

    const sel = client.interactions.createSelect({
      user: userId,
      data: { placeholder: '➕ Adicionar fluxo ao sistema...', options },
      funcao: async (i) => {
        await _deferUpdate(i);
        const newId = i.data.values[0];
        if (!state.selectedFlowIds.includes(newId)) state.selectedFlowIds.push(newId);
        return _renderPublishPanel(i, client, lib, flows, userId, guildId, authorName, state, false);
      }
    });
    selectRows.push({ type: 1, components: [sel] });
  }

  const btnRemove = client.interactions.createButton({
    user: userId,
    data: { label: '➖ Remover último', style: 4 },
    funcao: async (i) => {
      await _deferUpdate(i);
      state.selectedFlowIds.pop();
      return _renderPublishPanel(i, client, lib, flows, userId, guildId, authorName, state, false);
    }
  });

  const btnPublish = client.interactions.createButton({
    user: userId,
    data: { label: '📤 Publicar', style: 3, disabled: state.selectedFlowIds.length === 0 },
    funcao: async (i) => {
      if (!state.selectedFlowIds.length) { await _deferUpdate(i); return; }
      return _publicarModal(i, client, lib, userId, guildId, authorName, state.selectedFlowIds);
    }
  });

  const embed = {
    title:       '📤 Publicar na Biblioteca',
    description: `**Autor:** ${authorName}\n\n**Fluxos selecionados (${state.selectedFlowIds.length}):**\n${selectedNames}\n\nAdicione os fluxos que farão parte deste sistema e clique em **Publicar** quando estiver pronto.`,
    color:       COLORS.library,
    footer:      { text: 'Você pode adicionar até 25 fluxos por publicação' }
  };

  const actionRow = { type: 1, components: [btnRemove, btnPublish] };
  const components = [...selectRows, actionRow];

  if (isReply) return _reply(interaction, { embeds: [embed], components });
  return _edit(interaction, client, { embeds: [embed], components });
}

async function _publicarModal(interaction, client, lib, userId, guildId, authorName, flowIds) {
  const modal = client.interactions.createModal({
    user:  userId,
    title: 'Publicar na Biblioteca',
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'name',      label: 'Nome do sistema',              style: 1, required: true,  max_length: 100,  placeholder: 'Ex: Sistema de XP Avançado' }] },
      { type: 1, components: [{ type: 4, custom_id: 'shortDesc', label: 'Descrição curta',               style: 1, required: true,  max_length: 150,  placeholder: 'Sistema completo de XP com níveis...' }] },
      { type: 1, components: [{ type: 4, custom_id: 'fullDesc',  label: 'Descrição completa (opcional)', style: 2, required: false, max_length: 2000, placeholder: 'Explique o funcionamento detalhado...' }] },
      { type: 1, components: [{ type: 4, custom_id: 'category',  label: 'Categoria',                    style: 1, required: true,  max_length: 20,   placeholder: 'Moderação, Economia, RPG...' }] },
      { type: 1, components: [{ type: 4, custom_id: 'tags',      label: 'Tags (separadas por vírgula)',  style: 1, required: false, max_length: 200,  placeholder: 'xp, level, rank, recompensa' }] }
    ],
    funcao: async (modalInteraction, _client, fields) => {
      const category = CATEGORIES.find(c => c.toLowerCase() === fields.category?.trim().toLowerCase());

      await DiscordRequest(
        `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
        { method: 'POST', body: { type: 6 } }
      );

      if (!category) {
        return _followUp(modalInteraction, client, {
          embeds: [{
            title:       '❌ Categoria inválida',
            description: `Categorias disponíveis:\n${CATEGORIES.join(', ')}`,
            color:       COLORS.danger
          }]
        });
      }

      try {
        const entry = await lib.publish({
          authorId:  userId,
          authorName,
          name:      fields.name.trim(),
          shortDesc: fields.shortDesc.trim(),
          fullDesc:  fields.fullDesc?.trim() || '',
          category,
          tags:      fields.tags ? fields.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          flowIds,
          guildId
        });

        // Notifica no canal público do servidor de suporte
        _announcePublicLibrary(client, entry, authorName, flowIds.length).catch(() => {});

        return _followUp(modalInteraction, client, {
          embeds: [{
            title:       '✅ Publicado com sucesso!',
            description: (
              `**${entry.name}** está disponível na biblioteca!\n\n` +
              `🆔 ID: \`${entry.libId}\`\n` +
              `📦 Fluxos: **${flowIds.length}**\n` +
              `🔧 Variáveis detectadas: ${entry.templateVars?.length ? entry.templateVars.map(v => `\`{${v}}\``).join(', ') : '_Nenhuma_'}`
            ),
            color:  COLORS.success,
            footer: { text: 'Logic Builder • Biblioteca de Fluxos' }
          }]
        });
      } catch (err) {
        return _followUp(modalInteraction, client, {
          embeds: [{ title: '❌ Erro ao publicar', description: err.message, color: COLORS.danger }]
        });
      }
    }
  });

  return client.interactions.showModal(interaction, modal);
}

/**
 * Anuncia a nova publicação no canal público do servidor de suporte.
 */
async function _announcePublicLibrary(client, entry, authorName, flowCount) {
  const emoji    = CATEGORY_EMOJI[entry.category] || '📦';
  const tags     = entry.tags?.length ? entry.tags.map(t => `\`${t}\``).join(' ') : '_Sem tags_';
  const vars     = entry.templateVars?.length
    ? entry.templateVars.map(v => `\`{${v}}\``).join(', ')
    : '_Nenhuma_';

  await DiscordRequest(`/channels/${SUPPORT_ANNOUNCE_CHANNEL}/messages`, {
    method: 'POST',
    body: {
      embeds: [{
        title:       `${emoji} Nova publicação na Biblioteca!`,
        description: (
          `**${entry.name}** foi publicado por **${authorName}**.\n\n` +
          `${entry.shortDesc || ''}`
        ),
        color:  COLORS.library,
        fields: [
          { name: '📂 Categoria',   value: entry.category,         inline: true  },
          { name: '🔗 Fluxos',      value: String(flowCount),      inline: true  },
          { name: '🏷️ Tags',        value: tags,                   inline: false },
          { name: '🔧 Variáveis',   value: vars,                   inline: false },
          { name: '🆔 ID',          value: `\`${entry.libId}\``,  inline: false }
        ],
        footer:    { text: 'Logic Builder • Biblioteca de Fluxos' },
        timestamp: new Date().toISOString()
      }]
    }
  });
}

/* ── /biblioteca atualizar ─────────────────────────────── */

async function _atualizar(interaction, client, lib, opts, userId, guildId) {
  const entry = await lib.getById(opts.id);
  if (!entry) {
    return _reply(interaction, { embeds: [{ title: '❌ Não encontrado', color: COLORS.danger }] });
  }
  if (entry.authorId !== userId) {
    return _reply(interaction, { embeds: [{ title: '❌ Sem permissão', description: 'Você não é o autor desta entrada.', color: COLORS.danger }] });
  }

  const { FlowModel } = require('../../Mongodb/flow.js');
  const flows = await FlowModel.find({ guildId }).lean();

  if (!flows.length) {
    return _reply(interaction, { embeds: [{ title: '❌ Sem fluxos', color: COLORS.danger }] });
  }

  let authorName = entry.authorName || 'Anônimo';
  try {
    const userData = await DiscordRequest(`/users/${userId}`);
    authorName = userData.global_name || userData.username || authorName;
  } catch {}

  const state = { selectedFlowIds: [] };
  return _renderUpdatePanel(interaction, client, lib, flows, userId, guildId, authorName, opts.id, entry, state, true);
}

async function _renderUpdatePanel(interaction, client, lib, flows, userId, guildId, authorName, libId, entry, state, isReply = false) {
  const selectedNames = state.selectedFlowIds
    .map(id => flows.find(f => f.flowId === id)?.name || id)
    .map((n, i) => `${i + 1}. **${n}**`)
    .join('\n') || '_Nenhum fluxo adicionado ainda_';

  const available = flows.filter(f => !state.selectedFlowIds.includes(f.flowId));
  const selectRows = [];

  if (available.length) {
    const options = available.slice(0, 25).map(f => ({
      label:       f.name.slice(0, 100),
      value:       f.flowId,
      description: `${f.enabled ? '🟢' : '🔴'} ${_triggerLabel(f.trigger)}`.slice(0, 100)
    }));

    const sel = client.interactions.createSelect({
      user: userId,
      data: { placeholder: '➕ Adicionar fluxo à nova versão...', options },
      funcao: async (i) => {
        await _deferUpdate(i);
        const newId = i.data.values[0];
        if (!state.selectedFlowIds.includes(newId)) state.selectedFlowIds.push(newId);
        return _renderUpdatePanel(i, client, lib, flows, userId, guildId, authorName, libId, entry, state, false);
      }
    });
    selectRows.push({ type: 1, components: [sel] });
  }

  const btnRemove = client.interactions.createButton({
    user: userId,
    data: { label: '➖ Remover último', style: 4 },
    funcao: async (i) => {
      await _deferUpdate(i);
      state.selectedFlowIds.pop();
      return _renderUpdatePanel(i, client, lib, flows, userId, guildId, authorName, libId, entry, state, false);
    }
  });

  const btnConfirm = client.interactions.createButton({
    user: userId,
    data: { label: '🔄 Confirmar atualização', style: 3, disabled: state.selectedFlowIds.length === 0 },
    funcao: async (i) => {
      if (!state.selectedFlowIds.length) { await _deferUpdate(i); return; }
      return _atualizarModal(i, client, lib, libId, userId, guildId, authorName, state.selectedFlowIds, entry.version);
    }
  });

  const embed = {
    title:       `🔄 Atualizar — ${entry.name}`,
    description: `Versão atual: \`${entry.version}\`\n\n**Fluxos selecionados (${state.selectedFlowIds.length}):**\n${selectedNames}\n\nSelecione os fluxos da nova versão e clique em **Confirmar atualização**.`,
    color:       COLORS.library
  };

  const actionRow = { type: 1, components: [btnRemove, btnConfirm] };
  const components = [...selectRows, actionRow];

  if (isReply) return _reply(interaction, { embeds: [embed], components });
  return _edit(interaction, client, { embeds: [embed], components });
}

async function _atualizarModal(interaction, client, lib, libId, userId, guildId, authorName, flowIds, currentVersion) {
  const modal = client.interactions.createModal({
    user:  userId,
    title: 'Nova Versão',
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'version',   label: `Nova versão (atual: ${currentVersion})`, style: 1, required: true,  max_length: 20,  placeholder: '2.0.0' }] },
      { type: 1, components: [{ type: 4, custom_id: 'changelog', label: 'O que mudou?',                           style: 2, required: false, max_length: 500, placeholder: 'Novos recursos, correções...' }] }
    ],
    funcao: async (modalInteraction, _client, fields) => {
      await DiscordRequest(
        `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
        { method: 'POST', body: { type: 6 } }
      );

      try {
        const updated = await lib.publishUpdate({
          libId, authorId: userId, authorName, flowIds, guildId,
          newVersion: fields.version.trim(),
          changelog:  fields.changelog?.trim() || ''
        });

        return _followUp(modalInteraction, client, {
          embeds: [{
            title:       `✅ Atualizado para v${updated.version}`,
            description: `**${updated.name}** foi atualizado com **${flowIds.length}** fluxo(s).\nInstaladores serão notificados via DM.`,
            color:       COLORS.success
          }]
        });
      } catch (err) {
        return _followUp(modalInteraction, client, {
          embeds: [{ title: '❌ Erro', description: err.message, color: COLORS.danger }]
        });
      }
    }
  });

  return client.interactions.showModal(interaction, modal);
}

/* ── /biblioteca editar ────────────────────────────────── */

async function _editar(interaction, client, lib, opts, userId) {
  const entry = await lib.getById(opts.id);
  if (!entry) {
    return _reply(interaction, { embeds: [{ title: '❌ Não encontrado', color: COLORS.danger }] });
  }
  if (entry.authorId !== userId) {
    return _reply(interaction, { embeds: [{ title: '❌ Sem permissão', description: 'Você não é o autor desta entrada.', color: COLORS.danger }] });
  }

  const modal = client.interactions.createModal({
    user:  userId,
    title: `Editar — ${entry.name.slice(0, 30)}`,
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'name',      label: 'Nome',               style: 1, required: true,  max_length: 100,  value: entry.name }] },
      { type: 1, components: [{ type: 4, custom_id: 'shortDesc', label: 'Descrição curta',    style: 1, required: false, max_length: 150,  value: entry.shortDesc || '' }] },
      { type: 1, components: [{ type: 4, custom_id: 'fullDesc',  label: 'Descrição completa', style: 2, required: false, max_length: 2000, value: entry.fullDesc  || '' }] },
      { type: 1, components: [{ type: 4, custom_id: 'category',  label: 'Categoria',          style: 1, required: false, max_length: 20,   value: entry.category }] },
      { type: 1, components: [{ type: 4, custom_id: 'tags',      label: 'Tags (vírgula)',     style: 1, required: false, max_length: 200,  value: entry.tags?.join(', ') || '' }] }
    ],
    funcao: async (modalInteraction, _client, fields) => {
      await DiscordRequest(
        `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
        { method: 'POST', body: { type: 6 } }
      );

      try {
        const category = fields.category
          ? CATEGORIES.find(c => c.toLowerCase() === fields.category.trim().toLowerCase())
          : entry.category;

        await lib.editMetadata(opts.id, userId, {
          name:      fields.name?.trim(),
          shortDesc: fields.shortDesc?.trim(),
          fullDesc:  fields.fullDesc?.trim(),
          category:  category || entry.category,
          tags:      fields.tags ? fields.tags.split(',').map(t => t.trim()).filter(Boolean) : entry.tags
        });

        return _followUp(modalInteraction, client, {
          embeds: [{ title: '✅ Entrada atualizada!', color: COLORS.success }]
        });
      } catch (err) {
        return _followUp(modalInteraction, client, {
          embeds: [{ title: '❌ Erro', description: err.message, color: COLORS.danger }]
        });
      }
    }
  });

  return client.interactions.showModal(interaction, modal);
}

/* ── /biblioteca apagar ────────────────────────────────── */

async function _apagar(interaction, client, lib, opts, userId) {
  const entry = await lib.getById(opts.id);
  if (!entry) {
    return _edit(interaction, client, { embeds: [{ title: '❌ Não encontrado', color: COLORS.danger }] });
  }
  if (entry.authorId !== userId) {
    return _edit(interaction, client, { embeds: [{ title: '❌ Sem permissão', description: 'Você não é o autor desta entrada.', color: COLORS.danger }] });
  }

  const btnConfirm = client.interactions.createButton({
    user: userId,
    data: { label: '✅ Confirmar exclusão', style: 4 },
    funcao: async (i) => {
      await _deferUpdate(i);
      try {
        await lib.delete(opts.id, userId);
        return _edit(i, client, {
          embeds: [{ title: '🗑️ Entrada removida', description: `**${entry.name}** foi removida da biblioteca.`, color: COLORS.danger }],
          components: []
        });
      } catch (err) {
        return _edit(i, client, {
          embeds: [{ title: '❌ Erro', description: err.message, color: COLORS.danger }],
          components: []
        });
      }
    }
  });

  const btnCancel = client.interactions.createButton({
    user: userId,
    data: { label: '❌ Cancelar', style: 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _edit(i, client, {
        embeds: [{ title: '↩️ Cancelado', description: 'A entrada não foi removida.', color: COLORS.default }],
        components: []
      });
    }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       '⚠️ Confirmar exclusão',
      description: `Tem certeza que deseja remover **${entry.name}** da biblioteca?\n\nEsta ação **não pode ser desfeita**.\nInstalações existentes nos servidores não serão afetadas.`,
      color:       COLORS.danger
    }],
    components: [{ type: 1, components: [btnConfirm, btnCancel] }]
  });
}

/* ── /biblioteca minhas ────────────────────────────────── */

async function _minhas(interaction, client, lib, userId) {
  const entries = await lib.getMyPublications(userId);

  if (!entries.length) {
    return _edit(interaction, client, {
      embeds: [{
        title:       '📤 Minhas Publicações',
        description: 'Você ainda não publicou nada na biblioteca.\nUse `/biblioteca publicar` para começar!',
        color:       COLORS.library
      }]
    });
  }

  const lines = entries.map((e, i) => {
    const statusIcon = e.status === 'approved' ? '🟢' : e.status === 'pending' ? '🟡' : '🔴';
    const emoji      = CATEGORY_EMOJI[e.category] || '📦';
    return (
      `**${i + 1}.** ${statusIcon} ${emoji} **${e.name}** \`v${e.version}\`\n` +
      `📥 ${e.stats.installs} instalações  •  ${_stars(e.stats.avgRating, 0)}`
    );
  }).join('\n\n');

  const selectOptions = entries.slice(0, 25).map(e => ({
    label:       e.name.slice(0, 100),
    value:       e.libId,
    description: (`v${e.version} • ${e.stats.installs} instalações`).slice(0, 100)
  }));

  const sel = client.interactions.createSelect({
    user: userId,
    data: { placeholder: 'Selecione para gerenciar...', options: selectOptions },
    funcao: async (i) => {
      await _deferUpdate(i);
      const selected = entries.find(e => e.libId === i.data.values[0]);
      return _renderManageEntry(i, client, lib, selected, userId);
    }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       `📤 Minhas Publicações (${entries.length})`,
      description: lines,
      color:       COLORS.library,
      footer:      { text: 'Selecione uma entrada para gerenciá-la' }
    }],
    components: [{ type: 1, components: [sel] }]
  });
}

async function _renderManageEntry(interaction, client, lib, entry, userId) {
  const changelog = entry.lastChangelog ? `\n**Último changelog:** ${entry.lastChangelog}` : '';

  const history = entry.versionHistory?.length
    ? entry.versionHistory.slice(-3).reverse()
        .map(v => `• \`v${v.version}\` — ${v.changelog || 'sem changelog'}`)
        .join('\n')
    : '_Nenhum histórico_';

  const btnEditar = client.interactions.createButton({
    user: userId,
    data: { label: '✏️ Editar', style: 2 },
    funcao: async (i) => _editar(i, client, lib, { id: entry.libId }, userId)
  });

  const btnAtualizar = client.interactions.createButton({
    user: userId,
    data: { label: '🔄 Atualizar versão', style: 1 },
    funcao: async (i) => _atualizar(i, client, lib, { id: entry.libId }, userId, i.guild_id)
  });

  const btnApagar = client.interactions.createButton({
    user: userId,
    data: { label: '🗑️ Apagar', style: 4 },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _apagar(i, client, lib, { id: entry.libId }, userId);
    }
  });

  const btnVoltar = client.interactions.createButton({
    user: userId,
    data: { label: '⬅️ Voltar', style: 2 },
    funcao: async (i) => {
      await _deferUpdate(i);
      return _minhas(i, client, lib, userId);
    }
  });

  return _edit(interaction, client, {
    embeds: [{
      title:       `${CATEGORY_EMOJI[entry.category] || '📦'} ${entry.name} \`v${entry.version}\``,
      description: entry.shortDesc + changelog,
      color:       COLORS.library,
      fields: [
        { name: '📊 Stats',     value: `📥 ${entry.stats.installs} instalações  •  👍 ${entry.stats.likes}  •  ⭐ ${entry.stats.avgRating}`, inline: false },
        { name: '📜 Histórico', value: history,                                                                                                inline: false },
        { name: '🆔 ID',        value: `\`${entry.libId}\``,                                                                                  inline: false }
      ]
    }],
    components: [{ type: 1, components: [btnEditar, btnAtualizar, btnApagar, btnVoltar] }]
  });
}

/* ── /biblioteca perfil ────────────────────────────────── */

async function _perfil(interaction, client, lib, opts, userId) {
  const targetId = opts.usuario || userId;
  return _renderProfile(interaction, client, lib, targetId, userId);
}

async function _renderProfile(interaction, client, lib, targetId, userId) {
  const profile = await lib.getCreatorProfile(targetId);

  // Resolve nome via Discord API se o perfil não tiver
  let displayName = profile.username;
  if (!displayName || displayName === targetId) {
    try {
      const userData = await DiscordRequest(`/users/${targetId}`);
      displayName = userData?.global_name || userData?.username || `Usuário ${targetId.slice(-4)}`;
    } catch {
      displayName = `Usuário ${targetId.slice(-4)}`;
    }
  }

  const topEntries = profile.entries
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 5)
    .map((e, i) => `${i + 1}. **${e.name}** \`v${e.version}\` — 📥 ${e.installs}`)
    .join('\n') || '_Nenhuma publicação_';

  const isFollowing = (await lib.getFollowers(targetId)).includes(userId);
  const isSelf      = targetId === userId;
  const components  = [];

  if (!isSelf) {
    const btnFollow = client.interactions.createButton({
      user: userId,
      data: { label: isFollowing ? '➖ Deixar de seguir' : '➕ Seguir', style: isFollowing ? 4 : 3 },
      funcao: async (i) => {
        await _deferUpdate(i);
        await lib.toggleFollow(userId, targetId);
        return _renderProfile(i, client, lib, targetId, userId);
      }
    });
    components.push({ type: 1, components: [btnFollow] });
  }

  return _edit(interaction, client, {
    embeds: [{
      title:       `👤 ${displayName}`,
      description: profile.bio || '_Sem bio_',
      color:       COLORS.library,
      fields: [
        { name: '📦 Publicações', value: String(profile.stats.totalFlows),                    inline: true },
        { name: '📥 Instalações', value: profile.stats.totalInstalls.toLocaleString('pt-BR'), inline: true },
        { name: '👍 Likes',       value: String(profile.stats.totalLikes),                    inline: true },
        { name: '⭐ Avaliação',   value: `${profile.stats.avgRating.toFixed(1)} ⭐`,          inline: true },
        { name: '👥 Seguidores',  value: String(profile.followers),                           inline: true },
        { name: '🏆 Top Fluxos',  value: topEntries,                                          inline: false }
      ],
      footer: { text: `ID: ${targetId}` }
    }],
    components
  });
}

/* ── /biblioteca destaques ─────────────────────────────── */

async function _destaques(interaction, client, lib) {
  const { trending, topInstalls, topRated, recent } = await lib.getHighlights();

  // Resolve nomes de autores para os destaques
  const fmt = async (list) => {
    if (!list.length) return '_Nenhum_';
    const names = await Promise.all(list.map(e => _resolveAuthorName(lib, e.authorId, e.authorName)));
    return list.map((e, i) =>
      `${i + 1}. **${e.name}** por ${names[i]} — 📥 ${e.stats.installs} • ⭐ ${e.stats.avgRating}`
    ).join('\n');
  };

  const [fTrending, fInstalls, fRated, fRecent] = await Promise.all([
    fmt(trending), fmt(topInstalls), fmt(topRated), fmt(recent)
  ]);

  return _edit(interaction, client, {
    embeds: [{
      title:     '🔥 Destaques da Semana',
      color:     COLORS.library,
      fields: [
        { name: '📈 Tendência',        value: fTrending,  inline: false },
        { name: '📥 Mais instalados',  value: fInstalls,  inline: false },
        { name: '⭐ Melhor avaliados', value: fRated,     inline: false },
        { name: '🕐 Mais recentes',    value: fRecent,    inline: false }
      ],
      footer:    { text: 'Logic Builder • Biblioteca de Fluxos' },
      timestamp: new Date().toISOString()
    }]
  });
}

/* ── Modal de avaliação ────────────────────────────────── */

async function _openRateModal(interaction, client, lib, libId, userId) {
  const modal = client.interactions.createModal({
    user:  userId,
    title: 'Avaliar fluxo',
    components: [{
      type: 1,
      components: [{
        type:        4,
        custom_id:   'rating',
        label:       'Nota de 1 a 5',
        style:       1,
        required:    true,
        max_length:  1,
        placeholder: '5'
      }]
    }],
    funcao: async (modalInteraction, _client, fields) => {
      const rating = Number(fields.rating);

      await DiscordRequest(
        `/interactions/${modalInteraction.id}/${modalInteraction.token}/callback`,
        { method: 'POST', body: { type: 6 } }
      );

      if (!rating || rating < 1 || rating > 5) {
        return _followUp(modalInteraction, client, {
          embeds: [{ title: '❌ Nota inválida', description: 'Informe um número entre 1 e 5.', color: COLORS.danger }]
        });
      }

      const result = await lib.rate(libId, userId, rating);
      return _followUp(modalInteraction, client, {
        embeds: [{
          title:       '✅ Avaliação registrada',
          description: `Você deu **${rating} ⭐** para este fluxo.\nNova média: **${result.avg} ⭐** (${result.count} avaliações)`,
          color:       COLORS.success
        }]
      });
    }
  });

  return client.interactions.showModal(interaction, modal);
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

function _opts(interaction) {
  const sub  = interaction.data.options?.[0];
  const opts = {};
  for (const o of sub?.options || []) opts[o.name] = o.value;
  return opts;
}

function _stars(avg, count) {
  if (!count) return '☆☆☆☆☆ _sem avaliações_';
  const full = Math.round(avg);
  return '⭐'.repeat(full) + '☆'.repeat(5 - full) + ` ${avg.toFixed(1)}`;
}

function _triggerLabel(trigger) {
  if (!trigger) return 'Não configurado';
  const labels = {
    'message:message_created':  '💬 Mensagem criada',
    'member:member_joined':     '👋 Membro entrou',
    'component:button_clicked': '🖱️ Botão clicado',
    'time:scheduled_trigger':   '🕐 Agendado'
  };
  return labels[`${trigger.category}:${trigger.type}`] || `${trigger.category}/${trigger.type}`;
}

// ── Discord helpers ──────────────────────────────────────

async function _defer(interaction) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: 'POST', body: { type: 5, data: { flags: 0 } } }
  );
}

async function _deferUpdate(interaction) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: 'POST', body: { type: 6 } }
  );
}

async function _reply(interaction, data) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: 'POST', body: { type: 4, data } }
  );
}

async function _edit(interaction, client, data) {
  return DiscordRequest(
    `/webhooks/${client.clientId}/${interaction.token}/messages/@original`,
    { method: 'PATCH', body: data }
  );
}

async function _followUp(interaction, client, data) {
  return DiscordRequest(
    `/webhooks/${client.clientId}/${interaction.token}`,
    { method: 'POST', body: data }
  );
}
