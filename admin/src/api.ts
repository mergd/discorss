import type { AuthUser, Channel, Feed, Guild } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
        },
        credentials: 'include',
    });

    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const message =
            typeof body.message === 'string'
                ? body.message
                : typeof body.error === 'string'
                  ? body.error
                  : `Request failed (${res.status})`;
        throw new Error(message);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

export async function getMe(): Promise<{ authenticated: boolean; user?: AuthUser }> {
    return request('/auth/me');
}

export async function logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' });
}

export async function getGuilds(): Promise<{ guilds: Guild[] }> {
    return request('/api/guilds');
}

export async function getChannels(guildId: string): Promise<{ channels: Channel[] }> {
    return request(`/api/guilds/${guildId}/channels`);
}

export async function getFeeds(
    guildId: string,
    channelId?: string
): Promise<{ feeds: Feed[] }> {
    const qs = channelId ? `?channelId=${channelId}` : '';
    return request(`/api/guilds/${guildId}/feeds${qs}`);
}

export async function addFeed(
    guildId: string,
    body: {
        url: string;
        channelId: string;
        nickname?: string;
        summarize?: boolean;
        useArchiveLinks?: boolean;
        category?: string;
        frequencyOverrideMinutes?: number | null;
    }
): Promise<{ id: string; convertedFromTwitter?: string }> {
    return request(`/api/guilds/${guildId}/feeds`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function updateFeed(
    guildId: string,
    feedId: string,
    body: {
        channelId: string;
        nickname?: string | null;
        summarize?: boolean;
        useArchiveLinks?: boolean;
        disabled?: boolean;
        category?: string | null;
        frequencyOverrideMinutes?: number | null;
    }
): Promise<void> {
    await request(`/api/guilds/${guildId}/feeds/${feedId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteFeed(
    guildId: string,
    feedId: string,
    channelId: string
): Promise<void> {
    await request(`/api/guilds/${guildId}/feeds/${feedId}?channelId=${channelId}`, {
        method: 'DELETE',
    });
}
