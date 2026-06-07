'use strict';

const DiscordRequest = require('../../function/DiscordRequest.js');

module.exports = {
    data: {
        name:        'ping',
        description: 'Mostra latência, cluster e shard',
        options: [{
            type:        3, // STRING
            name:        'escopo',
            description: 'Onde verificar o ping',
            required:    true,
            choices: [
                { name: 'Apenas nesse servidor', value: 'local'  },
                { name: 'Todos os clusters',      value: 'global' },
            ],
        }],
    },

    async execute(interaction, client) {
        const escopo  = interaction.data.options.find(o => o.name === 'escopo')?.value;
        const guildId = interaction.guild_id;

        if (escopo === 'local') {
            return _replyLocal(interaction, client, guildId);
        }

        return _replyGlobal(interaction, client);
    },
};

// ─── Local (apenas este cluster/shard) ────────────────────────────────────────

async function _replyLocal(interaction, client, guildId) {
    const shardId = client.getShardId(guildId);
    const info    = await client.getClusterInfo();
    const shard   = info.shards.find(s => s.shardId === shardId);
    let CLUSTERS_NAME = client.CLUSTERS_NAME;

    const embed = {
        title:  '🏓 Pong! — Este servidor',
        color:  0x5865F2,
        fields: [
            { name: `Cluster: ${CLUSTERS_NAME[info.clusterId]}`,       value: `ID: \`#${info.clusterId}\``,               inline: true  },
            { name: '📡 Shard',         value: `\`#${shardId}\``,                      inline: true  },
            { name: '🏓 Ping',          value: `\`${shard?.ping ?? '?'}ms\``,          inline: true  },
            { name: '🕐 Uptime',        value: `\`${_formatUptime(info.uptime)}\``,    inline: true  },
            { name: '💾 Memória',       value: `\`${_formatMemory(info.memory)}\``,    inline: true  },
            { name: '🔢 Total Shards',  value: `\`${info.totalShards}\``,              inline: true  },
        ],
        timestamp: new Date().toISOString(),
    };

    return _reply(interaction, embed);
}

// ─── Global (todos os clusters via IPC) ───────────────────────────────────────

async function _replyGlobal(interaction, client) {
    // Defer pois o IPC pode demorar
    await DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        { method: 'POST', body: { type: 5 } } 
    );

    let allStats;
    try {
        allStats = await client.requestAllStats(); // ← via IPC, não global
    } catch {
        return _editReply(interaction, client, {
            title:       '❌ Indisponível',
            color:       0xED4245,
            description: 'Não foi possível obter stats dos clusters.',
        });
    }
    
    let CLUSTERS_NAME = client.CLUSTERS_NAME;

    const totalMemory = allStats.reduce((acc, c) => acc + (c.memory ?? 0), 0);
    const totalShards = allStats.reduce((acc, c) => acc + (c.shards?.length ?? 0), 0);
    const avgPing     = _calcAvgPing(allStats);

    const clusterFields = allStats.map((c) => {
        if (c.error) {
            return {
                name:   `Cluster: \`${CLUSTERS_NAME[c.clusterId]}\``,
                value:  `⚠️ ${c.error}`,
                inline: false,
            };
        }

        const shardList = c.shards
            .map(s => `\`#${s.shardId}\` ${s.ping}ms`)
            .join('  ');

        return {
            name:  `Cluster \`${CLUSTERS_NAME[c.clusterId]}\` — 🕐 \`${_formatUptime(c.uptime)}\` — 💾 \`${_formatMemory(c.memory)}\``,
            value: shardList || 'Sem shards',
            inline: false,
        };
    });

    const embed = {
        title:  '🏓 Pong! — Todos os Clusters',
        color:  0x57F287,
        fields: [
            { name: '📊 Clusters',     value: `\`${allStats.length}\``,        inline: true },
            { name: '📡 Shards',       value: `\`${totalShards}\``,            inline: true },
            { name: '🏓 Ping Médio',   value: `\`${avgPing}ms\``,              inline: true },
            { name: '💾 Memória Total',value: `\`${_formatMemory(totalMemory)}\``, inline: true },
            { name: '\u200b', value: '\u200b', inline: false }, // separador
            ...clusterFields,
        ],
        timestamp: new Date().toISOString(),
    };

    return _editReply(interaction, client, embed);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _reply(interaction, embed) {
    return DiscordRequest(
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        {
            method: 'POST',
            body: {
                type: 4,
                data: { embeds: [embed], flags: 64 },
            },
        }
    );
}

function _editReply(interaction, client, embed) {
    return DiscordRequest(
        `/webhooks/${client.clientId}/${interaction.token}/messages/@original`,
        {
            method: 'PATCH',
            body:   { embeds: [embed] },
        }
    );
}

function _calcAvgPing(clusters) {
    const pings = clusters
        .flatMap(c => c.shards ?? [])
        .map(s => s.ping)
        .filter(p => p >= 0);

    if (!pings.length) return '?';
    return Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
}

function _formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function _formatMemory(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}