'use strict';

/**
 * TranscriptManager
 *
 * Responsável por:
 *  - Coletar mensagens de um canal/thread antes de deletá-lo
 *  - Gerar transcript em HTML ou TXT
 *  - Enviar para canal configurado
 *  - Opcionalmente enviar DM para o usuário
 */

const DiscordRequest = require('../../DiscordRequest.js');

const MAX_MESSAGES_PER_FETCH = 100;
const MAX_TOTAL_MESSAGES     = 2000; // limite de segurança

class TranscriptManager {

  constructor(client) {
    this.client = client;
  }

  /* ═══════════════════════════════════════════
     ENTRY POINT
     ═══════════════════════════════════════════ */

  /**
   * Gera e envia o transcript do ticket.
   * Deve ser chamado ANTES de deletar o canal.
   * Não bloqueia o fluxo de fechamento (retorna Promise separada).
   *
   * @param {{ interaction: object, panel: object, closedBy: string }} opts
   * @returns {Promise<void>}
   */
  async generate({ interaction, panel, closedBy }) {
    const cfg = panel.transcriptConfig;
    if (!cfg?.enabled || !cfg.channelId) return;

    try {
      const channelId = interaction.channel_id;
      const messages  = await this._fetchAllMessages(channelId);
      const channel   = await DiscordRequest(`/channels/${channelId}`);

      const content = cfg.format === 'html'
        ? this._buildHtml(messages, channel, closedBy)
        : this._buildTxt(messages, channel, closedBy);

      const filename    = `transcript-${channel.name || channelId}-${Date.now()}.${cfg.format}`;
      const contentType = cfg.format === 'html' ? 'text/html' : 'text/plain';

      const fileBuffer = Buffer.from(content, 'utf-8');

      // Envia para o canal de transcript
      await DiscordRequest(`/channels/${cfg.channelId}/messages`, {
        method: 'POST',
        body: {
          embeds: [{
            title:       '📄 Transcript',
            description: `Canal: **${channel.name || channelId}**\nFechado por: <@${closedBy}>\nMensagens: **${messages.length}**`,
            color:       0x5865F2,
            timestamp:   new Date().toISOString()
          }]
        },
        files: [{ name: filename, data: fileBuffer, contentType }]
      });

      // Envia DM para o usuário que abriu o ticket (se configurado)
      if (cfg.sendToUser) {
        const openerMention = this._findTicketOpener(messages);
        if (openerMention) {
          await this._sendDmTranscript(openerMention, filename, fileBuffer, contentType, channel.name).catch(() => {});
        }
      }

    } catch (err) {
      console.error('[Transcript] Erro ao gerar transcript:', err);
    }
  }

  /* ═══════════════════════════════════════════
     COLETA DE MENSAGENS
     ═══════════════════════════════════════════ */

  async _fetchAllMessages(channelId) {
    const messages = [];
    let   before   = null;
    let   total    = 0;

    while (total < MAX_TOTAL_MESSAGES) {
      const route = before
        ? `/channels/${channelId}/messages?limit=${MAX_MESSAGES_PER_FETCH}&before=${before}`
        : `/channels/${channelId}/messages?limit=${MAX_MESSAGES_PER_FETCH}`;

      const batch = await DiscordRequest(route);
      if (!batch || !batch.length) break;

      messages.push(...batch);
      total += batch.length;

      if (batch.length < MAX_MESSAGES_PER_FETCH) break;
      before = batch[batch.length - 1].id;
    }

    // ordena do mais antigo para o mais novo
    return messages.reverse();
  }

  /* ═══════════════════════════════════════════
     GERAÇÃO HTML
     ═══════════════════════════════════════════ */

  _buildHtml(messages, channel, closedBy) {
    const rows = messages.map(m => this._messageToHtmlRow(m)).join('\n');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transcript — ${this._esc(channel.name || channel.id)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #313338;
      color: #dbdee1;
      font-family: "gg sans", "Noto Sans", Whitney, "Helvetica Neue", sans-serif;
      font-size: 15px;
      line-height: 1.375;
    }
    header {
      background: #2b2d31;
      padding: 16px 24px;
      border-bottom: 1px solid #1e1f22;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    header h1 { font-size: 18px; font-weight: 600; color: #f2f3f5; }
    header span { font-size: 13px; color: #949ba4; }
    .messages { padding: 16px 24px; display: flex; flex-direction: column; gap: 2px; }
    .msg {
      display: grid;
      grid-template-columns: 40px 1fr;
      gap: 0 12px;
      padding: 4px 0;
      border-radius: 4px;
    }
    .msg:hover { background: #2e3035; }
    .avatar {
      grid-row: 1 / 3;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      margin-top: 2px;
    }
    .meta { display: flex; align-items: baseline; gap: 8px; }
    .username { font-weight: 600; color: #f2f3f5; }
    .timestamp { font-size: 12px; color: #949ba4; }
    .content { color: #dbdee1; word-wrap: break-word; white-space: pre-wrap; }
    .embed {
      border-left: 4px solid #5865f2;
      background: #2b2d31;
      border-radius: 0 4px 4px 0;
      padding: 8px 12px;
      margin: 4px 0;
      max-width: 520px;
    }
    .embed-title  { font-weight: 700; color: #f2f3f5; margin-bottom: 4px; }
    .embed-desc   { font-size: 14px; color: #dbdee1; white-space: pre-wrap; }
    .attachment   { color: #00b0f4; text-decoration: none; font-size: 13px; }
    .attachment:hover { text-decoration: underline; }
    footer {
      text-align: center;
      padding: 16px;
      font-size: 12px;
      color: #949ba4;
      border-top: 1px solid #1e1f22;
    }
    .system-msg { color: #949ba4; font-style: italic; font-size: 13px; padding: 4px 0; grid-column: 1/-1; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>#${this._esc(channel.name || channel.id)}</h1>
      <span>Fechado por: ${this._esc(closedBy)} · ${messages.length} mensagem(s) · Gerado em ${new Date().toLocaleString('pt-BR')}</span>
    </div>
  </header>
  <div class="messages">
${rows}
  </div>
  <footer>Transcript gerado automaticamente · ${new Date().toISOString()}</footer>
</body>
</html>`;
  }

  _messageToHtmlRow(msg) {
    if (msg.type === 6 || msg.type === 7) {
      return `    <div class="system-msg">» ${this._esc(msg.content || '')}</div>`;
    }

    const user      = msg.author;
    const avatarUrl = this._avatarUrl(user);
    const name      = this._esc(user.global_name || user.username || 'Unknown');
    const ts        = new Date(msg.timestamp).toLocaleString('pt-BR');
    const content   = this._esc(msg.content || '');

    const embedsHtml = (msg.embeds || []).map(e => `
      <div class="embed">
        ${e.title       ? `<div class="embed-title">${this._esc(e.title)}</div>` : ''}
        ${e.description ? `<div class="embed-desc">${this._esc(e.description)}</div>` : ''}
      </div>`).join('');

    const attachmentsHtml = (msg.attachments || []).map(a =>
      `<div><a class="attachment" href="${this._esc(a.url)}" target="_blank">📎 ${this._esc(a.filename)}</a></div>`
    ).join('');

    return `    <div class="msg">
      <img class="avatar" src="${avatarUrl}" alt="${name}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
      <div class="meta"><span class="username">${name}</span><span class="timestamp">${ts}</span></div>
      <div>
        ${content ? `<div class="content">${content}</div>` : ''}
        ${embedsHtml}
        ${attachmentsHtml}
      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════
     GERAÇÃO TXT
     ═══════════════════════════════════════════ */

  _buildTxt(messages, channel, closedBy) {
    const header = [
      `=== TRANSCRIPT ===`,
      `Canal: #${channel.name || channel.id}`,
      `Fechado por: ${closedBy}`,
      `Mensagens: ${messages.length}`,
      `Gerado em: ${new Date().toISOString()}`,
      `==================\n`
    ].join('\n');

    const body = messages.map(m => {
      const user    = m.author;
      const name    = user.global_name || user.username || 'Unknown';
      const ts      = new Date(m.timestamp).toLocaleString('pt-BR');
      const content = m.content || '';

      let line = `[${ts}] ${name}: ${content}`;

      if (m.embeds?.length) {
        line += m.embeds.map(e =>
          `\n  [EMBED] ${e.title || ''}: ${e.description || ''}`
        ).join('');
      }

      if (m.attachments?.length) {
        line += m.attachments.map(a => `\n  [ANEXO] ${a.filename}: ${a.url}`).join('');
      }

      return line;
    }).join('\n');

    return header + body;
  }

  /* ═══════════════════════════════════════════
     DM AO USUÁRIO
     ═══════════════════════════════════════════ */

  async _sendDmTranscript(userId, filename, buffer, contentType, channelName) {
    // Abre DM channel
    const dm = await DiscordRequest('/users/@me/channels', {
      method: 'POST',
      body:   { recipient_id: userId }
    });

    await DiscordRequest(`/channels/${dm.id}/messages`, {
      method: 'POST',
      body: {
        embeds: [{
          title:       '📄 Seu Transcript',
          description: `Seu ticket **#${channelName || 'ticket'}** foi fechado.\nSegue o transcript em anexo.`,
          color:       0x5865F2
        }]
      },
      files: [{ name: filename, data: buffer, contentType }]
    });
  }

  /* ═══════════════════════════════════════════
     UTILITÁRIOS
     ═══════════════════════════════════════════ */

  _findTicketOpener(messages) {
    // o abridor geralmente é o autor da primeira mensagem que não é o bot
    const botId = process.env.CLIENT_ID;
    const first = messages.find(m => m.author?.id !== botId && !m.author?.bot);
    return first?.author?.id || null;
  }

  _avatarUrl(user) {
    if (!user?.avatar) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

module.exports = TranscriptManager;
