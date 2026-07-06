import type { Env } from '../env.js';

const DISCORD_API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 1n << 5n;

export type DiscordOAuthUser = {
    id: string;
    username: string;
    avatar: string | null;
};

export type DiscordOAuthGuild = {
    id: string;
    name: string;
    icon: string | null;
    permissions: string;
};

export function getDiscordOAuthUrl(env: Env, state: string): string {
    const params = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: env.ADMIN_OAUTH_REDIRECT_URI!,
        response_type: 'code',
        scope: 'identify guilds',
        state,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeOAuthCode(env: Env, code: string): Promise<string> {
    const body = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.ADMIN_OAUTH_REDIRECT_URI!,
    });

    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Discord token exchange failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { access_token: string };
    return data.access_token;
}

export async function fetchOAuthUser(accessToken: string): Promise<DiscordOAuthUser> {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch Discord user (${res.status})`);
    }
    const data = (await res.json()) as { id: string; username: string; avatar: string | null };
    return { id: data.id, username: data.username, avatar: data.avatar };
}

export async function fetchOAuthGuilds(accessToken: string): Promise<DiscordOAuthGuild[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
            return (await res.json()) as DiscordOAuthGuild[];
        }
        if (res.status === 429 && attempt === 0) {
            const retryAfter = Number(res.headers.get('retry-after') || '1');
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue;
        }
        throw new Error(`Failed to fetch Discord guilds (${res.status})`);
    }
    throw new Error('Failed to fetch Discord guilds');
}

export function filterManageableGuilds(
    userGuilds: DiscordOAuthGuild[],
    botGuildIds: Set<string>
): DiscordOAuthGuild[] {
    return userGuilds.filter(guild => {
        if (!botGuildIds.has(guild.id)) return false;
        try {
            return (BigInt(guild.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
        } catch {
            return false;
        }
    });
}
