'use strict';

const DiscordRequest = require('../DiscordRequest.js');

const CDN = 'https://cdn.discordapp.com';

const ChannelType = Object.freeze({
    GUILD_TEXT:           0,
    DM:                   1,
    GUILD_VOICE:          2,
    GROUP_DM:             3,
    GUILD_CATEGORY:       4,
    GUILD_ANNOUNCEMENT:   5,
    ANNOUNCEMENT_THREAD: 10,
    PUBLIC_THREAD:       11,
    PRIVATE_THREAD:      12,
    GUILD_STAGE_VOICE:   13,
    GUILD_FORUM:         15,
    GUILD_MEDIA:         16,
});

const HANDLED_EVENTS = new Set([
    'GUILD_CREATE',
    'GUILD_UPDATE',
    'GUILD_DELETE',
    'GUILD_MEMBER_ADD',
    'GUILD_MEMBER_UPDATE',
    'GUILD_MEMBER_REMOVE',
    'CHANNEL_CREATE',
    'CHANNEL_UPDATE',
    'CHANNEL_DELETE',
    'GUILD_ROLE_CREATE',
    'GUILD_ROLE_UPDATE',
    'GUILD_ROLE_DELETE',
    'GUILD_EMOJIS_UPDATE',
]);



class Guild {

    constructor(client, data) {
        this.client = client;
        this._patch(data);
    }

    _patch(data) {
        this.id                          = data.id;
        this.name                        = data.name;
        this.icon                        = data.icon                          ?? null;
        this.banner                      = data.banner                        ?? null;
        this.splash                      = data.splash                        ?? null;
        this.description                 = data.description                   ?? null;
        this.ownerId                     = data.owner_id;
        this.afkChannelId                = data.afk_channel_id                ?? null;
        this.afkTimeout                  = data.afk_timeout                   ?? 0;
        this.verificationLevel           = data.verification_level            ?? 0;
        this.defaultMessageNotifications = data.default_message_notifications ?? 0;
        this.explicitContentFilter       = data.explicit_content_filter       ?? 0;
        this.features                    = data.features                      ?? [];
        this.mfaLevel                    = data.mfa_level                     ?? 0;
        this.systemChannelId             = data.system_channel_id             ?? null;
        this.rulesChannelId              = data.rules_channel_id              ?? null;
        this.publicUpdatesChannelId      = data.public_updates_channel_id     ?? null;
        this.preferredLocale             = data.preferred_locale              ?? 'en-US';
        this.premiumTier                 = data.premium_tier                  ?? 0;
        this.premiumSubscriptionCount    = data.premium_subscription_count    ?? 0;
        this.memberCount                 = data.member_count                  ?? 0;
        this.maxMembers                  = data.max_members                   ?? 0;
        this.vanityUrlCode               = data.vanity_url_code               ?? null;
        this.nsfwLevel                   = data.nsfw_level                    ?? 0;
        this.large                       = data.large                         ?? false;
        this.unavailable                 = data.unavailable                   ?? false;
        return this;
    }

    iconURL({ format = 'webp', size = 1024, dynamic = true } = {}) {
        if (!this.icon) return null;
        const ext = dynamic && this.icon.startsWith('a_') ? 'gif' : format;
        return `${CDN}/icons/${this.id}/${this.icon}.${ext}?size=${size}`;
    }

    bannerURL({ format = 'webp', size = 1024 } = {}) {
        if (!this.banner) return null;
        return `${CDN}/banners/${this.id}/${this.banner}.${format}?size=${size}`;
    }

    splashURL({ format = 'webp', size = 1024 } = {}) {
        if (!this.splash) return null;
        return `${CDN}/splashes/${this.id}/${this.splash}.${format}?size=${size}`;
    }

    toJSON() {
        return {
            id: this.id, name: this.name, icon: this.icon,
            banner: this.banner, ownerId: this.ownerId,
            memberCount: this.memberCount, premiumTier: this.premiumTier,
            features: this.features,
        };
    }
}



class GuildMember {

    constructor(client, guildId, data) {
        this.client  = client;
        this.guildId = guildId;
        this._patch(data);
    }

    _patch(data) {
        const user          = data.user          ?? {};
        this.userId         = user.id            ?? data.user_id;
        this.username       = user.username      ?? null;
        this.globalName     = user.global_name   ?? null;
        this.discriminator  = user.discriminator ?? '0';
        this.userAvatar     = user.avatar        ?? null;
        this.bot            = user.bot           ?? false;
        this.nick           = data.nick          ?? null;
        this.avatar         = data.avatar        ?? null;
        this.roles          = data.roles         ?? [];
        this.joinedAt       = data.joined_at     ? new Date(data.joined_at)      : null;
        this.premiumSince   = data.premium_since ? new Date(data.premium_since)  : null;
        this.deaf           = data.deaf          ?? false;
        this.mute           = data.mute          ?? false;
        this.pending        = data.pending       ?? false;
        this.communicationDisabledUntil = data.communication_disabled_until
            ? new Date(data.communication_disabled_until) : null;
        return this;
    }

    get id()          { return this.userId; }
    get displayName() { return this.nick ?? this.globalName ?? this.username; }
    get mention()     { return `<@${this.userId}>`; }

    avatarURL({ format = 'webp', size = 1024, dynamic = true } = {}) {
        if (this.avatar) {
            const ext = dynamic && this.avatar.startsWith('a_') ? 'gif' : format;
            return `${CDN}/guilds/${this.guildId}/users/${this.userId}/avatars/${this.avatar}.${ext}?size=${size}`;
        }
        if (!this.userAvatar) {
            const index = this.discriminator === '0'
                ? Number(BigInt(this.userId) >> 22n) % 6
                : Number(this.discriminator) % 5;
            return `${CDN}/embed/avatars/${index}.png`;
        }
        const ext = dynamic && this.userAvatar.startsWith('a_') ? 'gif' : format;
        return `${CDN}/avatars/${this.userId}/${this.userAvatar}.${ext}?size=${size}`;
    }

    hasRole(roleId)  { return this.roles.includes(roleId); }
    isTimedOut()     { return this.communicationDisabledUntil !== null && this.communicationDisabledUntil > new Date(); }

    toJSON() {
        return { userId: this.userId, guildId: this.guildId, nick: this.nick, roles: this.roles, joinedAt: this.joinedAt, bot: this.bot };
    }
}

class GuildChannel {

    constructor(client, data) {
        this.client = client;
        this._patch(data);
    }

    _patch(data) {
        this.id                   = data.id;
        this.type                 = data.type;
        this.guildId              = data.guild_id             ?? null;
        this.name                 = data.name                 ?? null;
        this.position             = data.position             ?? 0;
        this.topic                = data.topic                ?? null;
        this.nsfw                 = data.nsfw                 ?? false;
        this.lastMessageId        = data.last_message_id      ?? null;
        this.bitrate              = data.bitrate              ?? null;
        this.userLimit            = data.user_limit           ?? null;
        this.rateLimitPerUser     = data.rate_limit_per_user  ?? 0;
        this.parentId             = data.parent_id            ?? null;
        this.permissionOverwrites = data.permission_overwrites ?? [];
        this.rtcRegion            = data.rtc_region           ?? null;
        this.defaultAutoArchiveDuration = data.default_auto_archive_duration ?? null;
        return this;
    }

    get mention() { return `<#${this.id}>`; }

    isText() {
        return [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT, ChannelType.GUILD_FORUM, ChannelType.GUILD_MEDIA].includes(this.type);
    }
    isVoice()    { return [ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE].includes(this.type); }
    isThread()   { return [ChannelType.ANNOUNCEMENT_THREAD, ChannelType.PUBLIC_THREAD, ChannelType.PRIVATE_THREAD].includes(this.type); }
    isCategory() { return this.type === ChannelType.GUILD_CATEGORY; }
    isDM()       { return this.type === ChannelType.DM || this.type === ChannelType.GROUP_DM; }

    toJSON() {
        return { id: this.id, type: this.type, guildId: this.guildId, name: this.name, position: this.position, parentId: this.parentId, nsfw: this.nsfw };
    }
}


class GuildRole {

    constructor(client, guildId, data) {
        this.client  = client;
        this.guildId = guildId;
        this._patch(data);
    }

    _patch(data) {
        this.id           = data.id;
        this.name         = data.name;
        this.color        = data.color         ?? 0;
        this.hoist        = data.hoist         ?? false;
        this.icon         = data.icon          ?? null;
        this.unicodeEmoji = data.unicode_emoji ?? null;
        this.position     = data.position      ?? 0;
        this.permissions  = data.permissions   ?? '0';
        this.managed      = data.managed       ?? false;
        this.mentionable  = data.mentionable   ?? false;
        return this;
    }

    get mention()  { return `<@&${this.id}>`; }
    get hexColor() { return this.color ? `#${this.color.toString(16).padStart(6, '0')}` : '#000000'; }

    iconURL({ format = 'webp', size = 64 } = {}) {
        if (!this.icon) return null;
        return `${CDN}/role-icons/${this.id}/${this.icon}.${format}?size=${size}`;
    }

    hasPermission(flag) { return (BigInt(this.permissions) & BigInt(flag)) === BigInt(flag); }
    isEveryone()        { return this.id === this.guildId; }

    toJSON() {
        return { id: this.id, guildId: this.guildId, name: this.name, color: this.color, position: this.position, permissions: this.permissions, managed: this.managed };
    }
}

class GuildEmoji {

    constructor(client, guildId, data) {
        this.client  = client;
        this.guildId = guildId;
        this._patch(data);
    }

    _patch(data) {
        this.id            = data.id;
        this.name          = data.name           ?? null;
        this.roles         = data.roles          ?? [];
        this.creatorId     = data.user?.id       ?? null;
        this.requireColons = data.require_colons ?? true;
        this.managed       = data.managed        ?? false;
        this.animated      = data.animated       ?? false;
        this.available     = data.available      ?? true;
        return this;
    }

    get mention() {
        const prefix = this.animated ? 'a' : '';
        return this.id ? `<${prefix}:${this.name}:${this.id}>` : this.name;
    }

    imageURL({ size = 64 } = {}) {
        if (!this.id) return null;
        return `${CDN}/emojis/${this.id}.${this.animated ? 'gif' : 'webp'}?size=${size}`;
    }

    toJSON() {
        return { id: this.id, guildId: this.guildId, name: this.name, animated: this.animated, managed: this.managed, available: this.available };
    }
}



class GuildManager {

    constructor(client) {
        this.client = client;

        this.cache = {
            guilds:   new Map(),
            channels: new Map(),
            members:  new Map(),
            roles:    new Map(),
            emojis:   new Map(),
        };
    }


    handleDispatch(payload) {
        if (!HANDLED_EVENTS.has(payload.t)) return;

        const d = payload.d;

        switch (payload.t) {
            case 'GUILD_CREATE':          this._onGuildCreate(d);                          break;
            case 'GUILD_UPDATE':          this._onGuildUpdate(d);                          break;
            case 'GUILD_DELETE':          this._onGuildDelete(d);                          break;
            case 'GUILD_MEMBER_ADD':
            case 'GUILD_MEMBER_UPDATE':   this._upsertMember(d.guild_id, d);               break;
            case 'GUILD_MEMBER_REMOVE':   this._removeMember(d.guild_id, d.user.id);       break;
            case 'CHANNEL_CREATE':
            case 'CHANNEL_UPDATE':        this._upsertChannel(d);                          break;
            case 'CHANNEL_DELETE':        this.cache.channels.delete(d.id);                break;
            case 'GUILD_ROLE_CREATE':
            case 'GUILD_ROLE_UPDATE':     this._upsertRole(d.guild_id, d.role);            break;
            case 'GUILD_ROLE_DELETE':     this.cache.roles.delete(d.role_id);              break;
            case 'GUILD_EMOJIS_UPDATE':   this._syncEmojis(d.guild_id, d.emojis);          break;
        }
    }


    _onGuildCreate(data) {
        const guild = this._upsertGuild(data);
        for (const ch  of data.channels ?? []) this._upsertChannel({ ...ch,  guild_id: data.id });
        for (const m   of data.members  ?? []) this._upsertMember(data.id, m);
        for (const r   of data.roles    ?? []) this._upsertRole(data.id, r);
        for (const e   of data.emojis   ?? []) this._upsertEmoji(data.id, e);
        return guild;
    }

    _onGuildUpdate(data) {
        const existing = this.cache.guilds.get(data.id);
        return existing ? existing._patch(data) : this._upsertGuild(data);
    }

    _onGuildDelete(data) {
        if (data.unavailable) {
            const guild = this.cache.guilds.get(data.id);
            if (guild) guild.unavailable = true;
            return;
        }
        this.cache.guilds.delete(data.id);
    }


    _upsertGuild(data) {
        const existing = this.cache.guilds.get(data.id);
        if (existing) return existing._patch(data);
        const guild = new Guild(this.client, data);
        this.cache.guilds.set(guild.id, guild);
        return guild;
    }

    _upsertMember(guildId, data) {
        const userId   = data.user?.id ?? data.user_id;
        const key      = this._memberKey(guildId, userId);
        const existing = this.cache.members.get(key);
        if (existing) return existing._patch(data);
        const member = new GuildMember(this.client, guildId, data);
        this.cache.members.set(key, member);
        return member;
    }

    _removeMember(guildId, userId) {
        this.cache.members.delete(this._memberKey(guildId, userId));
    }

    _upsertChannel(data) {
        const existing = this.cache.channels.get(data.id);
        if (existing) return existing._patch(data);
        const channel = new GuildChannel(this.client, data);
        this.cache.channels.set(channel.id, channel);
        return channel;
    }

    _upsertRole(guildId, data) {
        const existing = this.cache.roles.get(data.id);
        if (existing) return existing._patch(data);
        const role = new GuildRole(this.client, guildId, data);
        this.cache.roles.set(role.id, role);
        return role;
    }

    _upsertEmoji(guildId, data) {
        const existing = this.cache.emojis.get(data.id);
        if (existing) return existing._patch(data);
        const emoji = new GuildEmoji(this.client, guildId, data);
        this.cache.emojis.set(emoji.id, emoji);
        return emoji;
    }

    _syncEmojis(guildId, emojis) {
        for (const [id, emoji] of this.cache.emojis) {
            if (emoji.guildId === guildId) this.cache.emojis.delete(id);
        }
        for (const emoji of emojis) this._upsertEmoji(guildId, emoji);
    }


    async fetch(guildId, force = false) {
        if (!force) {
            const cached = this.cache.guilds.get(guildId);
            if (cached) return cached;
        }
        const data = await DiscordRequest(`/guilds/${guildId}?with_counts=true`, { method: 'GET' });
        return this._upsertGuild(data);
    }

    async fetchAll(force = false) {
        if (!force && this.cache.guilds.size > 0) return this.cache.guilds;
        const guilds = await DiscordRequest('/users/@me/guilds', { method: 'GET' });
        for (const raw of guilds) this._upsertGuild(raw);
        return this.cache.guilds;
    }

    get(guildId)      { return this.cache.guilds.get(guildId) ?? null; }
    set(data)         { return this._upsertGuild(data); }
    has(guildId)      { return this.cache.guilds.has(guildId); }
    values()          { return this.cache.guilds.values(); }
    keys()            { return this.cache.guilds.keys(); }

    async patch(guildId, data) {
        const updated = await DiscordRequest(`/guilds/${guildId}`, { method: 'PATCH', body: data });
        return this._upsertGuild(updated);
    }

    async delete(guildId) {
        await DiscordRequest(`/guilds/${guildId}`, { method: 'DELETE' });
        this.cache.guilds.delete(guildId);
    }

    clear() {
        for (const store of Object.values(this.cache)) store.clear();
    }


    async fetchMember(guildId, userId, force = false) {
        const key = this._memberKey(guildId, userId);
        if (!force) {
            const cached = this.cache.members.get(key);
            if (cached) return cached;
        }
        const data = await DiscordRequest(`/guilds/${guildId}/members/${userId}`, { method: 'GET' });
        return this._upsertMember(guildId, data);
    }

    async fetchMembers(guildId, options = {}) {
        const params = new URLSearchParams();
        if (options.limit) params.set('limit', String(Math.min(options.limit, 1000)));
        if (options.after) params.set('after', options.after);
        const query  = params.toString() ? `?${params}` : '';
        const list   = await DiscordRequest(`/guilds/${guildId}/members${query}`, { method: 'GET' });
        const result = new Map();
        for (const raw of list) {
            const member = this._upsertMember(guildId, raw);
            result.set(member.userId, member);
        }
        return result;
    }

    getMember(guildId, userId) { return this.cache.members.get(this._memberKey(guildId, userId)) ?? null; }
    setMember(guildId, data)   { return this._upsertMember(guildId, data); }

    async patchMember(guildId, userId, data) {
        const updated = await DiscordRequest(`/guilds/${guildId}/members/${userId}`, { method: 'PATCH', body: data });
        return this._upsertMember(guildId, { ...updated, user: { id: userId } });
    }

    async deleteMember(guildId, userId) {
        await DiscordRequest(`/guilds/${guildId}/members/${userId}`, { method: 'DELETE' });
        this._removeMember(guildId, userId);
    }


    async fetchChannel(channelId, force = false) {
        if (!force) {
            const cached = this.cache.channels.get(channelId);
            if (cached) return cached;
        }
        const data = await DiscordRequest(`/channels/${channelId}`, { method: 'GET' });
        return this._upsertChannel(data);
    }

    async fetchGuildChannels(guildId, force = false) {
        if (!force) {
            const cached = this._filterCache(this.cache.channels, ch => ch.guildId === guildId);
            if (cached.size > 0) return cached;
        }
        const list   = await DiscordRequest(`/guilds/${guildId}/channels`, { method: 'GET' });
        const result = new Map();
        for (const raw of list) {
            const channel = this._upsertChannel({ ...raw, guild_id: guildId });
            result.set(channel.id, channel);
        }
        return result;
    }

    getChannel(channelId)     { return this.cache.channels.get(channelId) ?? null; }
    setChannel(data)          { return this._upsertChannel(data); }

    async patchChannel(channelId, data) {
        const updated = await DiscordRequest(`/channels/${channelId}`, { method: 'PATCH', body: data });
        return this._upsertChannel(updated);
    }

    async deleteChannel(channelId) {
        await DiscordRequest(`/channels/${channelId}`, { method: 'DELETE' });
        this.cache.channels.delete(channelId);
    }


    async fetchRoles(guildId, force = false) {
        if (!force) {
            const cached = this._filterCache(this.cache.roles, r => r.guildId === guildId);
            if (cached.size > 0) return cached;
        }
        const list   = await DiscordRequest(`/guilds/${guildId}/roles`, { method: 'GET' });
        const result = new Map();
        for (const raw of list) {
            const role = this._upsertRole(guildId, raw);
            result.set(role.id, role);
        }
        return result;
    }

    getRole(roleId)           { return this.cache.roles.get(roleId) ?? null; }
    setRole(guildId, data)    { return this._upsertRole(guildId, data); }

    async patchRole(guildId, roleId, data) {
        const updated = await DiscordRequest(`/guilds/${guildId}/roles/${roleId}`, { method: 'PATCH', body: data });
        return this._upsertRole(guildId, updated);
    }

    async deleteRole(guildId, roleId) {
        await DiscordRequest(`/guilds/${guildId}/roles/${roleId}`, { method: 'DELETE' });
        this.cache.roles.delete(roleId);
    }


    async fetchEmojis(guildId, force = false) {
        if (!force) {
            const cached = this._filterCache(this.cache.emojis, e => e.guildId === guildId);
            if (cached.size > 0) return cached;
        }
        const list   = await DiscordRequest(`/guilds/${guildId}/emojis`, { method: 'GET' });
        const result = new Map();
        for (const raw of list) {
            const emoji = this._upsertEmoji(guildId, raw);
            result.set(emoji.id, emoji);
        }
        return result;
    }

    getEmoji(emojiId)         { return this.cache.emojis.get(emojiId) ?? null; }
    setEmoji(guildId, data)   { return this._upsertEmoji(guildId, data); }

    async deleteEmoji(guildId, emojiId) {
        await DiscordRequest(`/guilds/${guildId}/emojis/${emojiId}`, { method: 'DELETE' });
        this.cache.emojis.delete(emojiId);
    }


    _memberKey(guildId, userId) {
        return `${guildId}:${userId}`;
    }

    _filterCache(map, predicate) {
        const result = new Map();
        for (const [id, value] of map) {
            if (predicate(value)) result.set(id, value);
        }
        return result;
    }
}

module.exports = GuildManager;