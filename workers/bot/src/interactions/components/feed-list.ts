import { ITEMS_PER_PAGE } from '../../constants.js';
import { ChannelTypes, Interaction, interactionUser } from '../../discord/interaction.js';
import { DiscordRest } from '../../discord/rest.js';
import { FeedConfig, FeedStorageService } from '../../services/feed-storage.js';
import { getShortId } from '../../utils.js';
import { CommandContext } from '../context.js';

const inlineCode = (s: string): string => `\`${s}\``;

// custom_id format: fl:<page>:<channelId or '-'>:<invokerUserId>:<p|n>
// The trailing direction marker keeps prev/next custom_ids unique even when
// wraparound makes them target the same page (e.g. exactly two pages).
export function parseFeedListCustomId(
    customId: string
): { page: number; channelId?: string; userId: string } | null {
    const parts = customId.split(':');
    if (parts.length < 4 || parts[0] !== 'fl') return null;
    const page = parseInt(parts[1], 10);
    if (isNaN(page)) return null;
    return { page, channelId: parts[2] === '-' ? undefined : parts[2], userId: parts[3] };
}

function paginationComponents(
    page: number,
    totalPages: number,
    channelId: string | undefined,
    userId: string
): unknown[] {
    if (totalPages <= 1) return [];
    const channelPart = channelId ?? '-';
    return [
        {
            type: 1, // action row
            components: [
                {
                    type: 2, // button
                    style: 2, // secondary
                    emoji: { name: '◀️' },
                    custom_id: `fl:${page - 1 >= 1 ? page - 1 : totalPages}:${channelPart}:${userId}:p`,
                },
                {
                    type: 2,
                    style: 2,
                    emoji: { name: '▶️' },
                    custom_id: `fl:${page + 1 <= totalPages ? page + 1 : 1}:${channelPart}:${userId}:n`,
                },
            ],
        },
    ];
}

async function generateFeedListEmbed(
    rest: DiscordRest,
    allFeeds: FeedConfig[],
    page: number,
    categoryFrequencies: Map<string, number>,
    targetChannelId?: string
): Promise<unknown> {
    const totalPages = Math.ceil(allFeeds.length / ITEMS_PER_PAGE);
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const currentPageFeeds = allFeeds.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const title =
        `📰 Configured RSS Feeds` + (targetChannelId ? ` in <#${targetChannelId}>` : ' (Server-Wide)');

    // Fetch channel names for server-wide list display
    const channelNames: { [id: string]: string } = {};
    if (!targetChannelId) {
        const channelIds = [...new Set(currentPageFeeds.map(f => f.channelId))];
        for (const chId of channelIds) {
            try {
                const ch = await rest.getChannel(chId);
                channelNames[chId] =
                    ch &&
                    (ch.type === ChannelTypes.GuildText ||
                        ch.type === ChannelTypes.GuildAnnouncement)
                        ? `#${ch.name}`
                        : `<#${chId}> (Unknown/Deleted)`;
            } catch {
                channelNames[chId] = `<#${chId}> (Error Fetching)`;
            }
        }
    }

    const feedDescriptions = currentPageFeeds.map(f => {
        const shortId = getShortId(f.id);
        const categoryString = f.category ? ` [${f.category}]` : '';
        const headerLine = f.nickname
            ? `**${f.nickname}** (${inlineCode(shortId)})${categoryString}`
            : `${inlineCode(shortId)}${categoryString}`;
        const channelMention = !targetChannelId ? ` ${channelNames[f.channelId]}` : '';
        const urlLine = `<${f.url}>`;

        let frequency = 30;
        let frequencySource = '(Default)';
        if (f.frequencyOverrideMinutes) {
            frequency = f.frequencyOverrideMinutes;
            frequencySource = '(Feed Override)';
        } else if (f.category && categoryFrequencies.has(f.category)) {
            frequency = categoryFrequencies.get(f.category)!;
            frequencySource = `(Category: ${f.category})`;
        }
        const frequencyLine = `*Frequency: ${frequency} min ${frequencySource}*`;

        const errorLine =
            f.consecutiveFailures && f.consecutiveFailures > 0
                ? `*⚠️ Fetch Error (${f.consecutiveFailures} failure${f.consecutiveFailures > 1 ? 's' : ''})*`
                : '';
        const disabledLine = f.disabled
            ? '*🔴 Polling disabled — use `/feed edit` with `enabled:true` to re-enable*'
            : '';

        let description = `${headerLine}${channelMention}\n${urlLine}\n${frequencyLine}`;
        if (disabledLine) description += `\n${disabledLine}`;
        if (errorLine) description += `\n${errorLine}`;
        return description;
    });

    return {
        title,
        color: 0x1abc9c,
        description: feedDescriptions.join('\n\n') || 'No feeds found for this page.',
        footer: { text: `Page ${page} of ${totalPages}` },
        timestamp: new Date().toISOString(),
    };
}

/**
 * Builds the /feed list message (embed + pagination buttons).
 * Returns null when the guild/channel has no feeds.
 */
export async function buildFeedListMessage(
    rest: DiscordRest,
    guildId: string,
    page: number,
    targetChannelId: string | undefined,
    invokerUserId: string
): Promise<{ embeds: unknown[]; components: unknown[] } | null> {
    const [allFeeds, guildCategories] = await Promise.all([
        FeedStorageService.getFeeds(guildId, targetChannelId),
        FeedStorageService.getGuildCategories(guildId),
    ]);

    if (allFeeds.length === 0) return null;

    const categoryFrequencies = new Map<string, number>();
    guildCategories.forEach(cat => categoryFrequencies.set(cat.name, cat.frequencyMinutes));

    const totalPages = Math.ceil(allFeeds.length / ITEMS_PER_PAGE);
    const clampedPage = Math.min(Math.max(page, 1), totalPages);

    const embed = await generateFeedListEmbed(
        rest,
        allFeeds,
        clampedPage,
        categoryFrequencies,
        targetChannelId
    );

    return {
        embeds: [embed],
        components: paginationComponents(clampedPage, totalPages, targetChannelId, invokerUserId),
    };
}

/** Handles pagination button clicks (runs after a deferred-update response). */
export async function handleFeedListComponent(ctx: CommandContext): Promise<void> {
    const intr: Interaction = ctx.intr;
    const parsed = parseFeedListCustomId(intr.data?.custom_id ?? '');
    if (!parsed || !intr.guild_id) return;

    // Only the original invoker can paginate, matching the old reaction filter.
    if (interactionUser(intr).id !== parsed.userId) return;

    const message = await buildFeedListMessage(
        ctx.rest,
        intr.guild_id,
        parsed.page,
        parsed.channelId,
        parsed.userId
    );
    if (!message) return;

    await ctx.rest.editComponentMessage(intr.token, message);
}
