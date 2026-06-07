const DiscordRequest = require("../../function/DiscordRequest.js");
const db = require("../../Mongodb/userglobal.js");

module.exports = {
  data: {
    name: "explorar",
    description: "Comandos relacionados à exploração",
    type: 1,
    options: [
      {
        name: "mondstadt",
        description: "Explore a Cidade da Liberdade e descubra o que os ventos de Barbatos insistem em esconder",
        type: 1
      },
      {
        name: "tempo",
        description: "Veja o tempo que falta de cada exploração",
        type: 1
      }
    ]
  },

  async execute(interaction, client) {

    const subcommand = interaction.data.options?.[0];
    const authorId = interaction.member.user.id;
    if (!subcommand) return;

    let user = await db.findOne({ userId: authorId });
    if (!user) user = await db.create({ userId: authorId }).save();
    

    

    const agora = Date.now();

    if (subcommand.name === "tempo") {

      const exploracao = user.exploracao.mondstadt;

      if (!exploracao.tempo || exploracao.tempo <= agora) {
        return await DiscordRequest(
          `/interactions/${interaction.id}/${interaction.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                flags: 64,
                content: "🌿 Você não possui nenhuma exploração ativa no momento."
              }
            }
          }
        );
      }

      const restante = exploracao.tempo - agora;
      const horas = Math.floor(restante / 1000 / 60 / 60);
      const minutos = Math.floor((restante / 1000 / 60) % 60);
      const segundos = Math.floor((restante / 1000) % 60);

      return await DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        {
          method: "POST",
          body: {
            type: 4,
            data: {
              flags: 64,
              content:
                `⏳ Exploração em andamento.\nTempo restante: **${horas > 0 ? `${horas}h ` : ""}${minutos}m ${segundos}s**`
            }
          }
        }
      );
    }

    if (subcommand.name === "mondstadt") {

      const exploracao = user.exploracao.mondstadt;

      if (exploracao.tempo > agora) {

        const restante = exploracao.tempo - agora;
        const horas = Math.floor(restante / 1000 / 60 / 60);
        const minutos = Math.floor((restante / 1000 / 60) % 60);

        return await DiscordRequest(
          `/interactions/${interaction.id}/${interaction.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                flags: 64,
                content:
                  `⏳ Tem uma exploração em andamento.\nVocê poderá explorar novamente em ${horas > 0 ? `${horas}h ` : ""}${minutos}min.`
              }
            }
          }
        );
      }

      if (exploracao.tempo <= agora && exploracao.coletar > 0) {

        const quantidade = exploracao.coletar;

        if (!user.primogemas) {
          user.primogemas = { atm: 0, transacoes: [] };
        }

        user.primogemas.atm += quantidade;
        user.primogemas.transacoes.push({
          tipo: "exploracao",
          quantidade,
          data: agora
        });
        
        await client.missionManager.trackEvent(authorId, 'explore', 1, interaction.guild_id);

        user.exploracao.mondstadt.coletar = 0;
        user.exploracao.mondstadt.tempo = 0;

        await user.save();

        return await DiscordRequest(
          `/interactions/${interaction.id}/${interaction.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                flags: 64,
                content:
                  `🎁 Sua exploração terminou.\nVocê coletou **${quantidade} Primogemas**.`
              }
            }
          }
        );
      }

      const msg = [
        {
          type: 10,
          content: `<@${authorId}>`
        },
        {
          type: 17,
          accent_color: 1167437,
          spoiler: false,
          components: [
            {
              type: 10,
              content: "# Exploração de Mondstadt"
            },
            {
              type: 10,
              content: "Os ventos de Mondstadt raramente carregam apenas canções e liberdade. Vá. Explore cada trilha, observe cada detalhe... e retorne apenas quando tiver algo de valor para me mostrar."
            },
            {
              type: 12,
              items: [
                {
                  media: {
                    url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS-SdaIFV7rzuOApt4UI4QIFA1yZXJ4SOyzOmSvcIpD6CTIWOmP4TXuPobC&s=10"
                  },
                  description: null,
                  spoiler: false
                }
              ]
            },
            {
              type: 1,
              components: [
                client.interactions.createSelect({
                  user: authorId,
                  data: {
                    placeholder: "Escolha o tempo de exploração",
                    options: [
                      {
                        label: "Rastros dos Ventos",
                        description: "Explore Mondstadt por 30 minutos",
                        value: "30min"
                      },
                      {
                        label: "Planícies Anemo",
                        description: "Explore Mondstadt por 1 hora",
                        value: "1h"
                      },
                      {
                        label: "Expedição da Liberdade",
                        description: "Explore Mondstadt por 2 horas",
                        value: "2h"
                      },
                      {
                        label: "Grande Jornada dos Mil Ventos",
                        description: "Explore Mondstadt por 10 horas",
                        value: "10h"
                      }
                    ]
                  },

                  funcao: async (i) => {

                    const userId = i.member.user.id;
                    const value = i.data.values?.[0];

                    let tempo = 0;
                    let recompensa = 0;
                    let tempoTexto = "";

                    switch (value) {
                      case "30min":
                        tempo = 30 * 60 * 1000;
                        recompensa = 300;
                        tempoTexto = "30 minutos";
                        break;

                      case "1h":
                        tempo = 1 * 60 * 60 * 1000;
                        recompensa = 600;
                        tempoTexto = "1 hora";
                        break;

                      case "2h":
                        tempo = 2 * 60 * 60 * 1000;
                        recompensa = 1200;
                        tempoTexto = "2 horas";
                        break;

                      case "10h":
                        tempo = 10 * 60 * 60 * 1000;
                        recompensa = 6000;
                        tempoTexto = "10 horas";
                        break;

                      default:
                        return;
                    }

                    const user = await db.findOne({ userId });

                    user.exploracao.mondstadt.tempo = Date.now() + tempo;
                    user.exploracao.mondstadt.coletar = recompensa;

                    await user.save();

                    await DiscordRequest(
                      `/interactions/${i.id}/${i.token}/callback`,
                      {
                        method: "POST",
                        body: {
                          type: 4,
                          data: {
                            flags: 64,
                            content:
                              `🌿 Sua exploração em Mondstadt começou.\n` +
                              `⏳ Duração: **${tempoTexto}**`,
                            components: [
                              {
                                type: 1,
                                components: [
                                  client.interactions.createButton({
                                    user: userId,
                                    data: {
                                      label: "Ativar Lembrete",
                                      style: 2
                                    },
                                    funcao: async (btn) => {

                                      await DiscordRequest(
                                        `/interactions/${btn.id}/${btn.token}/callback`,
                                        {
                                          method: "POST",
                                          body: {
                                            type: 4,
                                            data: {
                                              flags: 64,
                                              content:
                                                "⏰ Lembrete ativado. Avisarei você quando a exploração terminar."
                                            }
                                          }
                                        }
                                      );

                                      await client.TaskManager.create({
                                        tipo: "lembrete",
                                        delay: tempo,
                                        dados: {
                                          userId,
                                          channelId: btn.channel_id,
                                          mensagem:
                                            "Sua exploração em Mondstadt terminou. Vá coletar suas Primogemas."
                                        }
                                      });
                                    }
                                  })
                                ]
                              }
                            ]
                          }
                        }
                      }
                    );
                  }
                })
              ]
            }
          ]
        }
      ];

      await DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        {
          method: "POST",
          body: {
            type: 4,
            data: {
              flags: 32768,
              components: msg
            }
          }
        }
      );
    }
  }
};