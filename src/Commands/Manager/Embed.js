"use strict";

const DiscordRequest = require("../../function/DiscordRequest.js");
const GetPerm        = require("../../function/Utils/GetPerm.js");


const MAX_EMBEDS         = 10;
const IS_COMPONENTS_V2   = 1 << 15; 


const PRESET_COLORS = [
  { label: "🔵 Azul",               value: "3498DB" },
  { label: "🟢 Verde",              value: "2ECC71" },
  { label: "🔴 Vermelho",           value: "E74C3C" },
  { label: "🟣 Roxo",               value: "9B59B6" },
  { label: "🟡 Amarelo",            value: "F1C40F" },
  { label: "⚫ Preto",              value: "000001" },
  { label: "⚪ Branco",             value: "FFFFFF" },
  { label: "💜 Discord Blurple",    value: "5865F2" },
  { label: "🎨 Selecionar HexCode", value: "custom" }
];


const CTYPE = Object.freeze({
  ACTION_ROW   : 1,
  BUTTON       : 2,
  SECTION      : 9,
  TEXT_DISPLAY : 10,
  THUMBNAIL    : 11,
  MEDIA_GALLERY: 12,
  SEPARATOR    : 14,
  CONTAINER    : 17
});


async function replyEphemeral(interaction, content) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: "POST", body: { type: 4, data: { content, flags: 64 } } }
  );
}


function buildVariableParser(interaction) {
  const user    = interaction.member.user;
  const guildId = interaction.guild_id ?? interaction.guild?.id ?? "";
  const icon    = interaction.guild?.icon ?? null;

  const avatarUrl   = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : "";

  const guildIconUrl = (guildId && icon)
    ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png`
    : "";


  const TOKENS = Object.freeze({
    "(user.id)"    : user.id           ?? "",
    "(user.name)"  : user.username     ?? "",
    "(user.tag)"   : user.username     ?? "",
    "(user.avatar)": avatarUrl,
    "(guild.id)"   : guildId,
    "(guild.name)" : interaction.guild?.name ?? "",
    "(guild.icon)" : guildIconUrl
  });


  function parseString(text) {
    if (typeof text !== "string") return text;

    if (!text.includes("(")) return text;
    let result = text;
    for (const [token, value] of Object.entries(TOKENS)) {
      if (result.includes(token)) result = result.replaceAll(token, value);
    }
    return result;
  }


  function applyVariables(value) {
    if (typeof value === "string")  return parseString(value);
    if (Array.isArray(value))       return value.map(applyVariables);
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) out[key] = applyVariables(value[key]);
      return out;
    }
    return value;
  }

  return { parseString, applyVariables };
}


function cleanObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(cleanObject).filter(v => v !== undefined && v !== null);
  }

  if (obj !== null && typeof obj === "object") {
    const out = {};
    for (const key of Object.keys(obj)) {
      const v = cleanObject(obj[key]);
      if (
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)
      ) {
        out[key] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }


  return (obj === undefined || obj === null) ? undefined : obj;
}


function embedLabel(index) {
  return `Embed ${index + 1}`;
}


function createBlankEmbed(index) {
  return {
    title      : "",
    description: `Embed Número ${index + 1}`,
    color      : 0x2f3136,
    url        : "",
    author     : { name: "", icon_url: "", url: "" },
    footer     : { text: "", icon_url: "" },
    thumbnail  : { url: "" },
    image      : { url: "" },
    fields     : []
  };
}


async function collectWebhookInfo(interaction, client, authorId) {
  const modal = client.interactions.createModal({
    user : authorId,
    title: "Enviar via Webhook",
    components: [
      {
        type: 1,
        components: [{
          type       : 4,
          custom_id  : "webhookUrl",
          label      : "URL do Webhook",
          style      : 1,
          required   : true,
          placeholder: "https://discord.com/api/webhooks/..."
        }]
      },
      {
        type: 1,
        components: [{
          type       : 4,
          custom_id  : "username",
          label      : "Nome exibido (author)",
          style      : 1,
          required   : false,
          placeholder: "Deixe vazio para usar o nome do bot"
        }]
      },
      {
        type: 1,
        components: [{
          type       : 4,
          custom_id  : "avatarUrl",
          label      : "URL do Avatar (opcional)",
          style      : 1,
          required   : false,
          placeholder: "https://..."
        }]
      }
    ],
    funcao: async (_modalInt, _resolve, _fields) => {}
  });

  return new Promise((resolve) => {
    modal.funcao = async (modalInt, _, fields) => {
      const url = (fields.webhookUrl || "").trim();
      if (!url.startsWith("https://discord.com/api/webhooks/") &&
          !url.startsWith("https://discordapp.com/api/webhooks/")) {
        await replyEphemeral(modalInt, "❌ URL de webhook inválida.");
        return resolve(null);
      }
      resolve({
        interaction: modalInt,
        webhookUrl : url,
        username   : fields.username?.trim()  || null,
        avatarUrl  : fields.avatarUrl?.trim() || null
      });
    };
  });
}



module.exports = {
  data: {
    name       : "criar",
    description: "Editor avançado de Embed e Components V2",
    type       : 1,
    options    : [
      {
        name       : "embed",
        description: "Editor avançado de Embed com preview em tempo real",
        type       : 1
      },
      {
        name       : "componentsv2",
        description: "Editor visual de Components V2 da Discord API",
        type       : 1
      }
    ]
  },

  async execute(interaction, client) {
    const perms = await GetPerm({
      id     : interaction.member.user.id,
      guildId: interaction.guild_id
    });

    if (!perms || !perms.includes("MANAGE_CHANNELS")) {
      return replyEphemeral(interaction, "❌ Você precisa da permissão **Gerenciar Canais**.");
    }

    await DiscordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: "POST", body: { type: 5 } }
    );

    const sub = interaction.data?.options?.[0]?.name;
    return sub === "componentsv2"
      ? runComponentsV2Editor(interaction, client)
      : runEmbedEditor(interaction, client);
  }
};



async function runEmbedEditor(interaction, client) {
  const authorId               = interaction.member.user.id;
  const { parseString, applyVariables } = buildVariableParser(interaction);


  const state = {
    content: "",
    embeds : [createBlankEmbed(0)],
    current: 0
  };

  const currentEmbed = () => state.embeds[state.current];


  function buildEmbeds(applyVars = true) {
    return state.embeds
      .map(embed => {
        const clone  = JSON.parse(JSON.stringify(embed));
        const parsed = applyVars ? applyVariables(clone) : clone;
        return cleanObject(parsed);
      })
      .filter(Boolean);
  }


  async function updateMessage(i) {
    await DiscordRequest(
      `/interactions/${i.id}/${i.token}/callback`,
      {
        method: "POST",
        body  : {
          type: 7,
          data: {
            content   : parseString(state.content) || null,
            embeds    : buildEmbeds(true),
            components: buildEditorRows()
          }
        }
      }
    );
  }


  async function openTextModal(i, title, current, onSubmit, multiline = false) {
    const modal = client.interactions.createModal({
      user : authorId,
      title,
      components: [{
        type: 1,
        components: [{
          type     : 4,
          custom_id: "input",
          label    : title,
          style    : multiline ? 2 : 1,
          required : false,
          value    : current || ""
        }]
      }],
      funcao: async (mi, _, fields) => {
        await onSubmit(fields.input ?? "");
        await updateMessage(mi);
      }
    });
    await client.interactions.showModal(i, modal);
  }


  const editorMenu = client.interactions.createSelect({
    user: authorId,
    data: {
      placeholder: "✏️ Editar Campo da Embed",
      options    : [
        { label: "Content",           value: "content"      },
        { label: "Title",             value: "title"        },
        { label: "Description",       value: "description"  },
        { label: "Title URL",         value: "url"          },
        { label: "Author Name",       value: "author_name"  },
        { label: "Author Icon URL",   value: "author_icon"  },
        { label: "Author URL",        value: "author_url"   },
        { label: "Footer Text",       value: "footer_text"  },
        { label: "Footer Icon URL",   value: "footer_icon"  },
        { label: "Thumbnail URL",     value: "thumbnail"    },
        { label: "Image URL",         value: "image"        }
      ]
    },
    funcao: async (i) => {
      const val   = i.data.values[0];
      const embed = currentEmbed();


      const MAP = {
        content    : ["Editar Content",         () => state.content,         v => { state.content           = v; }, true ],
        title      : ["Editar Título",           () => embed.title,           v => { embed.title             = v; }, false],
        description: ["Editar Descrição",        () => embed.description,     v => { embed.description       = v; }, true ],
        url        : ["Editar Title URL",        () => embed.url,             v => { embed.url               = v; }, false],
        author_name: ["Editar Author Name",      () => embed.author.name,     v => { embed.author.name       = v; }, false],
        author_icon: ["Editar Author Icon URL",  () => embed.author.icon_url, v => { embed.author.icon_url   = v; }, false],
        author_url : ["Editar Author URL",       () => embed.author.url,      v => { embed.author.url        = v; }, false],
        footer_text: ["Editar Footer Text",      () => embed.footer.text,     v => { embed.footer.text       = v; }, false],
        footer_icon: ["Editar Footer Icon URL",  () => embed.footer.icon_url, v => { embed.footer.icon_url   = v; }, false],
        thumbnail  : ["Editar Thumbnail URL",    () => embed.thumbnail.url,   v => { embed.thumbnail.url     = v; }, false],
        image      : ["Editar Image URL",        () => embed.image.url,       v => { embed.image.url         = v; }, false]
      };

      const entry = MAP[val];
      if (!entry) return;
      const [title, getter, setter, multi] = entry;
      return openTextModal(i, title, getter(), async v => setter(v), multi);
    }
  });

  
  const fieldMenu = client.interactions.createSelect({
    user: authorId,
    data: {
      placeholder: "📋 Gerenciar Fields",
      options    : [
        { label: "➕ Adicionar Field",       value: "add"    },
        { label: "🗑️ Remover Última Field",  value: "remove" }
      ]
    },
    funcao: async (i) => {
      const embed = currentEmbed();

      if (i.data.values[0] === "remove") {
        if (embed.fields.length === 0) return replyEphemeral(i, "❌ Não há fields para remover.");
        embed.fields.pop();
        return updateMessage(i);
      }

      const modal = client.interactions.createModal({
        user : authorId,
        title: "Adicionar Field",
        components: [
          { type: 1, components: [{ type: 4, custom_id: "name",   label: "Nome",            style: 1, required: true  }] },
          { type: 1, components: [{ type: 4, custom_id: "value",  label: "Valor",           style: 2, required: true  }] },
          { type: 1, components: [{ type: 4, custom_id: "inline", label: "Inline? sim/nao", style: 1, required: false }] }
        ],
        funcao: async (mi, _, fields) => {
          embed.fields.push({
            name  : fields.name,
            value : fields.value,
            inline: fields.inline?.toLowerCase() === "sim"
          });
          await updateMessage(mi);
        }
      });
      await client.interactions.showModal(i, modal);
    }
  });

  
  const colorBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "🎨 Cor", style: 1 },
    funcao: async (i) => {
      const colorSelect = client.interactions.createSelect({
        user: authorId,
        data: {
          placeholder: "Escolha uma cor…",
          options    : PRESET_COLORS.map(c => ({ label: c.label, value: c.value }))
        },
        funcao: async (ci) => {
          const chosen = ci.data.values[0];
          const embed  = currentEmbed();

          if (chosen === "custom") {
            const hexModal = client.interactions.createModal({
              user : authorId,
              title: "Cor HEX Personalizada",
              components: [{
                type: 1,
                components: [{
                  type       : 4,
                  custom_id  : "hex",
                  label      : "Código HEX (ex: FF5733)",
                  style      : 1,
                  required   : true,
                  max_length : 7,
                  placeholder: "FF5733"
                }]
              }],
              funcao: async (mi, _, fields) => {
                const hex = (fields.hex || "").replace("#", "").trim();
                if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
                  return replyEphemeral(mi, "❌ HEX inválido. Use 6 caracteres (ex: FF5733).");
                }
                embed.color = parseInt(hex, 16);
                await updateMessage(mi);
              }
            });
            return client.interactions.showModal(ci, hexModal);
          }

          embed.color = parseInt(chosen, 16);
          await updateMessage(ci);
        }
      });

      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : {
          type: 4,
          data: {
            content   : "🎨 **Qual cor você gostaria?**",
            flags     : 64,
            components: [{ type: 1, components: [colorSelect] }]
          }
        }
      });
    }
  });

 
  const prevEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "◀ Anterior", style: 2 },
    funcao: async (i) => {
      if (state.current > 0) state.current--;
      await updateMessage(i);
    }
  });

  const nextEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "Próxima ▶", style: 2 },
    funcao: async (i) => {
      if (state.current < state.embeds.length - 1) state.current++;
      await updateMessage(i);
    }
  });

  
  const addEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "➕ Embed", style: 3 },
    funcao: async (i) => {
      if (state.embeds.length >= MAX_EMBEDS) {
        return replyEphemeral(i, `❌ Máximo de ${MAX_EMBEDS} embeds atingido.`);
      }
      const idx = state.embeds.length;
      state.embeds.push(createBlankEmbed(idx));
      state.current = idx;
      await updateMessage(i);
    }
  });

  
  const removeEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "🗑️ Embed", style: 4 },
    funcao: async (i) => {
      if (state.embeds.length <= 1) {
        return replyEphemeral(i, "❌ Deve existir ao menos uma embed.");
      }
      state.embeds.splice(state.current, 1);
      state.current = Math.max(0, state.current - 1);
      await updateMessage(i);
    }
  });

  
  const jsonBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "{ } JSON", style: 1 },
    funcao: async (i) => {
      const embedSelect = client.interactions.createSelect({
        user: authorId,
        data: {
          placeholder: "Selecione a embed para exportar…",
          options    : state.embeds.map((_, idx) => ({
            label: embedLabel(idx),
            value: String(idx)
          }))
        },
        funcao: async (si) => {
          const idx    = parseInt(si.data.values[0], 10);
          const clone  = JSON.parse(JSON.stringify(state.embeds[idx]));
          const clean  = cleanObject(clone);
          const json   = JSON.stringify(clean, null, 2);
          const output = json.length > 1900
            ? json.slice(0, 1900) + "\n… (truncado)"
            : json;

          await DiscordRequest(`/interactions/${si.id}/${si.token}/callback`, {
            method: "POST",
            body  : {
              type: 4,
              data: {
                content: `📋 **${embedLabel(idx)}**\n\`\`\`json\n${output}\n\`\`\``,
                flags  : 64
              }
            }
          });
        }
      });

      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : {
          type: 4,
          data: {
            content   : "📦 **Qual embed você deseja exportar?**",
            flags     : 64,
            components: [{ type: 1, components: [embedSelect] }]
          }
        }
      });
    }
  });

  
  const previewBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "👁️ Preview", style: 2 },
    funcao: async (i) => {
      const previewEmbeds   = buildEmbeds(true);
      const previewContent  = parseString(state.content) || null;

      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : {
          type: 4,
          data: {
            content: previewContent,
            embeds : previewEmbeds,
            flags  : 64   
          }
        }
      });
    }
  });


  const sendBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "📨 Enviar", style: 3 },
    funcao: async (i) => {


      const destinoSelect = client.interactions.createSelect({
        user: authorId,
        data: {
          placeholder: "Selecione o destino do envio…",
          options    : [
            {
              label      : "📡 Canal do Discord",
              value      : "canal",
              description: "Enviar para um canal por ID ou menção"
            },
            {
              label      : "🔗 Webhook",
              value      : "webhook",
              description: "Enviar via URL de webhook com nome e avatar opcionais"
            }
          ]
        },
        funcao: async (si) => {
          const destino = si.data.values[0];

          if (destino === "canal") {
            await DiscordRequest(`/interactions/${si.id}/${si.token}/callback`, {
              method: "POST",
              body  : {
                type: 4,
                data: { content: "📡 Envie o **ID** ou **menção** (`#canal`) do canal destino.", flags: 64 }
              }
            });

            try {
              const msg = await client.NextMessageCollector.wait({
                channelId: interaction.channel_id,
                userId   : authorId,
                time     : 30000
              });

              const channelId = msg.content.replace(/[<#>]/g, "").trim();

              await DiscordRequest(`/channels/${channelId}/messages`, {
                method: "POST",
                body  : {
                  content: parseString(state.content) || null,
                  embeds : buildEmbeds(true)
                }
              });

              await DiscordRequest(`/webhooks/${interaction.application_id}/${si.token}`, {
                method: "POST",
                body  : { content: "✅ Mensagem enviada com sucesso!" }
              });

            } catch {
              await DiscordRequest(`/webhooks/${interaction.application_id}/${si.token}`, {
                method: "POST",
                body  : { content: "Nào foi possivel enviar a Embed nesse chat, pois não tenho permissão." , flags: 64 }
              });
            }
            return;
          }


          if (destino === "webhook") {
            const info = await openWebhookModal(si, authorId, client);
            if (!info) return;

            const body = {
              content: parseString(state.content) || null,
              embeds : buildEmbeds(true)
            };
            if (info.username)  body.username   = info.username;
            if (info.avatarUrl) body.avatar_url = info.avatarUrl;

            try {
              await DiscordRequest(info.webhookUrl.replace("https://discord.com/api/", "/"), {
                method  : "POST",
                body,
                _fullUrl: info.webhookUrl
              });

              await DiscordRequest(`/interactions/${info.interaction.id}/${info.interaction.token}/callback`, {
                method: "POST",
                body  : { type: 4, data: { content: "✅ Enviado via webhook!", flags: 64 } }
              });
            } catch (err) {
              await DiscordRequest(`/interactions/${info.interaction.id}/${info.interaction.token}/callback`, {
                method: "POST",
                body  : { type: 4, data: { content: `❌ Erro ao enviar: ${err?.message ?? "desconhecido"}`, flags: 64 } }
              });
            }
          }
        }
      });

      
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : {
          type: 4,
          data: {
            content   : "📨 **Para onde deseja enviar?**",
            flags     : 64,
            components: [{ type: 1, components: [destinoSelect] }]
          }
        }
      });
    }
  });

 
  const varsBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "📌 Variáveis", style: 2 },
    funcao: async (i) => {
      await replyEphemeral(i,
        "**Variáveis disponíveis** *(funcionam em QUALQUER campo, incluindo URLs)*\n" +
        "```\n" +
        "(user.id)     → ID do usuário\n" +
        "(user.name)   → Username\n" +
        "(user.tag)    → Username\n" +
        "(user.avatar) → URL do avatar\n\n" +
        "(guild.id)    → ID do servidor\n" +
        "(guild.name)  → Nome do servidor\n" +
        "(guild.icon)  → URL do ícone do servidor\n" +
        "```"
      );
    }
  });


  function buildEditorRows() {
    return [
      { type: 1, components: [editorMenu]                                                         },
      { type: 1, components: [fieldMenu]                                                          },
      { type: 1, components: [colorBtn, prevEmbedBtn, nextEmbedBtn, addEmbedBtn, removeEmbedBtn] },
      { type: 1, components: [previewBtn, sendBtn, jsonBtn, varsBtn]                             }
    ];
  }

 
  await DiscordRequest(
    `/webhooks/${interaction.application_id}/${interaction.token}`,
    {
      method: "POST",
      body  : {
        content   : null,
        embeds    : buildEmbeds(true),
        components: buildEditorRows()
      }
    }
  );
}



async function runComponentsV2Editor(interaction, client) {
  const authorId = interaction.member.user.id;

  let _nextId = 0;
  const uid = () => ++_nextId;

  const BLOCK = {
    textDisplay : () => ({ _id: uid(), kind: "text",       content: "Texto aqui (**markdown** suportado)" }),
    mediaGallery: () => ({ _id: uid(), kind: "gallery",    items: []                                       }),
    section     : () => ({ _id: uid(), kind: "section",    text: "Texto da seção", accessory: null         }),
    separator   : () => ({ _id: uid(), kind: "separator",  divider: true, spacing: "small"                 }),
    container   : () => ({ _id: uid(), kind: "container",  accentColor: null, spoiler: false, children: [] }),
    actionRow   : () => ({ _id: uid(), kind: "action_row", buttons: []                                     })
  };

  const state = {
    blocks: [],
    path  : [0]
  };

  function getBlockByPath(path) {
    if (!state.blocks.length) return null;
    let node = state.blocks[path[0]];
    if (!node) return null;
    for (let i = 1; i < path.length; i++) {
      if (!node.children) return null;
      node = node.children[path[i]];
      if (!node) return null;
    }
    return node;
  }

  function getParentArrayByPath(path) {
    if (path.length === 1) return state.blocks;
    let arr = state.blocks;
    let node = arr[path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      if (!node.children) return null;
      arr  = node.children;
      node = arr[path[i]];
    }
    return node?.children ?? null;
  }

  function currentBlock() {
    return getBlockByPath(state.path);
  }

  function addRootBlock(kind) {
    const b = BLOCK[kind]?.();
    if (!b) return;
    state.blocks.push(b);
    state.path = [state.blocks.length - 1];
  }

  function serializeLinkButton(btn) {
    const out = { type: CTYPE.BUTTON, style: 5, url: btn.url };
    if (btn.label)    out.label    = btn.label;
    if (btn.disabled) out.disabled = true;
    if (btn.emoji) {
      out.emoji = /^\d{17,20}$/.test(btn.emoji.trim())
        ? { id: btn.emoji.trim() }
        : { name: btn.emoji.trim() };
    }
    return out;
  }

  function serializeBlock(block) {
    switch (block.kind) {
      case "text":
        return { type: CTYPE.TEXT_DISPLAY, content: block.content || "" };

      case "gallery": {
        if (!block.items?.length) return null;
        return {
          type : CTYPE.MEDIA_GALLERY,
          items: block.items.map(it => {
            const obj = { media: { url: it.url } };
            if (it.description) obj.description = it.description;
            if (it.spoiler)     obj.spoiler      = true;
            return obj;
          })
        };
      }

      case "section": {
        const comp = {
          type      : CTYPE.SECTION,
          components: [{ type: CTYPE.TEXT_DISPLAY, content: block.text || "" }]
        };
        if (block.accessory) {
          if (block.accessory.kind === "thumbnail") {
            comp.accessory = {
              type : CTYPE.THUMBNAIL,
              media: { url: block.accessory.url },
              ...(block.accessory.description ? { description: block.accessory.description } : {}),
              ...(block.accessory.spoiler      ? { spoiler: true }                            : {})
            };
          } else if (block.accessory.kind === "button_link") {
            comp.accessory = serializeLinkButton(block.accessory);
          }
        }
        return comp;
      }

      case "separator":
        return {
          type   : CTYPE.SEPARATOR,
          divider: block.divider ?? true,
          spacing: block.spacing === "large" ? 2 : 1
        };

      case "action_row": {
        if (!block.buttons?.length) return null;
        return {
          type      : CTYPE.ACTION_ROW,
          components: block.buttons.map(serializeLinkButton)
        };
      }

      case "container": {
        const children = (block.children || []).map(serializeBlock).filter(Boolean);
        const comp     = { type: CTYPE.CONTAINER, components: children };
        if (block.accentColor !== null && block.accentColor !== undefined) {
          comp.accent_color = block.accentColor;
        }
        if (block.spoiler) comp.spoiler = true;
        return comp;
      }

      default:
        return null;
    }
  }

  function buildApiComponents() {
    return state.blocks.map(serializeBlock).filter(Boolean);
  }

  function buildApiPayload() {
    return { flags: IS_COMPONENTS_V2, components: buildApiComponents() };
  }

  function validatePayload() {
    const errors = [];
    const components = buildApiComponents();

    if (!components.length) {
      errors.push("Nenhum componente adicionado.");
      return errors;
    }

    const json = JSON.stringify({ flags: IS_COMPONENTS_V2, components });
    if (json.length > 8000) {
      errors.push(`Payload muito grande: ${json.length} chars (limite ~8000).`);
    }

    function validateNode(block, depth) {
      if (block.kind === "gallery" && (!block.items || !block.items.length)) {
        errors.push("Media Gallery está vazia — adicione ao menos 1 item.");
      }
      if (block.kind === "gallery" && block.items?.length > 10) {
        errors.push(`Media Gallery tem ${block.items.length} itens (máximo: 10).`);
      }
      if (block.kind === "action_row") {
        if (!block.buttons?.length) errors.push("Action Row está vazia — adicione ao menos 1 botão.");
        if (block.buttons?.length  > 5) errors.push(`Action Row tem ${block.buttons.length} botões (máximo: 5).`);
        block.buttons?.forEach((btn, bi) => {
          if (!btn.url || !/^https?:\/\/.+/.test(btn.url)) {
            errors.push(`Botão ${bi + 1} tem URL inválida.`);
          }
          if (!btn.label && !btn.emoji) {
            errors.push(`Botão ${bi + 1} precisa de label ou emoji.`);
          }
        });
      }
      if (block.kind === "section" && !block.text?.trim()) {
        errors.push("Section tem texto vazio.");
      }
      if (block.kind === "section" && block.accessory?.kind === "button_link") {
        if (!block.accessory.url || !/^https?:\/\/.+/.test(block.accessory.url)) {
          errors.push("Botão acessório da Section tem URL inválida.");
        }
      }
      if (block.kind === "section" && block.accessory?.kind === "thumbnail") {
        if (!block.accessory.url || !/^https?:\/\/.+/.test(block.accessory.url)) {
          errors.push("Thumbnail da Section tem URL inválida.");
        }
      }
      if (block.kind === "container") {
        if (!block.children?.length) errors.push("Container está vazio — adicione ao menos 1 filho.");
        block.children?.forEach(c => validateNode(c, depth + 1));
      }
    }

    state.blocks.forEach(b => validateNode(b, 0));
    return errors;
  }

  const KIND_ICON = {
    text      : "📝", gallery   : "🖼️", section: "📐",
    separator : "➖", action_row: "🔘", container: "📦"
  };

  const KIND_LABEL = {
    text      : "Text Display",  gallery   : "Media Gallery",
    section   : "Section",       separator : "Separator",
    action_row: "Action Row",    container : "Container"
  };

  function blockSummary(block) {
    switch (block.kind) {
      case "text"      : return `"${(block.content || "").slice(0, 32)}"`;
      case "gallery"   : return `${block.items?.length ?? 0}/10 itens`;
      case "section"   : return `"${(block.text || "").slice(0, 32)}" | acessório: ${block.accessory?.kind ?? "nenhum"}`;
      case "action_row": return `${block.buttons?.length ?? 0}/5 botões`;
      case "container" : return `${block.children?.length ?? 0} filho(s) | spoiler: ${block.spoiler} | accent: ${block.accentColor !== null && block.accentColor !== undefined ? "#" + block.accentColor.toString(16).padStart(6,"0").toUpperCase() : "nenhum"}`;
      case "separator" : return `spacing: ${block.spacing}, divider: ${block.divider}`;
      default          : return "";
    }
  }

  function buildPathBreadcrumb() {
    if (!state.blocks.length) return "";
    const parts = [];
    let node = state.blocks[state.path[0]];
    if (!node) return "";
    parts.push(`${KIND_ICON[node.kind] ?? "❓"} ${KIND_LABEL[node.kind] ?? node.kind}`);
    for (let i = 1; i < state.path.length; i++) {
      if (!node.children) break;
      node = node.children[state.path[i]];
      if (!node) break;
      parts.push(`${KIND_ICON[node.kind] ?? "❓"} ${KIND_LABEL[node.kind] ?? node.kind}`);
    }
    if (!parts.length) return "";
    if (parts.length === 1) return `📍 **Editando:** ${parts[0]}`;
    const lines = parts.map((p, i) => {
      if (i === 0) return p;
      const indent = "   ".repeat(i);
      const conn   = i === parts.length - 1 ? "└─ " : "├─ ";
      return `${indent}${conn}${p}`;
    });
    return `📍 **Caminho Atual:**\n${lines.join("\n")}`;
  }

  function renderTreeLines(blocks, parentPath, depthPrefix, isRoot) {
    const lines = [];
    blocks.forEach((block, idx) => {
      const blockPath = isRoot ? [idx] : [...parentPath, idx];
      const isActive  = JSON.stringify(state.path) === JSON.stringify(blockPath);
      const isLast    = idx === blocks.length - 1;
      const connector = isRoot ? "" : (isLast ? "└─ " : "├─ ");
      const childPfx  = isRoot ? "" : (isLast ? "   " : "│  ");
      const marker    = isActive ? "▶ " : "   ";
      const icon      = KIND_ICON[block.kind]  ?? "❓";
      const label     = KIND_LABEL[block.kind] ?? block.kind;
      const summary   = blockSummary(block);
      const num       = isRoot ? `${idx + 1}. ` : "";

      const activeMark = isActive ? " **◄**" : "";
      lines.push(`${depthPrefix}${connector}${marker}${num}${icon} **${label}**${summary ? `  ·  ${summary}` : ""}${activeMark}`);

      if (block.kind === "container" && block.children?.length) {
        const childLines = renderTreeLines(
          block.children,
          blockPath,
          depthPrefix + childPfx,
          false
        );
        lines.push(...childLines);
      }
    });
    return lines;
  }

  function buildStatusText() {
    const apiComps = buildApiComponents();
    const crumb    = buildPathBreadcrumb();

    const divider  = "━━━━━━━━━━━━━━━━━━━━━━━━";

    const headerLines = [
      "## 🧩 Discord Components V2 Builder",
      "",
      `📦 **Blocos raiz:** ${state.blocks.length}   🧱 **Componentes:** ${apiComps.length}   🔖 \`IS_COMPONENTS_V2\``,
      ""
    ];

    if (crumb) {
      headerLines.push(crumb, "");
    }

    headerLines.push(divider, "");

    if (!state.blocks.length) {
      headerLines.push("*Nenhum componente ainda.*", "*Use os menus abaixo para adicionar blocos.*");
      return headerLines.join("\n");
    }

    const treeLines = renderTreeLines(state.blocks, [], "", true);
    return headerLines.join("\n") + treeLines.join("\n");
  }

  async function safeUpdateEditor(i) {
    try {
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : {
          type: 7,
          data: {
            content   : buildStatusText(),
            embeds    : [],
            components: buildEditorUI()
          }
        }
      });
    } catch (err) {
      try {
        await DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
          method: "POST",
          body  : { content: `❌ Erro ao atualizar editor: ${err?.message ?? "desconhecido"}`, flags: 64 }
        });
      } catch {}
    }
  }

  async function safeEphemeral(i, content) {
    try {
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : { type: 4, data: { content, flags: 64 } }
      });
    } catch {}
  }

  function buildEditorUI() {
    const allNodes = [];

    function collectNodes(blocks, depth, parentPath, parentIsLast) {
      blocks.forEach((b, idx) => {
        const nodePath = parentPath ? [...parentPath, idx] : [idx];
        const isActive = JSON.stringify(state.path) === JSON.stringify(nodePath);
        const isLast   = idx === blocks.length - 1;
        const icon     = KIND_ICON[b.kind]  ?? "❓";
        const label    = KIND_LABEL[b.kind] ?? b.kind;
        const num      = depth === 0 ? `${idx + 1}. ` : "";
        const conn     = depth === 0 ? "" : (isLast ? "└─ " : "├─ ");
        const indent   = depth === 0 ? "" : "   ".repeat(depth - 1) + (parentIsLast ? "   " : "│  ");
        const mark     = isActive ? "▶ " : "   ";
        allNodes.push({
          label  : `${indent}${conn}${mark}${num}${icon} ${label}`,
          value  : JSON.stringify(nodePath),
          default: isActive
        });
        if (b.kind === "container" && b.children?.length) {
          collectNodes(b.children, depth + 1, nodePath, isLast);
        }
      });
    }

    collectNodes(state.blocks, 0, null, true);

    const navOptions = allNodes.length > 0
      ? allNodes.slice(0, 25)
      : [{ label: "(sem blocos — adicione um abaixo)", value: "__none__" }];

    const navSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "🗂️ Navegar / Selecionar bloco na árvore",
        options    : navOptions
      },
      funcao: async (i) => {
        const v = i.data.values[0];
        if (v !== "__none__") {
          const parsed = JSON.parse(v);
          state.path = parsed;
        }
        await safeUpdateEditor(i);
      }
    });

    const addLayoutSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "➕ Adicionar Layout (raiz)",
        options    : [
          { label: "📦 Container",  value: "container",  description: "Agrupa blocos com borda e cor opcional" },
          { label: "📐 Section",    value: "section",    description: "Texto com acessório (thumbnail ou botão)" },
          { label: "➖ Separator",  value: "separator",  description: "Divisor visual entre blocos" }
        ]
      },
      funcao: async (i) => {
        addRootBlock(i.data.values[0]);
        await safeUpdateEditor(i);
      }
    });

    const addContentSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "➕ Adicionar Conteúdo / Botões (raiz)",
        options    : [
          { label: "📝 Text Display",  value: "textDisplay",  description: "Texto livre com suporte a markdown" },
          { label: "🖼️ Media Gallery", value: "mediaGallery", description: "Galeria de imagens/vídeos (até 10)" },
          { label: "🔘 Action Row",    value: "actionRow",    description: "Linha de Link Buttons (até 5)" }
        ]
      },
      funcao: async (i) => {
        addRootBlock(i.data.values[0]);
        await safeUpdateEditor(i);
      }
    });

    const editBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "✏️ Editar", style: 1 },
      funcao: async (i) => {
        const b = currentBlock();
        if (!b) return safeEphemeral(i, "❌ Nenhum bloco selecionado. Use o menu de navegação acima.");
        return openBlockEditor(i, b);
      }
    });

    const removeBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "🗑️ Remover", style: 4 },
      funcao: async (i) => {
        const arr = getParentArrayByPath(state.path);
        if (!arr) return safeEphemeral(i, "❌ Nenhum bloco para remover.");
        const idx = state.path[state.path.length - 1];
        arr.splice(idx, 1);
        const newIdx = Math.max(0, idx - 1);
        if (state.path.length === 1) {
          state.path = state.blocks.length ? [Math.min(newIdx, state.blocks.length - 1)] : [0];
        } else {
          const parent = state.path.slice(0, -1);
          const parentArr = getParentArrayByPath([...parent, 0]);
          state.path = parentArr?.length ? [...parent, Math.min(newIdx, parentArr.length - 1)] : parent;
        }
        await safeUpdateEditor(i);
      }
    });

    const moveUpBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "⬆️ Subir", style: 2 },
      funcao: async (i) => {
        const arr = getParentArrayByPath(state.path);
        const idx = state.path[state.path.length - 1];
        if (!arr || idx <= 0) return safeEphemeral(i, "❌ O bloco já está no topo.");
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        state.path = [...state.path.slice(0, -1), idx - 1];
        await safeUpdateEditor(i);
      }
    });

    const moveDownBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "⬇️ Descer", style: 2 },
      funcao: async (i) => {
        const arr = getParentArrayByPath(state.path);
        const idx = state.path[state.path.length - 1];
        if (!arr || idx >= arr.length - 1) return safeEphemeral(i, "❌ O bloco já está no final.");
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        state.path = [...state.path.slice(0, -1), idx + 1];
        await safeUpdateEditor(i);
      }
    });

    const cv2PreviewBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "👁️ Preview", style: 2 },
      funcao: async (i) => {
        const errors = validatePayload();
        if (errors.length) {
          return safeEphemeral(i, `❌ **Não é possível fazer preview:**\n${errors.map(e => `• ${e}`).join("\n")}`);
        }

        const components = buildApiComponents();
        try {
          await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
            method: "POST",
            body  : {
              type: 4,
              data: {
                flags            : 64 | IS_COMPONENTS_V2,
                components,
                allowed_mentions : { parse: [] }
              }
            }
          });
        } catch (err) {
          const msg = err?.message ?? "Erro desconhecido";
          await DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
            method: "POST",
            body  : { content: `❌ **Erro no preview:**\n\`\`\`\n${msg}\n\`\`\``, flags: 64 }
          });
        }
      }
    });

    const cv2SendBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "📨 Canal", style: 3 },
      funcao: async (i) => {
        const errors = validatePayload();
        if (errors.length) {
          return safeEphemeral(i, `❌ **Payload inválido:**\n${errors.map(e => `• ${e}`).join("\n")}`);
        }

        await safeEphemeral(i, "📡 **Envio por Canal**\nEnvie o **ID** ou **menção** (`#canal`) do canal destino no chat. *(30 segundos)*");

        try {
          const msg = await client.NextMessageCollector.wait({
            channelId: interaction.channel_id,
            userId   : authorId,
            time     : 30000
          });

          const rawId    = msg.content.replace(/[<#>]/g, "").trim();
          const channelId = /^\d{17,20}$/.test(rawId) ? rawId : null;

          if (!channelId) {
            return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
              method: "POST",
              body  : { content: "❌ ID de canal inválido. Use um ID numérico ou `#menção`.", flags: 64 }
            });
          }

          const payload = {
            flags           : IS_COMPONENTS_V2,
            components      : buildApiComponents(),
            embeds          : [],
            allowed_mentions: { parse: [] }
          };

          try {
            await DiscordRequest(`/channels/${channelId}/messages`, { method: "POST", body: payload });
            await DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
              method: "POST",
              body  : { content: `✅ **Components V2 enviados com sucesso!**\nCanal: <#${channelId}>`, flags: 64 }
            });
          } catch (err) {
            const msg2 = err?.message ?? "Sem detalhes";
            await DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
              method: "POST",
              body  : { content: `❌ **Erro ao enviar para o canal:**\n\`\`\`\n${msg2}\n\`\`\`\nVerifique se o bot tem permissão de enviar mensagens nesse canal.`, flags: 64 }
            });
          }

        } catch {
          await DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
            method: "POST",
            body  : { content: "⏱️ **Tempo esgotado.** Nenhum canal foi informado em 30 segundos.", flags: 64 }
          });
        }
      }
    });

    const cv2WebhookBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "📡 Webhook", style: 1 },
      funcao: async (i) => {
        const errors = validatePayload();
        if (errors.length) {
          return safeEphemeral(i, `❌ **Payload inválido:**\n${errors.map(e => `• ${e}`).join("\n")}`);
        }

        const info = await openWebhookModal(i, authorId, client);
        if (!info) return;

        const payload = {
          flags           : IS_COMPONENTS_V2,
          components      : buildApiComponents(),
          embeds          : [],
          allowed_mentions: { parse: [] }
        };

        if (info.username)  payload.username   = info.username;
        if (info.avatarUrl) payload.avatar_url = info.avatarUrl;

        try {
          const urlPath = info.webhookUrl.replace(/^https:\/\/(?:discord\.com|discordapp\.com)\/api/, "");
          await DiscordRequest(urlPath, { method: "POST", body: payload, _fullUrl: info.webhookUrl });

          await DiscordRequest(`/interactions/${info.interaction.id}/${info.interaction.token}/callback`, {
            method: "POST",
            body  : { type: 4, data: { content: "✅ **Components V2 enviados via webhook com sucesso!**", flags: 64 } }
          });
          try {
            await DiscordRequest(
              `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
              {
                method: "PATCH",
                body  : {
                  content   : buildStatusText(),
                  embeds    : [],
                  components: buildEditorUI()
                }
              }
            );
          } catch {}
        } catch (err) {
          const msg = err?.message ?? "Sem detalhes";
          let hint  = "";
          if (msg.includes("401")) hint = "\n💡 O token do webhook pode estar inválido ou revogado.";
          if (msg.includes("404")) hint = "\n💡 O webhook não foi encontrado. Verifique se a URL está correta.";

          await DiscordRequest(`/interactions/${info.interaction.id}/${info.interaction.token}/callback`, {
            method: "POST",
            body  : {
              type: 4,
              data: {
                content: `❌ **Erro ao enviar pelo webhook:**\n\`\`\`\n${msg}\n\`\`\`${hint}`,
                flags  : 64
              }
            }
          });
        }
      }
    });

    const jsonBtn = client.interactions.createButton({
      user: authorId,
      data: { label: "{ } JSON", style: 2 },
      funcao: async (i) => {
        const components = buildApiComponents();
        if (!components.length) return safeEphemeral(i, "❌ Nenhum componente para exportar.");
        const payload = { flags: IS_COMPONENTS_V2, components };
        const json    = JSON.stringify(payload, null, 2);
        if (json.length > 1950) {
          return safeEphemeral(i,
            `⚠️ JSON muito grande (${json.length} chars).\nPrimeiros 1900 chars:\n\`\`\`json\n${json.slice(0, 1900)}\n…\`\`\``
          );
        }
        await safeEphemeral(i, `📋 **Components V2 — payload completo**\n\`\`\`json\n${json}\n\`\`\``);
      }
    });

    const helpBtn = client.interactions.createButton({
  user: authorId,
  data: {
    label: "❓ Como Usar",
    style: 2
  },

  funcao: async (i) => {

    const embeds = [

      {
        title: "❓ Components V2 Builder • Guia (1/3)",
        color: 0x5865F2,
        description: [
          "**O que é Components V2?**",
          "É o novo sistema de mensagens visuais do Discord que permite criar layouts ricos com texto, imagens, botões e containers — sem usar embeds.",
          "",
          "**─── 1. Adicionando Blocos ───**",
          "Use os menus **➕ Adicionar Layout** e **➕ Adicionar Conteúdo** para criar blocos na raiz da mensagem.",
          "",
          "• `📦 Container` — agrupa outros blocos com borda e cor opcional",
          "• `📐 Section` — texto com um acessório (imagem ou botão)",
          "• `➖ Separator` — linha divisória entre blocos",
          "• `📝 Text Display` — texto livre com markdown",
          "• `🖼️ Media Gallery` — galeria de até 10 imagens/vídeos",
          "• `🔘 Action Row` — linha de até 5 Link Buttons",
          "",
          "**─── 2. Navegação em Árvore ───**",
          "Use o menu **🗂️ Navegar** para selecionar qualquer bloco, inclusive filhos dentro de containers.",
          "",
          "O caminho atual aparece no topo:",
          "`📍 Container › Section`",
          "",
          "A árvore visual mostra todos os blocos com indentação hierárquica.",
          "",
          "**─── 3. Editando Blocos ───**",
          "Selecione o bloco desejado no menu e clique **✏️ Editar**.",
          "Cada tipo de bloco tem seu próprio editor especializado."
        ].join("\n")
      },

      {
        title: "❓ Components V2 Builder • Guia (2/3)",
        color: 0x57F287,
        description: [
          "**─── 4. Movendo e Removendo ───**",
          "• **⬆️ Subir / ⬇️ Descer** — reordena o bloco na sua posição atual",
          "• **🗑️ Remover** — remove o bloco selecionado",
          "",
          "Funciona tanto em blocos raiz quanto em filhos de containers.",
          "",
          "**─── 5. Containers ───**",
          "Clique **✏️ Editar** num Container para gerenciar seus filhos.",
          "",
          "Você pode adicionar, remover, reordenar e editar filhos individualmente.",
          "",
          "Containers suportam:",
          "• `accent_color`",
          "• `spoiler`",
          "",
          "**─── 6. Sections ───**",
          "Uma Section tem um texto principal e um acessório opcional:",
          "",
          "• `Thumbnail` — imagem ao lado do texto",
          "• `Link Button` — botão de link ao lado do texto",
          "",
          "**─── 7. Media Gallery ───**",
          "Adicione URLs de imagens ou vídeos.",
          "",
          "Cada item pode possuir:",
          "• `descrição`",
          "• `spoiler`",
          "",
          "Limite: `10 itens por galeria`."
        ].join("\n")
      },

      {
        title: "❓ Components V2 Builder • Guia (3/3)",
        color: 0xED4245,
        description: [
          "**─── 8. Link Buttons ───**",
          "São os únicos botões permitidos no Components V2.",
          "",
          "Cada botão possui:",
          "• `label`",
          "• `URL`",
          "• `emoji`",
          "• `disabled`",
          "",
          "Limite: `5 botões por Action Row`.",
          "",
          "**─── 9. Preview ───**",
          "Clique **👁️ Preview** para ver como a mensagem vai aparecer.",
          "",
          "O preview é visível apenas para você (`ephemeral`).",
          "",
          "**─── 10. Envio ───**",
          "• **📨 Canal** — informe o ID ou `#menção` do canal",
          "• **📡 Webhook** — informe a URL do webhook no modal",
          "",
          "A mensagem final inclui automaticamente a flag:",
          "`IS_COMPONENTS_V2`",
          "",
          "**─── Limites da Discord API ───**",
          "• Máximo 5 rows raiz",
          "• Máximo 5 botões por Action Row",
          "• Máximo 10 itens por Media Gallery",
          "• Payload máximo ~8000 chars",
          "• Containers não podem ser aninhados"
        ].join("\n")
      }

    ];

    await DiscordRequest(
  `/interactions/${i.id}/${i.token}/callback`,
  {
    method: "POST",
    body: {
      type: 4,
      data: {
        embeds: embeds,
        flags: 64
      }
    }
  }
);

    

  }
});
    

    return [
      { type: 1, components: [navSelect]                                          },
      { type: 1, components: [addLayoutSelect]                                    },
      { type: 1, components: [addContentSelect]                                   },
      { type: 1, components: [editBtn, removeBtn, moveUpBtn, moveDownBtn]         },
      { type: 1, components: [cv2PreviewBtn, cv2SendBtn, cv2WebhookBtn, jsonBtn, helpBtn] }
    ];
  }

  async function openBlockEditor(i, block) {
    const MAP = {
      text      : openTextDisplayEditor,
      gallery   : openGalleryEditor,
      section   : openSectionEditor,
      action_row: openActionRowEditor,
      separator : openSeparatorEditor,
      container : openContainerEditor
    };
    return MAP[block.kind]?.(i, block)
      ?? safeEphemeral(i, "❌ Tipo de bloco sem editor disponível.");
  }

  async function openTextDisplayEditor(i, block) {
    const modal = client.interactions.createModal({
      user : authorId,
      title: "Editar Text Display",
      components: [{
        type: 1,
        components: [{
          type      : 4, custom_id: "content",
          label     : "Conteúdo (markdown suportado)",
          style     : 2, required: true,
          value     : block.content || "",
          max_length: 4000
        }]
      }],
      funcao: async (mi, _, fields) => {
        block.content = fields.content ?? "";
        await safeUpdateEditor(mi);
      }
    });
    await client.interactions.showModal(i, modal);
  }

  async function openGalleryEditor(i, block) {
    if (!Array.isArray(block.items)) block.items = [];

    const itemOptions = block.items.length > 0
      ? block.items.map((it, idx) => ({
          label      : `🖼️ Item ${idx + 1}`,
          value      : `edit_${idx}`,
          description: it.url.slice(0, 50)
        }))
      : [];

    const options = [
      { label: "➕ Adicionar imagem ou vídeo", value: "add", description: `Atual: ${block.items.length}/10` },
      ...itemOptions,
      ...(block.items.length > 0 ? block.items.map((_, idx) => ({
        label: `🗑️ Remover Item ${idx + 1}`,
        value: `rm_${idx}`
      })) : [])
    ];

    const gallerySelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `🖼️ Media Gallery — ${block.items.length}/10 itens`,
        options    : options.slice(0, 25)
      },
      funcao: async (si) => {
        const val = si.data.values[0];

        if (val.startsWith("rm_")) {
          const idx = parseInt(val.slice(3), 10);
          block.items.splice(idx, 1);
          return safeUpdateEditor(si);
        }

        const isEdit   = val.startsWith("edit_");
        const editIdx  = isEdit ? parseInt(val.slice(5), 10) : -1;
        const existing = isEdit ? block.items[editIdx] : null;

        if (val === "add" && block.items.length >= 10) {
          return safeEphemeral(si, "❌ Máximo de 10 itens por Media Gallery.");
        }

        const modal = client.interactions.createModal({
          user : authorId,
          title: isEdit ? `Editar Item ${editIdx + 1}` : "Adicionar Mídia",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "url",         label: "URL da mídia (imagem ou vídeo)", style: 1, required: true,  value: existing?.url         || "" }] },
            { type: 1, components: [{ type: 4, custom_id: "description", label: "Descrição (opcional)",           style: 1, required: false, value: existing?.description || "" }] },
            { type: 1, components: [{ type: 4, custom_id: "spoiler",     label: "Marcar como spoiler? sim/nao",   style: 1, required: false, value: existing?.spoiler ? "sim" : "nao" }] }
          ],
          funcao: async (mi, _, fields) => {
            const url = (fields.url || "").trim();
            if (!url || !/^https?:\/\/.+/.test(url)) return safeEphemeral(mi, "❌ URL inválida. Deve começar com https://");
            const item = { url, description: fields.description?.trim() || "", spoiler: fields.spoiler?.toLowerCase() === "sim" };
            if (isEdit) block.items[editIdx] = item;
            else        block.items.push(item);
            await safeUpdateEditor(mi);
          }
        });
        await client.interactions.showModal(si, modal);
      }
    });

    const galleryContent = [
      `🖼️ **Media Gallery** — ${block.items.length}/10 itens`,
      block.items.length
        ? block.items.map((it, idx) => `  ${idx + 1}. ${it.url.slice(0, 60)}`).join("\n")
        : "  *Vazio — adicione itens abaixo.*"
    ].join("\n");

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : {
        type: 7,
        data: {
          content   : buildStatusText() + "\n\n" + galleryContent,
          embeds    : [],
          components: [
            { type: 1, components: [gallerySelect] },
            ...buildEditorUI().slice(1)
          ]
        }
      }
    });
  }

  async function openSectionEditor(i, block) {
    const options = [
      { label: "✏️ Editar texto da section",          value: "text",         description: "Texto principal (markdown)" },
      { label: "🖼️ Definir acessório: Thumbnail",     value: "acc_thumbnail", description: "Imagem ao lado do texto" },
      { label: "🔗 Definir acessório: Link Button",   value: "acc_button",    description: "Botão de link ao lado do texto" },
      { label: "🗑️ Remover acessório",                value: "acc_remove",    description: `Atual: ${block.accessory?.kind ?? "nenhum"}` }
    ];

    const sectionSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `📐 Section — acessório: ${block.accessory?.kind ?? "nenhum"}`,
        options
      },
      funcao: async (si) => {
        const val = si.data.values[0];

        if (val === "acc_remove") {
          block.accessory = null;
          return safeUpdateEditor(si);
        }

        if (val === "text") {
          const modal = client.interactions.createModal({
            user : authorId,
            title: "Texto da Section",
            components: [{
              type: 1,
              components: [{
                type      : 4, custom_id: "text",
                label     : "Texto (markdown suportado)",
                style     : 2, required: true,
                value     : block.text || "",
                max_length: 4000
              }]
            }],
            funcao: async (mi, _, fields) => {
              block.text = fields.text || "";
              await safeUpdateEditor(mi);
            }
          });
          return client.interactions.showModal(si, modal);
        }

        if (val === "acc_thumbnail") {
          const modal = client.interactions.createModal({
            user : authorId,
            title: "Acessório: Thumbnail",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "url",         label: "URL da imagem (https://...)",  style: 1, required: true,  value: block.accessory?.url         || "" }] },
              { type: 1, components: [{ type: 4, custom_id: "description", label: "Descrição alt (opcional)",     style: 1, required: false, value: block.accessory?.description || "" }] },
              { type: 1, components: [{ type: 4, custom_id: "spoiler",     label: "Spoiler? sim/nao",             style: 1, required: false, value: block.accessory?.spoiler ? "sim" : "nao" }] }
            ],
            funcao: async (mi, _, fields) => {
              const url = (fields.url || "").trim();
              if (!url || !/^https?:\/\/.+/.test(url)) return safeEphemeral(mi, "❌ URL inválida.");
              block.accessory = { kind: "thumbnail", url, description: fields.description?.trim() || "", spoiler: fields.spoiler?.toLowerCase() === "sim" };
              await safeUpdateEditor(mi);
            }
          });
          return client.interactions.showModal(si, modal);
        }

        if (val === "acc_button") {
          return openLinkButtonModal(si, block.accessory?.kind === "button_link" ? block.accessory : null, edited => {
            block.accessory = { kind: "button_link", ...edited };
          });
        }
      }
    });

    const sectionContent = [
      `📐 **Section**`,
      `Texto: "${(block.text || "").slice(0, 60)}"`,
      `Acessório: ${block.accessory ? `${KIND_ICON[block.accessory.kind] ?? ""} ${block.accessory.kind}` : "nenhum"}`
    ].join("\n");

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : {
        type: 7,
        data: {
          content   : buildStatusText() + "\n\n" + sectionContent,
          embeds    : [],
          components: [
            { type: 1, components: [sectionSelect] },
            ...buildEditorUI().slice(1)
          ]
        }
      }
    });
  }

  async function openActionRowEditor(i, block) {
    if (!Array.isArray(block.buttons)) block.buttons = [];

    const baseOptions = [{ label: "➕ Adicionar Link Button", value: "add", description: `Atual: ${block.buttons.length}/5` }];

    const editOptions = block.buttons.map((b, idx) => ({
      label      : `✏️ Editar Botão ${idx + 1}${b.label ? `: ${b.label}` : ""}`,
      value      : `edit_${idx}`,
      description: b.url.slice(0, 50)
    }));

    const removeOptions = block.buttons.map((_, idx) => ({
      label: `🗑️ Remover Botão ${idx + 1}`,
      value: `rm_${idx}`
    }));

    const allOptions = [...baseOptions, ...editOptions, ...removeOptions];

    const rowSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `🔘 Action Row — ${block.buttons.length}/5 Link Buttons`,
        options    : allOptions.slice(0, 25)
      },
      funcao: async (si) => {
        const val = si.data.values[0];

        if (val === "add") {
          if (block.buttons.length >= 5) return safeEphemeral(si, "❌ Máximo de 5 botões por Action Row.");
          return openLinkButtonModal(si, null, newBtn => block.buttons.push(newBtn));
        }

        if (val.startsWith("edit_")) {
          const idx = parseInt(val.slice(5), 10);
          return openLinkButtonModal(si, block.buttons[idx], edited => { block.buttons[idx] = edited; });
        }

        if (val.startsWith("rm_")) {
          const idx = parseInt(val.slice(3), 10);
          block.buttons.splice(idx, 1);
          return safeUpdateEditor(si);
        }
      }
    });

    const rowContent = [
      `🔘 **Action Row** — ${block.buttons.length}/5 Link Buttons`,
      block.buttons.length
        ? block.buttons.map((b, idx) => `  ${idx + 1}. ${b.label || "(sem label)"}  →  ${b.url.slice(0, 50)}`).join("\n")
        : "  *Vazio — adicione botões abaixo.*"
    ].join("\n");

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : {
        type: 7,
        data: {
          content   : buildStatusText() + "\n\n" + rowContent,
          embeds    : [],
          components: [
            { type: 1, components: [rowSelect] },
            ...buildEditorUI().slice(1)
          ]
        }
      }
    });
  }

  async function openLinkButtonModal(i, existing, onSave) {
    const modal = client.interactions.createModal({
      user : authorId,
      title: existing ? "Editar Link Button" : "Novo Link Button",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "label",    label: "Label (texto visível no botão)",  style: 1, required: false, value: existing?.label    || "", max_length: 80  }] },
        { type: 1, components: [{ type: 4, custom_id: "url",      label: "URL de destino (https://...)",    style: 1, required: true,  value: existing?.url      || "", max_length: 512 }] },
        { type: 1, components: [{ type: 4, custom_id: "emoji",    label: "Emoji (unicode 🔗 ou ID custom)", style: 1, required: false, value: existing?.emoji    || ""                  }] },
        { type: 1, components: [{ type: 4, custom_id: "disabled", label: "Desativado? sim/nao",             style: 1, required: false, value: existing?.disabled ? "sim" : "nao"        }] }
      ],
      funcao: async (mi, _, fields) => {
        const url = (fields.url || "").trim();
        if (!url || !/^https?:\/\/.+/.test(url)) return safeEphemeral(mi, "❌ URL inválida. Deve começar com https://");
        if (!fields.label?.trim() && !fields.emoji?.trim()) return safeEphemeral(mi, "❌ O botão precisa de pelo menos um label ou emoji.");
        onSave({
          label   : fields.label?.trim()  || "",
          url,
          emoji   : fields.emoji?.trim()  || "",
          disabled: fields.disabled?.toLowerCase() === "sim"
        });
        await safeUpdateEditor(mi);
      }
    });
    await client.interactions.showModal(i, modal);
  }

  async function openSeparatorEditor(i, block) {
    const options = [
      { label: "Espaçamento Pequeno (small)", value: "small",   description: "Espaço menor entre blocos" },
      { label: "Espaçamento Grande (large)",  value: "large",   description: "Espaço maior entre blocos" },
      { label: "Ativar linha divisória",      value: "div_on",  description: `Atual: ${block.divider ? "ativado" : "desativado"}` },
      { label: "Desativar linha divisória",   value: "div_off", description: `Atual: ${block.divider ? "ativado" : "desativado"}` }
    ];

    const sepSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `➖ Separator — spacing: ${block.spacing}, divider: ${block.divider}`,
        options
      },
      funcao: async (si) => {
        const val = si.data.values[0];
        if (val === "small")   block.spacing = "small";
        if (val === "large")   block.spacing = "large";
        if (val === "div_on")  block.divider  = true;
        if (val === "div_off") block.divider  = false;
        await safeUpdateEditor(si);
      }
    });

    const sepContent = [
      `➖ **Separator**`,
      `Espaçamento: \`${block.spacing}\``,
      `Linha divisória: \`${block.divider ? "ativada" : "desativada"}\``
    ].join("\n");

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : {
        type: 7,
        data: {
          content   : buildStatusText() + "\n\n" + sepContent,
          embeds    : [],
          components: [
            { type: 1, components: [sepSelect] },
            ...buildEditorUI().slice(1)
          ]
        }
      }
    });
  }

  async function openContainerEditor(i, block) {
    if (!Array.isArray(block.children)) block.children = [];

    const accentHex = block.accentColor !== null && block.accentColor !== undefined
      ? `#${block.accentColor.toString(16).padStart(6, "0").toUpperCase()}`
      : "nenhum";

    const childOptions = block.children.map((c, idx) => ({
      label      : `✏️ Editar filho ${idx + 1}: ${KIND_ICON[c.kind] ?? ""} ${KIND_LABEL[c.kind] ?? c.kind}`,
      value      : `edit_child_${idx}`,
      description: blockSummary(c).slice(0, 50)
    }));

    const removeChildOptions = block.children.map((c, idx) => ({
      label: `🗑️ Remover filho ${idx + 1}: ${KIND_LABEL[c.kind] ?? c.kind}`,
      value: `rm_child_${idx}`
    }));

    const addOptions = [
      { label: "📝 Adicionar Text Display",  value: "child_textDisplay",  description: "Texto markdown" },
      { label: "🖼️ Adicionar Media Gallery", value: "child_mediaGallery", description: "Galeria de mídias" },
      { label: "🔘 Adicionar Action Row",    value: "child_actionRow",    description: "Botões de link" },
      { label: "📐 Adicionar Section",       value: "child_section",      description: "Texto + acessório" },
      { label: "➖ Adicionar Separator",     value: "child_separator",    description: "Divisor visual" }
    ];

    const settingsOptions = [
      { label: "🎨 Definir Accent Color",  value: "color",   description: `Atual: ${accentHex}` },
      { label: "🙈 Toggle Spoiler",        value: "spoiler", description: `Atual: ${block.spoiler ? "ativado" : "desativado"}` }
    ];

    const allOptions = [...addOptions, ...settingsOptions, ...childOptions, ...removeChildOptions];

    const containerSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `📦 Container — ${block.children.length} filho(s) | accent: ${accentHex}`,
        options    : allOptions.slice(0, 25)
      },
      funcao: async (si) => {
        const val = si.data.values[0];

        if (val === "spoiler") {
          block.spoiler = !block.spoiler;
          return safeUpdateEditor(si);
        }

        if (val === "color") {
          const hexModal = client.interactions.createModal({
            user : authorId,
            title: "Accent Color do Container",
            components: [{
              type: 1,
              components: [{
                type       : 4, custom_id: "hex",
                label      : "HEX (ex: 5865F2) — vazio para remover",
                style      : 1, required: false,
                placeholder: "5865F2",
                value      : block.accentColor !== null ? block.accentColor.toString(16).padStart(6, "0") : ""
              }]
            }],
            funcao: async (mi, _, fields) => {
              const hex = (fields.hex || "").replace("#", "").trim();
              if (!hex)                               block.accentColor = null;
              else if (/^[0-9A-Fa-f]{6}$/.test(hex)) block.accentColor = parseInt(hex, 16);
              else return safeEphemeral(mi, "❌ HEX inválido. Use 6 caracteres (ex: 5865F2).");
              await safeUpdateEditor(mi);
            }
          });
          return client.interactions.showModal(si, hexModal);
        }

        if (val.startsWith("edit_child_")) {
          const idx   = parseInt(val.slice(11), 10);
          const child = block.children[idx];
          if (!child) return safeEphemeral(si, "❌ Filho não encontrado.");
          return openBlockEditor(si, child);
        }

        if (val.startsWith("rm_child_")) {
          const idx = parseInt(val.slice(9), 10);
          block.children.splice(idx, 1);
          return safeUpdateEditor(si);
        }

        if (val.startsWith("child_")) {
          const kind  = val.slice(6);
          const child = BLOCK[kind]?.();
          if (!child) return;
          block.children.push(child);
          const parentIdx  = state.path[state.path.length - 1];
          state.path = [...state.path, block.children.length - 1];
          return safeUpdateEditor(si);
        }
      }
    });

    const contContent = [
      `📦 **Container**`,
      `Filhos: ${block.children.length}  |  Spoiler: ${block.spoiler}  |  Accent: \`${accentHex}\``,
      block.children.length
        ? block.children.map((c, idx) => `  ${idx + 1}. ${KIND_ICON[c.kind] ?? ""} ${KIND_LABEL[c.kind] ?? c.kind}  ·  ${blockSummary(c).slice(0, 45)}`).join("\n")
        : "  *Vazio — adicione filhos abaixo.*"
    ].join("\n");

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : {
        type: 7,
        data: {
          content   : buildStatusText() + "\n\n" + contContent,
          embeds    : [],
          components: [
            { type: 1, components: [containerSelect] },
            ...buildEditorUI().slice(1)
          ]
        }
      }
    });
  }

  await DiscordRequest(
    `/webhooks/${interaction.application_id}/${interaction.token}`,
    {
      method: "POST",
      body  : {
        content   : buildStatusText(),
        embeds    : [],
        components: buildEditorUI()
      }
    }
  );
}

async function openWebhookModal(i, authorId, client) {
  return new Promise((resolve) => {
    const modal = client.interactions.createModal({
      user : authorId,
      title: "Enviar via Webhook",
      components: [
        {
          type: 1,
          components: [{
            type       : 4, custom_id: "webhookUrl",
            label      : "URL do Webhook",
            style      : 1, required: true,
            placeholder: "https://discord.com/api/webhooks/ID/TOKEN"
          }]
        },
        {
          type: 1,
          components: [{
            type       : 4, custom_id: "username",
            label      : "Nome exibido (opcional)",
            style      : 1, required: false,
            placeholder: "Deixe vazio para usar o nome padrão"
          }]
        },
        {
          type: 1,
          components: [{
            type       : 4, custom_id: "avatarUrl",
            label      : "URL do Avatar (opcional)",
            style      : 1, required: false,
            placeholder: "https://cdn.discordapp.com/..."
          }]
        }
      ],
      funcao: async (mi, _, fields) => {
        const url = (fields.webhookUrl || "").trim();

        const isDiscordWebhook =
          url.startsWith("https://discord.com/api/webhooks/") ||
          url.startsWith("https://discordapp.com/api/webhooks/");

        if (!isDiscordWebhook) {
          await DiscordRequest(`/interactions/${mi.id}/${mi.token}/callback`, {
            method: "POST",
            body  : { type: 4, data: { content: "❌ URL de webhook inválida. Deve ser uma URL de webhook do Discord.", flags: 64 } }
          });
          return resolve(null);
        }

        resolve({
          interaction: mi,
          webhookUrl : url,
          username   : fields.username?.trim()  || null,
          avatarUrl  : fields.avatarUrl?.trim() || null
        });
      }
    });

    client.interactions.showModal(i, modal);
  });
}
