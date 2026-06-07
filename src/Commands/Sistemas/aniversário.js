'use strict';

module.exports = {

  data: {
    name:        "aniversario",
    description: "Registre seu aniversário neste servidor"
  },

  async execute(interaction, client) {
    await client.birthdayManager.handleButtonRegister(interaction);
  }
};