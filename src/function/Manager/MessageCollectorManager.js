'use strict';

const util = require('util');

const PremiumManager = require('../Utils/PremiumManager.js');
const GuildDb        = require('../../Mongodb/guild.js');
const UserGlobalDb   = require('../../Mongodb/userglobal.js');
const sendDm         = require('../Utils/sendDm.js');
const MessageEmbed   = require('../Messages/EmbedBuild.js');
const DiscordRequest = require('../DiscordRequest.js');



const STAFF_IDS = new Set(['1438170698580361287']);

const MAX_ADVENTURE_LEVEL  = 60;
const XP_PER_MESSAGE       = 5;
const ROLLS_PER_LEVEL      = 5;
const PRIMOGEMAS_PER_ROLL  = 160;
const EVAL_OUTPUT_LIMIT    = 1900;
const COLLECTOR_DEFAULT_MS = 60_000;



class NextMessageCollector {



    constructor(client) {
        this.client = client;

        /**
         * Active wait() collectors.
         * key   → `${channelId}_${userId}`
         * value → { resolve, reject, expires, timeout }
         * @type {Map<string, CollectorEntry>}
         */
        this._waiting = new Map();

        /**
         * Staff command registry.
         * Maps command name → handler method (bound to this).
         * @type {Map<string, Function>}
         */
        this._staffCommands = this._buildStaffCommandRegistry();
    }



    handle(payload) {
        if (payload.t !== 'MESSAGE_CREATE') return;

        const message = payload.d;

       
        if (message.author?.id === process.env.CLIENT_ID) return;


        this._runPipeline(message);
    }

    /**
     * Wait for the next message from a specific user in a specific channel.
     *
     * @param {{ channelId: string, userId: string, time?: number }} opts
     * @returns {Promise<object>} Resolves with the Discord message object.
     */
    wait({ channelId, userId, time = COLLECTOR_DEFAULT_MS }) {
        return new Promise((resolve, reject) => {
            const key     = this._collectorKey(channelId, userId);
            const expires = Date.now() + time;

            
            this._cancelCollector(key);

            const timeout = setTimeout(() => {
                this._waiting.delete(key);
                reject(new Error('Tempo esgotado'));
            }, time);

            this._waiting.set(key, { resolve, reject, expires, timeout });
        });
    }


    /**
     * Ordered pipeline executed for every incoming message.
     * Each stage is isolated — a failure in one does not block the others.
     */
    async _runPipeline(message) {
        await this._handleLeaks(message);
        await this._handleAdventureXp(message);
        await this._handleMentionReply(message);
        this._handleStaffCommands(message);
        this._handleCollectors(message);
    }



    async _handleLeaks(message) {
        try {
            await this.client.GenshinLeaksManager.handleMessage(message);
        } catch (err) {
            console.error('[MessagePipeline] Leaks handler error:', err);
        }
    }



    async _handleAdventureXp(message) {
        const userId = message.author?.id;
        if (!userId) return;

        try {
            const user = await this._getOrCreateUser(userId);

            const levelBefore = user.rankaventureiro.nivelAtual;

            this._awardMessageXp(user);
            this._recalculateLevel(user);

            const levelAfter   = user.rankaventureiro.nivelAtual;
            const levelsGained = levelAfter - levelBefore;

            if (levelsGained > 0) {
                this._applyLevelUpRewards(user, levelBefore, levelAfter);
            }

            this._updateXpRemaining(user);

            await user.save();

            if (levelsGained > 0 && user.dmNotificacoes) {
                await this._sendLevelUpDm(userId, user, levelBefore, levelAfter);
            }
        } catch (err) {
            console.error('[AdventureXP] Error processing message XP:', err);
        }
    }



    async _getOrCreateUser(userId) {
        let user = await UserGlobalDb.findOne({ userId });

        if (!user) {
            user = new UserGlobalDb({
                userId,
                rankaventureiro: { nivelAtual: 0, xpTotal: 0, xpRestante: 1000 },
            });
        }

        if (!user.rankaventureiro) {
            user.rankaventureiro = { nivelAtual: 0, xpTotal: 0, xpRestante: 1000 };
        }

        return user;
    }

    _awardMessageXp(user) {
        user.rankaventureiro.xpTotal += XP_PER_MESSAGE;
    }

    _recalculateLevel(user) {
        let { nivelAtual, xpTotal } = user.rankaventureiro;

        while (nivelAtual < MAX_ADVENTURE_LEVEL) {
            if (xpTotal >= (nivelAtual + 1) * 1000) {
                nivelAtual++;
            } else {
                break;
            }
        }

        user.rankaventureiro.nivelAtual = Math.min(nivelAtual, MAX_ADVENTURE_LEVEL);
    }

    _applyLevelUpRewards(user, levelBefore, levelAfter) {
        const levelsGained = levelAfter - levelBefore;
        const rolls        = levelsGained * ROLLS_PER_LEVEL;
        const primogemas   = rolls * PRIMOGEMAS_PER_ROLL;

        user.primogemas.atm += primogemas;

        if (!Array.isArray(user.primogemas.transacoes)) {
            user.primogemas.transacoes = [];
        }

        user.primogemas.transacoes.push({
            type:      'adventure_rank_reward',
            value:     primogemas,
            rolls,
            old_level: levelBefore,
            new_level: levelAfter,
            date:      Date.now(),
        });
    }

    _updateXpRemaining(user) {
        const { nivelAtual, xpTotal } = user.rankaventureiro;

        if (nivelAtual >= MAX_ADVENTURE_LEVEL) {
            user.rankaventureiro.xpRestante = 0;
            return;
        }

        user.rankaventureiro.xpRestante = ((nivelAtual + 1) * 1000) - xpTotal;
    }



    async _sendLevelUpDm(userId, user, levelBefore, levelAfter) {
        try {
            const userData = await DiscordRequest(`/users/${userId}`, { method: 'GET' });

            const embed = new MessageEmbed()
                .setTitle('Novo Rank de Aventureiro!')
                .setColor('Red')
                .setThumbnail(this._getAvatarUrl(userData))
                .setDescription(this._buildLevelUpText(user, levelBefore, levelAfter));

            await sendDm(userId, { embeds: [embed.build()] });
        } catch (err) {
            
            console.error('[AdventureXP] Failed to send level-up DM:', err);
        }
    }

    _buildLevelUpText(user, levelBefore, levelAfter) {
        return (
`Hm... então você evoluiu.

Do Rank de Aventureiro #${levelBefore} para #${levelAfter}.
Nada mal. Você começa a entender o peso do próprio crescimento.

Como reconhecimento pelo avanço, a Casa da Lareira concedeu a você 5 giros.
Use-os com sabedoria… ou desperdice-os como tantos outros fazem.

Sua experiência atual é ${user.rankaventureiro.xpTotal}XP.
Ainda faltam ${user.rankaventureiro.xpRestante}XP para alcançar o Rank de Aventureiro #${levelAfter + 1}.

Não pense que isso é o suficiente.
O verdadeiro valor não está no número… mas no quanto você suporta para alcançá-lo.

Continue.

Eu estarei observando.`
        );
    }



    _handleMentionReply(message) {
        const clientId = process.env.CLIENT_ID;
        const isMentioned =
            message.content?.includes(`<@${clientId}>`) ||
            message.content?.includes(`<@!${clientId}>`);

        if (!isMentioned) return;

        return DiscordRequest(`/channels/${message.channel_id}/messages`, {
            method: 'POST',
            body: {
                content:
                    `<@${message.author.id}> | Use </ajuda:0> para visualizar todos os comandos e sistemas disponíveis.\n` +
                    `-# Continue crescendo. Eu observo cada passo seu…`,
            },
        });
    }



    /**
     * Route a message to the correct staff command handler.
     * Uses an internal Map registry instead of chained ifs.
     */
    _handleStaffCommands(message) {
        if (!message.content?.startsWith('!')) return;

        const userId = message.author?.id;
        if (!this._isStaff(userId)) return;

        const [rawCmd, ...args] = message.content.slice(1).trim().split(/ +/);
        const cmd = rawCmd.toLowerCase();

        const handler = this._staffCommands.get(cmd);
        if (!handler) return;

        handler(message, args).catch((err) => {
            console.error(`[StaffCommand] Error in !${cmd}:`, err);
            this._send(message.channel_id, `❌ Erro interno ao executar \`!${cmd}\`.`);
        });
    }


    _buildStaffCommandRegistry() {
        return new Map([
            ['useraddpremium',    this._cmdUserAddPremium.bind(this)],
            ['userremovepremium', this._cmdUserRemovePremium.bind(this)],
            ['guildaddpremium',   this._cmdGuildAddPremium.bind(this)],
            ['guildremovepremium',this._cmdGuildRemovePremium.bind(this)],
            ['eval',              this._cmdEval.bind(this)],
        ]);
    }


    async _cmdUserAddPremium(message, args) {
        const [targetId, rawDays] = args;
        const days = Number(rawDays);

        if (!targetId || !days) {
            return this._send(message.channel_id, '❌ Uso: `!useraddpremium [ID] [DIAS]`');
        }

        await PremiumManager.addUserPremium(targetId, days);
        return this._send(
            message.channel_id,
            `✅ Premium adicionado para <@${targetId}> por **${days} dias**`
        );
    }

    async _cmdUserRemovePremium(message, args) {
        const [targetId] = args;

        if (!targetId) {
            return this._send(message.channel_id, '❌ Uso: `!userremovepremium [ID]`');
        }

        await PremiumManager.removeUserPremium(targetId);
        return this._send(message.channel_id, `❌ Premium removido de <@${targetId}>`);
    }

    async _cmdGuildAddPremium(message, args) {
        const [targetUserId, guildId] = args;

        if (!targetUserId || !guildId) {
            return this._send(message.channel_id, '❌ Uso: `!guildaddpremium [USER_ID] [GUILD_ID]`');
        }

        const result = await PremiumManager.addGuildPremium(guildId, targetUserId);

        if (!result.status) {
            return this._send(message.channel_id, '❌ Usuário não tem premium ativo.');
        }

        return this._send(message.channel_id, `🏰 Servidor **${guildId}** agora é premium`);
    }

    async _cmdGuildRemovePremium(message, args) {
        const [guildId] = args;

        if (!guildId) {
            return this._send(message.channel_id, '❌ Uso: `!guildremovepremium [GUILD_ID]`');
        }

        await PremiumManager.removeGuildPremium(guildId);
        return this._send(message.channel_id, `❌ Premium removido do servidor ${guildId}`);
    }

    async _cmdEval(message, args) {
        const channelId = message.channel_id;
        const code      = args.join(' ');

        if (!code) {
            return this._send(channelId, '❌ Uso: `!eval [CODIGO]`');
        }

        try {
            // eslint-disable-next-line no-eval
            let result = await eval(`(async () => { ${code} })()`);

            if (typeof result !== 'string') {
                result = util.inspect(result, { depth: 1 });
            }

            if (!result) result = '✅ Executado sem retorno.';

            if (result.length > EVAL_OUTPUT_LIMIT) {
                result = result.slice(0, EVAL_OUTPUT_LIMIT) + '\n… (truncado)';
            }

            return this._send(channelId, `\`\`\`js\n${result}\n\`\`\``);
        } catch (err) {
            const output = (err.stack || String(err)).slice(0, EVAL_OUTPUT_LIMIT);
            return this._send(channelId, `\`\`\`js\n${output}\n\`\`\``);
        }
    }


    /**
     * Resolve a pending wait() collector if one exists for this message.
     * Deletes the collected message from Discord afterward.
     */
    _handleCollectors(message) {
        const key  = this._collectorKey(message.channel_id, message.author.id);
        const data = this._waiting.get(key);

        if (!data) return;

        if (Date.now() > data.expires) {
            this._cancelCollector(key);
            return;
        }

        clearTimeout(data.timeout);
        this._waiting.delete(key);

        // Best-effort delete — non-critical if it fails.
        this._deleteMessage(message.channel_id, message.id);

        data.resolve(message);
    }




    _isStaff(userId) {
        return STAFF_IDS.has(userId);
    }

    
    _collectorKey(channelId, userId) {
        return `${channelId}_${userId}`;
    }


    _cancelCollector(key) {
        const data = this._waiting.get(key);
        if (!data) return;
        clearTimeout(data.timeout);
        this._waiting.delete(key);
    }

    
    _send(channelId, content) {
        return DiscordRequest(`/channels/${channelId}/messages`, {
            method: 'POST',
            body:   { content },
        });
    }


    async _deleteMessage(channelId, messageId) {
        try {
            await DiscordRequest(`/channels/${channelId}/messages/${messageId}`, {
                method: 'DELETE',
            });
        } catch {
            
        }
    }

    
    _getAvatarUrl(user) {
        if (!user.avatar) {
            return 'https://cdn.discordapp.com/embed/avatars/0.png';
        }

        const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=1024`;
    }
}

module.exports = NextMessageCollector;
