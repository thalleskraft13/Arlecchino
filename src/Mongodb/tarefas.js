const { Schema, model } = require("mongoose");

const taskSchema = new Schema({
  taskId: { type: String, required: true, unique: true },
  tipo: { type: String, required: true },
  executeAt: { type: Date, required: true },
  dados: { type: Object, default: {} },
  repeat: { type: Boolean, default: false },
  repeatDelay: { type: Number, default: null },
  status: {
    type: String,
    enum: ["pending", "executed", "cancelled"],
    default: "pending"
  }
}, { timestamps: true });

module.exports = model("Task-Canary", taskSchema);