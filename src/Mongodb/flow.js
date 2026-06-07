'use strict';

const { Schema, model } = require('mongoose');


const libraryFlowSchema = new Schema({
  libId:        { type: String, required: true, unique: true },
  authorId:     { type: String, required: true },   // userId Discord
  authorName:   { type: String, default: '' },

  name:         { type: String, required: true },
  shortDesc:    { type: String, default: '', maxlength: 150 },
  fullDesc:     { type: String, default: '', maxlength: 2000 },

  category: {
    type: String,
    enum: [
      'Moderação','Economia','Automação','Logs','Tickets',
      'Recompensas','Eventos','RPG','Utilidade','Comunidade',
      'Diversão','Outros'
    ],
    default: 'Outros'
  },

  tags:    { type: [String], default: [] },
  version: { type: String, default: '1.0.0' },

  // Snapshot dos fluxos (sem guildId — neutros para instalação)
  flows: { type: [Schema.Types.Mixed], default: [] },

  // Variáveis de template detectadas automaticamente
  // Ex: ['canal_logs', 'cargo_xp', 'canal_boas_vindas']
  templateVars: { type: [String], default: [] },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'   // aprovação automática por padrão; mude para 'pending' se quiser moderação
  },

  stats: {
    installs:     { type: Number, default: 0 },
    likes:        { type: Number, default: 0 },
    dislikes:     { type: Number, default: 0 },
    avgRating:    { type: Number, default: 0 },
    ratingCount:  { type: Number, default: 0 },
    weeklyScore:  { type: Number, default: 0 }  // decai semanalmente
  },

  publishedAt: { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },

  // Changelog da última versão
  lastChangelog: { type: String, default: '' },

  // Histórico de versões anteriores (últimas 10)
  versionHistory: {
    type: [{
      version:    { type: String },
      changelog:  { type: String, default: '' },
      archivedAt: { type: Date }
    }],
    default: []
  }
});

libraryFlowSchema.index({ 'stats.installs': -1 });
libraryFlowSchema.index({ 'stats.avgRating': -1 });
libraryFlowSchema.index({ 'stats.weeklyScore': -1 });
libraryFlowSchema.index({ category: 1, status: 1 });
libraryFlowSchema.index({ tags: 1, status: 1 });

// ── Avaliações individuais ──────────────────────────────────
const libraryRatingSchema = new Schema({
  libId:   { type: String, required: true },
  userId:  { type: String, required: true },
  rating:  { type: Number, min: 1, max: 5, default: null },
  vote:    { type: String, enum: ['like', 'dislike'], default: null }
});
libraryRatingSchema.index({ libId: 1, userId: 1 }, { unique: true });

// ── Perfil de criador ───────────────────────────────────────
const creatorProfileSchema = new Schema({
  userId:      { type: String, required: true, unique: true },
  username:    { type: String, default: '' },
  bio:         { type: String, default: '', maxlength: 300 },
  followers:   { type: [String], default: [] },   // userIds que seguem
  following:   { type: [String], default: [] },   // userIds que este segue
  publishedAt: { type: Date, default: Date.now }
});

// ── Instalações (histórico por guild) ──────────────────────
const libraryInstallSchema = new Schema({
  libId:       { type: String, required: true },
  guildId:     { type: String, required: true },
  installedBy: { type: String, required: true },   // userId
  flowIds:     { type: [String], default: [] },    // IDs criados no guild
  version:     { type: String, default: '1.0.0' },
  installedAt: { type: Date, default: Date.now }
});
libraryInstallSchema.index({ libId: 1, guildId: 1 });




/* ═══════════════════════════════════════════════════════════
   CONDITION SCHEMA
   ═══════════════════════════════════════════════════════════ */

const conditionSchema = new Schema({
  // Identificador único da condição dentro do fluxo
  id: { type: String, required: true },

  // Tipo de condição — agrupa o conjunto de checks disponíveis
  // Ex: "user", "channel", "message", "economy", "variable",
  //     "probability", "date", "time", "permission", "inventory", "command"
  category: { type: String, required: true },

  // Operação específica dentro da categoria
  // Ex: "has_role", "is_bot", "contains_text", "balance_gt", "chance"
  type: { type: String, required: true },

  // Parâmetros da condição — estrutura varia por tipo
  // Ex: { roleId: "123" } | { text: "olá" } | { percent: 30 }
  params: { type: Schema.Types.Mixed, default: {} },

  // Operador lógico com a condição anterior ("AND" | "OR")
  // A primeira condição do array ignora este campo
  operator: { type: String, enum: ['AND', 'OR'], default: 'AND' },

  // Negar o resultado desta condição
  negate: { type: Boolean, default: false }

}, { _id: false });

/* ═══════════════════════════════════════════════════════════
   ACTION SCHEMA
   ═══════════════════════════════════════════════════════════ */

const actionSchema = new Schema({
  // Identificador único da ação dentro do fluxo
  id: { type: String, required: true },

  // Categoria da ação
  // Ex: "message", "embed", "user", "economy", "variable",
  //     "inventory", "channel", "voice", "time", "system", "discord", "webhook"
  category: { type: String, required: true },

  // Operação específica
  // Ex: "send_message", "give_role", "add_coins", "wait_seconds", "run_flow"
  type: { type: String, required: true },

  // Parâmetros da ação
  params: { type: Schema.Types.Mixed, default: {} },

  // Ordem de execução dentro do fluxo (menor = primeiro)
  order: { type: Number, default: 0 }

}, { _id: false });

/* ═══════════════════════════════════════════════════════════
   TRIGGER SCHEMA
   ═══════════════════════════════════════════════════════════ */

const triggerSchema = new Schema({
  // Categoria do trigger
  // Ex: "message", "reaction", "member", "role", "channel",
  //     "voice", "component", "form", "command", "time",
  //     "economy", "inventory", "ranking", "event", "system", "internal"
  category: { type: String, required: true },

  // Evento específico dentro da categoria
  // Ex: "message_created", "member_joined", "voice_joined", "button_clicked"
  type: { type: String, required: true },

  // Filtros do trigger — restringe quando ele dispara
  // Ex: { channelId: "123" } | { prefix: "!" } | { roleId: "456" }
  filters: { type: Schema.Types.Mixed, default: {} }

}, { _id: false });

/* ═══════════════════════════════════════════════════════════
   VARIABLE SCHEMA  (variáveis locais do fluxo)
   ═══════════════════════════════════════════════════════════ */

const flowVariableSchema = new Schema({
  name:         { type: String, required: true },
  defaultValue: { type: Schema.Types.Mixed, default: null },
  scope: { type: String, enum: ['flow', 'user'], default: 'flow' },

  // "string" | "number" | "boolean" | "list"
  type:         { type: String, default: 'string' },

  // variáveis persistentes sobrevivem entre execuções do fluxo
  persistent:   { type: Boolean, default: false }

}, { _id: false });

/* ═══════════════════════════════════════════════════════════
   FLOW SCHEMA  (documento principal)
   ═══════════════════════════════════════════════════════════ */

const flowSchema = new Schema({
  flowId:   { type: String, required: true, unique: true },
  guildId:  { type: String, required: true, index: true },

  name:        { type: String, required: true },
  description: { type: String, default: '' },

  enabled:  { type: Boolean, default: true },

  trigger:    { type: triggerSchema,    required: true },
  conditions: { type: [conditionSchema], default: [] },
  actions:    { type: [actionSchema],   default: [] },
  variables:  { type: [flowVariableSchema], default: [] },

  // Controle de execução
  // "sequential" = ações em sequência (padrão)
  // "parallel"   = ações em paralelo (quando não há dependência entre elas)
  executionMode: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },

  // Cooldown global do fluxo em ms (0 = sem cooldown)
  cooldown: { type: Number, default: 0 },

  // Mapa de cooldowns ativos: userId → timestamp de expiração
  // Armazenado como Map serializado
  cooldownMap: { type: Map, of: Number, default: {} },

  // Metadata
  createdBy: { type: String, default: null },
  createdAt: { type: Date,   default: Date.now },
  updatedAt: { type: Date,   default: Date.now },

  // Estatísticas
  stats: {
    totalRuns:   { type: Number, default: 0 },
    successRuns: { type: Number, default: 0 },
    failedRuns:  { type: Number, default: 0 },
    lastRunAt:   { type: Date,   default: null }
  }
});

// Índice composto para busca rápida por guild + trigger
flowSchema.index({ guildId: 1, 'trigger.category': 1, 'trigger.type': 1, enabled: 1 });

/* ═══════════════════════════════════════════════════════════
   CUSTOM COMMAND SCHEMA
   ═══════════════════════════════════════════════════════════ */

const customCommandSchema = new Schema({
  commandId: { type: String, required: true, unique: true },
  guildId:   { type: String, required: true, index: true },

  name:        { type: String, required: true },   // "daily", "pescar", "abrir"
  aliases:     { type: [String], default: [] },
  description: { type: String, default: '' },

  prefix:   { type: String, default: '!' },
  enabled:  { type: Boolean, default: true },

  // ID do fluxo associado a este comando
  flowId: { type: String, required: true },

  // Cooldown em ms por usuário (0 = sem cooldown)
  cooldown: { type: Number, default: 0 },
  cooldownMap: { type: Map, of: Number, default: {} },

  // Permissões mínimas para usar o comando
  // Ex: ["MANAGE_GUILD"] | [] (qualquer um)
  permissions: { type: [String], default: [] },

  // Cargos necessários (OR — qualquer um deles basta)
  requiredRoles: { type: [String], default: [] }
});

customCommandSchema.index({ guildId: 1, name: 1 });
customCommandSchema.index({ guildId: 1, aliases: 1 });

/* ═══════════════════════════════════════════════════════════
   PERSISTENT VARIABLE SCHEMA
   Variáveis de fluxo marcadas como persistent=true ficam aqui
   ═══════════════════════════════════════════════════════════ */

const persistentVarSchema = new Schema({
  guildId: { type: String, required: true },
  flowId:  { type: String, required: true },
  name:    { type: String, required: true },
  value:   { type: Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now }
});

persistentVarSchema.index({ guildId: 1, name: 1 }, { unique: true });

/* ═══════════════════════════════════════════════════════════
   FLOW RUN LOG  (histórico de execuções para debug)
   ═══════════════════════════════════════════════════════════ */

const flowRunLogSchema = new Schema({
  flowId:  { type: String, required: true, index: true },
  guildId: { type: String, required: true },

  // "success" | "failed" | "condition_blocked" | "cooldown_blocked"
  result: { type: String, required: true },

  // Contexto de quem disparou (userId, channelId, messageId, etc.)
  context: { type: Schema.Types.Mixed, default: {} },

  // Detalhes do erro, se houver
  error:    { type: String, default: null },
  duration: { type: Number, default: 0 },  // ms

runAt: { type: Date, default: Date.now }  
});

// TTL: logs expiram automaticamente após 7 dias
flowRunLogSchema.index({ runAt: 1 }, { expireAfterSeconds: 604800 });


const userVarSchema = new Schema({
  guildId: { type: String, required: true },
  userId:  { type: String, required: true },
  flowId:  { type: String, required: true },
  name:    { type: String, required: true },
  value:   { type: Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now }
});

userVarSchema.index({ guildId: 1, userId: 1, flowId: 1, name: 1 }, { unique: true });

const UserVarModel = model('UserVar', userVarSchema);

/* ═══════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════ */



module.exports = {
  FlowModel:          model('Flow',          flowSchema),
  CustomCommandModel: model('CustomCommand', customCommandSchema),
  PersistentVarModel: model('PersistentVar', persistentVarSchema),
  FlowRunLogModel:    model('FlowRunLog',    flowRunLogSchema),
  UserVarModel: model("userVarSchema", userVarSchema),
  LibraryFlowModel:    model('LibraryFlow',    libraryFlowSchema),
  LibraryRatingModel:  model('LibraryRating',  libraryRatingSchema),
  CreatorProfileModel: model('CreatorProfile', creatorProfileSchema),
  LibraryInstallModel: model('LibraryInstall', libraryInstallSchema),
};
