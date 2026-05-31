const mongoose = require('mongoose');

const EmbedsComponentSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    index: true
  },

  guildId: {
    type: String,
    default: null,
    index: true
  },

  messageId: {
    type: String,
    default: null
  },

  channelId: {
    type: String,
    default: null
  },

  type: {
    type: String,
    enum: ['embed', 'components_v2'],
    default: 'embed'
  },

  data: {
    type: Object,
    default: {}
  },

  templateId: {
    type: String,
    default: null,
    unique: true,
    sparse: true,
    index: true
  },

  name: {
    type: String,
    default: null,
    index: true
  },

  description: {
    type: String,
    default: null
  },

  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'private',
    index: true
  },

  tags: {
    type: [String],
    default: [],
    index: true
  },

  likes: {
    type: Number,
    default: 0
  },

  likedBy: {
    type: [String],
    default: []
  },

  uses: {
    type: Number,
    default: 0
  },

  isTemplate: {
    type: Boolean,
    default: false,
    index: true
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model(
  'EmbedsComponent-Canary',
  EmbedsComponentSchema
);