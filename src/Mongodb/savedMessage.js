"use strict";

const mongoose = require("mongoose");

const SavedMessageSchema = new mongoose.Schema(
  {
    guildId  : { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },

    type: {
      type    : String,
      enum    : ["embed", "components_v2"],
      required: true
    },

    content   : { type: String, default: "" },
    embeds    : { type: Array,  default: [] },
    components: { type: Array,  default: [] },

    webhook: {
      id   : { type: String, default: null },
      token: { type: String, default: null }
    },

    webhookProfile: {
      username : { type: String, default: null },
      avatarUrl: { type: String, default: null }
    },

    sendError   : { type: String,  default: null  },
    usedFallback: { type: Boolean, default: false },

    createdBy : { type: String, required: true },
    createdAt : { type: Date, default: Date.now },
    updatedAt : { type: Date, default: Date.now }
  },
  { collection: "saved_messages" }
);

SavedMessageSchema.pre("save", function () {
  this.updatedAt = new Date();
});

const SavedMessageModel =
  mongoose.models.SavedMessage ||
  mongoose.model("SavedMessage", SavedMessageSchema);

module.exports = { SavedMessageModel };
