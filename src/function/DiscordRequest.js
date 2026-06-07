'use strict';

const BASE_URL      = 'https://discord.com/api/v10';
const LOG_CHANNEL   = '1500087209536000190';

const RATE_LIMIT_RETRY_LIMIT = 3;      
const REQUEST_TIMEOUT_MS     = 15_000; 

const METHOD_COLOR = Object.freeze({
    GET:    0x57F287,
    POST:   0x5865F2,
    PATCH:  0xFEE75C,
    PUT:    0xEB459E,
    DELETE: 0xED4245,
});
const DEFAULT_COLOR = 0x95A5A6;



/**
 * Central Discord REST API wrapper for Arlecchino Bot.
 *
 * Fully backwards-compatible with all existing callers.
 * Automatically switches between JSON and multipart/form-data payloads.
 *
 * @param {string} route   Discord API route (with or without leading slash)
 * @param {object} options
 * @param {string}   [options.method='GET']
 * @param {object}   [options.body]         JSON payload (existing usage — unchanged)
 * @param {Array}    [options.files]        File attachments → triggers multipart mode
 *   Each file: { name: string, data: Buffer|Blob|ReadableStream, contentType?: string }
 * @param {number}   [options._retries]     Internal — do not pass manually
 * @returns {Promise<object|null>}
 */
async function DiscordRequest(route, options = {}) {
    _assertToken();

    if (!route.startsWith('/')) route = `/${route}`;

    const method    = (options.method ?? 'GET').toUpperCase();
    const url       = BASE_URL + route;
    const safeRoute = _sanitizeRoute(route);
    const origin    = _getCaller();
    const retries   = options._retries ?? 0;
    const start     = Date.now();

    const config = _buildRequestConfig(method, options);

    let response;
    
    

    try {
        response = await _fetchWithTimeout(url, config);
    } catch (fetchErr) {
        _logInternal({ method, safeRoute, origin, elapsed: Date.now() - start, err: fetchErr });
        console.error('[DiscordRequest] Fetch failed:', fetchErr);
        throw fetchErr;
    }

    const elapsed = Date.now() - start;

    if (response.status === 429 && retries < RATE_LIMIT_RETRY_LIMIT) {
        const retryAfter = _parseRetryAfter(response);
        console.warn(
            `[DiscordRequest] Rate limited on ${method} ${safeRoute}. ` +
            `Retrying in ${retryAfter}ms (attempt ${retries + 1}/${RATE_LIMIT_RETRY_LIMIT})…`
        );
        await _sleep(retryAfter);
        return DiscordRequest(route, { ...options, _retries: retries + 1 });
    }


    if (!response.ok) {
        const apiError = await _safeParseJson(response);

        _sendLog({
            title:  `❌ Discord API ERROR • ${method}`,
            color:  0xED4245,
            method, safeRoute, origin, elapsed,
            extra:  [{ name: 'API Error', value: _formatError(apiError) }],
        });

        throw new Error(
            `[DiscordRequest] ${method} ${safeRoute} → HTTP ${response.status}: ` +
            JSON.stringify(apiError)
        );
    }

    
    _sendLog({
        title:  `🌐 Discord API • ${method}`,
        color:  METHOD_COLOR[method] ?? DEFAULT_COLOR,
        method, safeRoute, origin, elapsed,
    });

    if (response.status === 204) return null;

    return _safeParseJson(response);
}



function _assertToken() {
    if (!process.env.DISCORD_TOKEN)
        throw new Error('[DiscordRequest] DISCORD_TOKEN is not defined.');
}

/**
 * Build the fetch config object.
 * Automatically selects JSON or multipart based on whether files are present.
 */
function _buildRequestConfig(method, options) {
    const baseHeaders = {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
    };


    if (options.files?.length) {
        const form = new FormData();

       
        if (options.body) {
            form.append('payload_json', JSON.stringify(options.body));
        }

        
        for (let i = 0; i < options.files.length; i++) {
            const file = options.files[i];
            const blob = file.data instanceof Blob
                ? file.data
                : new Blob([file.data], { type: file.contentType ?? 'application/octet-stream' });

            form.append(`files[${i}]`, blob, file.name);
        }

        return { method, headers: baseHeaders, body: form };
    }


    const headers = { ...baseHeaders, 'Content-Type': 'application/json' };
    const config  = { method, headers };

    if (options.body !== undefined) {
        config.body = JSON.stringify(options.body);
    }

    return config;
}



async function _fetchWithTimeout(url, config) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, { ...config, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}



async function _safeParseJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function _formatError(apiError) {
    if (!apiError) return 'Unknown';
    const msg  = apiError.message ?? '';
    const code = apiError.code    ?? '';
    return `${code ? `[${code}] ` : ''}${msg || JSON.stringify(apiError)}`.slice(0, 1000);
}


function _parseRetryAfter(response) {
    const header = response.headers?.get('retry-after');
    if (!header) return 1000;
    // Discord sends retry-after in seconds (float)
    return Math.ceil(parseFloat(header) * 1000) || 1000;
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}



/**
 * Build and fire a log embed to the bot's log channel.
 * Uses a raw fetch (not DiscordRequest itself) to prevent recursion.
 */
function _sendLog({ title, color, method, safeRoute, origin, elapsed, extra = [] }) {
    const embed = {
        title,
        color,
        fields: [
            { name: 'Status',  value: _resolveStatus(title), inline: true },
            { name: 'Tempo',   value: `${elapsed}ms`,        inline: true },
            { name: 'Rota',    value: safeRoute },
            { name: 'Origem',  value: origin },
            ...extra,
        ],
        timestamp: new Date().toISOString(),
    };

   // fetch(`${BASE_URL}/channels/${LOG_CHANNEL}/messages`, {
      //  method:  'POST',
    //  headers: {
      //      Authorization:  `Bot ${process.env.DISCORD_TOKEN}`,
  //        'Content-Type': 'application/json',
       // },
     //   body: JSON.stringify({ embeds: [embed] }),
 //   }).catch(() => {}); ,
}


function _logInternal({ method, safeRoute, origin, elapsed, err }) {
    _sendLog({
        title:  `💥 Internal Error • ${method}`,
        color:  0x992D22,
        method, safeRoute, origin, elapsed,
        extra:  [{ name: 'Erro', value: (err?.message ?? String(err)).slice(0, 1000) }],
    });
}

function _resolveStatus(title) {
    if (title.startsWith('❌')) return '❌ Error';
    if (title.startsWith('💥')) return '💥 Fatal';
    return '✅ OK';
}



function _getCaller() {
    const stack = new Error().stack?.split('\n') ?? [];

    const line = stack.find((l) =>
        l.includes('.js') &&
        !l.includes('DiscordRequest') &&
        !l.includes('_getCaller') &&
        !l.includes('node_modules')
    );

    if (!line) return 'Desconhecido';

    return line
        .replace(process.cwd(), '')
        .replace(/\\/g, '/')
        .replace('at ', '')
        .replace(/\(.+\//, '(')
        .trim();
}



function _sanitizeRoute(route) {
    return route
        .replace(/interactions\/(\d+)\/([^/]+)/, 'interactions/$1/[TOKEN]')
        .replace(/webhooks\/(\d+)\/([^/]+)/,     'webhooks/$1/[TOKEN]');
}
 

module.exports = DiscordRequest;
