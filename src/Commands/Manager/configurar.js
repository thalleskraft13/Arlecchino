'use strict';

const getPerm = require("../../function/Utils/GetPerm.js");
const DiscordRequest = require("../../function/DiscordRequest.js");

module.exports = {

  data: {
    name: "configurar",
    description: "Painel de configuração do bot"
  },

  info: {
    perm: ["MANAGE_GUILD"]
  },

  async execute(interaction, client) {

    const perms = await getPerm({
      id: interaction.member.user.id,
      guildId: interaction.guild_id
    });

    if (!perms || !perms.includes("MANAGE_GUILD")) {

      await DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        {
          method: "POST",
          body: {
            type: 4,
            data: {
              content:
                "❌ Você precisa da permissão **Gerenciar Servidor** para usar este comando.",
              flags: 64
            }
          }
        }
      );

      return;
    }

    let guildData = {};

    try {

      guildData = await DiscordRequest(
        `/guilds/${interaction.guild_id}`,
        {
          method: "GET"
        }
      );

    } catch {

      guildData = {};
    }

    const user = interaction.member.user.id;

    const configSelect = client.interactions.createSelect({
      user,

      data: {
        placeholder: "Selecione um sistema para configurar",

        options: [
          {
            label: "Sistema de Tickets",
            description: "Painéis, categorias, staff e automações",
            value: "tickets",
            emoji: {
              name: "🎫"
            }
          },

          {
            label: "Sistema de UID",
            description: "Compartilhamento automático de UID",
            value: "uid",
            emoji: {
              name: "✨"
            }
          },

          {
            label: "Genshin Vazamentos",
            description: "Notícias, anúncios e vazamentos",
            value: "leaks",
            emoji: {
              name: "📰"
            }
          },

/*{
  label:       "Sistema de Aniversários",
  description: "Mensagens automáticas, cargo e botão de registro",
  value:       "birthday",
  emoji: { name: "🎂" }
},*/

          {
            label: "Logic Builder",
            description: "Criação de fluxos e automações",
            value: "logic",
            emoji: {
              name: "⚡"
            }
          }
        ]
      },

      funcao: async (i) => {

        const value = i.data.values?.[0];

        switch (value) {

          case "tickets":
            await client.ticketSystem.deferUpdate(i);
            return client.ticketSystem.startSetup(i);

          case "uid":
            await client.UidManager.deferUpdate(i);
            return client.UidManager.startSetup(i);

          case "leaks":
            await client.GenshinLeaksManager.deferUpdate(i);
            return client.GenshinLeaksManager.startSetup(i);
            
            case "birthday":
  await client.birthdayManager.deferUpdate(i);
  return client.birthdayManager.startSetup(i);

          case "logic":

            if (client.logicUI.ui?.deferUpdate) {
              await client.logicUI.ui.deferUpdate(i);
            } else {
              await client.ticketSystem.deferUpdate(i);
            }

            return client.logicUI.open(i);
        }
      }
    });

    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",

        body: {
          type: 4,

          data: {

            embeds: [
              {
                title:
                  "⚙️ Central de Configuração",

                description:
                  [
                    "Bem-vindo ao painel principal de configuração.",
                    "",
                    "> Escolha um sistema no menu abaixo para começar.",
                    "",
                    "🎫 **Sistema de Tickets**",
                    "Configure painéis, categorias, staff, modais e automações.",
                    "",
                    "📰 **Genshin Vazamentos**",
                    "Receba automaticamente vazamentos, anúncios e notícias do servidor principal.",
                    "Suporte a imagens, vídeos, embeds e cargo de ping.",
                    "",
                    "✨ **Compartilhamento de UID**",
                    "Configure envio automático de UID em canais específicos.",
                    "Suporte a webhook com nome e foto do usuário.",
                    "",
                    "⚡ **Logic Builder**",
                    "Crie automações e fluxos personalizados para seu servidor."
                  ].join("\n"),

                color: 0x2b2d31,

                thumbnail:
                  guildData.icon
                    ? {
                        url:
                          `https://cdn.discordapp.com/icons/${interaction.guild_id}/${guildData.icon}.png?size=1024`
                      }
                    : undefined,

                footer: {
                  text:
                    guildData.name ||
                    `Servidor ${interaction.guild_id}`
                }
              }
            ],

            components: [
              {
                type: 1,
                components: [
                  configSelect
                ]
              }
            ]
          }
        }
      }
    );
  }
};