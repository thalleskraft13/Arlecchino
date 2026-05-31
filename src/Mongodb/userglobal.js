const { Schema, model } = require("mongoose");

const userSchema = new Schema({

  userId: {
    type: String,
    required: true,
    unique: true
  },
  
  uidGenshin: {
    type:Number,
    default: 0
  },
  
  dmNotificacoes: { type: Boolean,default: false },
  
  server: {
    type: String,
    default: ""
  },

  premium: {
    type: Number,
    default: 0
  },
  
  premium_guild_limit: {
  type: Number,
  default: 1
},

premium_guilds: {
  type: [{
    guildId: String,
    expireAt: Number
  }],
  default: []
},

  primogemas: {

    atm: {
      type: Number,
      default: 0
    },

    transacoes: {
  type: Array,
  default: []
},

    daily_tempo: {
      type: Number,
      default: 0
    },


    bannerlimitado: {
      garantidot5: { type: Boolean, default: false },
      garantidot4: { type: Boolean, default: false },
      pityt5: { type: Number, default: 0 },
      pityt4: { type: Number, default: 0 }
    },

    mochileiro: {
      pityt5: { type: Number, default: 0 },
      pityt4: { type: Number, default: 0 }
    }
  },

  personagens: [{
    nome: String,
    raridade: String, // "4⭐" | "5⭐"
    constelacao: {
      type: Number,
      default: 0,
      max: 6
    }
  }],
  
  rankaventureiro: {
    xpTotal: { type: Number,default: 0},
    nivelAtual: { type: Number,default: 0},
    xpRestante: { type: Number,default: 1000},
  },
  
  exploracao: {
    mondstadt: { 
      tempo: { type: Number,default: 0 },
      coletar: { type: Number, default: 0 }
     }
  }

});

module.exports = model("User Global-Canary", userSchema);