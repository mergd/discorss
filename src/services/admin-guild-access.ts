import { Client } from 'discord.js';
import { AdminSession } from './admin-session.js';
import {
    DiscordOAuthGuild,
    fetchOAuthGuilds,
    filterManageableGuilds,
} from './discord-oauth-service.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

type GuildAccessCache = {
    guilds: DiscordOAuthGuild[];
    guildIds: Set<string>;
    expiresAt: number;
};

const cache = new Map<string, GuildAccessCache>();
const inFlight = new Map<string, Promise<GuildAccessCache>>();

async function loadGuildAccess(
    session: AdminSession,
    client: Client
): Promise<GuildAccessCache> {
    const botGuildIds = new Set(client.guilds.cache.map(g => g.id));
    const userGuilds = await fetchOAuthGuilds(session.accessToken);
    const manageable = filterManageableGuilds(userGuilds, botGuildIds);
    const guildIds = new Set(manageable.map(g => g.id));
    const entry: GuildAccessCache = {
        guilds: manageable,
        guildIds,
        expiresAt: Date.now() + CACHE_TTL_MS,
    };
    cache.set(session.userId, entry);
    return entry;
}

export async function getManageableGuilds(
    session: AdminSession,
    client: Client
): Promise<DiscordOAuthGuild[]> {
    const cached = cache.get(session.userId);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.guilds;
    }

    const pending = inFlight.get(session.userId);
    if (pending) {
        return (await pending).guilds;
    }

    const promise = loadGuildAccess(session, client);
    inFlight.set(session.userId, promise);
    try {
        return (await promise).guilds;
    } finally {
        inFlight.delete(session.userId);
    }
}

export async function hasGuildAccess(
    session: AdminSession,
    client: Client,
    guildId: string
): Promise<boolean> {
    const cached = cache.get(session.userId);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.guildIds.has(guildId);
    }

    const pending = inFlight.get(session.userId);
    if (pending) {
        return (await pending).guildIds.has(guildId);
    }

    const promise = loadGuildAccess(session, client);
    inFlight.set(session.userId, promise);
    try {
        return (await promise).guildIds.has(guildId);
    } finally {
        inFlight.delete(session.userId);
    }
}

export function clearGuildAccessCache(userId: string): void {
    cache.delete(userId);
    inFlight.delete(userId);
}
