
const { Schema, model } = require("mongoose");

const ticketSchema = new Schema({

  panelId: { type: String, required: true },

  categoriaId: { type: String, default: null },
  canalId: { type: String, default: null },

  painelPrincipal: { type: Object, default: null },

  cargosStaff: { type: [String], default: [] },

  ticketChatName: { type: String, default: null },

  contadorTicket: { type: Number, default: 0 },

  tipoDeCriacao: {
    type: Number,
    enum: [0, 1, 2], // 0 = channel | 1 = thread public | 2 = thread private
    default: 0
  },
  
  modalConfig: {
  enabled: { type: Boolean, default: false },
  title: { type: String, default: "Formulário do Ticket" },
  sendMode: { type: Number, default: 0 }, // 0 = ticket | 1 = canal
  logChannelId: { type: String, default: null },
  fields: {
    type: [{
      label: String,
      customId: String,
      style: Number,
      required: Boolean,
      placeholder: String,
      minLength: Number,
      maxLength: Number
    }],
    default: []
  }
}

}, { _id: false });

const guildSchema = new Schema({

  guildId: { type: String, required: true, unique: true },

  premiumUser: { type: String, default: "0" },
  premiumTime: { type: Number,default: 0 },

  ticket: {
    type: [ticketSchema],
    default: []
  },
  
  uidSend: {
    ativado: { type: Boolean, default: false },
    webhook: { type: Boolean, default: false },
    channel: { type: String,default: "0" }
  },
  
  starboard: {
    chat: { type: String,default: "0"},
    emoji: { type: String,default: "⭐" },
    salvar: { type: Boolean,default: true}
  },
  
  genshinAnuncios: {
    vazamentos: {
      chat: { type: String,default: "0"},
      ping: { type: String,default: "0"}
    },
  }

});

module.exports = model("Guild", guildSchema);