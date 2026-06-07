'use strict';

/**
 * Schema do Grupo de Aventureiros — AdventureGroupModel
 * Arquivo: Mongodb/adventureGroup.js
 */

const { Schema, model } = require('mongoose');

const adventureGroupSchema = new Schema({
  groupId: { type: String, required: true, unique: true },

  // Líder do grupo
  leaderId: { type: String, required: true },

  // Membros (inclui o líder) — max 4
  members: {
    type: [String],
    default: [],
    validate: { validator: v => v.length <= 4, message: 'Grupo cheio (máx 4 membros).' }
  },

  // Convites pendentes (userId → expiresAt)
  pendingInvites: {
    type: [{ userId: String, expiresAt: Number }],
    default: []
  },

  // Missões do grupo (diárias e semanais compartilhadas)
  missions: {
    daily: {
      generatedAt: { type: Number, default: 0 },
      expiresAt:   { type: Number, default: 0 },
      list:        { type: Array,  default: [] }
    },
    weekly: {
      generatedAt: { type: Number, default: 0 },
      expiresAt:   { type: Number, default: 0 },
      list:        { type: Array,  default: [] }
    }
  },

  createdAt: { type: Date, default: Date.now }
});

module.exports = model('AdventureGroup', adventureGroupSchema);
