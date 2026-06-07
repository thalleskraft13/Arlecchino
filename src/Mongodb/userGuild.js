'use strict';

const { Schema, model } = require("mongoose");

/* ─────────────────────────────────────────────
   USER GUILD SCHEMA
   Dados por usuário por servidor
   ───────────────────────────────────────────── */

const UserGuild = new Schema({
  userId:  { type: String, required: true },
  guildId: { type: String, required: true },

  /* ── ANIVERSÁRIO ── */
  birthday: {
    day:   { type: Number, default: null },   // 1–31
    month: { type: Number, default: null },   // 1–12
    year:  { type: Number, default: null },   // opcional — para calcular idade
    set:   { type: Boolean, default: false }  // já cadastrou?
  }
});

/* Índice composto — busca rápida por guild + usuário */
UserGuild.index({ guildId: 1, userId: 1 }, { unique: true });

/* Índice para a varredura diária de aniversariantes */
UserGuild.index({ "birthday.day": 1, "birthday.month": 1 });

module.exports = model("UserGuild-Canary", UserGuild);
