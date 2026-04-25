const DiscordRequest = require("../../function/DiscordRequest");
const GetPerm = require("../../function/utils/GetPerm")

module.exports = {
  data: {
    name: "criar-embed",
    description: "Editor avançado de Embed",
    type: 1
  },

  async execute(interaction, client) {

    const perms = await GetPerm({
      id: interaction.member.user.id,
      guildId: interaction.guild_id
    });

    if (!perms || !perms.includes("MANAGE_CHANNELS")) {

      await DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        {
          method: "POST",
          body: {
            type: 4,
            data: {
              content: "❌ Você precisa da permissão **Gerenciar Canais** para usar este comando.",
              flags: 64
            }
          }
        }
      );

      return;
    }

    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: "POST", body: { type: 5 } }
    );

    const authorId = interaction.member.user.id;

    const messageData = {
      content: "",
      embed: {
        title: "",
        url: "",
        description: "Olá mundo!",
        color: 0x2f3136,
        footer: "",
        thumbnail: "",
        image: "",
        fields: []
      }
    };

    function parseVariables(text) {
      if (!text) return text;

      return text
        .replaceAll("(user.avatar)", interaction.member.user.avatar
          ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png`
          : "")
        .replaceAll("(guild.icon)", interaction.guild?.icon
          ? `https://cdn.discordapp.com/icons/${interaction.guild.id}/${interaction.guild.icon}.png`
          : "")
        .replaceAll("(guild.name)", interaction.guild?.name || "")
        .replaceAll("(guild.id)", interaction.guild?.id || "");
    }

    function buildEmbed(applyVars = true) {

      const e = messageData.embed;

      const embed = {
        description: e.description || "Olá mundo!",
        color: e.color
      };

      if (e.title) embed.title = applyVars ? parseVariables(e.title) : e.title;
      if (e.url) embed.url = e.url;
      if (e.footer) embed.footer = { text: applyVars ? parseVariables(e.footer) : e.footer };
      if (e.thumbnail) embed.thumbnail = { url: applyVars ? parseVariables(e.thumbnail) : e.thumbnail };
      if (e.image) embed.image = { url: applyVars ? parseVariables(e.image) : e.image };

      if (e.fields.length) {
        embed.fields = e.fields.map(f => ({
          name: applyVars ? parseVariables(f.name) : f.name,
          value: applyVars ? parseVariables(f.value) : f.value,
          inline: f.inline
        }));
      }

      return embed;
    }

    async function update(i) {
      await DiscordRequest(
        `/interactions/${i.id}/${i.token}/callback`,
        {
          method: "POST",
          body: {
            type: 7,
            data: {
              content: parseVariables(messageData.content) || null,
              embeds: [buildEmbed(true)],
              components
            }
          }
        }
      );
    }

    const messageMenu = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "Message / Images",
        options: [
          { label: "Content", value: "content" },
          { label: "Title", value: "title" },
          { label: "TitleUrl", value: "url" },
          { label: "Description", value: "description" },
          { label: "Footer", value: "footer" },
          { label: "Thumbnail", value: "thumbnail" },
          { label: "Image", value: "image" }
        ]
      },
      funcao: async (i) => {

        const key = i.data.values[0];

        const modal = client.interactions.createModal({
          user: authorId,
          title: `Editar ${key}`,
          components: [{
            type: 1,
            components: [{
              type: 4,
              custom_id: "input",
              label: `Novo ${key}`,
              style: key === "description" ? 2 : 1,
              required: false,
              value: messageData.embed[key] || messageData.content || ""
            }]
          }],
          funcao: async (modalInt, _, fields) => {

            if (key === "content")
              messageData.content = fields.input;
            else
              messageData.embed[key] = fields.input;

            await update(modalInt);
          }
        });

        await client.interactions.showModal(i, modal);
      }
    });

    const fieldMenu = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "Fields",
        options: [
          { label: "Adicionar Field", value: "add" },
          { label: "Remover Último", value: "remove" }
        ]
      },
      funcao: async (i) => {

        const value = i.data.values[0];

        if (value === "remove") {
          messageData.embed.fields.pop();
          return await update(i);
        }

        const modal = client.interactions.createModal({
          user: authorId,
          title: "Adicionar Field",
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: "name",
                label: "Nome",
                style: 1,
                required: true
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: "value",
                label: "Valor",
                style: 2,
                required: true
              }]
            }
          ],
          funcao: async (modalInt, _, fields) => {

            messageData.embed.fields.push({
              name: fields.name,
              value: fields.value,
              inline: false
            });

            await update(modalInt);
          }
        });

        await client.interactions.showModal(i, modal);
      }
    });

    const colorMenu = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "Cor da Embed",
        options: [
          { label: "Azul", value: "3447003" },
          { label: "Verde", value: "5763719" },
          { label: "Vermelho", value: "15548997" },
          { label: "Amarelo", value: "16776960" },
          { label: "Roxo", value: "10181046" },
          { label: "HEX Personalizado", value: "hex" }
        ]
      },
      funcao: async (i) => {

        const value = i.data.values[0];

        if (value !== "hex") {
          messageData.embed.color = parseInt(value);
          return await update(i);
        }

        const modal = client.interactions.createModal({
          user: authorId,
          title: "Inserir HEX",
          components: [{
            type: 1,
            components: [{
              type: 4,
              custom_id: "hex",
              label: "Digite o HEX",
              style: 1,
              required: true
            }]
          }],
          funcao: async (modalInt, _, fields) => {

            const hex = fields.hex.replace("#", "");
            messageData.embed.color = parseInt(hex, 16);
            await update(modalInt);
          }
        });

        await client.interactions.showModal(i, modal);
      }
    });

    const sendBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "Enviar a Embed", style: 3 },
      funcao: async (i) => {

        await DiscordRequest(
          `/interactions/${i.id}/${i.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                content: "📨 Envie o ID do canal.",
                flags: 64
              }
            }
          }
        );

        try {

          const msg = await client.NextMessageCollector.wait({
            channelId: interaction.channel_id,
            userId: authorId,
            time: 30000
          });

          const targetChannel = msg.content.replace(/[<#>]/g, "");
          
          const perms = await GetPerm({
               channel: true,
               id: targetChannel,
               guildId: interaction.guild_id,
               bot: true 
           });

     if (
  !perms ||
  !perms.includes("SEND_MESSAGES") ||
  !perms.includes("ATTACH_FILES") ||
  !perms.includes("EMBED_LINKS")
) {
  await DiscordRequest(
    `/webhooks/${interaction.application_id}/${i.token}`,
    {
      method: "POST",
      body: {
        content: `:x: | Eu não tenho permissão de **Enviar Mensagens / Anexar Arquivos / Incorporar Links** no canal <#${targetChannel}>!`,
        flags: 64
      }
    }
  );
  return;
}

          await DiscordRequest(`/channels/${targetChannel}/messages`, {
            method: "POST",
            body: {
              content: parseVariables(messageData.content),
              embeds: [buildEmbed(true)]
            }
          });

          await DiscordRequest(
            `/webhooks/${interaction.application_id}/${i.token}`,
            {
              method: "POST",
              body: { content: "✅ Enviado!", flags: 64 }
            }
          );

        } catch {
          await DiscordRequest(
            `/webhooks/${interaction.application_id}/${i.token}`,
            {
              method: "POST",
              body: { content: "❌ Erro.", flags: 64 }
            }
          );
        }
      }
    });

    const webhookBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "Enviar Webhook", style: 2 },
      funcao: async (i) => {

        const modal = client.interactions.createModal({
          user: authorId,
          title: "Webhook URL",
          components: [{
            type: 1,
            components: [{
              type: 4,
              custom_id: "url",
              label: "Cole a URL",
              style: 1,
              required: true
            }]
          }],
          funcao: async (modalInt, _, fields) => {

            await DiscordRequest(fields.url, {
              method: "POST",
              body: {
                content: parseVariables(messageData.content),
                embeds: [buildEmbed(true)]
              }
            });

            await DiscordRequest(
              `/interactions/${modalInt.id}/${modalInt.token}/callback`,
              {
                method: "POST",
                body: { content: "Enviado!", flags: 64 }
              }
            );
          }
        });

        await client.interactions.showModal(i, modal);
      }
    });

    const jsonBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "Obter JSON", style: 1 },
      funcao: async (i) => {

        await DiscordRequest(
          `/interactions/${i.id}/${i.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                content:
                  "```json\n" +
                  JSON.stringify({
                    content: messageData.content,
                    embeds: [buildEmbed(false)]
                  }, null, 2) +
                  "\n```",
                flags: 64
              }
            }
          }
        );
      }
    });

    const varsBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "Variáveis", style: 2 },
      funcao: async (i) => {

        await DiscordRequest(
          `/interactions/${i.id}/${i.token}/callback`,
          {
            method: "POST",
            body: {
              type: 4,
              data: {
                content:
`Variáveis:

(user.avatar)
(guild.icon)
(guild.name)
(guild.id)`,
                flags: 64
              }
            }
          }
        );
      }
    });

    const components = [
      { type: 1, components: [messageMenu] },
      { type: 1, components: [fieldMenu] },
      { type: 1, components: [colorMenu] },
      { type: 1, components: [sendBtn, webhookBtn] },
      { type: 1, components: [jsonBtn, varsBtn] }
    ];

    await DiscordRequest(
      `/webhooks/${interaction.application_id}/${interaction.token}`,
      {
        method: "POST",
        body: {
          content: null,
          embeds: [buildEmbed(true)],
          components
        }
      }
    );
  }
};