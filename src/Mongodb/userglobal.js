const { Schema, model } = require("mongoose");

const userSchema = new Schema({

  userId: {
    type: String,
    required: true,
    unique: true
  },

  uidGenshin: {
    type: Number,
    default: 0
  },

  dmNotificacoes: {
    type: Boolean,
    default: false
  },

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
      garantidot5: {
        type: Boolean,
        default: false
      },

      garantidot4: {
        type: Boolean,
        default: false
      },

      pityt5: {
        type: Number,
        default: 0
      },

      pityt4: {
        type: Number,
        default: 0
      }
    },

    mochileiro: {
      pityt5: {
        type: Number,
        default: 0
      },

      pityt4: {
        type: Number,
        default: 0
      }
    }
  },

  personagens: [{
    nome: String,

    raridade: String,

    constelacao: {
      type: Number,
      default: 0,
      max: 6
    },

    nivel: {
      type: Number,
      default: 1
    },

    amizade: {
      type: Number,
      default: 0
    },

    obtidoEm: {
      type: Number,
      default: Date.now
    }
  }],

  times: [{
    nome: {
      type: String,
      default: "Time"
    },

    personagens: {
      type: [String],
      default: []
    }
  }],

  timeAtivo: {
    type: Number,
    default: 0
  },

  arena: {

    pontos: {
      type: Number,
      default: 1000
    },

    vitorias: {
      type: Number,
      default: 0
    },

    derrotas: {
      type: Number,
      default: 0
    },

    maiorSequencia: {
      type: Number,
      default: 0
    }
  },

  batalhas: {

    vencidas: {
      type: Number,
      default: 0
    },

    perdidas: {
      type: Number,
      default: 0
    },

    personagensDerrotados: {
      type: Number,
      default: 0
    },

    danoTotal: {
      type: Number,
      default: 0
    },

    curaTotal: {
      type: Number,
      default: 0
    }
  },

  rankaventureiro: {

    xpTotal: {
      type: Number,
      default: 0
    },

    nivelAtual: {
      type: Number,
      default: 0
    },

    xpRestante: {
      type: Number,
      default: 1000
    }
  },

  exploracao: {

    mondstadt: {

      tempo: {
        type: Number,
        default: 0
      },

      coletar: {
        type: Number,
        default: 0
      }
    }
  },
  
  missions: {
  daily:  { type: Object, default: () => ({}) },
  weekly: { type: Object, default: () => ({}) }
}

});

module.exports = model("User Global-Canary", userSchema);