"use strict";

const DiscordRequest     = require("../../function/DiscordRequest.js");
const GetPerm            = require("../../function/Utils/GetPerm.js");
const { sendMessage, editMessage, ensureWebhook } = require("../../function/Manager/WebhookManager.js");
const { SavedMessageModel } = require("../../Mongodb/savedMessage.js");

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_EMBEDS       = 10;
const IS_COMPONENTS_V2 = 1 << 15;

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

const PRESET_COLORS = [
  { label: "🔵 Azul",              value: "3498DB" },
  { label: "🟢 Verde",             value: "2ECC71" },
  { label: "🔴 Vermelho",          value: "E74C3C" },
  { label: "🟣 Roxo",              value: "9B59B6" },
  { label: "🟡 Amarelo",           value: "F1C40F" },
  { label: "⚫ Preto",             value: "000001" },
  { label: "⚪ Branco",            value: "FFFFFF" },
  { label: "💜 Discord Blurple",   value: "5865F2" },
  { label: "🎨 HEX Personalizado", value: "custom" }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function replyEphemeral(interaction, content) {
  return DiscordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    { method: "POST", body: { type: 4, data: { content, flags: 64 } } }
  );
}

function cleanObject(obj) {
  if (Array.isArray(obj)) return obj.map(cleanObject).filter(v => v != null);
  if (obj !== null && typeof obj === "object") {
    const out = {};
    for (const key of Object.keys(obj)) {
      const v = cleanObject(obj[key]);
      if (v !== undefined && v !== null && v !== "" &&
          !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)) {
        out[key] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return (obj == null) ? undefined : obj;
}

function buildVariableParser(interaction) {
  const user         = interaction.member.user;
  const guildId      = interaction.guild_id ?? interaction.guild?.id ?? "";
  const icon         = interaction.guild?.icon ?? null;
  const avatarUrl    = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : "";
  const guildIconUrl = (guildId && icon)
    ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png` : "";

  const TOKENS = Object.freeze({
    "(user.id)"    : user.id        ?? "",
    "(user.name)"  : user.username  ?? "",
    "(user.tag)"   : user.username  ?? "",
    "(user.avatar)": avatarUrl,
    "(guild.id)"   : guildId,
    "(guild.name)" : interaction.guild?.name ?? "",
    "(guild.icon)" : guildIconUrl
  });

  function parseString(text) {
    if (typeof text !== "string" || !text.includes("(")) return text;
    let result = text;
    for (const [token, value] of Object.entries(TOKENS))
      if (result.includes(token)) result = result.replaceAll(token, value);
    return result;
  }

  function applyVariables(value) {
    if (typeof value === "string") return parseString(value);
    if (Array.isArray(value))      return value.map(applyVariables);
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) out[key] = applyVariables(value[key]);
      return out;
    }
    return value;
  }

  return { parseString, applyVariables };
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

function embedLabel(index) { return `Embed ${index + 1}`; }

// ─── Busca mensagens salvas e exibe select para escolher ou criar nova ────────
async function checkExistingAndPrompt(interaction, client, type) {
  const authorId = interaction.member.user.id;
  const guildId  = interaction.guild_id;

  const saved = await SavedMessageModel
    .find({ guildId, type })
    .sort({ updatedAt: -1 })
    .limit(24)
    .lean();

  // Sem mensagens salvas → abre editor diretamente
  if (!saved.length) {
    if (type === "embed")        return runEmbedEditor(interaction, client);
    return runComponentsV2Editor(interaction, client);
  }

  // Com mensagens salvas → pergunta se quer editar uma ou criar nova
  const options = [
    { label: "✨ Criar nova mensagem", value: "__new__", description: "Abre o editor em branco" },
    ...saved.map(m => ({
      label      : `${m.type === "embed" ? "📋" : "🧩"} ${m.messageId ?? "sem ID"} — #${m.channelId}`,
      value      : m._id.toString(),
      description: `${new Date(m.updatedAt).toLocaleString("pt-BR")}`
    }))
  ];

  const typeLabel = type === "embed" ? "Embed" : "Components V2";

  const listSelect = client.interactions.createSelect({
    user: authorId,
    data: { placeholder: `📂 Mensagens ${typeLabel} salvas — escolha ou crie nova`, options },
    funcao: async (si) => {
      const chosen = si.data.values[0];
      if (chosen === "__new__") {
        await DiscordRequest(`/interactions/${si.id}/${si.token}/callback`,
          { method: "POST", body: { type: 6 } }); // deferred update silencioso
        if (type === "embed") return runEmbedEditor(interaction, client);
        return runComponentsV2Editor(interaction, client);
      }

      const doc = await SavedMessageModel.findById(chosen).lean();
      if (!doc) return replyEphemeral(si, "❌ Mensagem não encontrada.");

      await DiscordRequest(`/interactions/${si.id}/${si.token}/callback`,
        { method: "POST", body: { type: 6 } });

      if (doc.type === "embed") return runEmbedEditor(interaction, client, doc);
      return runComponentsV2Editor(interaction, client, doc);
    }
  });

  await DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
    method: "POST",
    body  : {
      content   : `📂 **Mensagens ${typeLabel} salvas neste servidor:**\nEscolha uma para editar ou crie uma nova.`,
      flags     : 64,
      components: [{ type: 1, components: [listSelect] }]
    }
  });
}

// ─── MODULE EXPORT ────────────────────────────────────────────────────────────
module.exports = {
  data: {
    name       : "criar",
    description: "Editor avançado de Embed e Components V2",
    type       : 1,
    options    : [
      { name: "embed",        description: "Editor avançado de Embed com preview em tempo real", type: 1 },
      { name: "componentsv2", description: "Editor visual de Components V2 da Discord API",      type: 1 },
      {
        name       : "editar",
        description: "Reabrir e editar uma mensagem salva anteriormente",
        type       : 1,
        options    : [{
          name       : "id",
          description: "ID da mensagem salva (deixe vazio para ver a lista)",
          type       : 3,
          required   : false
        }]
      }
    ]
  },

  async execute(interaction, client) {
    const perms = await GetPerm({ id: interaction.member.user.id, guildId: interaction.guild_id });
    if (!perms || !perms.includes("MANAGE_CHANNELS"))
      return replyEphemeral(interaction, "❌ Você precisa da permissão **Gerenciar Canais**.");

    await DiscordRequest(`/interactions/${interaction.id}/${interaction.token}/callback`,
      { method: "POST", body: { type: 5 } });

    const sub = interaction.data?.options?.[0]?.name;

    if (sub === "editar")       return runEditSavedMessage(interaction, client);
    if (sub === "componentsv2") return checkExistingAndPrompt(interaction, client, "components_v2");
    // default: embed
    return checkExistingAndPrompt(interaction, client, "embed");
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  EDIT SAVED MESSAGE  (/criar editar)
// ══════════════════════════════════════════════════════════════════════════════
async function runEditSavedMessage(interaction, client) {
  const authorId = interaction.member.user.id;
  const guildId  = interaction.guild_id;
  const msgId    = interaction.data?.options?.[0]?.options?.find(o => o.name === "id")?.value;

  // List mode
  if (!msgId) {
    const saved = await SavedMessageModel
      .find({ guildId })
      .sort({ updatedAt: -1 })
      .limit(25)
      .lean();

    if (!saved.length) {
      return DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
        method: "POST",
        body  : { content: "📭 Nenhuma mensagem salva neste servidor.", flags: 64 }
      });
    }

    const options = saved.map(m => ({
      label      : `${m.type === "embed" ? "📋" : "🧩"} ${m.messageId ?? "sem ID"} — #${m.channelId}`,
      value      : m._id.toString(),
      description: `${m.type} • ${new Date(m.updatedAt).toLocaleString("pt-BR")}`
    }));

    const listSelect = client.interactions.createSelect({
      user: authorId,
      data: { placeholder: "Selecione uma mensagem para editar", options },
      funcao: async (si) => {
        const doc = await SavedMessageModel.findById(si.data.values[0]).lean();
        if (!doc) return replyEphemeral(si, "❌ Mensagem não encontrada.");
        await replyEphemeral(si, `🔄 Abrindo editor para mensagem \`${doc.messageId}\`…`);
        if (doc.type === "embed") return runEmbedEditor(interaction, client, doc);
        return runComponentsV2Editor(interaction, client, doc);
      }
    });

    return DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
      method: "POST",
      body  : {
        content   : "📂 **Mensagens salvas neste servidor:**",
        flags     : 64,
        components: [{ type: 1, components: [listSelect] }]
      }
    });
  }

  // Direct ID mode
  const doc = await SavedMessageModel.findById(msgId).lean();
  if (!doc || doc.guildId !== guildId)
    return DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
      method: "POST", body: { content: "❌ Mensagem não encontrada.", flags: 64 }
    });

  if (doc.type === "embed") return runEmbedEditor(interaction, client, doc);
  return runComponentsV2Editor(interaction, client, doc);
}

// ══════════════════════════════════════════════════════════════════════════════
//  EMBED EDITOR
// ══════════════════════════════════════════════════════════════════════════════
async function runEmbedEditor(interaction, client, existingDoc = null) {
  const authorId = interaction.member.user.id;
  const guildId  = interaction.guild_id;
  const { parseString, applyVariables } = buildVariableParser(interaction);

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    content  : existingDoc?.content ?? "",
    embeds   : existingDoc?.embeds?.length ? existingDoc.embeds : [createBlankEmbed(0)],
    current  : 0,
    // persistence
    savedId  : existingDoc?._id?.toString() ?? null,
    channelId: existingDoc?.channelId ?? null,
    messageId: existingDoc?.messageId ?? null,
    webhook  : existingDoc?.webhook   ?? null,
    // webhook display profile
    webhookProfile: {
      username : existingDoc?.webhookProfile?.username  ?? null,
      avatarUrl: existingDoc?.webhookProfile?.avatarUrl ?? null
    }
  };

  const currentEmbed = () => state.embeds[state.current];

  function buildEmbeds(applyVars = true) {
    return state.embeds
      .map(e => {
        const clone  = JSON.parse(JSON.stringify(e));
        const parsed = applyVars ? applyVariables(clone) : clone;
        return cleanObject(parsed);
      })
      .filter(Boolean);
  }

  async function updateMessage(i) {
    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : {
        type: 7,
        data: {
          content   : parseString(state.content) || null,
          embeds    : buildEmbeds(true),
          components: buildEditorRows()
        }
      }
    });
  }

  async function openTextModal(i, title, current, onSubmit, multiline = false) {
    const modal = client.interactions.createModal({
      user : authorId,
      title,
      components: [{ type: 1, components: [{ type: 4, custom_id: "input", label: title, style: multiline ? 2 : 1, required: false, value: current || "" }] }],
      funcao: async (mi, _, fields) => {
        await onSubmit(fields.input ?? "");
        await updateMessage(mi);
      }
    });
    await client.interactions.showModal(i, modal);
  }

  // ── Validate ────────────────────────────────────────────────────────────────
  function validate() {
    const errors = [];
    const embeds = buildEmbeds(true);
    if (!embeds.length) errors.push("Nenhuma embed com conteúdo.");
    embeds.forEach((e, idx) => {
      const total = (e.title?.length ?? 0) + (e.description?.length ?? 0);
      if (total > 6000) errors.push(`Embed ${idx + 1}: conteúdo muito longo.`);
    });
    return errors;
  }

  // ── Save to MongoDB ─────────────────────────────────────────────────────────
  async function persistState(channelId, messageId, webhook, usedFallback, sendError) {
    const data = {
      guildId,
      channelId,
      messageId,
      type          : "embed",
      content       : state.content,
      embeds        : state.embeds,
      components    : [],
      webhook       : webhook ?? { id: null, token: null },
      webhookProfile: state.webhookProfile,
      usedFallback,
      sendError     : sendError ?? null,
      createdBy     : authorId,
      updatedAt     : new Date()
    };

    if (state.savedId) {
      const doc = await SavedMessageModel.findByIdAndUpdate(state.savedId, data, { new: true });
      return doc;
    }
    const doc = await new SavedMessageModel({ ...data, createdAt: new Date() }).save();
    state.savedId = doc._id.toString();
    return doc;
  }

  // ── Send pipeline ───────────────────────────────────────────────────────────
  async function doSend(i, channelId) {
    const errors = validate();
    if (errors.length)
      return replyEphemeral(i, `❌ **Payload inválido:**\n${errors.map(e => `• ${e}`).join("\n")}`);

    const payload = {
      content: parseString(state.content) || null,
      embeds : buildEmbeds(true)
    };

    const result = await sendMessage({
      channelId,
      payload,
      isCV2        : false,
      cachedWebhook: state.webhook,
      profile      : state.webhookProfile
    });

    state.channelId = channelId;
    state.messageId = result.messageId;
    state.webhook   = result.webhook ?? state.webhook;

    await persistState(channelId, result.messageId, result.webhook, result.usedFallback, result.sendError);

    const who    = state.webhookProfile.username ? `**${state.webhookProfile.username}**` : "bot";
    const status = result.usedFallback
      ? `⚠️ Enviado via bot (webhook falhou). ID: \`${result.messageId}\``
      : `✅ Enviado como ${who}! ID: \`${result.messageId}\``;

    return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
      method: "POST",
      body  : { content: result.sendError ? `${status}\n⚠️ Erro: ${result.sendError}` : status, flags: 64 }
    });
  }

  // ── Re-send / edit existing message ────────────────────────────────────────
  async function doResend(i, channelId) {
    const errors = validate();
    if (errors.length)
      return replyEphemeral(i, `❌ **Payload inválido:**\n${errors.map(e => `• ${e}`).join("\n")}`);

    const payload = {
      content: parseString(state.content) || null,
      embeds : buildEmbeds(true)
    };

    if (state.messageId) {
      const result = await editMessage({
        channelId    : state.channelId ?? channelId,
        messageId    : state.messageId,
        payload,
        isCV2        : false,
        cachedWebhook: state.webhook
      });
      await persistState(state.channelId ?? channelId, state.messageId, state.webhook, result.usedFallback, result.sendError);
      return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
        method: "POST",
        body  : { content: result.ok ? "✅ Mensagem atualizada!" : `❌ Erro: ${result.sendError}`, flags: 64 }
      });
    }

    return doSend(i, channelId);
  }

  // ── Buttons / selects ───────────────────────────────────────────────────────
  const editorMenu = client.interactions.createSelect({
    user: authorId,
    data: {
      placeholder: "✏️ Editar Campo da Embed",
      options    : [
        { label: "Content",         value: "content"       },
        { label: "Title",           value: "title"         },
        { label: "Description",     value: "description"   },
        { label: "Title URL",       value: "url"           },
        { label: "Author Name",     value: "author_name"   },
        { label: "Author Icon URL", value: "author_icon"   },
        { label: "Author URL",      value: "author_url"    },
        { label: "Footer Text",     value: "footer_text"   },
        { label: "Footer Icon URL", value: "footer_icon"   },
        { label: "Thumbnail URL",   value: "thumbnail"     },
        { label: "Image URL",       value: "image"         }
      ]
    },
    funcao: async (i) => {
      const val   = i.data.values[0];
      const embed = currentEmbed();
      const MAP = {
        content    : ["Editar Content",        () => state.content,          v => { state.content         = v; }, true ],
        title      : ["Editar Título",          () => embed.title,            v => { embed.title           = v; }, false],
        description: ["Editar Descrição",       () => embed.description,      v => { embed.description     = v; }, true ],
        url        : ["Editar Title URL",       () => embed.url,              v => { embed.url             = v; }, false],
        author_name: ["Editar Author Name",     () => embed.author.name,      v => { embed.author.name     = v; }, false],
        author_icon: ["Editar Author Icon URL", () => embed.author.icon_url,  v => { embed.author.icon_url = v; }, false],
        author_url : ["Editar Author URL",      () => embed.author.url,       v => { embed.author.url      = v; }, false],
        footer_text: ["Editar Footer Text",     () => embed.footer.text,      v => { embed.footer.text     = v; }, false],
        footer_icon: ["Editar Footer Icon URL", () => embed.footer.icon_url,  v => { embed.footer.icon_url = v; }, false],
        thumbnail  : ["Editar Thumbnail URL",   () => embed.thumbnail.url,    v => { embed.thumbnail.url   = v; }, false],
        image      : ["Editar Image URL",       () => embed.image.url,        v => { embed.image.url       = v; }, false]
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
        { label: "➕ Adicionar Field",      value: "add"    },
        { label: "🗑️ Remover Última Field", value: "remove" }
      ]
    },
    funcao: async (i) => {
      const embed = currentEmbed();
      if (i.data.values[0] === "remove") {
        if (!embed.fields.length) return replyEphemeral(i, "❌ Não há fields para remover.");
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
          embed.fields.push({ name: fields.name, value: fields.value, inline: fields.inline?.toLowerCase() === "sim" });
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
        data: { placeholder: "Escolha uma cor…", options: PRESET_COLORS.map(c => ({ label: c.label, value: c.value })) },
        funcao: async (ci) => {
          const chosen = ci.data.values[0];
          const embed  = currentEmbed();
          if (chosen === "custom") {
            const hexModal = client.interactions.createModal({
              user : authorId,
              title: "Cor HEX Personalizada",
              components: [{ type: 1, components: [{ type: 4, custom_id: "hex", label: "Código HEX (ex: FF5733)", style: 1, required: true, max_length: 7, placeholder: "FF5733" }] }],
              funcao: async (mi, _, fields) => {
                const hex = (fields.hex || "").replace("#", "").trim();
                if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return replyEphemeral(mi, "❌ HEX inválido.");
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
        body  : { type: 4, data: { content: "🎨 **Qual cor?**", flags: 64, components: [{ type: 1, components: [colorSelect] }] } }
      });
    }
  });

  const prevEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "◀ Anterior", style: 2 },
    funcao: async (i) => { if (state.current > 0) state.current--; await updateMessage(i); }
  });

  const nextEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "Próxima ▶", style: 2 },
    funcao: async (i) => { if (state.current < state.embeds.length - 1) state.current++; await updateMessage(i); }
  });

  const addEmbedBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "➕ Embed", style: 3 },
    funcao: async (i) => {
      if (state.embeds.length >= MAX_EMBEDS) return replyEphemeral(i, `❌ Máximo de ${MAX_EMBEDS} embeds.`);
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
      if (state.embeds.length <= 1) return replyEphemeral(i, "❌ Deve existir ao menos uma embed.");
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
          options    : state.embeds.map((_, idx) => ({ label: embedLabel(idx), value: String(idx) }))
        },
        funcao: async (si) => {
          const idx    = parseInt(si.data.values[0], 10);
          const clean  = cleanObject(JSON.parse(JSON.stringify(state.embeds[idx])));
          const json   = JSON.stringify(clean, null, 2);
          const buffer = Buffer.from(json, "utf-8");
          await DiscordRequest(`/interactions/${si.id}/${si.token}/callback`, {
            method: "POST",
            body  : { type: 4, data: { content: `📋 **${embedLabel(idx)}**`, flags: 64 } },
            files : [{ name: "embed.json", data: buffer, contentType: "application/json" }]
          });
        }
      });
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : { type: 4, data: { content: "📦 **Qual embed exportar?**", flags: 64, components: [{ type: 1, components: [embedSelect] }] } }
      });
    }
  });

  const previewBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "👁️ Preview", style: 2 },
    funcao: async (i) => {
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : { type: 4, data: { content: parseString(state.content) || null, embeds: buildEmbeds(true), flags: 64 } }
      });
    }
  });

  // ── Send button ─────────────────────────────────────────────────────────────
  const sendBtn = client.interactions.createButton({
    user: authorId,
    data: { label: state.messageId ? "🔄 Atualizar" : "📨 Enviar", style: 3 },
    funcao: async (i) => {
      // If already sent → offer update or resend to new channel
      if (state.messageId) {
        const updateSelect = client.interactions.createSelect({
          user: authorId,
          data: {
            placeholder: "O que deseja fazer?",
            options    : [
              { label: "🔄 Atualizar mensagem existente", value: "update",  description: `Mensagem ID: ${state.messageId}` },
              { label: "📨 Enviar para novo canal",        value: "new_ch"  }
            ]
          },
          funcao: async (si) => {
            if (si.data.values[0] === "update") return doResend(si, state.channelId);

            await replyEphemeral(si, "📡 Envie o **ID** ou **menção** do canal destino. *(30s)*");
            try {
              const msg = await client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: authorId, time: 30000 });
              const channelId = msg.content.replace(/[<#>]/g, "").trim();
              return doSend(si, channelId);
            } catch {
              return DiscordRequest(`/webhooks/${interaction.application_id}/${si.token}`, {
                method: "POST", body: { content: "⏱️ Tempo esgotado.", flags: 64 }
              });
            }
          }
        });
        return DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
          method: "POST",
          body  : { type: 4, data: { content: "📨 **O que deseja fazer?**", flags: 64, components: [{ type: 1, components: [updateSelect] }] } }
        });
      }

      // Fresh send — ask for channel
      await replyEphemeral(i, "📡 Envie o **ID** ou **menção** (`#canal`) do canal destino. *(30s)*");
      try {
        const msg       = await client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: authorId, time: 30000 });
        const channelId = msg.content.replace(/[<#>]/g, "").trim();
        return doSend(i, channelId);
      } catch {
        return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
          method: "POST", body: { content: "⏱️ Tempo esgotado.", flags: 64 }
        });
      }
    }
  });

  const varsBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "📌 Variáveis", style: 2 },
    funcao: async (i) => {
      await replyEphemeral(i,
        "**Variáveis disponíveis**\n```\n" +
        "(user.id)     → ID do usuário\n(user.name)   → Username\n" +
        "(user.avatar) → URL do avatar\n(guild.id)    → ID do servidor\n" +
        "(guild.name)  → Nome do servidor\n(guild.icon)  → URL do ícone\n```"
      );
    }
  });

  const savedInfoBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "💾 Salvo", style: 2 },
    funcao: async (i) => {
      const info = state.savedId
        ? `✅ **Salvo**\nID: \`${state.savedId}\`\nMensagem: \`${state.messageId ?? "não enviada"}\`\nCanal: \`${state.channelId ?? "—"}\``
        : "📭 Ainda não foi salvo. Envie a mensagem primeiro.";
      await replyEphemeral(i, info);
    }
  });

  // ── Webhook profile button ──────────────────────────────────────────────────
  const webhookProfileBtn = client.interactions.createButton({
    user: authorId,
    data: { label: "🪪 Perfil", style: 2 },
    funcao: async (i) => {
      const modal = client.interactions.createModal({
        user : authorId,
        title: "Perfil do Webhook",
        components: [
          {
            type: 1,
            components: [{
              type       : 4,
              custom_id  : "username",
              label      : "Nome exibido (deixe vazio = nome do bot)",
              style      : 1,
              required   : false,
              max_length : 80,
              placeholder: "Meu Bot",
              value      : state.webhookProfile.username ?? ""
            }]
          },
          {
            type: 1,
            components: [{
              type       : 4,
              custom_id  : "avatarUrl",
              label      : "URL do Avatar (deixe vazio = avatar do bot)",
              style      : 1,
              required   : false,
              max_length : 512,
              placeholder: "https://cdn.discordapp.com/...",
              value      : state.webhookProfile.avatarUrl ?? ""
            }]
          }
        ],
        funcao: async (mi, _, fields) => {
          const username  = fields.username?.trim()  || null;
          const avatarUrl = fields.avatarUrl?.trim() || null;

          if (avatarUrl && !/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(avatarUrl)) {
            return replyEphemeral(mi, "❌ URL de avatar inválida. Use uma URL direta de imagem (png, jpg, gif, webp).");
          }

          state.webhookProfile.username  = username;
          state.webhookProfile.avatarUrl = avatarUrl;

          const preview = [
            `✅ **Perfil do webhook atualizado!**`,
            `Nome: ${username  ? `\`${username}\`` : "*(padrão do bot)*"}`,
            `Avatar: ${avatarUrl ? `[link](${avatarUrl})` : "*(padrão do bot)*"}`
          ].join("\n");

          await DiscordRequest(`/interactions/${mi.id}/${mi.token}/callback`, {
            method: "POST",
            body  : { type: 4, data: { content: preview, flags: 64 } }
          });
        }
      });
      await client.interactions.showModal(i, modal);
    }
  });

  function buildEditorRows() {
    return [
      { type: 1, components: [editorMenu] },
      { type: 1, components: [fieldMenu] },
      { type: 1, components: [colorBtn, prevEmbedBtn, nextEmbedBtn, addEmbedBtn, removeEmbedBtn] },
      { type: 1, components: [previewBtn, sendBtn, jsonBtn, webhookProfileBtn, savedInfoBtn] }
    ];
  }

  await DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
    method: "POST",
    body  : {
      content   : null,
      embeds    : buildEmbeds(true),
      components: buildEditorRows()
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  COMPONENTS V2 EDITOR
// ══════════════════════════════════════════════════════════════════════════════
async function runComponentsV2Editor(interaction, client, existingDoc = null) {
  const authorId = interaction.member.user.id;
  const guildId  = interaction.guild_id;

  let _nextId = 0;
  const uid = () => ++_nextId;

  const BLOCK = {
    textDisplay : () => ({ _id: uid(), kind: "text",        content: "Texto aqui (**markdown** suportado)" }),
    mediaGallery: () => ({ _id: uid(), kind: "gallery",     items: [] }),
    section     : () => ({ _id: uid(), kind: "section",     text: "Texto da seção", accessory: null }),
    separator   : () => ({ _id: uid(), kind: "separator",   divider: true, spacing: "small" }),
    container   : () => ({ _id: uid(), kind: "container",   accentColor: null, spoiler: false, children: [] }),
    actionRow   : () => ({ _id: uid(), kind: "action_row",  buttons: [] }),
    selectMenu  : () => ({ _id: uid(), kind: "select_menu", placeholder: "Selecione uma opção", options: [] })
  };

  const state = {
    blocks   : existingDoc?.components ?? [],
    path     : [0],
    // persistence
    savedId  : existingDoc?._id?.toString() ?? null,
    channelId: existingDoc?.channelId ?? null,
    messageId: existingDoc?.messageId ?? null,
    webhook  : existingDoc?.webhook   ?? null,
    // webhook display profile
    webhookProfile: {
      username : existingDoc?.webhookProfile?.username  ?? null,
      avatarUrl: existingDoc?.webhookProfile?.avatarUrl ?? null
    }
  };

  // ── Tree helpers ────────────────────────────────────────────────────────────
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
    let arr  = state.blocks;
    let node = arr[path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      if (!node.children) return null;
      arr  = node.children;
      node = arr[path[i]];
    }
    return node?.children ?? null;
  }

  function currentBlock() { return getBlockByPath(state.path); }
  function addRootBlock(kind) {
    const b = BLOCK[kind]?.();
    if (!b) return;
    state.blocks.push(b);
    state.path = [state.blocks.length - 1];
  }

  // ── Serializers ─────────────────────────────────────────────────────────────
  function serializeButton(btn) {
    if (btn.kind === "flow") {
      const out = { type: CTYPE.BUTTON, style: Number(btn.style) || 1, custom_id: JSON.stringify({ t: "flow_trigger", f: btn.flowId }) };
      if (btn.label) out.label = btn.label;
      if (btn.emoji) out.emoji = /^\d{17,20}$/.test(btn.emoji.trim()) ? { id: btn.emoji.trim() } : { name: btn.emoji.trim() };
      return out;
    }
    const out = { type: CTYPE.BUTTON, style: 5, url: btn.url };
    if (btn.label)    out.label    = btn.label;
    if (btn.disabled) out.disabled = true;
    if (btn.emoji)    out.emoji    = /^\d{17,20}$/.test(btn.emoji.trim()) ? { id: btn.emoji.trim() } : { name: btn.emoji.trim() };
    return out;
  }

  function serializeBlock(block) {
    switch (block.kind) {
      case "text":
        return { type: CTYPE.TEXT_DISPLAY, content: block.content || "" };
      case "gallery": {
        if (!block.items?.length) return null;
        return { type: CTYPE.MEDIA_GALLERY, items: block.items.map(it => {
          const obj = { media: { url: it.url } };
          if (it.description) obj.description = it.description;
          if (it.spoiler)     obj.spoiler      = true;
          return obj;
        }) };
      }
      case "section": {
        const comp = { type: CTYPE.SECTION, components: [{ type: CTYPE.TEXT_DISPLAY, content: block.text || "" }] };
        if (block.accessory) {
          if (block.accessory.kind === "thumbnail") {
            comp.accessory = { type: CTYPE.THUMBNAIL, media: { url: block.accessory.url },
              ...(block.accessory.description ? { description: block.accessory.description } : {}),
              ...(block.accessory.spoiler     ? { spoiler: true } : {}) };
          } else if (block.accessory.kind === "button_link") {
            comp.accessory = { type: CTYPE.BUTTON, style: 5, url: block.accessory.url,
              ...(block.accessory.label   ? { label: block.accessory.label } : {}),
              ...(block.accessory.disabled ? { disabled: true } : {}) };
          }
        }
        return comp;
      }
      case "separator":
        return { type: CTYPE.SEPARATOR, divider: block.divider ?? true, spacing: block.spacing === "large" ? 2 : 1 };
      case "action_row":
        if (!block.buttons?.length) return null;
        return { type: CTYPE.ACTION_ROW, components: block.buttons.map(serializeButton) };
      case "select_menu": {
        if (!block.options?.length) return null;
        return { type: 1, components: [{ type: 3,
          custom_id: JSON.stringify({ t: "cv2_select", id: block._id }),
          placeholder: block.placeholder || "",
          min_values: 1, max_values: 1, disabled: false,
          options: block.options.map(o => ({
            label: o.label, value: JSON.stringify({ t: "flow_trigger", f: o.flowId }),
            description: o.description || null, emoji: o.emoji ? { name: o.emoji } : null, default: false
          }))
        }] };
      }
      case "container": {
        const children = (block.children || []).map(serializeBlock).filter(Boolean);
        const comp     = { type: CTYPE.CONTAINER, components: children };
        if (block.accentColor != null) comp.accent_color = block.accentColor;
        if (block.spoiler)             comp.spoiler       = true;
        return comp;
      }
      default: return null;
    }
  }

  function buildApiComponents() { return state.blocks.map(serializeBlock).filter(Boolean); }
  function buildApiPayload()    { return { flags: IS_COMPONENTS_V2, components: buildApiComponents() }; }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validatePayload() {
    const errors     = [];
    const components = buildApiComponents();
    if (!components.length) { errors.push("Nenhum componente adicionado."); return errors; }
    const json = JSON.stringify({ flags: IS_COMPONENTS_V2, components });
    if (json.length > 8000) errors.push(`Payload muito grande: ${json.length} chars.`);

    function validateNode(block) {
      if (block.kind === "gallery")    { if (!block.items?.length)   errors.push("Media Gallery vazia.");  }
      if (block.kind === "action_row") { if (!block.buttons?.length) errors.push("Action Row vazia.");     }
      if (block.kind === "select_menu"){ if (!block.options?.length) errors.push("Select Menu vazio.");    }
      if (block.kind === "container")  {
        if (!block.children?.length) errors.push("Container vazio.");
        block.children?.forEach(validateNode);
      }
    }
    state.blocks.forEach(validateNode);
    return errors;
  }

  // ── Persist ─────────────────────────────────────────────────────────────────
  async function persistState(channelId, messageId, webhook, usedFallback, sendError) {
    const data = {
      guildId,
      channelId,
      messageId,
      type          : "components_v2",
      content       : "",
      embeds        : [],
      components    : state.blocks,
      webhook       : webhook ?? { id: null, token: null },
      webhookProfile: state.webhookProfile,
      usedFallback,
      sendError     : sendError ?? null,
      createdBy     : authorId,
      updatedAt     : new Date()
    };
    if (state.savedId) {
      const doc = await SavedMessageModel.findByIdAndUpdate(state.savedId, data, { new: true });
      return doc;
    }
    const doc = await new SavedMessageModel({ ...data, createdAt: new Date() }).save();
    state.savedId = doc._id.toString();
    return doc;
  }

  // ── Send pipeline ───────────────────────────────────────────────────────────
  async function doSend(i, channelId) {
    const errors = validatePayload();
    if (errors.length) return replyEphemeral(i, `❌ **Payload inválido:**\n${errors.map(e => `• ${e}`).join("\n")}`);

    const payload = buildApiPayload();

    const result = await sendMessage({
      channelId,
      payload,
      isCV2        : true,
      cachedWebhook: state.webhook,
      profile      : state.webhookProfile
    });
    state.channelId = channelId;
    state.messageId = result.messageId;
    state.webhook   = result.webhook ?? state.webhook;

    await persistState(channelId, result.messageId, result.webhook, result.usedFallback, result.sendError);

    const who    = state.webhookProfile.username ? `**${state.webhookProfile.username}**` : "bot";
    const status = result.usedFallback
      ? `⚠️ Enviado via bot (webhook falhou). ID: \`${result.messageId}\``
      : `✅ Enviado como ${who}! ID: \`${result.messageId}\``;
    return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
      method: "POST",
      body  : { content: result.sendError ? `${status}\n⚠️ ${result.sendError}` : status, flags: 64 }
    });
  }

  async function doResend(i, channelId) {
    const errors = validatePayload();
    if (errors.length) return replyEphemeral(i, `❌ **Payload inválido:**\n${errors.map(e => `• ${e}`).join("\n")}`);

    const payload = buildApiPayload();

    if (state.messageId) {
      const result = await editMessage({ channelId: state.channelId ?? channelId, messageId: state.messageId, payload, isCV2: true, cachedWebhook: state.webhook });
      await persistState(state.channelId ?? channelId, state.messageId, state.webhook, result.usedFallback, result.sendError);
      return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
        method: "POST",
        body  : { content: result.ok ? "✅ Mensagem CV2 atualizada!" : `❌ Erro: ${result.sendError}`, flags: 64 }
      });
    }
    return doSend(i, channelId);
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────
  const KIND_ICON  = { text: "📝", gallery: "🖼️", section: "📐", separator: "➖", action_row: "🔘", container: "📦", select_menu: "📋" };
  const KIND_LABEL = { text: "Text Display", gallery: "Media Gallery", section: "Section", separator: "Separator", action_row: "Action Row", container: "Container", select_menu: "Select Menu" };

  function blockSummary(block) {
    switch (block.kind) {
      case "text"      : return `"${(block.content || "").slice(0, 32)}"`;
      case "gallery"   : return `${block.items?.length ?? 0}/10 itens`;
      case "section"   : return `"${(block.text || "").slice(0, 32)}"`;
      case "action_row": return `${block.buttons?.length ?? 0}/5 botões`;
      case "container" : return `${block.children?.length ?? 0} filho(s)`;
      case "separator" : return `spacing: ${block.spacing}`;
      default          : return "";
    }
  }

  function buildPathBreadcrumb() {
    if (!state.blocks.length) return "";
    const parts = [];
    let node = state.blocks[state.path[0]];
    if (!node) return "";
    parts.push(`${KIND_ICON[node.kind]} ${KIND_LABEL[node.kind]}`);
    for (let i = 1; i < state.path.length; i++) {
      if (!node.children) break;
      node = node.children[state.path[i]];
      if (!node) break;
      parts.push(`${KIND_ICON[node.kind]} ${KIND_LABEL[node.kind]}`);
    }
    return parts.length ? `> 📍 **Selecionado:** ${parts.join(" › ")}` : "";
  }

  function renderTreeLines(blocks, parentPath, depthPrefix, isRoot) {
    const lines = [];
    blocks.forEach((block, idx) => {
      const blockPath = isRoot ? [idx] : [...parentPath, idx];
      const isActive  = JSON.stringify(state.path) === JSON.stringify(blockPath);
      const isLast    = idx === blocks.length - 1;
      const connector = isRoot ? "" : (isLast ? "└─ " : "├─ ");
      const marker    = isActive ? "▶ " : "   ";
      const num       = isRoot ? `${idx + 1}. ` : "";
      const summary   = blockSummary(block);
      const activeMk  = isActive ? " **◄**" : "";
      lines.push(`${depthPrefix}${connector}${marker}${num}${KIND_ICON[block.kind]} **${KIND_LABEL[block.kind]}**${summary ? `  ·  ${summary}` : ""}${activeMk}`);
      if (block.kind === "container" && block.children?.length) {
        const childPfx = isRoot ? "" : (isLast ? "   " : "│  ");
        lines.push(...renderTreeLines(block.children, blockPath, depthPrefix + childPfx, false));
      }
    });
    return lines;
  }

  function buildStatusText() {
    const apiComps = buildApiComponents();
    const savedTag = state.savedId ? ` • 💾 \`${state.savedId.slice(-6)}\`` : "";
    const lines = [
      `### 🧩 Components V2 Builder${savedTag}`,
      `> 📦 **${state.blocks.length}** blocos  •  🧱 **${apiComps.length}** componentes`,
      ""
    ];
    if (!state.blocks.length) { lines.push("> *Nenhum bloco ainda.*"); return lines.join("\n"); }
    const crumb = buildPathBreadcrumb();
    if (crumb) lines.push(crumb, "");
    lines.push("**📋 Estrutura:**", ...renderTreeLines(state.blocks, [], "", true));
    return lines.join("\n");
  }

  async function safeUpdateEditor(i) {
    try {
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        body  : { type: 7, data: { content: buildStatusText(), embeds: [], components: buildEditorUI() } }
      });
    } catch (err) {
      try {
        await DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
          method: "POST", body: { content: `❌ Erro: ${err?.message ?? "desconhecido"}`, flags: 64 }
        });
      } catch {}
    }
  }

  async function safeEphemeral(i, content) {
    try {
      await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
        method: "POST", body: { type: 4, data: { content, flags: 64 } }
      });
    } catch {}
  }

  // ── Build editor UI rows ────────────────────────────────────────────────────
  function buildEditorUI() {
    const allNodes = [];
    function collectNodes(blocks, depth, parentPath, parentIsLast) {
      blocks.forEach((b, idx) => {
        const nodePath = parentPath ? [...parentPath, idx] : [idx];
        const isActive = JSON.stringify(state.path) === JSON.stringify(nodePath);
        const isLast   = idx === blocks.length - 1;
        const conn     = depth === 0 ? "" : (isLast ? "└─ " : "├─ ");
        const indent   = depth === 0 ? "" : "   ".repeat(depth - 1) + (parentIsLast ? "   " : "│  ");
        const mark     = isActive ? "▶ " : "   ";
        const num      = depth === 0 ? `${idx + 1}. ` : "";
        allNodes.push({ label: `${indent}${conn}${mark}${num}${KIND_ICON[b.kind]} ${KIND_LABEL[b.kind]}`, value: JSON.stringify(nodePath), default: isActive });
        if (b.kind === "container" && b.children?.length) collectNodes(b.children, depth + 1, nodePath, isLast);
      });
    }
    collectNodes(state.blocks, 0, null, true);

    const navOptions = allNodes.length > 0
      ? allNodes.slice(0, 25)
      : [{ label: "(sem blocos — adicione abaixo)", value: "__none__" }];

    const navSelect = client.interactions.createSelect({
      user: authorId,
      data: { placeholder: "🗂️ Navegar / Selecionar bloco", options: navOptions },
      funcao: async (i) => {
        const v = i.data.values[0];
        if (v !== "__none__") state.path = JSON.parse(v);
        await safeUpdateEditor(i);
      }
    });

    const addLayoutSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "➕ Adicionar Layout (raiz)",
        options    : [
          { label: "📦 Container", value: "container", description: "Agrupa blocos com borda e cor opcional" },
          { label: "📐 Section",   value: "section",   description: "Texto com acessório" },
          { label: "➖ Separator", value: "separator", description: "Divisor visual" }
        ]
      },
      funcao: async (i) => { addRootBlock(i.data.values[0]); await safeUpdateEditor(i); }
    });

    const addContentSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "➕ Adicionar Conteúdo / Botões (raiz)",
        options    : [
          { label: "📝 Text Display",  value: "textDisplay",  description: "Texto livre markdown" },
          { label: "🖼️ Media Gallery", value: "mediaGallery", description: "Galeria de imagens (até 10)" },
          { label: "🔘 Action Row",    value: "actionRow",    description: "Linha de botões (até 5)" },
          { label: "📋 Select Menu",   value: "selectMenu",   description: "Menu de seleção com fluxos" }
        ]
      },
      funcao: async (i) => { addRootBlock(i.data.values[0]); await safeUpdateEditor(i); }
    });

    const editBtn = client.interactions.createButton({
      user: authorId, data: { label: "✏️ Editar", style: 1 },
      funcao: async (i) => {
        const b = currentBlock();
        if (!b) return safeEphemeral(i, "❌ Nenhum bloco selecionado.");
        return openBlockEditor(i, b);
      }
    });

    const removeBtn = client.interactions.createButton({
      user: authorId, data: { label: "🗑️ Remover", style: 4 },
      funcao: async (i) => {
        const arr = getParentArrayByPath(state.path);
        if (!arr) return safeEphemeral(i, "❌ Nenhum bloco para remover.");
        const idx    = state.path[state.path.length - 1];
        arr.splice(idx, 1);
        const newIdx = Math.max(0, idx - 1);
        if (state.path.length === 1) {
          state.path = state.blocks.length ? [Math.min(newIdx, state.blocks.length - 1)] : [0];
        } else {
          const parent    = state.path.slice(0, -1);
          const parentArr = getParentArrayByPath([...parent, 0]);
          state.path = parentArr?.length ? [...parent, Math.min(newIdx, parentArr.length - 1)] : parent;
        }
        await safeUpdateEditor(i);
      }
    });

    const moveUpBtn = client.interactions.createButton({
      user: authorId, data: { label: "⬆️ Subir", style: 2 },
      funcao: async (i) => {
        const arr = getParentArrayByPath(state.path);
        const idx = state.path[state.path.length - 1];
        if (!arr || idx <= 0) return safeEphemeral(i, "❌ Já está no topo.");
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        state.path = [...state.path.slice(0, -1), idx - 1];
        await safeUpdateEditor(i);
      }
    });

    const moveDownBtn = client.interactions.createButton({
      user: authorId, data: { label: "⬇️ Descer", style: 2 },
      funcao: async (i) => {
        const arr = getParentArrayByPath(state.path);
        const idx = state.path[state.path.length - 1];
        if (!arr || idx >= arr.length - 1) return safeEphemeral(i, "❌ Já está no final.");
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        state.path = [...state.path.slice(0, -1), idx + 1];
        await safeUpdateEditor(i);
      }
    });

    const cv2PreviewBtn = client.interactions.createButton({
      user: authorId, data: { label: "👁️ Preview", style: 2 },
      funcao: async (i) => {
        const errors = validatePayload();
        if (errors.length) return safeEphemeral(i, `❌ **Preview bloqueado:**\n${errors.map(e => `• ${e}`).join("\n")}`);
        try {
          await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
            method: "POST",
            body  : { type: 4, data: { flags: 64 | IS_COMPONENTS_V2, components: buildApiComponents(), allowed_mentions: { parse: [] } } }
          });
        } catch (err) {
          await safeEphemeral(i, `❌ Erro no preview: ${err?.message ?? "desconhecido"}`);
        }
      }
    });

    const cv2SendBtn = client.interactions.createButton({
      user: authorId,
      data: { label: state.messageId ? "🔄 Atualizar" : "📨 Canal", style: 3 },
      funcao: async (i) => {
        if (state.messageId) {
          const updateSelect = client.interactions.createSelect({
            user: authorId,
            data: {
              placeholder: "O que deseja fazer?",
              options    : [
                { label: "🔄 Atualizar mensagem existente", value: "update", description: `ID: ${state.messageId}` },
                { label: "📨 Enviar para novo canal",        value: "new_ch" }
              ]
            },
            funcao: async (si) => {
              if (si.data.values[0] === "update") return doResend(si, state.channelId);
              await safeEphemeral(si, "📡 Envie o **ID** ou **#menção** do canal. *(30s)*");
              try {
                const msg = await client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: authorId, time: 30000 });
                return doSend(si, msg.content.replace(/[<#>]/g, "").trim());
              } catch {
                return DiscordRequest(`/webhooks/${interaction.application_id}/${si.token}`, {
                  method: "POST", body: { content: "⏱️ Tempo esgotado.", flags: 64 }
                });
              }
            }
          });
          return DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
            method: "POST",
            body  : { type: 4, data: { content: "📨 **O que deseja fazer?**", flags: 64, components: [{ type: 1, components: [updateSelect] }] } }
          });
        }

        await safeEphemeral(i, "📡 Envie o **ID** ou **#menção** do canal destino. *(30s)*");
        try {
          const msg       = await client.NextMessageCollector.wait({ channelId: interaction.channel_id, userId: authorId, time: 30000 });
          const channelId = msg.content.replace(/[<#>]/g, "").trim();
          return doSend(i, channelId);
        } catch {
          return DiscordRequest(`/webhooks/${interaction.application_id}/${i.token}`, {
            method: "POST", body: { content: "⏱️ Tempo esgotado.", flags: 64 }
          });
        }
      }
    });

    const jsonBtn = client.interactions.createButton({
      user: authorId, data: { label: "{ } JSON", style: 2 },
      funcao: async (i) => {
        const components = buildApiComponents();
        if (!components.length) return safeEphemeral(i, "❌ Nenhum componente para exportar.");
        const payload = { flags: IS_COMPONENTS_V2, components };
        const json    = JSON.stringify(payload, null, 2);
        await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
          method: "POST",
          body  : { type: 4, data: { content: "📋 **Payload CV2**", flags: 64 } },
          files : [{ name: "components_v2.json", data: Buffer.from(json, "utf-8"), contentType: "application/json" }]
        });
      }
    });

    const savedInfoBtn = client.interactions.createButton({
      user: authorId, data: { label: "💾 Salvo", style: 2 },
      funcao: async (i) => {
        const info = state.savedId
          ? `✅ **Salvo**\nID: \`${state.savedId}\`\nMensagem: \`${state.messageId ?? "não enviada"}\`\nCanal: \`${state.channelId ?? "—"}\``
          : "📭 Ainda não foi salvo. Envie a mensagem primeiro.";
        await safeEphemeral(i, info);
      }
    });

    // ── Webhook profile button ────────────────────────────────────────────────
    const webhookProfileBtn = client.interactions.createButton({
      user: authorId, data: { label: "🪪 Perfil", style: 2 },
      funcao: async (i) => {
        const modal = client.interactions.createModal({
          user : authorId,
          title: "Perfil do Webhook",
          components: [
            {
              type: 1,
              components: [{
                type       : 4,
                custom_id  : "username",
                label      : "Nome exibido (deixe vazio = nome do bot)",
                style      : 1,
                required   : false,
                max_length : 80,
                placeholder: "Meu Bot",
                value      : state.webhookProfile.username ?? ""
              }]
            },
            {
              type: 1,
              components: [{
                type       : 4,
                custom_id  : "avatarUrl",
                label      : "URL do Avatar (deixe vazio = avatar do bot)",
                style      : 1,
                required   : false,
                max_length : 512,
                placeholder: "https://cdn.discordapp.com/...",
                value      : state.webhookProfile.avatarUrl ?? ""
              }]
            }
          ],
          funcao: async (mi, _, fields) => {
            const username  = fields.username?.trim()  || null;
            const avatarUrl = fields.avatarUrl?.trim() || null;

            if (avatarUrl && !/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(avatarUrl)) {
              return safeEphemeral(mi, "❌ URL de avatar inválida. Use uma URL direta de imagem (png, jpg, gif, webp).");
            }

            state.webhookProfile.username  = username;
            state.webhookProfile.avatarUrl = avatarUrl;

            const preview = [
              `✅ **Perfil do webhook atualizado!**`,
              `Nome: ${username  ? `\`${username}\`` : "*(padrão do bot)*"}`,
              `Avatar: ${avatarUrl ? `[link](${avatarUrl})` : "*(padrão do bot)*"}`
            ].join("\n");

            await DiscordRequest(`/interactions/${mi.id}/${mi.token}/callback`, {
              method: "POST",
              body  : { type: 4, data: { content: preview, flags: 64 } }
            });
          }
        });
        await client.interactions.showModal(i, modal);
      }
    });

    return [
      { type: 1, components: [navSelect] },
      { type: 1, components: [addLayoutSelect] },
      { type: 1, components: [addContentSelect] },
      { type: 1, components: [editBtn, removeBtn, moveUpBtn, moveDownBtn] },
      { type: 1, components: [cv2PreviewBtn, cv2SendBtn, jsonBtn, webhookProfileBtn, savedInfoBtn] }
    ];
  }

  // ── Block editors ───────────────────────────────────────────────────────────
  async function openBlockEditor(i, block) {
    const MAP = {
      text       : openTextDisplayEditor,
      gallery    : openGalleryEditor,
      section    : openSectionEditor,
      action_row : openActionRowEditor,
      separator  : openSeparatorEditor,
      container  : openContainerEditor,
      select_menu: openSelectMenuEditor
    };
    return MAP[block.kind]?.(i, block) ?? safeEphemeral(i, "❌ Tipo sem editor disponível.");
  }

  async function openTextDisplayEditor(i, block) {
    const modal = client.interactions.createModal({
      user : authorId, title: "Editar Text Display",
      components: [{ type: 1, components: [{ type: 4, custom_id: "content", label: "Conteúdo (markdown)", style: 2, required: true, value: block.content || "", max_length: 4000 }] }],
      funcao: async (mi, _, fields) => { block.content = fields.content ?? ""; await safeUpdateEditor(mi); }
    });
    await client.interactions.showModal(i, modal);
  }

  async function openGalleryEditor(i, block) {
    if (!Array.isArray(block.items)) block.items = [];
    const options = [
      { label: "➕ Adicionar imagem/vídeo", value: "add", description: `Atual: ${block.items.length}/10` },
      ...block.items.map((it, idx) => ({ label: `✏️ Item ${idx + 1}`, value: `edit_${idx}`, description: it.url.slice(0, 50) })),
      ...block.items.map((_, idx) => ({ label: `🗑️ Remover Item ${idx + 1}`, value: `rm_${idx}` }))
    ];

    const gallerySelect = client.interactions.createSelect({
      user: authorId,
      data: { placeholder: `🖼️ Media Gallery — ${block.items.length}/10`, options: options.slice(0, 25) },
      funcao: async (si) => {
        const val = si.data.values[0];
        if (val.startsWith("rm_")) { block.items.splice(parseInt(val.slice(3), 10), 1); return safeUpdateEditor(si); }
        const isEdit   = val.startsWith("edit_");
        const editIdx  = isEdit ? parseInt(val.slice(5), 10) : -1;
        const existing = isEdit ? block.items[editIdx] : null;
        if (val === "add" && block.items.length >= 10) return safeEphemeral(si, "❌ Máximo de 10 itens.");
        const modal = client.interactions.createModal({
          user : authorId, title: isEdit ? `Editar Item ${editIdx + 1}` : "Adicionar Mídia",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "url",         label: "URL da mídia",         style: 1, required: true,  value: existing?.url         || "" }] },
            { type: 1, components: [{ type: 4, custom_id: "description", label: "Descrição (opcional)",  style: 1, required: false, value: existing?.description || "" }] },
            { type: 1, components: [{ type: 4, custom_id: "spoiler",     label: "Spoiler? sim/nao",      style: 1, required: false, value: existing?.spoiler ? "sim" : "nao" }] }
          ],
          funcao: async (mi, _, fields) => {
            const url = (fields.url || "").trim();
            if (!url || !/^https?:\/\/.+/.test(url)) return safeEphemeral(mi, "❌ URL inválida.");
            const item = { url, description: fields.description?.trim() || "", spoiler: fields.spoiler?.toLowerCase() === "sim" };
            if (isEdit) block.items[editIdx] = item; else block.items.push(item);
            await safeUpdateEditor(mi);
          }
        });
        await client.interactions.showModal(si, modal);
      }
    });

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 7, data: { content: buildStatusText() + `\n\n🖼️ **Media Gallery** — ${block.items.length}/10`, embeds: [], components: [{ type: 1, components: [gallerySelect] }, ...buildEditorUI().slice(1)] } }
    });
  }

  async function openSectionEditor(i, block) {
    const sectionSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `📐 Section — acessório: ${block.accessory?.kind ?? "nenhum"}`,
        options    : [
          { label: "✏️ Editar texto",           value: "text"          },
          { label: "🖼️ Acessório: Thumbnail",   value: "acc_thumbnail" },
          { label: "🔗 Acessório: Link Button",  value: "acc_button"    },
          { label: "🗑️ Remover acessório",       value: "acc_remove"    }
        ]
      },
      funcao: async (si) => {
        const val = si.data.values[0];
        if (val === "acc_remove") { block.accessory = null; return safeUpdateEditor(si); }
        if (val === "text") {
          const modal = client.interactions.createModal({
            user : authorId, title: "Texto da Section",
            components: [{ type: 1, components: [{ type: 4, custom_id: "text", label: "Texto (markdown)", style: 2, required: true, value: block.text || "", max_length: 4000 }] }],
            funcao: async (mi, _, fields) => { block.text = fields.text || ""; await safeUpdateEditor(mi); }
          });
          return client.interactions.showModal(si, modal);
        }
        if (val === "acc_thumbnail") {
          const modal = client.interactions.createModal({
            user : authorId, title: "Acessório: Thumbnail",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "url",         label: "URL da imagem",        style: 1, required: true,  value: block.accessory?.url         || "" }] },
              { type: 1, components: [{ type: 4, custom_id: "description", label: "Descrição (opcional)", style: 1, required: false, value: block.accessory?.description || "" }] },
              { type: 1, components: [{ type: 4, custom_id: "spoiler",     label: "Spoiler? sim/nao",     style: 1, required: false, value: block.accessory?.spoiler ? "sim" : "nao" }] }
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
          const modal = client.interactions.createModal({
            user : authorId, title: "Acessório: Link Button",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "label",    label: "Label",               style: 1, required: false, value: block.accessory?.label    || "" }] },
              { type: 1, components: [{ type: 4, custom_id: "url",      label: "URL (https://…)",      style: 1, required: true,  value: block.accessory?.url      || "" }] },
              { type: 1, components: [{ type: 4, custom_id: "disabled", label: "Desativado? sim/nao",  style: 1, required: false, value: block.accessory?.disabled ? "sim" : "nao" }] }
            ],
            funcao: async (mi, _, fields) => {
              const url = (fields.url || "").trim();
              if (!url || !/^https?:\/\/.+/.test(url)) return safeEphemeral(mi, "❌ URL inválida.");
              block.accessory = { kind: "button_link", label: fields.label?.trim() || "", url, disabled: fields.disabled?.toLowerCase() === "sim" };
              await safeUpdateEditor(mi);
            }
          });
          return client.interactions.showModal(si, modal);
        }
      }
    });

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 7, data: { content: buildStatusText() + `\n\n📐 **Section** — "${(block.text || "").slice(0, 60)}"`, embeds: [], components: [{ type: 1, components: [sectionSelect] }, ...buildEditorUI().slice(1)] } }
    });
  }

  async function openActionRowEditor(i, block) {
    if (!Array.isArray(block.buttons)) block.buttons = [];
    const options = [
      { label: "➕ Adicionar Botão", value: "add", description: `Atual: ${block.buttons.length}/5` },
      ...block.buttons.map((b, idx) => ({ label: `✏️ Botão ${idx + 1}: ${b.label || "(sem label)"}`, value: `edit_${idx}`, description: b.kind === "flow" ? `⚡ Fluxo: ${b.flowId?.slice(0, 30)}` : (b.url || "").slice(0, 50) })),
      ...block.buttons.map((_, idx) => ({ label: `🗑️ Remover Botão ${idx + 1}`, value: `rm_${idx}` }))
    ];

    const rowSelect = client.interactions.createSelect({
      user: authorId,
      data: { placeholder: `🔘 Action Row — ${block.buttons.length}/5`, options: options.slice(0, 25) },
      funcao: async (si) => {
        const val = si.data.values[0];
        if (val === "add") {
          if (block.buttons.length >= 5) return safeEphemeral(si, "❌ Máximo de 5 botões.");
          return openButtonEditor(si, null, newBtn => block.buttons.push(newBtn));
        }
        if (val.startsWith("edit_")) {
          const idx = parseInt(val.slice(5), 10);
          return openButtonEditor(si, block.buttons[idx], edited => { block.buttons[idx] = edited; });
        }
        if (val.startsWith("rm_")) {
          block.buttons.splice(parseInt(val.slice(3), 10), 1);
          return safeUpdateEditor(si);
        }
      }
    });

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 7, data: { content: buildStatusText() + `\n\n🔘 **Action Row** — ${block.buttons.length}/5`, embeds: [], components: [{ type: 1, components: [rowSelect] }, ...buildEditorUI().slice(1)] } }
    });
  }

  async function openButtonEditor(i, existing, onSave) {
    const tipoSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "Tipo de botão?",
        options    : [
          { label: "🔗 Link — abre uma URL",          value: "link" },
          { label: "⚡ Interação — dispara um fluxo", value: "flow" }
        ]
      },
      funcao: async (si) => {
        if (si.data.values[0] === "link") return openLinkButtonModal(si, existing?.kind === "link" ? existing : null, onSave);
        return openFlowButtonEditor(si, existing?.kind === "flow" ? existing : null, onSave);
      }
    });
    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 4, data: { content: "**Tipo de botão:**", flags: 64, components: [{ type: 1, components: [tipoSelect] }] } }
    });
  }

  async function openLinkButtonModal(i, existing, onSave) {
    const modal = client.interactions.createModal({
      user : authorId, title: existing ? "Editar Link Button" : "Novo Link Button",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "label",    label: "Label",               style: 1, required: false, value: existing?.label    || "", max_length: 80  }] },
        { type: 1, components: [{ type: 4, custom_id: "url",      label: "URL (https://…)",      style: 1, required: true,  value: existing?.url      || "", max_length: 512 }] },
        { type: 1, components: [{ type: 4, custom_id: "emoji",    label: "Emoji (opcional)",     style: 1, required: false, value: existing?.emoji    || "" }] },
        { type: 1, components: [{ type: 4, custom_id: "disabled", label: "Desativado? sim/nao",  style: 1, required: false, value: existing?.disabled ? "sim" : "nao" }] }
      ],
      funcao: async (mi, _, fields) => {
        const url = (fields.url || "").trim();
        if (!url || !/^https?:\/\/.+/.test(url)) return safeEphemeral(mi, "❌ URL inválida.");
        if (!fields.label?.trim() && !fields.emoji?.trim()) return safeEphemeral(mi, "❌ Precisa de label ou emoji.");
        onSave({ kind: "link", label: fields.label?.trim() || "", url, emoji: fields.emoji?.trim() || "", disabled: fields.disabled?.toLowerCase() === "sim" });
        await safeUpdateEditor(mi);
      }
    });
    await client.interactions.showModal(i, modal);
  }

  async function openFlowButtonEditor(i, existing, onSave) {
    const { FlowModel } = require("../../Mongodb/flow.js");
    const flows = await FlowModel.find({ guildId: interaction.guild_id, enabled: true }).lean();
    if (!flows.length) return safeEphemeral(i, "❌ Nenhum fluxo ativo disponível.");

    const flowSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: "Selecione o fluxo",
        options    : flows.slice(0, 25).map(f => ({ label: f.name.slice(0, 100), value: f.flowId, description: `Trigger: ${f.trigger?.type || "N/A"}`, default: existing?.flowId === f.flowId }))
      },
      funcao: async (si) => {
        const flowId = si.data.values[0];
        const modal  = client.interactions.createModal({
          user : authorId, title: "Configurar Botão de Fluxo",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "label", label: "Label", style: 1, required: true, max_length: 80, value: existing?.label || "" }] },
            { type: 1, components: [{ type: 4, custom_id: "style", label: "Estilo (1=Azul 2=Cinza 3=Verde 4=Verm.)", style: 1, required: false, max_length: 1, value: String(existing?.style || 1) }] },
            { type: 1, components: [{ type: 4, custom_id: "emoji", label: "Emoji (opcional)", style: 1, required: false, max_length: 50, value: existing?.emoji || "" }] }
          ],
          funcao: async (mi, _, fields) => {
            const style = [1,2,3,4].includes(Number(fields.style)) ? Number(fields.style) : 1;
            onSave({ kind: "flow", label: fields.label?.trim() || "", flowId, style, emoji: fields.emoji?.trim() || "" });
            await safeUpdateEditor(mi);
          }
        });
        return client.interactions.showModal(si, modal);
      }
    });
    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 4, data: { content: "⚡ **Selecione o fluxo:**", flags: 64, components: [{ type: 1, components: [flowSelect] }] } }
    });
  }

  async function openSeparatorEditor(i, block) {
    const sepSelect = client.interactions.createSelect({
      user: authorId,
      data: {
        placeholder: `➖ Separator — spacing: ${block.spacing}, divider: ${block.divider}`,
        options    : [
          { label: "Espaçamento Pequeno", value: "small"   },
          { label: "Espaçamento Grande",  value: "large"   },
          { label: "Ativar divisória",    value: "div_on"  },
          { label: "Desativar divisória", value: "div_off" }
        ]
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
    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 7, data: { content: buildStatusText() + `\n\n➖ **Separator** — spacing: ${block.spacing}, divider: ${block.divider}`, embeds: [], components: [{ type: 1, components: [sepSelect] }, ...buildEditorUI().slice(1)] } }
    });
  }

  async function openContainerEditor(i, block) {
    if (!Array.isArray(block.children)) block.children = [];
    const accentHex = block.accentColor != null
      ? `#${block.accentColor.toString(16).padStart(6, "0").toUpperCase()}` : "nenhum";

    const options = [
      { label: "📝 Adicionar Text Display",  value: "child_textDisplay"  },
      { label: "🖼️ Adicionar Media Gallery", value: "child_mediaGallery" },
      { label: "🔘 Adicionar Action Row",    value: "child_actionRow"    },
      { label: "📐 Adicionar Section",       value: "child_section"      },
      { label: "➖ Adicionar Separator",     value: "child_separator"    },
      { label: "🎨 Definir Accent Color",    value: "color"              },
      { label: "🙈 Toggle Spoiler",          value: "spoiler", description: `Atual: ${block.spoiler ? "ativado" : "desativado"}` },
      ...block.children.map((c, idx) => ({ label: `✏️ Editar filho ${idx + 1}: ${KIND_LABEL[c.kind]}`, value: `edit_child_${idx}` })),
      ...block.children.map((_, idx) => ({ label: `🗑️ Remover filho ${idx + 1}`, value: `rm_child_${idx}` }))
    ];

    const containerSelect = client.interactions.createSelect({
      user: authorId,
      data: { placeholder: `📦 Container — ${block.children.length} filho(s) | accent: ${accentHex}`, options: options.slice(0, 25) },
      funcao: async (si) => {
        const val = si.data.values[0];
        if (val === "spoiler") { block.spoiler = !block.spoiler; return safeUpdateEditor(si); }
        if (val === "color") {
          const hexModal = client.interactions.createModal({
            user : authorId, title: "Accent Color",
            components: [{ type: 1, components: [{ type: 4, custom_id: "hex", label: "HEX (vazio para remover)", style: 1, required: false, placeholder: "5865F2", value: block.accentColor != null ? block.accentColor.toString(16).padStart(6, "0") : "" }] }],
            funcao: async (mi, _, fields) => {
              const hex = (fields.hex || "").replace("#", "").trim();
              if (!hex)                                block.accentColor = null;
              else if (/^[0-9A-Fa-f]{6}$/.test(hex)) block.accentColor = parseInt(hex, 16);
              else return safeEphemeral(mi, "❌ HEX inválido.");
              await safeUpdateEditor(mi);
            }
          });
          return client.interactions.showModal(si, hexModal);
        }
        if (val.startsWith("edit_child_")) {
          const child = block.children[parseInt(val.slice(11), 10)];
          if (!child) return safeEphemeral(si, "❌ Filho não encontrado.");
          return openBlockEditor(si, child);
        }
        if (val.startsWith("rm_child_")) { block.children.splice(parseInt(val.slice(9), 10), 1); return safeUpdateEditor(si); }
        if (val.startsWith("child_")) {
          const kind  = val.slice(6);
          const child = BLOCK[kind]?.();
          if (!child) return;
          block.children.push(child);
          state.path = [...state.path, block.children.length - 1];
          return safeUpdateEditor(si);
        }
      }
    });

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 7, data: { content: buildStatusText() + `\n\n📦 **Container** — ${block.children.length} filho(s) | spoiler: ${block.spoiler} | accent: ${accentHex}`, embeds: [], components: [{ type: 1, components: [containerSelect] }, ...buildEditorUI().slice(1)] } }
    });
  }

  async function openSelectMenuEditor(i, block) {
    const { FlowModel } = require("../../Mongodb/flow.js");
    const flows = await FlowModel.find({ guildId: interaction.guild_id, enabled: true }).lean();
    if (!Array.isArray(block.options)) block.options = [];

    const options = [
      { label: "✏️ Editar placeholder", value: "placeholder", description: `Atual: ${block.placeholder || "vazio"}` },
      { label: "➕ Adicionar opção",    value: "add",         description: `${block.options.length}/25` },
      ...block.options.map((o, idx) => ({ label: `✏️ Opção ${idx + 1}: ${o.label.slice(0, 40)}`, value: `edit_${idx}` })),
      ...block.options.map((_, idx) => ({ label: `🗑️ Remover opção ${idx + 1}`, value: `rm_${idx}` }))
    ];

    const sel = client.interactions.createSelect({
      user: authorId,
      data: { placeholder: `📋 Select Menu — ${block.options.length} opções`, options: options.slice(0, 25) },
      funcao: async (si) => {
        const val = si.data.values[0];
        if (val === "placeholder") {
          const modal = client.interactions.createModal({
            user : authorId, title: "Editar Placeholder",
            components: [{ type: 1, components: [{ type: 4, custom_id: "ph", label: "Placeholder", style: 1, required: false, value: block.placeholder || "", max_length: 150 }] }],
            funcao: async (mi, _, fields) => { block.placeholder = fields.ph || ""; await safeUpdateEditor(mi); }
          });
          return client.interactions.showModal(si, modal);
        }
        if (val.startsWith("rm_")) { block.options.splice(parseInt(val.slice(3), 10), 1); return safeUpdateEditor(si); }
        const isEdit   = val.startsWith("edit_");
        const editIdx  = isEdit ? parseInt(val.slice(5), 10) : -1;
        const existing = isEdit ? block.options[editIdx] : null;
        if (!isEdit && block.options.length >= 25) return safeEphemeral(si, "❌ Máximo de 25 opções.");
        if (!flows.length) return safeEphemeral(si, "❌ Nenhum fluxo ativo.");

        const flowSel = client.interactions.createSelect({
          user: authorId,
          data: { placeholder: "Selecione o fluxo", options: flows.slice(0, 25).map(f => ({ label: f.name.slice(0, 100), value: f.flowId, default: existing?.flowId === f.flowId })) },
          funcao: async (fsi) => {
            const flowId = fsi.data.values[0];
            const modal  = client.interactions.createModal({
              user : authorId, title: isEdit ? "Editar Opção" : "Nova Opção",
              components: [
                { type: 1, components: [{ type: 4, custom_id: "label",       label: "Label",               style: 1, required: true,  max_length: 100, value: existing?.label       || "" }] },
                { type: 1, components: [{ type: 4, custom_id: "description", label: "Descrição (opcional)", style: 1, required: false, max_length: 100, value: existing?.description || "" }] },
                { type: 1, components: [{ type: 4, custom_id: "emoji",       label: "Emoji (opcional)",     style: 1, required: false, max_length: 10,  value: existing?.emoji       || "" }] }
              ],
              funcao: async (mi, _, fields) => {
                const option = { label: fields.label?.trim() || "Opção", description: fields.description?.trim() || "", emoji: fields.emoji?.trim() || "", flowId };
                if (isEdit) block.options[editIdx] = option; else block.options.push(option);
                await safeUpdateEditor(mi);
              }
            });
            return client.interactions.showModal(fsi, modal);
          }
        });
        await DiscordRequest(`/interactions/${si.id}/${si.token}/callback`, {
          method: "POST",
          body  : { type: 4, data: { content: "⚡ **Selecione o fluxo:**", flags: 64, components: [{ type: 1, components: [flowSel] }] } }
        });
      }
    });

    await DiscordRequest(`/interactions/${i.id}/${i.token}/callback`, {
      method: "POST",
      body  : { type: 7, data: { content: buildStatusText() + `\n\n📋 **Select Menu** — ${block.options.length}/25 opções`, embeds: [], components: [{ type: 1, components: [sel] }, ...buildEditorUI().slice(1)] } }
    });
  }

  // ── Initial render ──────────────────────────────────────────────────────────
  await DiscordRequest(`/webhooks/${interaction.application_id}/${interaction.token}`, {
    method: "POST",
    body  : { content: buildStatusText(), embeds: [], components: buildEditorUI() }
  });
}
