const { Schema, model } = require("mongoose");

const userSchema = new Schema({
  userId: { type: String,required: true},
  
  primogemas: { //economy
    atm: { type: Number, default: 0 },
    transacoes: { type: Array, default: []}
  }
});

module.exports = model("User Global", userSchema);