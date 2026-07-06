// Minimal raw-interaction payload types and helpers (replaces discord.js's
// ChatInputCommandInteraction option getters).

export const InteractionType = {
    Ping: 1,
    ApplicationCommand: 2,
    MessageComponent: 3,
    Autocomplete: 4,
    ModalSubmit: 5,
} as const;

export const InteractionResponseType = {
    Pong: 1,
    ChannelMessageWithSource: 4,
    DeferredChannelMessageWithSource: 5,
    DeferredUpdateMessage: 6,
    UpdateMessage: 7,
} as const;

export const MessageFlags = {
    SuppressEmbeds: 1 << 2,
    Ephemeral: 1 << 6,
} as const;

export const ChannelTypes = {
    GuildText: 0,
    GuildAnnouncement: 5,
} as const;

export interface InteractionOption {
    name: string;
    type: number;
    value?: string | number | boolean;
    options?: InteractionOption[];
}

export interface ResolvedChannel {
    id: string;
    name?: string;
    type: number;
}

export interface Interaction {
    id: string;
    type: number;
    token: string;
    application_id: string;
    guild_id?: string;
    channel_id?: string;
    channel?: ResolvedChannel;
    locale?: string;
    member?: { user: DiscordUser; permissions?: string; joined_at?: string };
    user?: DiscordUser;
    data?: {
        id?: string;
        name?: string;
        type?: number;
        options?: InteractionOption[];
        custom_id?: string;
        component_type?: number;
        target_id?: string;
        resolved?: {
            channels?: Record<string, ResolvedChannel>;
            messages?: Record<string, { id: string; timestamp: string }>;
            members?: Record<string, { joined_at: string }>;
            users?: Record<string, DiscordUser>;
        };
    };
    message?: { id: string; embeds?: unknown[] };
}

export interface DiscordUser {
    id: string;
    username: string;
    discriminator?: string;
    global_name?: string | null;
}

export function interactionUser(intr: Interaction): DiscordUser {
    return (intr.member?.user ?? intr.user)!;
}

export function userTag(user: DiscordUser): string {
    return user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username;
}

/** Walks past subcommand groups/subcommands to the leaf options. */
function leafOptions(intr: Interaction): InteractionOption[] {
    let options = intr.data?.options ?? [];
    while (options.length === 1 && (options[0].type === 1 || options[0].type === 2)) {
        options = options[0].options ?? [];
    }
    return options;
}

export function getSubcommandGroup(intr: Interaction): string | null {
    const first = intr.data?.options?.[0];
    return first?.type === 2 ? first.name : null;
}

export function getSubcommand(intr: Interaction): string | null {
    let options = intr.data?.options ?? [];
    if (options[0]?.type === 2) {
        options = options[0].options ?? [];
    }
    return options[0]?.type === 1 ? options[0].name : null;
}

function findOption(intr: Interaction, name: string): InteractionOption | undefined {
    return leafOptions(intr).find(o => o.name === name);
}

export function getString(intr: Interaction, name: string): string | null {
    const opt = findOption(intr, name);
    return typeof opt?.value === 'string' ? opt.value : null;
}

export function getInteger(intr: Interaction, name: string): number | null {
    const opt = findOption(intr, name);
    return typeof opt?.value === 'number' ? opt.value : null;
}

export function getBoolean(intr: Interaction, name: string): boolean | null {
    const opt = findOption(intr, name);
    return typeof opt?.value === 'boolean' ? opt.value : null;
}

/** Returns the resolved channel option, or the invoking channel if not provided. */
export function getChannelOption(intr: Interaction, name: string): ResolvedChannel | null {
    const opt = findOption(intr, name);
    if (typeof opt?.value === 'string') {
        const resolved = intr.data?.resolved?.channels?.[opt.value];
        if (resolved) return resolved;
    }
    return intr.channel ?? null;
}

// --- Response helpers (the synchronous HTTP response to the interaction) ---

export function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
    });
}

export function pong(): Response {
    return jsonResponse({ type: InteractionResponseType.Pong });
}

export function deferredReply(ephemeral: boolean): Response {
    return jsonResponse({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: ephemeral ? { flags: MessageFlags.Ephemeral } : {},
    });
}

export function deferredUpdate(): Response {
    return jsonResponse({ type: InteractionResponseType.DeferredUpdateMessage });
}

export function immediateReply(
    data: { content?: string; embeds?: unknown[]; flags?: number },
    ephemeral = false
): Response {
    return jsonResponse({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: ephemeral ? { ...data, flags: (data.flags ?? 0) | MessageFlags.Ephemeral } : data,
    });
}
