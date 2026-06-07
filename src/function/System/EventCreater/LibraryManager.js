'use strict';

const { randomUUID }   = require('crypto');
const DiscordRequest   = require('../../DiscordRequest.js');
const {
  LibraryFlowModel,
  LibraryRatingModel,
  CreatorProfileModel,
  LibraryInstallModel
} = require('../../../Mongodb/flow.js');


/* ═══════════════════════════════════════════════════════════
   LIBRARY MANAGER
   ═══════════════════════════════════════════════════════════ */

/**
 * LibraryManager
 *
 * Gerencia toda a Biblioteca de Fluxos do Logic Builder:
 *   - Publicação e versionamento de fluxos
 *   - Busca com filtros e paginação
 *   - Instalação com assistente de template vars
 *   - Avaliações (like/dislike + estrelas)
 *   - Perfil de criador e sistema de seguidores
 *   - Destaques semanais
 *
 * Uso:
 *   client.libraryManager = new LibraryManager(client);
 */
class LibraryManager {

  constructor(client) {
    this.client = client;

    // Nomes de variáveis de sistema que NÃO devem virar templateVars
    this._systemVarNames = new Set([
      'user','user_id','user_mention','guild','guild_id',
      'channel','channel_id','message','message_id',
      'timestamp','date','time','count','role','role_id',
      'args','arg0','arg1','arg2','arg3','arg4','aleatorio'
    ]);

    this._decayInterval = null;
  }

  /**
   * Inicia o LibraryManager.
   * Deve ser chamado APÓS o MongoDB conectar, igual ao LogicEngine.start().
   *
   * Exemplo no ready handler:
   *   client.libraryManager.start();
   */
  start() {
    this._startWeeklyDecay();
    console.log('[LibraryManager] Iniciado.');
  }

  /* ═══════════════════════════════════════════
     PUBLICAÇÃO
     ═══════════════════════════════════════════ */

  /**
   * Publica um ou mais fluxos na biblioteca.
   *
   * @param {object} opts
   * @param {string}   opts.authorId      — userId do Discord
   * @param {string}   opts.name          — nome do sistema
   * @param {string}   opts.shortDesc     — descrição curta
   * @param {string}   opts.fullDesc      — descrição completa
   * @param {string}   opts.category      — categoria
   * @param {string[]} opts.tags          — tags
   * @param {string[]} opts.flowIds       — IDs dos fluxos do guild a exportar
   * @param {string}   opts.guildId       — guild de origem (para buscar os fluxos)
   * @returns {Promise<object>} — documento LibraryFlow criado
   */
  async publish({ authorId, name, shortDesc, fullDesc, category, tags, flowIds, guildId }) {
    const { FlowModel } = require('../../../Mongodb/flow.js');

    // Busca os fluxos originais
    const flows = await FlowModel.find({
      guildId,
      flowId: { $in: flowIds }
    }).lean();

    if (!flows.length) {
      throw new Error('Nenhum fluxo encontrado para publicar.');
    }

    // Sanitiza: remove guildId, cooldownMap e stats antes de exportar
    const sanitized = flows.map(f => this._sanitizeFlow(f));

    // Detecta variáveis de template
    const templateVars = this._extractTemplateVars(sanitized);

    // Busca ou cria o perfil do criador
    const profile = await this._ensureProfile(authorId);

    const entry = await LibraryFlowModel.create({
      libId:        randomUUID(),
      authorId,
      authorName:   profile.username || authorId,
      name:         name.trim(),
      shortDesc:    shortDesc?.trim() || '',
      fullDesc:     fullDesc?.trim() || '',
      category,
      tags:         (tags || []).map(t => t.toLowerCase().trim()).filter(Boolean),
      version:      '1.0.0',
      flows:        sanitized,
      templateVars,
      status:       'approved'
    });

    return entry;
  }

  /**
   * Edita apenas os metadados de uma entrada (nome, descrição, categoria, tags).
   * Não altera os fluxos nem a versão — use publishUpdate para isso.
   *
   * @param {string} libId
   * @param {string} authorId  — deve ser o mesmo do original
   * @param {object} fields    — campos editáveis
   * @param {string} [fields.name]
   * @param {string} [fields.shortDesc]
   * @param {string} [fields.fullDesc]
   * @param {string} [fields.category]
   * @param {string[]} [fields.tags]
   * @returns {Promise<object>} — documento atualizado
   */
  async editMetadata(libId, authorId, { name, shortDesc, fullDesc, category, tags } = {}) {
    const entry = await LibraryFlowModel.findOne({ libId });
    if (!entry)                        throw new Error('Entrada não encontrada.');
    if (entry.authorId !== authorId)   throw new Error('Sem permissão.');

    const VALID_CATEGORIES = [
      'Moderação','Economia','Automação','Logs','Tickets',
      'Recompensas','Eventos','RPG','Utilidade','Comunidade',
      'Diversão','Outros'
    ];

    if (name)      entry.name      = name.trim().slice(0, 100);
    if (shortDesc !== undefined) entry.shortDesc = shortDesc.trim().slice(0, 150);
    if (fullDesc  !== undefined) entry.fullDesc  = fullDesc.trim().slice(0, 2000);
    if (category && VALID_CATEGORIES.includes(category)) entry.category = category;
    if (tags)      entry.tags      = tags.map(t => t.toLowerCase().trim()).filter(Boolean);

    entry.updatedAt = new Date();
    await entry.save();

    return entry.toObject();
  }

  /**
   * Atualiza os fluxos de uma entrada existente, incrementando a versão.
   * Notifica todos os instaladores sobre a nova versão disponível.
   *
   * @param {object} opts
   * @param {string}   opts.libId
   * @param {string}   opts.authorId    — deve ser o mesmo do original
   * @param {string[]} opts.flowIds     — IDs dos fluxos atualizados no guild
   * @param {string}   opts.guildId     — guild de origem
   * @param {string}   opts.newVersion  — ex: '2.0.0'
   * @param {string}   [opts.changelog] — resumo das mudanças
   * @returns {Promise<object>} — documento atualizado
   */
  async publishUpdate({ libId, authorId, flowIds, guildId, newVersion, changelog = '' }) {
    const entry = await LibraryFlowModel.findOne({ libId });
    if (!entry)                       throw new Error('Entrada não encontrada.');
    if (entry.authorId !== authorId)  throw new Error('Sem permissão.');
    if (!this._isNewerVersion(entry.version, newVersion)) {
      throw new Error(`A versão ${newVersion} deve ser maior que a atual (${entry.version}).`);
    }

    const { FlowModel } = require('../../../Mongodb/flow.js');
    const flows = await FlowModel.find({ guildId, flowId: { $in: flowIds } }).lean();

    if (!flows.length) throw new Error('Nenhum fluxo encontrado para publicar.');

    const sanitized    = flows.map(f => this._sanitizeFlow(f));
    const templateVars = this._extractTemplateVars(sanitized);

    // Guarda snapshot da versão anterior no histórico
    entry.versionHistory = entry.versionHistory || [];
    entry.versionHistory.push({
      version:   entry.version,
      changelog: entry.lastChangelog || '',
      archivedAt: new Date()
    });

    entry.flows         = sanitized;
    entry.templateVars  = templateVars;
    entry.version       = newVersion;
    entry.lastChangelog = changelog;
    entry.updatedAt     = new Date();
    await entry.save();

    // Notifica instaladores de forma assíncrona (não bloqueia o retorno)
    this._notifyUpdate(libId, entry.name, newVersion, changelog).catch(() => {});

    return entry.toObject();
  }

  /**
   * Exclui permanentemente uma entrada da biblioteca.
   * Apenas o autor pode excluir. Moderadores usam moderate('rejected').
   *
   * @param {string} libId
   * @param {string} authorId
   */
  async delete(libId, authorId) {
    const entry = await LibraryFlowModel.findOne({ libId });
    if (!entry)                       throw new Error('Entrada não encontrada.');
    if (entry.authorId !== authorId)  throw new Error('Sem permissão.');

    await this._deleteEntry(libId);
  }

  /**
   * Lista todas as entradas publicadas por um autor,
   * com status, versão e stats resumidos.
   *
   * @param {string} authorId
   * @returns {Promise<object[]>}
   */
  async getMyPublications(authorId) {
    const entries = await LibraryFlowModel
      .find({ authorId })
      .sort({ publishedAt: -1 })
      .lean();

    return entries.map(e => ({
      libId:       e.libId,
      name:        e.name,
      shortDesc:   e.shortDesc,
      category:    e.category,
      tags:        e.tags,
      version:     e.version,
      status:      e.status,
      lastChangelog: e.lastChangelog || '',
      versionHistory: (e.versionHistory || []).slice(-5), // últimas 5 versões
      stats: {
        installs:  e.stats.installs,
        likes:     e.stats.likes,
        dislikes:  e.stats.dislikes,
        avgRating: e.stats.avgRating
      },
      publishedAt: e.publishedAt,
      updatedAt:   e.updatedAt
    }));
  }

  /* ═══════════════════════════════════════════
     BUSCA / LISTAGEM
     ═══════════════════════════════════════════ */

  /**
   * Pesquisa fluxos na biblioteca com filtros e paginação.
   *
   * @param {object} opts
   * @param {string}  [opts.query]    — texto livre (nome ou descrição)
   * @param {string}  [opts.category]
   * @param {string}  [opts.tag]
   * @param {string}  [opts.authorId]
   * @param {string}  [opts.sort]     — 'installs' | 'rating' | 'recent' | 'trending'
   * @param {number}  [opts.page]     — 0-based
   * @param {number}  [opts.limit]    — padrão 10
   * @returns {Promise<{ results: object[], total: number, pages: number }>}
   */
  async search({ query, category, tag, authorId, sort = 'installs', page = 0, limit = 10 } = {}) {
    const filter = { status: 'approved' };

    if (query) {
      filter.$or = [
        { name:      { $regex: query, $options: 'i' } },
        { shortDesc: { $regex: query, $options: 'i' } },
        { tags:      { $regex: query, $options: 'i' } }
      ];
    }

    if (category) filter.category = category;
    if (tag)      filter.tags     = tag.toLowerCase();
    if (authorId) filter.authorId = authorId;

    const sortMap = {
      installs:  { 'stats.installs':    -1 },
      rating:    { 'stats.avgRating':   -1, 'stats.ratingCount': -1 },
      recent:    { publishedAt:          -1 },
      trending:  { 'stats.weeklyScore': -1 }
    };

    const sortObj = sortMap[sort] || sortMap.installs;
    const total   = await LibraryFlowModel.countDocuments(filter);
    const results = await LibraryFlowModel
      .find(filter)
      .sort(sortObj)
      .skip(page * limit)
      .limit(limit)
      .lean();

    return {
      results,
      total,
      pages: Math.ceil(total / limit),
      page
    };
  }

  /**
   * Busca uma entrada específica pelo libId.
   */
  async getById(libId) {
    return LibraryFlowModel.findOne({ libId, status: 'approved' }).lean();
  }

  /**
   * Destaques da semana — retorna top 5 de cada categoria.
   */
  async getHighlights() {
    const [trending, topInstalls, topRated, recent] = await Promise.all([
      LibraryFlowModel.find({ status: 'approved' }).sort({ 'stats.weeklyScore': -1 }).limit(5).lean(),
      LibraryFlowModel.find({ status: 'approved' }).sort({ 'stats.installs':    -1 }).limit(5).lean(),
      LibraryFlowModel.find({ status: 'approved', 'stats.ratingCount': { $gte: 3 } })
        .sort({ 'stats.avgRating': -1 }).limit(5).lean(),
      LibraryFlowModel.find({ status: 'approved' }).sort({ publishedAt: -1 }).limit(5).lean()
    ]);

    return { trending, topInstalls, topRated, recent };
  }

  /* ═══════════════════════════════════════════
     INSTALAÇÃO
     ═══════════════════════════════════════════ */

  /**
   * Instala uma entrada da biblioteca em um guild.
   * Substitui as templateVars pelos valores fornecidos.
   *
   * @param {object} opts
   * @param {string}  opts.libId
   * @param {string}  opts.guildId
   * @param {string}  opts.userId       — quem instalou
   * @param {object}  opts.varValues    — { canal_logs: '123456', cargo_xp: '789' }
   * @returns {Promise<string[]>} — flowIds criados no guild
   */
  async install({ libId, guildId, userId, varValues = {} }) {
    const entry = await LibraryFlowModel.findOne({ libId, status: 'approved' });
    if (!entry) throw new Error('Entrada não encontrada na biblioteca.');

    // Clona os fluxos e substitui as templateVars
    const cloned = this._applyTemplateVars(entry.flows, varValues);

    const createdIds = [];

    for (const flowData of cloned) {
      const flow = await this.client.logicEngine.createFlow({
        ...flowData,
        guildId,
        name:        `${flowData.name}`,
        description: flowData.description
          ? `${flowData.description}\n\n_Instalado da biblioteca: ${entry.name} v${entry.version}_`
          : `_Instalado da biblioteca: ${entry.name} v${entry.version}_`,
        createdBy:   userId
      });
      createdIds.push(flow.flowId);
    }

    // Registra a instalação
    await LibraryInstallModel.findOneAndUpdate(
      { libId, guildId },
      { libId, guildId, installedBy: userId, flowIds: createdIds, version: entry.version, installedAt: new Date() },
      { upsert: true }
    );

    // Atualiza estatísticas
    await LibraryFlowModel.updateOne({ libId }, {
      $inc: {
        'stats.installs':    1,
        'stats.weeklyScore': 5   // cada instalação vale 5 pontos de tendência
      }
    });

    return createdIds;
  }

  /**
   * Verifica se um guild tem uma atualização disponível para uma entrada instalada.
   */
  async checkUpdate(libId, guildId) {
    const [entry, install] = await Promise.all([
      LibraryFlowModel.findOne({ libId }).lean(),
      LibraryInstallModel.findOne({ libId, guildId }).lean()
    ]);

    if (!entry || !install) return null;
    if (entry.version === install.version) return null;

    return { currentVersion: install.version, newVersion: entry.version };
  }

  /* ═══════════════════════════════════════════
     AVALIAÇÕES
     ═══════════════════════════════════════════ */

  /**
   * Registra um like ou dislike.
   * Cada usuário só pode votar uma vez por entrada.
   *
   * @param {string} libId
   * @param {string} userId
   * @param {'like'|'dislike'} vote
   */
  async vote(libId, userId, vote) {
    const existing = await LibraryRatingModel.findOne({ libId, userId });

    if (existing?.vote === vote) {
      // Remove o voto (toggle)
      await LibraryRatingModel.deleteOne({ libId, userId });
      const field = vote === 'like' ? 'stats.likes' : 'stats.dislikes';
      await LibraryFlowModel.updateOne({ libId }, { $inc: { [field]: -1 } });
      return { action: 'removed', vote };
    }

    if (existing) {
      // Troca o voto
      const oldField = existing.vote === 'like' ? 'stats.likes' : 'stats.dislikes';
      const newField = vote === 'like' ? 'stats.likes' : 'stats.dislikes';
      await LibraryRatingModel.updateOne({ libId, userId }, { vote });
      await LibraryFlowModel.updateOne({ libId }, {
        $inc: { [oldField]: -1, [newField]: 1 }
      });
      return { action: 'changed', vote };
    }

    // Novo voto
    await LibraryRatingModel.create({ libId, userId, vote });
    const field = vote === 'like' ? 'stats.likes' : 'stats.dislikes';
    const scoreInc = vote === 'like' ? 2 : 0;
    await LibraryFlowModel.updateOne({ libId }, {
      $inc: { [field]: 1, 'stats.weeklyScore': scoreInc }
    });
    return { action: 'added', vote };
  }

  /**
   * Registra uma avaliação por estrelas (1–5).
   */
  async rate(libId, userId, rating) {
    if (rating < 1 || rating > 5) throw new Error('Avaliação deve ser entre 1 e 5.');

    const existing = await LibraryRatingModel.findOne({ libId, userId });

    if (existing) {
      existing.rating = rating;
      await existing.save();
    } else {
      await LibraryRatingModel.create({ libId, userId, rating });
    }

    // Recalcula a média
    const all = await LibraryRatingModel.find({ libId, rating: { $ne: null } }).lean();
    const avg = all.reduce((acc, r) => acc + r.rating, 0) / all.length;

    await LibraryFlowModel.updateOne({ libId }, {
      $set: {
        'stats.avgRating':   Math.round(avg * 10) / 10,
        'stats.ratingCount': all.length
      }
    });

    return { avg: Math.round(avg * 10) / 10, count: all.length };
  }

  /**
   * Retorna o voto/rating de um usuário em uma entrada.
   */
  async getUserRating(libId, userId) {
    return LibraryRatingModel.findOne({ libId, userId }).lean();
  }

  /* ═══════════════════════════════════════════
     PERFIL DE CRIADOR
     ═══════════════════════════════════════════ */

  /**
   * Retorna o perfil público de um criador com suas estatísticas agregadas.
   */
  async getCreatorProfile(authorId) {
    const [profile, entries] = await Promise.all([
      CreatorProfileModel.findOne({ userId: authorId }).lean(),
      LibraryFlowModel.find({ authorId, status: 'approved' }).lean()
    ]);

    const totalInstalls = entries.reduce((acc, e) => acc + (e.stats?.installs || 0), 0);
    const totalLikes    = entries.reduce((acc, e) => acc + (e.stats?.likes    || 0), 0);
    const ratings       = entries.filter(e => e.stats?.ratingCount > 0);
    const avgRating     = ratings.length
      ? ratings.reduce((acc, e) => acc + e.stats.avgRating, 0) / ratings.length
      : 0;

    return {
      userId:       authorId,
      username:     profile?.username || '',
      bio:          profile?.bio || '',
      followers:    profile?.followers?.length || 0,
      following:    profile?.following?.length || 0,
      publishedAt:  profile?.publishedAt,
      stats: {
        totalFlows:    entries.length,
        totalInstalls,
        totalLikes,
        avgRating:     Math.round(avgRating * 10) / 10
      },
      entries: entries.map(e => ({
        libId:    e.libId,
        name:     e.name,
        category: e.category,
        version:  e.version,
        installs: e.stats.installs,
        rating:   e.stats.avgRating
      }))
    };
  }

  /**
   * Atualiza o perfil do criador (username, bio).
   */
  async updateProfile(userId, { username, bio }) {
    return CreatorProfileModel.findOneAndUpdate(
      { userId },
      { username, bio, userId },
      { upsert: true, new: true }
    );
  }

  /* ═══════════════════════════════════════════
     SEGUIDORES
     ═══════════════════════════════════════════ */

  /**
   * Segue ou deixa de seguir um criador.
   * Retorna { action: 'followed' | 'unfollowed' }.
   */
  async toggleFollow(followerId, targetId) {
    if (followerId === targetId) throw new Error('Você não pode se seguir.');

    const [follower, target] = await Promise.all([
      this._ensureProfile(followerId),
      this._ensureProfile(targetId)
    ]);

    const isFollowing = follower.following.includes(targetId);

    if (isFollowing) {
      await CreatorProfileModel.updateOne({ userId: followerId }, { $pull: { following: targetId } });
      await CreatorProfileModel.updateOne({ userId: targetId  }, { $pull: { followers: followerId } });
      return { action: 'unfollowed' };
    }

    await CreatorProfileModel.updateOne({ userId: followerId }, { $addToSet: { following: targetId } });
    await CreatorProfileModel.updateOne({ userId: targetId  }, { $addToSet: { followers: followerId } });
    return { action: 'followed' };
  }

  /**
   * Retorna os seguidores de um criador como array de userIds.
   */
  async getFollowers(userId) {
    const profile = await CreatorProfileModel.findOne({ userId }).lean();
    return profile?.followers || [];
  }

  /* ═══════════════════════════════════════════
     EXCLUSÃO / MODERAÇÃO
     ═══════════════════════════════════════════ */

  /**
   * Aprova ou rejeita uma entrada (moderação).
   * Moderadores podem também excluir via moderate('rejected') + remove manual,
   * ou usar deleteByModerator() abaixo.
   */
  async moderate(libId, status) {
    if (!['approved', 'rejected'].includes(status)) throw new Error('Status inválido.');
    return LibraryFlowModel.findOneAndUpdate(
      { libId },
      { status, updatedAt: new Date() },
      { new: true }
    );
  }

  /**
   * Exclusão forçada por moderador (remove todos os dados relacionados).
   */
  async deleteByModerator(libId) {
    const entry = await LibraryFlowModel.findOne({ libId });
    if (!entry) throw new Error('Entrada não encontrada.');
    await this._deleteEntry(libId);
  }

  /* ═══════════════════════════════════════════
     HELPERS INTERNOS
     ═══════════════════════════════════════════ */

  /**
   * Remove campos específicos do guild antes de exportar o fluxo.
   */
  _sanitizeFlow(flow) {
    const clean = { ...flow };

    // remove campos de identidade do guild de origem
    delete clean._id;
    delete clean.__v;
    delete clean.guildId;
    delete clean.cooldownMap;
    delete clean.stats;
    delete clean.createdAt;
    delete clean.updatedAt;
    delete clean.createdBy;

    // mantém flowId como referência original, mas será recriado na instalação
    delete clean.flowId;

    return clean;
  }

  /**
   * Remove todos os dados relacionados a uma entrada (fluxo, ratings, instalações).
   */
  async _deleteEntry(libId) {
    await Promise.all([
      LibraryFlowModel.deleteOne({ libId }),
      LibraryRatingModel.deleteMany({ libId }),
      LibraryInstallModel.deleteMany({ libId })
    ]);
  }

  /**
   * Verifica se newVersion é estritamente maior que currentVersion.
   * Segue semver simples: MAJOR.MINOR.PATCH
   */
  _isNewerVersion(current, next) {
    const parse = v => v.split('.').map(Number);
    const [cMaj, cMin, cPat] = parse(current);
    const [nMaj, nMin, nPat] = parse(next);

    if (nMaj !== cMaj) return nMaj > cMaj;
    if (nMin !== cMin) return nMin > cMin;
    return nPat > cPat;
  }

  /**
   * variáveis de sistema, retornando a lista de templateVars detectadas.
   */
  _extractTemplateVars(flows) {
    const found = new Set();
    const regex = /\{([a-z_][a-z0-9_]*)\}/g;

    for (const flow of flows) {
      const str = JSON.stringify(flow.actions || []);
      for (const [, name] of str.matchAll(regex)) {
        if (!this._systemVarNames.has(name)) found.add(name);
      }
    }

    return [...found];
  }

  /**
   * Clona os fluxos substituindo cada {templateVar} pelo valor fornecido.
   */
  _applyTemplateVars(flows, varValues) {
    let str = JSON.stringify(flows);

    for (const [key, value] of Object.entries(varValues)) {
      // substitui tanto {canal_logs} como outros formatos comuns
      str = str.replaceAll(`{${key}}`, value ?? '');
    }

    return JSON.parse(str);
  }

  /**
   * Garante que o perfil de criador existe, criando um vazio se necessário.
   */
  async _ensureProfile(userId) {
    let profile = await CreatorProfileModel.findOne({ userId });
    if (!profile) {
      profile = await CreatorProfileModel.create({ userId });
    }
    return profile;
  }

  /**
   * Notifica (via DM ou canal) os instaladores de uma entrada sobre uma nova versão.
   * Usa o canal de cada guild que instalou, se disponível.
   */
  async _notifyUpdate(libId, entryName, newVersion, changelog = '') {
    const installs = await LibraryInstallModel.find({ libId }).lean();

    for (const install of installs) {
      try {
        // Tenta notificar o usuário que instalou via DM
        const dm = await DiscordRequest('/users/@me/channels', {
          method: 'POST',
          body:   { recipient_id: install.installedBy }
        });

        if (!dm?.id) continue;

        await DiscordRequest(`/channels/${dm.id}/messages`, {
          method: 'POST',
          body: {
            embeds: [{
              title:       '🔄 Atualização disponível',
              description: `O sistema **${entryName}** foi atualizado para **v${newVersion}**.\nAcesse a biblioteca para instalar a nova versão.`
                + (changelog ? `\n\n📋 **Novidades:** ${changelog}` : ''),
              color:       0xFEE75C,
              footer:      { text: `Logic Builder • Biblioteca de Fluxos` },
              timestamp:   new Date().toISOString()
            }]
          }
        });
      } catch {
        // falha silenciosa — DMs podem estar fechadas
      }
    }
  }

  /**
   * Decaimento semanal do weeklyScore para manter a tendência relevante.
   * Roda todo domingo à meia-noite (ou na inicialização + intervalo).
   */
  _startWeeklyDecay() {
    const MS_IN_WEEK = 7 * 24 * 60 * 60 * 1000;

    const decay = async () => {
      try {
        // Reduz o score semanal em 50% a cada semana
        const entries = await LibraryFlowModel.find({ 'stats.weeklyScore': { $gt: 0 } });
        for (const entry of entries) {
          entry.stats.weeklyScore = Math.floor(entry.stats.weeklyScore * 0.5);
          await entry.save();
        }
      } catch (err) {
        console.error('[LibraryManager] Erro no decaimento semanal:', err);
      }
    };

    // Primeira execução: aguarda 1 minuto para o DB estabilizar, depois roda semanalmente
    setTimeout(() => {
      decay();
      this._decayInterval = setInterval(decay, MS_IN_WEEK);
    }, 60_000);
  }
}

/* ═══════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════ */

module.exports = LibraryManager;