"use strict";

const DiscordRequest = require("../DiscordRequest.js");

const IS_COMPONENTS_V2 = 1 << 15;

// ─────────────────────────────────────────────
//  Error codes that signal a broken webhook
// ─────────────────────────────────────────────
const WEBHOOK_DEAD_CODES = new Set([401, 403, 404, 10015]);

function isWebhookDead(err) {
  if (!err) return false;
  const code = err.status ?? err.httpStatus ?? err.code;
  if (WEBHOOK_DEAD_CODES.has(Number(code))) return true;
  const msg = String(err?.message ?? "");
  return msg.includes("10015") || msg.includes("Unknown Webhook");
}

// ─────────────────────────────────────────────
//  Ensure a valid webhook exists for the channel
//  Tries cached first, recreates if dead.
// ─────────────────────────────────────────────
async function ensureWebhook(channelId, cachedWebhook) {
  // 1. Try the cached webhook with a lightweight GET
  if (cachedWebhook?.id && cachedWebhook?.token) {
    try {
      await DiscordRequest(`/webhooks/${cachedWebhook.id}/${cachedWebhook.token}`, {
        method: "GET"
      });
      return cachedWebhook; // still alive
    } catch (err) {
      if (!isWebhookDead(err)) throw err; // unexpected error
      // fall through → recreate
    }
  }

  // 2. Create a fresh webhook
  const created = await DiscordRequest(`/channels/${channelId}/webhooks`, {
    method: "POST",
    body  : { name: "Message Studio" }
  });

  return { id: created.id, token: created.token };
}

// ─────────────────────────────────────────────
//  Send via webhook.
//  profile: { username?, avatarUrl? } — opcional
// ─────────────────────────────────────────────
async function sendViaWebhook(webhook, payload, isCV2 = false, profile = null) {
  const qs = isCV2 ? "?wait=true&with_components=true" : "?wait=true";

  const body = { ...payload };
  if (profile?.username)  body.username   = profile.username;
  if (profile?.avatarUrl) body.avatar_url = profile.avatarUrl;

  const res = await DiscordRequest(`/webhooks/${webhook.id}/${webhook.token}${qs}`, {
    method: "POST",
    body
  });
  return { ok: true, messageId: res?.id ?? null };
}

// ─────────────────────────────────────────────
//  Send via bot (fallback)
// ─────────────────────────────────────────────
async function sendViaBot(channelId, payload) {
  // Strip CV2 flag when sending as a normal bot message
  const safePayload = { ...payload };
  if (safePayload.flags !== undefined) {
    safePayload.flags = safePayload.flags & ~IS_COMPONENTS_V2;
    if (safePayload.flags === 0) delete safePayload.flags;
  }

  const res = await DiscordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body  : safePayload
  });
  return { ok: true, messageId: res?.id ?? null };
}

// ─────────────────────────────────────────────
//  Edit an existing webhook message
// ─────────────────────────────────────────────
async function editViaWebhook(webhook, messageId, payload, isCV2 = false) {
  const qs = isCV2 ? "?with_components=true" : "";
  await DiscordRequest(
    `/webhooks/${webhook.id}/${webhook.token}/messages/${messageId}${qs}`,
    { method: "PATCH", body: payload }
  );
  return { ok: true };
}

// ─────────────────────────────────────────────
//  Edit via bot (fallback)
// ─────────────────────────────────────────────
async function editViaBot(channelId, messageId, payload) {
  const safePayload = { ...payload };
  if (safePayload.flags !== undefined) {
    safePayload.flags = safePayload.flags & ~IS_COMPONENTS_V2;
    if (safePayload.flags === 0) delete safePayload.flags;
  }
  await DiscordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body  : safePayload
  });
  return { ok: true };
}

// ─────────────────────────────────────────────
//  Main pipeline: webhook → bot fallback
//  profile: { username?, avatarUrl? }
// ─────────────────────────────────────────────
async function sendMessage({ channelId, payload, isCV2, cachedWebhook, profile = null }) {
  let webhook      = null;
  let usedFallback = false;
  let sendError    = null;
  let messageId    = null;

  // ── Step 1: obtain / recreate webhook ──────
  try {
    webhook = await ensureWebhook(channelId, cachedWebhook);
  } catch (err) {
    sendError = `Webhook create failed: ${err?.message ?? err}`;
  }

  // ── Step 2: try webhook send ────────────────
  if (webhook) {
    try {
      const result = await sendViaWebhook(webhook, payload, isCV2, profile);
      messageId = result.messageId;
      return { webhook, messageId, usedFallback: false, sendError: null };
    } catch (err) {
      sendError = `Webhook send failed: ${err?.message ?? err}`;

      // If the webhook is dead, recreate once and retry
      if (isWebhookDead(err)) {
        try {
          webhook = await ensureWebhook(channelId, null); // force create
          const retry = await sendViaWebhook(webhook, payload, isCV2, profile);
          messageId = retry.messageId;
          return { webhook, messageId, usedFallback: false, sendError: null };
        } catch (err2) {
          sendError = `Webhook retry failed: ${err2?.message ?? err2}`;
        }
      }
    }
  }

  // ── Step 3: bot fallback ────────────────────
  try {
    const result = await sendViaBot(channelId, payload);
    messageId    = result.messageId;
    usedFallback = true;
    return { webhook, messageId, usedFallback, sendError };
  } catch (err) {
    sendError = `Bot fallback also failed: ${err?.message ?? err}`;
    return { webhook, messageId: null, usedFallback: true, sendError };
  }
}

// ─────────────────────────────────────────────
//  Edit pipeline: webhook → bot fallback
// ─────────────────────────────────────────────
async function editMessage({ channelId, messageId, payload, isCV2, cachedWebhook }) {
  // Try webhook edit first
  if (cachedWebhook?.id && cachedWebhook?.token && messageId) {
    try {
      await editViaWebhook(cachedWebhook, messageId, payload, isCV2);
      return { ok: true, usedFallback: false, sendError: null };
    } catch (err) {
      if (!isWebhookDead(err)) {
        // Non-dead error → fall through to bot
      }
    }
  }

  // Bot fallback for edit
  try {
    await editViaBot(channelId, messageId, payload);
    return { ok: true, usedFallback: true, sendError: null };
  } catch (err) {
    return {
      ok          : false,
      usedFallback: true,
      sendError   : `Edit failed: ${err?.message ?? err}`
    };
  }
}

module.exports = {
  ensureWebhook,
  sendMessage,
  editMessage,
  isWebhookDead
};
