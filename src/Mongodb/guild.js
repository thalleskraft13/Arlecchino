'use strict';

const { Schema, model } = require("mongoose");

/* ─────────────────────────────────────────────
   SUB-SCHEMAS
   ───────────────────────────────────────────── */

const birthdayConfigSchema = new Schema({
  ativado:      { type: Boolean, default: false },
  channel:      { type: String,  default: "0" },
  ping:         { type: String,  default: "0" },
  birthdayRole: { type: String,  default: "0" },
  birthdayThread: { type: Boolean, default: false },
  webhook:      { type: Boolean, default: false },
  webhookName:   { type: String, default: null },
  webhookAvatar: { type: String, default: null },
  pinMessage:   { type: Boolean, default: false },
  _pinMsgId:    { type: String,  default: null },
  hour:         { type: Number,  default: 8  },
  minute:       { type: Number,  default: 0  },
  messageText:  { type: String,  default: "🎂 Hoje é o aniversário de {user}! Parabéns! 🎉" }
}, { _id: false });

const modalFieldSchema = new Schema({
  label:       String,
  customId:    String,
  style:       Number,
  required:    Boolean,
  placeholder: String,
  minLength:   Number,
  maxLength:   Number
}, { _id: false });

const modalConfigSchema = new Schema({
  enabled:      { type: Boolean, default: false },
  title:        { type: String,  default: "Formulário do Ticket" },
  sendMode:     { type: Number,  default: 0 },   // 0 = ticket | 1 = canal log
  logChannelId: { type: String,  default: null },
  fields:       { type: [modalFieldSchema], default: [] }
}, { _id: false });

/* ── CARGO AUTOMÁTICO ── */

const autoRoleEntrySchema = new Schema({
  roleId: { type: String, required: true },

  /**
   * tipo:
   *   0 = permanente  – adiciona ao abrir, nunca remove automaticamente
   *   1 = temporário  – adiciona ao abrir, remove após `duration` ms
   *   2 = vinculado   – adiciona ao abrir, remove quando TODOS os tickets
   *                     do usuário que usam esse cargo forem fechados
   */
  tipo: { type: Number, enum: [0, 1, 2], default: 0 },

  /** Duração em ms — obrigatório quando tipo === 1 */
  duration: { type: Number, default: null }
}, { _id: false });

const autoRoleConfigSchema = new Schema({
  enabled: { type: Boolean, default: false },
  roles:   { type: [autoRoleEntrySchema], default: [] }
}, { _id: false });

/* ── PERGUNTAS SEQUENCIAIS ── */

const seqQuestionSchema = new Schema({
  id:          { type: String, required: true },  // identificador único
  label:       { type: String, required: true },  // texto da pergunta
  tipo:        { type: String, default: "text" }, // text | number | attachment | select | yesno
  required:    { type: Boolean, default: true },
  placeholder: { type: String, default: "" },
  options:     { type: [String], default: [] },   // para tipo select
  maxLength:   { type: Number, default: 2000 }
}, { _id: false });

const seqQuestionsConfigSchema = new Schema({
  enabled:      { type: Boolean, default: false },
  sendMode:     { type: Number,  default: 0 },    // 0 = no ticket | 1 = canal log
  logChannelId: { type: String,  default: null },
  timeout:      { type: Number,  default: 120_000 }, // ms para cada resposta
  questions:    { type: [seqQuestionSchema], default: [] }
}, { _id: false });

/* ── TRANSCRIPT ── */

const transcriptConfigSchema = new Schema({
  enabled:      { type: Boolean, default: false },
  channelId:    { type: String,  default: null },
  format:       { type: String,  default: "html", enum: ["html", "txt"] },
  sendToUser:   { type: Boolean, default: false }
}, { _id: false });

/* ── SELECT MENU HUB ── */

const selectMenuOptionSchema = new Schema({
  label:       { type: String, required: true },
  description: { type: String, default: "" },
  emoji:       { type: String, default: null },
  panelId:     { type: String, required: true }  // aponta para outro panelId
}, { _id: false });

const selectMenuConfigSchema = new Schema({
  enabled:     { type: Boolean, default: false },
  placeholder: { type: String,  default: "Selecione o tipo de atendimento" },
  options:     { type: [selectMenuOptionSchema], default: [] }
}, { _id: false });

/* ── PAINEL PRINCIPAL ── */

const ticketSchema = new Schema({
  panelId:      { type: String, required: true },
  categoriaId:  { type: String, default: null },
  canalId:      { type: String, default: null },
  painelPrincipal: { type: Object, default: null },
  cargosStaff:  { type: [String], default: [] },
  ticketChatName: { type: String, default: null },
  contadorTicket: { type: Number, default: 0 },
  tipoDeCriacao: {
    type:    Number,
    enum:    [0, 1, 2],
    default: 0
  },

  /* Funcionalidades existentes */
  modalConfig: { type: modalConfigSchema, default: () => ({}) },

  /* Novas funcionalidades */
  autoRoleConfig:     { type: autoRoleConfigSchema,     default: () => ({}) },
  seqQuestionsConfig: { type: seqQuestionsConfigSchema, default: () => ({}) },
  transcriptConfig:   { type: transcriptConfigSchema,   default: () => ({}) },
  selectMenuConfig:   { type: selectMenuConfigSchema,   default: () => ({}) }

}, { _id: false });

/* ─────────────────────────────────────────────
   CARGOS TEMPORÁRIOS PENDENTES
   Rastreados em coleção separada para persistência entre restarts
   ───────────────────────────────────────────── */

const pendingTempRoleSchema = new Schema({
  guildId:   { type: String, required: true },
  userId:    { type: String, required: true },
  roleId:    { type: String, required: true },
  panelId:   { type: String, required: true },
  ticketId:  { type: String, required: true },  // channel/thread ID
  removeAt:  { type: Number, required: true },  // timestamp ms
  removed:   { type: Boolean, default: false }
});

/* ─────────────────────────────────────────────
   CARGOS VINCULADOS ATIVOS
   Rastreia quais tickets estão mantendo um cargo vinculado ativo
   ───────────────────────────────────────────── */

const activeLinkedRoleSchema = new Schema({
  guildId:  { type: String, required: true },
  userId:   { type: String, required: true },
  roleId:   { type: String, required: true },
  panelId:  { type: String, required: true },
  ticketId: { type: String, required: true }   // channel/thread ID
});

/* ─────────────────────────────────────────────
   GUILD SCHEMA PRINCIPAL
   ───────────────────────────────────────────── */

const guildSchema = new Schema({
  guildId:     { type: String, required: true, unique: true },
  premiumUser: { type: String, default: "0" },
  premiumTime: { type: Number, default: 0 },
  ticket:      { type: [ticketSchema], default: [] },

  uidSend: {
    ativado: { type: Boolean, default: false },
    webhook: { type: Boolean, default: false },
    channel: { type: String,  default: "0" }
  },

  starboard: {
    chat:   { type: String,  default: "0" },
    emoji:  { type: String,  default: "⭐" },
    salvar: { type: Boolean, default: true }
  },

  genshinAnuncios: {
    vazamentos: {
      chat: { type: String, default: "0" },
      ping: { type: String, default: "0" }
    }
  },
  
  birthdayConfig: { type: birthdayConfigSchema, default: () => ({}) },
  
  webhooks: {
  componentsV2: {
    enabled: { type: Boolean, default: false },
    items: {
      type: [{
        channelId: String,
        webhookId: String,
        webhookToken: String,
        url: String,
        createdAt: Number
      }],
      default: []
    }
  }
}
});

/* ─────────────────────────────────────────────
   EXPORTS
   ───────────────────────────────────────────── */

const GuildModel            = model("Guild-Canary",      guildSchema);
const PendingTempRoleModel  = model("PendingTempRole",   pendingTempRoleSchema);
const ActiveLinkedRoleModel = model("ActiveLinkedRole",  activeLinkedRoleSchema);

module.exports = {
  GuildDb: GuildModel,
  PendingTempRoleModel,
  ActiveLinkedRoleModel
};

