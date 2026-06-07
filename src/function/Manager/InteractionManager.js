'use strict';

const crypto         = require('crypto');
const DiscordRequest = require('../DiscordRequest.js');
const ms             = require('ms');



const DEFAULT_TTL_MS       = ms('10min');
const CACHE_SWEEP_INTERVAL = ms('5min');


const CALLBACK_TYPE = Object.freeze({
    REPLY:        4,
    DEFER_UPDATE: 6,
    MODAL:        9,
});


const FLAGS = Object.freeze({
    EPHEMERAL: 64,
});



class InteractionManager {


    constructor(client) {
        this.client = client;

        /**
         * In-memory component/modal cache.
         * key   → custom_id (temp_<hex>)
         * value → { user, funcao, modal?, expires }
         * @type {Map<string, CacheEntry>}
         */
        this._cache = new Map();

        /**
         * Tracks which interactions have already received a callback,
         * preventing "Unknown Interaction" / "Interaction already replied" errors.
         * key   → interaction.id
         * value → { replied, deferred }
         * @type {Map<string, InteractionState>}
         */
        this._states = new Map();

        this._startCacheSweep();
    }


    /**
     * Build a button component object and register its handler in cache.
     *
     * @param {{ user?: string, tempo?: number, funcao: Function, data?: object }} opts
     * @returns {object} Discord button component object
     */
    createButton({ user, tempo = DEFAULT_TTL_MS, funcao, data = {} }) {
        const id = this._register({ user, funcao }, tempo);

        return {
            type:      2,
            style:     data.style  ?? 1,
            label:     data.label  ?? 'Botao',
            custom_id: id,
        };
    }

    /**
     * Build a select menu component object and register its handler in cache.
     *
     * @param {{ user?: string, tempo?: number, funcao: Function, data?: object }} opts
     * @returns {object} Discord select menu component object
     */
    createSelect({ user, tempo = DEFAULT_TTL_MS, funcao, data = {} }) {
        const id = this._register({ user, funcao }, tempo);

        return {
            type:        3,
            custom_id:   id,
            placeholder: data.placeholder ?? 'Escolha uma opcao',
            min_values:  data.min_values  ?? 1,
            max_values:  data.max_values  ?? 1,
            options:     data.options     ?? [],
        };
    }

    /**
     * Build a modal data object and register its handler in cache.
     *
     * @param {{ user?: string, tempo?: number, title: string, components: object[], funcao: Function }} opts
     * @returns {object} Discord modal data object
     */
    createModal({ user, tempo = DEFAULT_TTL_MS, title, components, funcao }) {
        const id = this._register({ user, funcao, modal: true }, tempo);

        return {
            custom_id: id,
            title,
            components,
        };
    }



    /**
     * Open a modal in response to an interaction.
     * Marks the interaction as replied to prevent double-callback errors.
     *
     * @param {object} interaction
     * @param {object} modalData
     */
    async showModal(interaction, modalData) {
        await this._callback(interaction, {
            type: CALLBACK_TYPE.MODAL,
            data: modalData,
        });
    }

    /**
     * Acknowledge a component interaction without sending a visible reply.
     * Marks the interaction as deferred.
     *
     * @param {object} interaction
     */
    async defer(interaction) {
        const state = this._getState(interaction.id);
        if (state.replied || state.deferred) return;

        await this._callback(interaction, { type: CALLBACK_TYPE.DEFER_UPDATE });
        state.deferred = true;
    }



    /**
     * Handle a MESSAGE_COMPONENT interaction (buttons and select menus).
     * Preserves full compatibility with the JSON custom_id routing system.
     *
     * @param {object} interaction
     */
    async handleComponent(interaction) {
      //console.log(interaction)
        const customId = interaction.data?.custom_id;
        if (!customId) return;

        try {

            const parsed = this._tryParseJson(customId);

            if (parsed?.t === 'create_ticket') {
                interaction.data.panelId = parsed.p;
                return await this.client.ticketSystem.create(interaction)
                    .catch((err) => this._replyError(interaction, err, 'Ticket Create'));
            }

            if (customId === 'close_ticket') {
                return await this.client.ticketSystem.close(interaction)
                    .catch((err) => this._replyError(interaction, err, 'Ticket Close'));
            }
            
            if (parsed?.t === 'hub_select') {
  const selectedValue = interaction.data?.values?.[0];
  if (!selectedValue) return;

  let valueParsed;
  try { valueParsed = JSON.parse(selectedValue); }
  catch { return; }

  if (valueParsed?.t === 'create_ticket') {
    interaction.data.custom_id = selectedValue;
    return await this.client.ticketSystem.create(interaction)
      .catch((err) => this._replyError(interaction, err, 'Hub Select Ticket Create'));
  }
  return;
}

// Botão de fluxo do CV2
if (parsed?.t === 'flow_trigger' && parsed?.f) {
  // verifica se realmente tem um flowId válido
  if (typeof parsed.f !== 'string' || !parsed.f.length) return;
  
  return await this.client.logicEngine.runById(parsed.f, {
    guildId:     interaction.guild_id,
    channelId:   interaction.channel_id,
    userId:      interaction.member?.user?.id,
    interaction
  }).catch((err) => this._replyError(interaction, err, 'CV2 Flow Button'));
}

// Select Menu do CV2
if (parsed?.t === 'cv2_select') {
  const selectedValue = interaction.data?.values?.[0];
  if (!selectedValue) return;
  let valueParsed;
  try { valueParsed = JSON.parse(selectedValue); } catch { return; }
 // console.log(valueParsed)
  
  //console.log(selectedValue, valueParsed)
  if (valueParsed?.t === 'flow_trigger') {
    return await this.client.logicEngine.runById(valueParsed.f, {
      guildId:     interaction.guild_id,
      channelId:   interaction.channel_id,
      userId:      interaction.member?.user?.id,
      interaction
    }).catch((err) => this._replyError(interaction, err, 'CV2 Select Flow'));
  }
  return;
}

if (interaction.data?.custom_id === "birthday_register_btn") {
  return this.client.birthdayManager.handleButtonRegister(interaction);
}


            const entry = this._cache.get(customId);

            if (!entry || this._isExpired(entry)) {
                this._cache.delete(customId);
                return this._replyUnavailable(interaction);
            }

            if (!this._isAuthorized(interaction, entry.user)) {
                return this._replyUnauthorized(interaction);
            }

            await entry.funcao(interaction, this.client);

        } catch (err) {
            await this._replyError(interaction, err, 'Component Handler');
        }
    }

    /**
     * Handle a MODAL_SUBMIT interaction.
     *
     * @param {object} interaction
     */
    async handleModal(interaction) {
        const customId = interaction.data?.custom_id;
        if (!customId?.startsWith('temp_')) return;

        const entry = this._cache.get(customId);

        if (!entry?.modal || this._isExpired(entry)) {
            this._cache.delete(customId);
            return this._replyExpired(interaction);
        }

        if (!this._isAuthorized(interaction, entry.user)) {
            return this._replyUnauthorizedModal(interaction);
        }

        try {
            const fields = this._parseModalFields(interaction);
            await entry.funcao(interaction, this.client, fields);
        } catch (err) {
            await this._replyError(interaction, err, 'Modal Handler');
        }
    }



    /**
     * Register a handler in the cache and return its generated id.
     *
     * @param {{ user?: string, funcao: Function, modal?: boolean }} data
     * @param {number} ttl — time-to-live in milliseconds
     * @returns {string} custom_id
     */
    _register(data, ttl) {
        const id      = this._generateId();
        const expires = Date.now() + ttl;

        this._cache.set(id, { ...data, expires });

        // Belt-and-suspenders: individual expiry timeout for exact cleanup.
        setTimeout(() => this._cache.delete(id), ttl);

        return id;
    }

    /**
     * Periodic sweep to remove stale entries that individual timeouts may
     * have missed (e.g. clock drift, process suspension).
     * Prevents long-running memory growth without blocking the event loop.
     */
    _startCacheSweep() {
        setInterval(() => {
            const now = Date.now();
            let removed = 0;

            for (const [key, entry] of this._cache) {
                if (now > entry.expires) {
                    this._cache.delete(key);
                    removed++;
                }
            }

            if (removed > 0)
                console.debug(`[InteractionManager] Cache sweep removed ${removed} expired entries.`);

        }, CACHE_SWEEP_INTERVAL).unref(); 
    }



    /**
     * Retrieve (or create) the state record for an interaction.
     * State is cleaned up automatically after Discord's 15-minute window.
     *
     * @param {string} interactionId
     * @returns {{ replied: boolean, deferred: boolean }}
     */
    _getState(interactionId) {
        if (!this._states.has(interactionId)) {
            this._states.set(interactionId, { replied: false, deferred: false });

            
            setTimeout(() => this._states.delete(interactionId), ms('15min')).unref();
        }

        return this._states.get(interactionId);
    }



    /**
     * Send an interaction callback to Discord.
     * Marks the interaction as replied and guards against double-callbacks.
     *
     * @param {object} interaction
     * @param {object} body — callback payload
     */
    async _callback(interaction, body) {
        const state = this._getState(interaction.id);

        if (state.replied) {
            
            return;
        }

        await DiscordRequest(
            `/interactions/${interaction.id}/${interaction.token}/callback`,
            { method: 'POST', body }
        );

        state.replied = true;
    }

    /**
     * Send an ephemeral text reply.
     * Falls back to a follow-up message when the interaction was already
     * acknowledged (prevents "Unknown Interaction" errors).
     *
     * @param {object} interaction
     * @param {string} content
     */
    async _reply(interaction, content) {
        const state = this._getState(interaction.id);

        if (!state.replied && !state.deferred) {
            
            return this._callback(interaction, {
                type: CALLBACK_TYPE.REPLY,
                data: { content, flags: FLAGS.EPHEMERAL },
            });
        }

        
        return DiscordRequest(
            `/webhooks/${this.client.clientId}/${interaction.token}`,
            {
                method: 'POST',
                body:   { content, flags: FLAGS.EPHEMERAL },
            }
        );
    }



    _replyUnavailable(interaction) {
        return this._reply(
            interaction,
            'Essa interação expirou ou não está mais disponível. Execute o comando novamente.'
        );
    }

    _replyExpired(interaction) {
        return this._reply(
            interaction,
            'Este formulário expirou. Execute novamente.'
        );
    }

    _replyUnauthorized(interaction) {
        return this._reply(interaction, 'Você não pode usar este componente.');
    }

    _replyUnauthorizedModal(interaction) {
        return this._reply(interaction, 'Você não pode responder este formulário.');
    }

    /**
     * Log an error with a unique ID and send an ephemeral error message.
     *
     * @param {object} interaction
     * @param {Error}  err
     * @param {string} [context]
     */
    async _replyError(interaction, err, context = 'Erro interno') {
        const errorId = this._errorId();

        console.error(`[InteractionManager] [${errorId}] ${context}`, err);

        const message =
            `Ocorreu um erro ao processar a interação.\n\n` +
            `Contexto: **\`${context}\`**\n` +
            `ID do erro: **\`${errorId}\`**\n` +
            `Detalhe: \`\`\`\n${err?.message ?? 'Desconhecido'}\n\`\`\``;

        try {
            await this._reply(interaction, message);
        } catch (replyErr) {
            
            console.error(`[InteractionManager] [${errorId}] Failed to send error reply:`, replyErr);
        }
    }


    _isExpired(entry) {
        return Date.now() > entry.expires;
    }

    /**
     * Returns true when the interacting user matches the registered owner,
     * or when no owner restriction was set.
     */
    _isAuthorized(interaction, expectedUserId) {
        if (!expectedUserId) return true;
        return interaction.member?.user?.id === expectedUserId;
    }


    _generateId() {
        return 'temp_' + crypto.randomBytes(6).toString('hex');
    }

    
    _errorId() {
        return crypto.randomBytes(4).toString('hex');
    }

    /**
     * Attempt to JSON.parse a string without throwing.
     * Returns the parsed object or null on failure.
     *
     * @param {string} str
     * @returns {object|null}
     */
    _tryParseJson(str) {
        try {
            return JSON.parse(str);
        } catch {
            return null;
        }
    }

    /**
     * Extract modal field values into a flat key→value map.
     *
     * @param {object} interaction
     * @returns {Record<string, string>}
     */
    _parseModalFields(interaction) {
        const fields = {};

        for (const row of interaction.data?.components ?? []) {
            for (const comp of row.components ?? []) {
                fields[comp.custom_id] = comp.value;
            }
        }

        return fields;
    }
}

module.exports = InteractionManager;
