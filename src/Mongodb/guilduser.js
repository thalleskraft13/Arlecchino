const { Schema, model } = require("mongoose");

const UserGuild = new Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  
  starboard: { type: Number,default: 0},
});

module.exports = model("UserGuild-Canary", UserGuild);