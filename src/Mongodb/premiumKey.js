const { Schema, model } = require("mongoose");

const keySchema = new Schema({

  code: {
    type: String,
    unique: true
  },

  type: {
    type: String,
    enum: ["USER", "GUILD"],
    required: true
  },

  duration: {
    type: Number,
    required: true
  },

  used: {
    type: Boolean,
    default: false
  },

  usedBy: {
    type: String,
    default: null
  },

  usedAt: {
    type: Number,
    default: null
  }

});

module.exports = model("PremiumKey-Canary", keySchema);