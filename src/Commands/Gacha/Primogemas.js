const DiscordRequest = require("../../function/DiscordRequest.js");
const MessageEmbed = require("../../function/Messages/EmbedBuild.js");
const UserEconomy = require("../../function/Gacha/Economy.js");
const UserGlobal = require("../../Mongodb/userglobal.js");
const PremiumManager = require("../../function/Utils/PremiumManager.js")

function MS(time) {
  const value = parseInt(time);
  const unit = time.replace(value, "").toLowerCase();

  const units = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  return value * (units[unit] || 1);
}

module.exports = {
  data: {
    name: 'primogemas',
    description: 'Comandos relacionados às Primogemas',
    type: 1,
    options: [
      {
        name: "saldo",
        description: "Veja o saldo de primogemas",
        type: 1,
        options: [{
          name: "user",
          description: "Mencione ou insira o ID do usuário",
          type: 6,
          required: false
        }]
      },
      {
        name: "daily",
        description: "Resgate suas primogemas diárias",
        type: 1
      },{
        name: "placar",
        description: "Veja os mais ricos de primogemas",
        type: 1
      },{
        name: "pagar",
        description: "Envie Primogemas para outro membro",
        type: 1,
        options: [{
          name: "usuario",
          description: "Mencione ou insira o ID",
          type: 6, 
          required: true
        },{
          name: "quantidade",
          description: "Envie a quantidade a ser enviada",
          type: 3,
          required: true
        }]
      },{
        name: "transferências",
        description: "Veja todas as suas transferências de primogemas",
        type: 1
      }
    ]
  },

  async execute(interaction, client) {

    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        body: { type: 5 }
      }
    );

    const subcommand = interaction.data.options[0];
    const authorId = interaction.member.user.id;


    if (subcommand.name === "saldo") {

      const mentionedUser = subcommand.options?.[0]?.value;
      const targetId = mentionedUser || authorId;

      const economy = new UserEconomy(targetId);
      const data = await economy.getTotal();
      const saldo = data.currentBalance;

      const embed = new MessageEmbed()
        .setTitle("Saldo de Primogemas")
        .setColor("Gold")
        .setDescription(
          targetId === authorId
            ? `💎 **Você tem ${saldo} primogemas!**`
            : `💎 <@${targetId}> tem **${saldo} primogemas!**`
        )
        .setTimestamp()
        .build();

      return await DiscordRequest(
        `/webhooks/${interaction.application_id}/${interaction.token}`,
        { method: "POST", body: { embeds: [embed] } }
      );
    }

    /* =========================
       DAILY
    ========================== */
    if (subcommand.name === "daily") {

      const baseReward = 160;
      const now = Date.now();

      let user = await UserGlobal.findOne({ userId: authorId });

      if (!user) {
        user = await UserGlobal.create({ userId: authorId });
      }

      const expiresAt = user.primogemas.daily_tempo || 0;

      const button = client.interactions.createButton({
        user: authorId,
        tempo: MS("24h"),
        data: {
          label: "Resgatar Daily",
          style: 3
        },
        funcao: async (i) => {

          const nowClick = Date.now();

          const freshUser = await UserGlobal.findOne({ userId: authorId });
          const expires = freshUser.primogemas.daily_tempo || 0;

          /* =========================
             COOLDOWN CHECK
          ========================== */
          if (nowClick < expires) {

            const remaining = expires - nowClick;

            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);

            const embedCooldown = new MessageEmbed()
              .setTitle("⏳ Daily em cooldown")
              .setColor("Orange")
              .setDescription(
                `Volte em **${hours}h ${minutes}m**`
              )
              .setTimestamp()
              .build();

            return await DiscordRequest(
              `/interactions/${i.id}/${i.token}/callback`,
              {
                method: "POST",
                body: {
                  type: 7,
                  data: {
                    embeds: [embedCooldown],
                    components: []
                  }
                }
              }
            );
          }

          /* =========================
             GIVE REWARD (COM PREMIUM)
          ========================== */

          // 🔥 verifica premium
          const premium = await PremiumManager.getUserPremium(authorId);

          const min = premium.status ? 20 : 10;
          const max = premium.status ? 50 : 20;

          const giros = Math.floor(Math.random() * (max - min + 1)) + min;
          const totalReward = giros * baseReward;

          const newExpire = nowClick + MS("24h");

          const updated = await UserGlobal.findOneAndUpdate(
            { userId: authorId },
            {
              $inc: { "primogemas.atm": totalReward },
              $set: { "primogemas.daily_tempo": newExpire },
              $push: {
                "primogemas.transacoes": {
                  type: "daily",
                  value: totalReward,
                  giros: giros,
                  premium: premium.status,
                  date: nowClick
                }
              }
            },
            { new: true }
          );
          
          await client.missionManager.trackEvent(authorId, 'do_daily', 1, interaction.guild_id);

          const embedSuccess = new MessageEmbed()
            .setTitle("🎁 Daily Resgatado!")
            .setColor("Green")
            .setDescription(
              `Giros Obtidos: **${giros}**\n` +
              `💎 Recompensa: **${totalReward} primogemas**\n` +
              (premium.status
                ? `✨ Valor maior devido a assinatura **Lua Carmesin**\n\n`
                : `\n`) +
              `📦 Saldo atual: **${updated.primogemas.atm}**`
            )
            .setTimestamp()
            .build();

          return await DiscordRequest(
            `/interactions/${i.id}/${i.token}/callback`,
            {
              method: "POST",
              body: {
                type: 7,
                data: {
                  embeds: [embedSuccess],
                  components: []
                }
              }
            }
          );
        }
      });

      const embed = new MessageEmbed()
        .setTitle("🎁 Daily de Primogemas")
        .setColor("Blue")
        .setDescription(
          `Clique no botão abaixo para resgatar suas primogemas.\n\n` +
          `🎰 Sistema de giros:\n` +
          `• Usuário normal: **10–20 giros**\n` +
          `• Premium: **20–50 giros**`
        )
        .setTimestamp()
        .build();

      return await DiscordRequest(
        `/webhooks/${interaction.application_id}/${interaction.token}`,
        {
          method: "POST",
          body: {
            embeds: [embed],
            components: [
              {
                type: 1,
                components: [button]
              }
            ]
          }
        }
      );
    } else if (subcommand.name === "placar") {

  const PAGE_SIZE = 10;
  let page = 0;

  const users = await UserGlobal.find({
    "primogemas.atm": { $gt: 0 }
  }).sort({ "primogemas.atm": -1 });

  if (!users.length) {
    return await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: { content: "Ainda não há aventureiros ricos em primogemas." }
      }
    );
  }

  const totalPages = Math.ceil(users.length / PAGE_SIZE);

  /* =========================
     GERAR EMBED
  ========================== */
  const generateEmbed = async (page) => {

    const start = page * PAGE_SIZE;
    const slice = users.slice(start, start + PAGE_SIZE);

    let description = "";

    for (let i = 0; i < slice.length; i++) {

      const userDb = slice[i];
      const position = start + i + 1;

      let userData;

      try {
        userData = await DiscordRequest(
          `/users/${userDb.userId}`,
          { method: "GET" }
        );
      } catch {
        continue;
      }

      const name =
        userData.global_name ||
        userData.username ||
        "Usuário";

      const profileUrl =
        `https://discord.com/users/${userDb.userId}`;

      description +=
        `**#${position}** [` +
        `${name}` +
        `](${profileUrl}) — **${userDb.primogemas.atm.toLocaleString()}**\n`;
    }

    return {
      title: "🏆 Placar de Primogemas",
      color: 0xFEE75C,
      description: description || "Sem dados nesta página.",
      footer: {
        text: `Página ${page + 1} de ${totalPages}`
      },
      timestamp: new Date().toISOString()
    };
  };

  /* =========================
     BOTÕES
  ========================== */
  const buildComponents = () => [{
    type: 1,
    components: [
      client.interactions.createButton({
        user: interaction.member.user.id,
        tempo: MS("5min"),
        data: {
          label: "⬅️",
          style: 2,
          disabled: page === 0
        },
        funcao: async (i) => {
          if (page > 0) page--;
          const embed = await generateEmbed(page);

          return await DiscordRequest(
            `/interactions/${i.id}/${i.token}/callback`,
            {
              method: "POST",
              body: {
                type: 7,
                data: {
                  embeds: [embed],
                  components: buildComponents()
                }
              }
            }
          );
        }
      }),

      client.interactions.createButton({
        user: interaction.member.user.id,
        tempo: MS("5min"),
        data: {
          label: "➡️",
          style: 2,
          disabled: page >= totalPages - 1
        },
        funcao: async (i) => {
          if (page < totalPages - 1) page++;
          const embed = await generateEmbed(page);

          return await DiscordRequest(
            `/interactions/${i.id}/${i.token}/callback`,
            {
              method: "POST",
              body: {
                type: 7,
                data: {
                  embeds: [embed],
                  components: buildComponents()
                }
              }
            }
          );
        }
      })
    ]
  }];

  const firstEmbed = await generateEmbed(page);

  return await DiscordRequest(
    `/webhooks/${interaction.application_id}/${interaction.token}`,
    {
      method: "POST",
      body: {
        embeds: [firstEmbed],
        components: buildComponents()
      }
    }
  )
    } else if (subcommand.name === "pagar") {

  const targetId = subcommand.options[0].value;
  const amountInput = subcommand.options[1].value;

  if (targetId === authorId) {
    return await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: {
          content: "🩸 Negociar consigo mesmo? Que infantil."
        }
      }
    );
  }

  let input = amountInput.toLowerCase().replace(/\s/g, "");
  const match = input.match(/^(\d+(?:\.\d+)?)(k|kk|m)?$/);

  if (!match) {
    return await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: {
          content: "Use valores como 100, 2k, 5kk ou 1m."
        }
      }
    );
  }

  let amount = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === "k") amount *= 1_000;
  if (suffix === "kk") amount *= 1_000_000;
  if (suffix === "m") amount *= 1_000_000;

  amount = Math.floor(amount);

  if (amount < 1) {
    return await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: {
          content: "O valor deve ser maior que zero."
        }
      }
    );
  }

  let sender = await UserGlobal.findOne({ userId: authorId });
  let receiver = await UserGlobal.findOne({ userId: targetId });

  if (!receiver) {
    receiver = await UserGlobal.create({
      userId: targetId
    });
  }

  if (!sender) {
    sender = await UserGlobal.create({
      userId: authorId
    });
  }

  if (targetId === process.env.CLIENT_ID) {

    if (sender.primogemas.atm < amount) {
      return await DiscordRequest(
        `/webhooks/${interaction.application_id}/${interaction.token}`,
        {
          method: "POST",
          body: {
            content: "🕯️ Recursos insuficientes."
          }
        }
      );
    }

    await UserGlobal.updateOne(
      { userId: authorId },
      {
        $inc: {
          "primogemas.atm": -amount
        }
      }
    );

    return await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: {
          content:
            `🩸 A Casa da Lareira recebeu sua oferta.\n\n` +
            `💎 ${amount.toLocaleString()} Primogemas foram entregues ao Cofre Central.\n\n` +
            `Sua contribuição foi registrada.\n\n` +
            `⚖️ Regulamento Oficial\n` +
            `• Primogemas não possuem valor real.\n` +
            `• Não podem ser vendidas ou trocadas por dinheiro.\n` +
            `• São apenas recursos virtuais deste sistema.`
        }
      }
    );
  }

  if (authorId !== process.env.CLIENT_ID) {

    if (sender.primogemas.atm < amount) {
      return await DiscordRequest(
        `/webhooks/${interaction.application_id}/${interaction.token}`,
        {
          method: "POST",
          body: {
            content: "🕯️ Recursos insuficientes. Planeje melhor antes de agir."
          }
        }
      );
    }
  }

  let confirmations = [];

  const confirmButton = client.interactions.createButton({
    tempo: MS("5m"),
    data: {
      label: "Registrar Selo",
      style: 3
    },

    funcao: async (i) => {

      const clickUserId =
        i.user?.id ||
        i.member?.user?.id ||
        i.author?.id ||
        i.data?.member?.user?.id;

      if (!clickUserId) return;

      if (![authorId, targetId].includes(clickUserId)) {
        return await DiscordRequest(
          `/interactions/${i.id}/${i.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                content: "Você não faz parte deste contrato.",
                flags: 64
              }
            }
          }
        );
      }

      if (confirmations.includes(clickUserId)) {
        return await DiscordRequest(
          `/interactions/${i.id}/${i.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                content: "Seu selo já foi registrado.",
                flags: 64
              }
            }
          }
        );
      }

      confirmations.push(clickUserId);

      if (confirmations.length < 2) {

  return await DiscordRequest(
    `/interactions/${i.id}/${i.token}/callback`,
    {
      method: "POST",
      body: {
        type: 7,
        data: {
          content:
            `🕯️ CONTRATO DE TRANSFERÊNCIA — CASA DA LAREIRA\n\n` +
            `💎 Valor Declarado: ${amount.toLocaleString()} Primogemas\n` +
            `👤 Remetente: <@${authorId}>\n` +
            `🎯 Destinatário: <@${targetId}>\n\n` +
            `📜 Selos de Concordância: (${confirmations.length}/2)\n\n` +
            `Ambas as partes devem registrar seu selo.\n\n` +
            `⚖️ Regulamento Oficial\n` +
            `• Primogemas não possuem valor real.\n` +
            `• Não podem ser vendidas ou trocadas por dinheiro.\n` +
            `• São apenas recursos virtuais deste sistema.`,

          components: [
            {
              type: 1,
              components: [confirmButton]
            }
          ]
        }
      }
    }
  );
}

      await UserGlobal.updateOne(
        { userId: authorId },
        {
          $inc: {
            "primogemas.atm": -amount
          }
        }
      );

      await UserGlobal.updateOne(
        { userId: targetId },
        {
          $inc: {
            "primogemas.atm": amount
          }
        }
      );
      
      await UserGlobal.updateOne(
  { userId: authorId },
  {
    $push: {
      "primogemas.transacoes": {
        type: "transfer_send",
        to: targetId,
        value: amount,
        date: Date.now()
      }
    }
  }
);

await UserGlobal.updateOne(
  { userId: targetId },
  {
    $push: {
      "primogemas.transacoes": {
        type: "transfer_receive",
        from: authorId,
        value: amount,
        date: Date.now()
      }
    }
  }
);

      return await DiscordRequest(
        `/interactions/${i.id}/${i.token}/callback`,
        {
          method: "POST",
          body: {
            type: 7,
            data: {
              content:
                `🩸 Contrato Formalizado.\n\n` +
                `💎 ${amount.toLocaleString()} Primogemas foram transferidas para <@${targetId}>.\n\n` +
                `📜 Selos de Concordância: (2/2)\n\n` +
                `A Casa da Lareira reconhece o acordo.\n\n` +
                `⚖️ Primogemas não possuem valor real.`,

              components: []
            }
          }
        }
      );
    }
  });

  return await DiscordRequest(
    `/webhooks/${interaction.application_id}/${interaction.token}`,
    {
      method: "POST",
      body: {
        content:
          `🕯️ CONTRATO DE TRANSFERÊNCIA — CASA DA LAREIRA\n\n` +
          `💎 Valor Declarado: ${amount.toLocaleString()} Primogemas\n` +
          `👤 Remetente: <@${authorId}>\n` +
          `🎯 Destinatário: <@${targetId}>\n\n` +
          `📜 Selos de Concordância: (0/2)\n\n` +
          `Ambas as partes devem registrar seu selo.\n\n` +
          `⚖️ Regulamento Oficial\n` +
          `• Primogemas não possuem valor real.\n` +
          `• Não podem ser vendidas ou trocadas por dinheiro.\n` +
          `• São apenas recursos virtuais deste sistema.`,

        components: [
          {
            type: 1,
            components: [confirmButton]
          }
        ]
      }
    }
  );
} else if (subcommand.name === "transferências") {

  const PAGE_SIZE = 20;
  let page = 0;

  let user = await UserGlobal.findOne({
    userId: authorId
  });

  if (!user) {
    user = await UserGlobal.create({
      userId: authorId
    });
  }
  
  //console.log(user.primogemas.transacoes);

  const transactions =
  (user.primogemas?.transacoes || [])
    .filter(t =>
      t &&
      (
        t.date ||
        t.value ||
        t.amount ||
        t.type
      )
    )
    .sort((a, b) =>
      (b.date || 0) - (a.date || 0)
    );
    
    //console.log(transactions);

  if (!transactions.length) {
    return await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: {
          content: "📜 Você ainda não possui registros."
        }
      }
    );
  }

  const totalPages =
    Math.ceil(transactions.length / PAGE_SIZE);

  const generateEmbed = async (page) => {

    const start = page * PAGE_SIZE;

    const slice =
      transactions.slice(start, start + PAGE_SIZE);

    let description = "";

    for (const transaction of slice) {

  const date = transaction.date
    ? Math.floor(
        new Date(transaction.date).getTime() / 1000
      )
    : Math.floor(Date.now() / 1000);


  if (transaction.type === "daily") {

    description +=
      `🎁 **Daily Resgatado**\n` +
      `${Number(
        transaction.value || 0
      ).toLocaleString()} Primogemas\n` +
      `${transaction.giros || 0} giros\n` +
      `${transaction.premium ? "✨ Bônus Premium\n" : ""}` +
      `🕒 <t:${date}:R>\n\n`;
  }


  else if (
    transaction.type === "transfer_send"
  ) {

    let userName = "Usuário";
    let profileUrl =
      `https://discord.com/users/${transaction.to}`;

    try {

      const userData =
        await DiscordRequest(
          `/users/${transaction.to}`,
          { method: "GET" }
        );

      userName =
        userData.global_name ||
        userData.username ||
        "Usuário";

    } catch {}

    description +=
      `📤 **Transferência Enviada**\n` +
      `👤 Para: [` +
      `${userName}` +
      `](${profileUrl})\n` +
      `${Number(
        transaction.value || 0
      ).toLocaleString()} Primogemas\n` +
      `🕒 <t:${date}:R>\n\n`;
  }


  else if (
    transaction.type === "transfer_receive"
  ) {

    let userName = "Usuário";
    let profileUrl =
      `https://discord.com/users/${transaction.from}`;

    try {

      const userData =
        await DiscordRequest(
          `/users/${transaction.from}`,
          { method: "GET" }
        );

      userName =
        userData.global_name ||
        userData.username ||
        "Usuário";

    } catch {}

    description +=
      `📥 **Transferência Recebida**\n` +
      `👤 De: [` +
      `${userName}` +
      `](${profileUrl})\n` +
      `${Number(
        transaction.value || 0
      ).toLocaleString()} Primogemas\n` +
      `🕒 <t:${date}:R>\n\n`;
  } else if (
  transaction.type === "banner_pull"
) {

  description +=
    `✨ **Invocação Realizada**\n` +
    `Banner: ${transaction.banner_name || "Desconhecido"}\n` +
    `Giros: ${transaction.amount || 0}\n` +
    `Gasto: ${Number(
      transaction.value || 0
    ).toLocaleString()} Primogemas\n` +
    `🕒 <t:${date}:R>\n\n`;
} else if (
  transaction.type ===
  "adventure_rank_reward"
) {

  description +=
    `📌 **Recompensa de Rank**\n` +
    `Rank: #${transaction.old_level || 0} → #${transaction.new_level || 0}\n` +
    `Giros Recebidos: ${transaction.rolls || 0}\n` +
    `${Number(
      transaction.value || 0
    ).toLocaleString()} Primogemas\n` +
    `🕒 <t:${date}:R>\n\n`;
}


  else {

    description +=
      `📜 **${transaction.type || "Desconhecido"}**\n` +
      `${Number(
        transaction.value || 0
      ).toLocaleString()} Primogemas\n` +
      `🕒 <t:${date}:R>\n\n`;
  }
}

    return {
      title: "📜 Histórico de Transações",
      color: 0xFEE75C,
      description:
        description || "Sem registros nesta página.",
      footer: {
        text:
          `Página ${page + 1} de ${totalPages} • ` +
          `${transactions.length} registros`
      },
      timestamp: new Date().toISOString()
    };
  };

  const buildComponents = () => [{
    type: 1,
    components: [

      client.interactions.createButton({
        user: authorId,
        tempo: MS("10m"),
        data: {
          label: "⬅️",
          style: 2,
          disabled: page === 0
        },

        funcao: async (i) => {

          if (page > 0) {
            page--;
          }

          const embed =
            await generateEmbed(page);

          return await DiscordRequest(
            `/interactions/${i.id}/${i.token}/callback`,
            {
              method: "POST",
              body: {
                type: 7,
                data: {
                  embeds: [embed],
                  components: buildComponents()
                }
              }
            }
          );
        }
      }),

      client.interactions.createButton({
        user: authorId,
        tempo: MS("10m"),
        data: {
          label: "➡️",
          style: 2,
          disabled: page >= totalPages - 1
        },

        funcao: async (i) => {

          if (page < totalPages - 1) {
            page++;
          }

          const embed =
            await generateEmbed(page);

          return await DiscordRequest(
            `/interactions/${i.id}/${i.token}/callback`,
            {
              method: "POST",
              body: {
                type: 7,
                data: {
                  embeds: [embed],
                  components: buildComponents()
                }
              }
            }
          );
        }
      })
    ]
  }];

  const firstEmbed =
    await generateEmbed(page);

  return await DiscordRequest(
    `/webhooks/${interaction.application_id}/${interaction.token}`,
    {
      method: "POST",
      body: {
        embeds: [firstEmbed],
        components: buildComponents()
      }
    }
  );
}
  }
 }