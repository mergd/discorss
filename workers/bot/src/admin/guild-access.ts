import { DiscordRest } from '../discord/rest.js';
import { AdminSession } from './session.js';
import { DiscordOAuthGuild, fetchOAuthGuilds, filterManageableGuilds } from './oauth.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

type GuildAccessCache = {
    guilds: DiscordOAuthGuild[];
    guildIds: Set<string>;
    expiresAt: number;
};

// Per-isolate caches — best-effort only; isolates are ephemeral, which is fine
// since this is purely a rate-limit optimization.
const cache = new Map<string, GuildAccessCache>();
let botGuildsCache: { guildIds: Set<string>; expiresAt: number } | null = null;

async function getBotGuildIds(rest: DiscordRest): Promise<Set<string>> {
    if (botGuildsCache && Date.now() < botGuildsCache.expiresAt) {
        return botGuildsCache.guildIds;
    }
    const guilds = await rest.getBotGuilds();
    const guildIds = new Set(guilds.map(g => g.id));
    botGuildsCache = { guildIds, expiresAt: Date.now() + CACHE_TTL_MS };
    return guildIds;
}

async function loadGuildAccess(session: AdminSession, rest: DiscordRest): Promise<GuildAccessCache> {
    const botGuildIds = await getBotGuildIds(rest);
    const userGuilds = await fetchOAuthGuilds(session.accessToken);
    const manageable = filterManageableGuilds(userGuilds, botGuildIds);
    const entry: GuildAccessCache = {
        guilds: manageable,
        guildIds: new Set(manageable.map(g => g.id)),
        expiresAt: Date.now() + CACHE_TTL_MS,
    };
    cache.set(session.userId, entry);
    return entry;
}

export async function getManageableGuilds(
    session: AdminSession,
    rest: DiscordRest
): Promise<DiscordOAuthGuild[]> {
    const cached = cache.get(session.userId);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.guilds;
    }
    return (await loadGuildAccess(session, rest)).guilds;
}

export async function hasGuildAccess(
    session: AdminSession,
    rest: DiscordRest,
    guildId: string
): Promise<boolean> {
    const cached = cache.get(session.userId);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.guildIds.has(guildId);
    }
    return (await loadGuildAccess(session, rest)).guildIds.has(guildId);
}
