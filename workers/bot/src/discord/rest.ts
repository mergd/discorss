const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordAPIError extends Error {
    constructor(
        public status: number,
        public code: number | undefined,
        message: string
    ) {
        super(message);
        this.name = 'DiscordAPIError';
    }
}

// Error codes we silently ignore (message/channel deleted, interaction expired, etc.)
const IGNORED_ERROR_CODES = new Set([10003, 10004, 10008, 10013, 10062, 50007]);

export const PERMISSION_ERROR_CODES = new Set([50001, 50013]);

export class DiscordRest {
    constructor(
        private botToken: string,
        private applicationId: string
    ) {}

    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        auth: 'bot' | 'none' = 'bot'
    ): Promise<T> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth === 'bot') headers.Authorization = `Bot ${this.botToken}`;

        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(`${DISCORD_API}${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });

            if (res.status === 429) {
                const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
                const retryAfterMs = Math.min((data.retry_after ?? 1) * 1000, 10_000);
                await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                continue;
            }

            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    code?: number;
                    message?: string;
                };
                throw new DiscordAPIError(
                    res.status,
                    data.code,
                    data.message ?? `Discord API error ${res.status}`
                );
            }

            if (res.status === 204) return undefined as T;
            return (await res.json()) as T;
        }

        throw new DiscordAPIError(429, undefined, 'Rate limited by Discord API');
    }

    /** Swallows "unknown message/channel/interaction"-class errors like the old InteractionUtils. */
    private async ignoringKnownErrors<T>(promise: Promise<T>): Promise<T | undefined> {
        try {
            return await promise;
        } catch (error) {
            if (error instanceof DiscordAPIError && error.code && IGNORED_ERROR_CODES.has(error.code)) {
                return undefined;
            }
            throw error;
        }
    }

    // --- Channels / messages ---

    async getChannel(channelId: string): Promise<{ id: string; type: number; name?: string } | null> {
        try {
            return await this.request('GET', `/channels/${channelId}`);
        } catch (error) {
            if (error instanceof DiscordAPIError && (error.status === 404 || error.code === 10003)) {
                return null;
            }
            throw error;
        }
    }

    async createMessage(
        channelId: string,
        message: {
            content?: string;
            embeds?: unknown[];
            allowed_mentions?: unknown;
            flags?: number;
        }
    ): Promise<{ id: string }> {
        return this.request('POST', `/channels/${channelId}/messages`, message);
    }

    // --- Guilds ---

    async getGuildChannels(
        guildId: string
    ): Promise<Array<{ id: string; type: number; name: string }>> {
        return this.request('GET', `/guilds/${guildId}/channels`);
    }

    /** Counts guilds the bot is in by paging /users/@me/guilds. */
    async getBotGuilds(): Promise<Array<{ id: string; name: string }>> {
        const all: Array<{ id: string; name: string }> = [];
        let after: string | undefined;
        for (let page = 0; page < 50; page++) {
            const query = after ? `?limit=200&after=${after}` : '?limit=200';
            const batch = await this.request<Array<{ id: string; name: string }>>(
                'GET',
                `/users/@me/guilds${query}`
            );
            all.push(...batch);
            if (batch.length < 200) break;
            after = batch[batch.length - 1].id;
        }
        return all;
    }

    // --- Interaction responses ---

    async editOriginalResponse(
        interactionToken: string,
        message: { content?: string; embeds?: unknown[]; components?: unknown[]; flags?: number }
    ): Promise<void> {
        await this.ignoringKnownErrors(
            this.request(
                'PATCH',
                `/webhooks/${this.applicationId}/${interactionToken}/messages/@original`,
                message,
                'none'
            )
        );
    }

    async createFollowup(
        interactionToken: string,
        message: { content?: string; embeds?: unknown[]; flags?: number }
    ): Promise<void> {
        await this.ignoringKnownErrors(
            this.request(
                'POST',
                `/webhooks/${this.applicationId}/${interactionToken}`,
                message,
                'none'
            )
        );
    }

    /** Edits the message a component interaction originated from. */
    async editComponentMessage(
        interactionToken: string,
        message: { content?: string; embeds?: unknown[]; components?: unknown[] }
    ): Promise<void> {
        await this.editOriginalResponse(interactionToken, message);
    }
}
