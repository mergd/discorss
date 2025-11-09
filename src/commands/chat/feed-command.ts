import {
    ChannelType,
    ChatInputCommandInteraction,
    codeBlock,
    EmbedBuilder,
    inlineCode,
    MessageFlags,
    MessageReaction,
    PermissionsString,
    User,
} from 'discord.js';
import { ITEMS_PER_PAGE, PAGINATION_TIMEOUT } from '../../constants/index.js';
import { getArchiveUrl, isPaywalled } from '../../constants/paywalled-sites.js';
import { EventData } from '../../models/internal-models.js';
import { FeedConfig, FeedStorageService } from '../../services/feed-storage-service.js';
import { Logger } from '../../services/logger.js';
import { posthog } from '../../utils/analytics.js';
import { fetchPageContent, summarizeContent } from '../../utils/feed-summarizer.js';
import { InteractionUtils, StringUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

// Use shared RSS Parser instance to reduce memory footprint
import { getRSSParser } from '../../utils/rss-parser.js';

// Helper to get a short ID (first 8 chars of UUID)
function getShortId(uuid: string): string {
    return uuid.substring(0, 8);
}

// Helper to format relative time
function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

// Helper to detect and convert Twitter/X URLs to Nitter RSS format
function detectAndConvertTwitterUrl(url: string): {
    isTwitter: boolean;
    convertedUrl?: string;
    username?: string;
} {
    const twitterPattern = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/?$/;
    const match = url.match(twitterPattern);

    if (match) {
        const username = match[3];
        return {
            isTwitter: true,
            convertedUrl: `https://nitter.net/${username}/rss`,
            username: username,
        };
    }

    return { isTwitter: false };
}

// Validate and normalize language code
// Allows: 2-char codes (en, es), language-region codes (en-US, es-ES), or 3-char codes (eng, spa)
function validateLanguageCode(language: string | null): string | null {
    if (!language) return null;

    const trimmed = language.trim().toLowerCase();

    // Empty after trimming
    if (!trimmed) return null;

    // Validate format: 2-10 characters, letters, numbers, and hyphens only
    // Common formats: "en", "es", "en-us", "es-es", "pt-br", "eng", "spa"
    const languageRegex = /^[a-z0-9]{2,10}(-[a-z0-9]{2,5})?$/;

    if (!languageRegex.test(trimmed)) {
        return null;
    }

    return trimmed;
}

// Helper function to generate the embed for a specific page
async function generateFeedListPage(
    intr: ChatInputCommandInteraction,
    allFeeds: FeedConfig[],
    page: number,
    itemsPerPage: number,
    categoryFrequencies: Map<string, number>,
    targetChannelId?: string
): Promise<EmbedBuilder> {
    const totalPages = Math.ceil(allFeeds.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentPageFeeds = allFeeds.slice(startIndex, endIndex);

    const title =
        `📰 Configured RSS Feeds` +
        (targetChannelId ? ` in <#${targetChannelId}>` : ' (Server-Wide)');
    const embed = new EmbedBuilder().setTitle(title).setColor('Aqua').setTimestamp();

    if (currentPageFeeds.length === 0) {
        // This should theoretically not happen if allFeeds is not empty, but good practice
        embed.setDescription('No feeds found for this page.');
        return embed;
    }

    // Fetch channel names for server-wide list display if needed
    const channelNames: { [id: string]: string } = {};
    if (!targetChannelId) {
        const channelIds = [...new Set(currentPageFeeds.map(f => f.channelId))];
        for (const chId of channelIds) {
            try {
                const ch = await intr.client.channels.fetch(chId);
                channelNames[chId] =
                    ch &&
                    (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
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
        let headerLine: string;
        if (f.nickname) {
            headerLine = `**${f.nickname}** (${inlineCode(shortId)})${categoryString}`;
        } else {
            headerLine = `${inlineCode(shortId)}${categoryString}`;
        }
        const channelMention = !targetChannelId ? ` ${channelNames[f.channelId]}` : ''; // Add channel if server-wide list
        const urlLine = `<${f.url}>`;

        // Determine frequency
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

        // Check for consecutive failures to indicate an error
        const errorLine =
            f.consecutiveFailures && f.consecutiveFailures > 0
                ? `*⚠️ Fetch Error (${f.consecutiveFailures} failure${f.consecutiveFailures > 1 ? 's' : ''})*`
                : '';

        let description = `${headerLine}${channelMention}\n${urlLine}\n${frequencyLine}`;
        if (errorLine) {
            description += `\n${errorLine}`;
        }
        return description;
    });

    embed.setDescription(feedDescriptions.join('\n\n')); // Use single backslash for newline
    embed.setFooter({ text: `Page ${page} of ${totalPages}` });

    return embed;
}

export class FeedCommand implements Command {
    public names = ['feed'];
    public deferType = CommandDeferType.PUBLIC; // Defer publicly initially
    public requireClientPerms: PermissionsString[] = [
        'SendMessages',
        'EmbedLinks',
        'AddReactions',
        'ManageMessages',
    ]; // Added reaction perms
    // Optional: Require user to have Manage Server permissions
    // public requireUserPerms: PermissionsString[] = ['ManageGuild'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        if (!intr.guild) {
            // Commands that manage server-specific feeds should only run in guilds
            await InteractionUtils.send(
                intr,
                'This command can only be used inside a server.',
                true
            );
            return;
        }

        const subCommand = intr.options.getSubcommand();
        const subCommandGroup = intr.options.getSubcommandGroup(false); // Check for group

        try {
            // Handle top-level commands first
            if (!subCommandGroup) {
                switch (subCommand) {
                    case 'add': {
                        const url = intr.options.getString('url', true);
                        const targetChannel = intr.options.getChannel('channel') ?? intr.channel;
                        const nickname = intr.options.getString('nickname');
                        const category = intr.options.getString('category');
                        const frequency = intr.options.getInteger('frequency'); // Optional frequency
                        const summarize = intr.options.getBoolean('summarize') ?? false;
                        const useArchiveLinks =
                            intr.options.getBoolean('use_archive_links') ?? false;
                        const languageInput = intr.options.getString('language');
                        const language = validateLanguageCode(languageInput);

                        if (languageInput && languageInput.trim() !== '' && !language) {
                            await InteractionUtils.editReply(
                                intr,
                                `❌ Invalid language code: ${inlineCode(languageInput)}. Language codes should be 2-10 characters and may include a region (e.g., "en", "es", "en-us", "es-es", "pt-br").`
                            );
                            return;
                        }

                        // URL validation (basic)
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            await InteractionUtils.editReply(
                                intr,
                                'Please provide a valid URL starting with http:// or https://.'
                            );
                            return;
                        }

                        // Check if this is a Twitter/X profile URL and convert to Nitter RSS
                        const twitterCheck = detectAndConvertTwitterUrl(url);
                        let feedUrl = url;
                        if (twitterCheck.isTwitter) {
                            feedUrl = twitterCheck.convertedUrl!;
                            await InteractionUtils.editReply(
                                intr,
                                `⚠️ **Twitter/X Profile Detected**\n\nTwitter/X doesn't provide RSS feeds. I've converted this to use Nitter (a Twitter RSS proxy):\n\n**Original:** ${inlineCode(url)}\n**RSS Feed:** ${inlineCode(feedUrl)}\n\n*Note: Nitter instances can be unreliable. If this feed fails, try a different Nitter instance or remove the feed.*`
                            );
                        }

                        // Ensure the target channel (either specified or current) is valid
                        if (
                            !targetChannel ||
                            (targetChannel.type !== ChannelType.GuildText &&
                                targetChannel.type !== ChannelType.GuildAnnouncement)
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                'Feeds can only be added to text or announcement channels.'
                            );
                            return;
                        }

                        // Validate feed works before adding (fail early)
                        let finalNickname = nickname;
                        try {
                            console.log(`Validating feed: ${feedUrl}`);
                            const rssParser = getRSSParser();
                            const feed = await rssParser.parseURL(feedUrl);

                            if (!feed || !feed.items || feed.items.length === 0) {
                                await InteractionUtils.editReply(
                                    intr,
                                    `❌ **Feed Validation Failed**\n\nThe feed at ${inlineCode(feedUrl)} appears to be empty or invalid. Please check the URL and try again.\n\n*If this is a Twitter/X feed, note that Nitter instances may be down. Try a different Nitter instance or wait and try again later.*\n\n💡 You can test feeds with ${inlineCode('/feed poke')} if you've already added them.`
                                );
                                return;
                            }

                            // Auto-nickname if not provided
                            if (!finalNickname && feed.title) {
                                finalNickname = feed.title.trim();
                                console.log(`Auto-nickname found: "${finalNickname}"`);
                            }
                        } catch (parseError: any) {
                            console.error(`Error validating feed (${feedUrl}):`, parseError);
                            const errorMsg = parseError?.message || 'Unknown error';
                            await InteractionUtils.editReply(
                                intr,
                                `❌ **Feed Validation Failed**\n\nCould not fetch or parse the RSS feed at ${inlineCode(feedUrl)}.\n\n**Error:** ${codeBlock(errorMsg.substring(0, 500))}\n\nPlease check:\n- The URL is correct and accessible\n- The feed is a valid RSS/Atom feed\n- If this is a Twitter/X feed, the Nitter instance may be down\n\n*Feeds must be valid RSS/Atom feeds. Twitter/X profile URLs are not RSS feeds.*\n\n💡 You can test feeds with ${inlineCode('/feed poke')} if you've already added them.`
                            );
                            return;
                        }

                        // Attempt to add the feed
                        try {
                            let initialSummary: string | null = null;
                            let articleContent: string | null = null;
                            let commentsContent: string | null = null;

                            if (summarize) {
                                try {
                                    const rssParser = getRSSParser();
                                    const feed = await rssParser.parseURL(feedUrl);
                                    const firstItem = feed.items?.[0];

                                    if (firstItem) {
                                        // Fetch article content
                                        if (firstItem.link) {
                                            const feedItemContent =
                                                firstItem['content:encoded'] || firstItem.content;
                                            if (feedItemContent && feedItemContent.length > 200) {
                                                articleContent = feedItemContent;
                                            } else {
                                                articleContent = await fetchPageContent(
                                                    firstItem.link
                                                );
                                            }
                                        }
                                        // Fetch comments content if available
                                        if (
                                            firstItem.comments &&
                                            firstItem.comments !== firstItem.link
                                        ) {
                                            commentsContent = await fetchPageContent(
                                                firstItem.comments
                                            );
                                        }

                                        // Generate summary if any content was fetched
                                        if (articleContent || commentsContent) {
                                            Logger.info(
                                                `[FeedAdd] Summarizing initial item for ${feedUrl}`
                                            );
                                            // Use provided language or guild language
                                            const effectiveLanguage =
                                                language ||
                                                (await FeedStorageService.getGuildLanguage(
                                                    intr.guild.id
                                                ));
                                            const { articleSummary, commentsSummary } =
                                                await summarizeContent(
                                                    articleContent,
                                                    commentsContent,
                                                    firstItem.link || feedUrl,
                                                    effectiveLanguage
                                                );
                                            if (
                                                articleSummary?.startsWith(
                                                    'Could not generate summary:'
                                                )
                                            ) {
                                                // Inform user about summary failure but proceed with add
                                                await InteractionUtils.send(
                                                    intr,
                                                    `⚠️ ${articleSummary}. Feed will be added without an initial summary check.`,
                                                    true
                                                ); // Send ephemeral follow-up
                                                initialSummary = null; // Don't store the failure message
                                            } else {
                                                initialSummary = articleSummary;
                                            }
                                        } else {
                                            Logger.warn(
                                                `[FeedAdd] No content found to summarize for initial item of ${feedUrl}`
                                            );
                                            await InteractionUtils.send(
                                                intr,
                                                '⚠️ Could not fetch initial content to generate a summary. Feed will be added without summary check.',
                                                true
                                            );
                                            initialSummary = null; // Explicitly nullify
                                        }
                                    } else {
                                        Logger.warn(
                                            `[FeedAdd] No items found in feed ${feedUrl} for initial summary.`
                                        );
                                        await InteractionUtils.send(
                                            intr,
                                            '⚠️ Feed has no items, cannot generate initial summary. Feed will be added.',
                                            true
                                        );
                                        initialSummary = null; // Explicitly nullify
                                    }
                                } catch (err: any) {
                                    Logger.error(
                                        `[FeedAdd] Error fetching/summarizing initial item for ${feedUrl}:`,
                                        err
                                    );
                                    await InteractionUtils.send(
                                        intr,
                                        `⚠️ Error fetching or summarizing initial item: ${err.message}. Feed will be added without summary check.`,
                                        true
                                    );
                                    initialSummary = null; // Ensure no summary on error
                                }
                            }

                            // Ensure feedData always includes summarize flag
                            const feedData: Omit<
                                FeedConfig,
                                | 'id'
                                | 'consecutiveFailures'
                                | 'createdAt'
                                | 'lastChecked'
                                | 'lastItemGuid'
                                | 'recentLinks'
                                | 'lastSummary'
                            > = {
                                url: feedUrl,
                                channelId: targetChannel.id,
                                guildId: intr.guild.id,
                                nickname: finalNickname,
                                category: category,
                                addedBy: intr.user.id,
                                frequencyOverrideMinutes: frequency,
                                summarize: summarize,
                                useArchiveLinks: useArchiveLinks,
                                language: language || null,
                                ignoreErrors: false,
                                disableFailureNotifications: false,
                                disabled: false,
                            };

                            const newFeedId = await FeedStorageService.addFeed(feedData);

                            // Only update lastSummary if one was successfully generated and not an error
                            if (
                                initialSummary &&
                                !initialSummary.startsWith('Could not generate summary:')
                            ) {
                                await FeedStorageService.updateFeedDetails(
                                    newFeedId,
                                    targetChannel.id,
                                    intr.guild.id,
                                    { lastArticleSummary: initialSummary }
                                );
                            }

                            const shortId = getShortId(newFeedId);
                            const nicknameString = finalNickname
                                ? ` Nickname: ${inlineCode(finalNickname)}.`
                                : '';
                            const categoryString = category
                                ? ` Category: ${inlineCode(category)}.`
                                : '';
                            const frequencyString = frequency
                                ? ` Frequency: ${inlineCode(frequency.toString())} min.`
                                : '';
                            const summarizeString = summarize ? ' Summarization: Enabled.' : '';
                            const identifierHint = finalNickname
                                ? `feed_id:"${finalNickname}"`
                                : `feed_id:${shortId}`;
                            const removeCommand = `/feed remove ${identifierHint} channel:${targetChannel.id}`;

                            // --- PostHog Tracking --- START
                            if (posthog) {
                                posthog.capture({
                                    distinctId: intr.user.id,
                                    event: 'feed_added',
                                    properties: {
                                        feedId: newFeedId,
                                        guildId: intr.guild.id,
                                        channelId: targetChannel.id,
                                        url: url,
                                        nickname: finalNickname,
                                        category: category,
                                        frequency: frequency,
                                        summarize: summarize,
                                        addedBy: intr.user.id,
                                    },
                                    groups: { guild: intr.guild.id },
                                });
                            }
                            // --- PostHog Tracking --- END

                            await InteractionUtils.editReply(
                                intr,
                                `✅ Feed added successfully to <#${targetChannel.id}>!${nicknameString}${categoryString}${frequencyString}${summarizeString}
   Short ID: ${inlineCode(shortId)}
   Use ${inlineCode(removeCommand)} to remove it.`
                            );
                        } catch (error) {
                            if (
                                error instanceof Error &&
                                error.message.includes('already exists')
                            ) {
                                await InteractionUtils.editReply(
                                    intr,
                                    `⚠️ This feed URL is already registered for <#${targetChannel.id}>.`
                                );
                            } else {
                                console.error('Error adding feed:', error);
                                await InteractionUtils.editReply(
                                    intr,
                                    '❌ An error occurred while adding the feed. Please check the logs.'
                                );
                            }
                        }
                        break;
                    }
                    case 'remove': {
                        const feedIdentifier = intr.options.getString('feed_id', true);
                        const targetChannel = intr.options.getChannel('channel') ?? intr.channel;

                        if (
                            !targetChannel ||
                            (targetChannel.type !== ChannelType.GuildText &&
                                targetChannel.type !== ChannelType.GuildAnnouncement)
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                'Feeds can only be removed from text or announcement channels.'
                            );
                            return;
                        }

                        try {
                            // Search for feeds using text-based search (nickname, URL, or ID)
                            const matchingFeeds = await FeedStorageService.searchFeeds(
                                intr.guild.id,
                                feedIdentifier,
                                targetChannel.id
                            );

                            if (matchingFeeds.length === 0) {
                                await InteractionUtils.editReply(
                                    intr,
                                    `❓ Could not find a feed matching \`${feedIdentifier}\` in this server.`
                                );
                                return;
                            }

                            // Use the first result (already prioritized by channel)
                            const targetFeed = matchingFeeds[0];

                            // Now, attempt removal using the full, resolved feed ID
                            const removed = await FeedStorageService.removeFeed(
                                targetFeed.id,
                                targetChannel.id,
                                intr.guild.id
                            );

                            if (removed) {
                                // --- PostHog Tracking --- START
                                if (posthog) {
                                    posthog.capture({
                                        distinctId: intr.user.id,
                                        event: 'feed_removed',
                                        properties: {
                                            guildId: intr.guild.id,
                                            channelId: targetChannel.id,
                                            removedFeedIdentifier: feedIdentifier, // What user provided
                                            removedFeedId: targetFeed.id, // Actual ID removed
                                            removedBy: intr.user.id,
                                        },
                                        groups: { guild: intr.guild.id },
                                    });
                                }
                                // --- PostHog Tracking --- END

                                const title = targetFeed.nickname || 'Untitled Feed';
                                const shortId = getShortId(targetFeed.id);
                                const url = targetFeed.url;

                                await InteractionUtils.editReply(
                                    intr,
                                    `✅ Feed **${title}** (${inlineCode(shortId)}) pointing to <${url}> has been removed from <#${targetChannel.id}>.`
                                );
                            } else {
                                // This is an edge case, but good to handle
                                await InteractionUtils.editReply(
                                    intr,
                                    `❌ Failed to remove feed \`${feedIdentifier}\`. It might have been deleted by another user just now. Please try listing the feeds again.`
                                );
                            }
                        } catch (error) {
                            Logger.error('Error removing feed:', {
                                guildId: intr.guild.id,
                                channelId: targetChannel.id,
                                feedIdentifier,
                                error,
                            });
                            await InteractionUtils.editReply(
                                intr,
                                '❌ An error occurred while removing the feed. Please check the logs.'
                            );
                        }
                        break;
                    }
                    case 'list': {
                        // --- LIST SUBCOMMAND (PAGINATED) ---
                        const channel = intr.options.getChannel('channel');
                        let targetChannelId: string | undefined = undefined;
                        let currentPage = 1;

                        if (channel) {
                            if (
                                channel.type !== ChannelType.GuildText &&
                                channel.type !== ChannelType.GuildAnnouncement
                            ) {
                                await InteractionUtils.editReply(
                                    intr,
                                    'Can only list feeds for text or announcement channels.'
                                );
                                return;
                            }
                            targetChannelId = channel.id;
                        }

                        try {
                            // Fetch feeds and category frequencies concurrently
                            const [allFeeds, guildCategories] = await Promise.all([
                                FeedStorageService.getFeeds(
                                    intr.guild!.id, // non-null assertion safe due to initial check
                                    targetChannelId // Pass undefined for server-wide
                                ),
                                FeedStorageService.getGuildCategories(intr.guild!.id),
                            ]);

                            // Convert categories to a Map for easy lookup
                            const categoryFrequencies = new Map<string, number>();
                            guildCategories.forEach(cat => {
                                categoryFrequencies.set(cat.name, cat.frequencyMinutes);
                            });

                            if (allFeeds.length === 0) {
                                const emptyMsg = targetChannelId
                                    ? `No feeds found for channel <#${targetChannelId}>.`
                                    : 'No feeds configured for this server yet.';
                                await InteractionUtils.editReply(intr, emptyMsg);
                                return;
                            }

                            const totalPages = Math.ceil(allFeeds.length / ITEMS_PER_PAGE);

                            // Generate and send the initial page
                            const initialEmbed = await generateFeedListPage(
                                intr,
                                allFeeds,
                                currentPage,
                                ITEMS_PER_PAGE,
                                categoryFrequencies, // Pass the map
                                targetChannelId
                            );
                            const message = await intr.editReply({
                                embeds: [initialEmbed],
                            });

                            // Don't add pagination if only one page
                            if (totalPages <= 1) {
                                return;
                            }

                            // Add reactions for pagination
                            try {
                                await message.react('◀️');
                                await message.react('▶️');
                            } catch (error) {
                                console.error('Failed to add pagination reactions:', error);
                                // Optionally inform user reactions couldn't be added
                                await message.edit({
                                    content: 'Could not add pagination reactions.',
                                    embeds: [initialEmbed],
                                });
                                return; // Stop if reactions fail
                            }

                            // Create reaction collector
                            const filter = (reaction: MessageReaction, user: User): boolean => {
                                return (
                                    ['◀️', '▶️'].includes(reaction.emoji.name ?? '') &&
                                    user.id === intr.user.id
                                );
                            };

                            const collector = message.createReactionCollector({
                                filter,
                                time: PAGINATION_TIMEOUT,
                            });

                            collector.on('collect', async (reaction, user) => {
                                // Update page number based on reaction
                                if (reaction.emoji.name === '◀️') {
                                    currentPage = currentPage > 1 ? currentPage - 1 : totalPages; // Wrap around
                                } else if (reaction.emoji.name === '▶️') {
                                    currentPage = currentPage < totalPages ? currentPage + 1 : 1; // Wrap around
                                } else {
                                    return; // Should not happen due to filter, but safety check
                                }

                                // Generate the new embed
                                const newEmbed = await generateFeedListPage(
                                    intr,
                                    allFeeds,
                                    currentPage,
                                    ITEMS_PER_PAGE,
                                    categoryFrequencies, // Pass the map again
                                    targetChannelId
                                );

                                // Edit the message
                                try {
                                    await message.edit({ embeds: [newEmbed] });
                                    // Remove the user's reaction *after* the edit succeeds
                                    try {
                                        await reaction.users.remove(user.id);
                                    } catch (error) {
                                        // This might fail if the bot lacks permissions, but isn't critical
                                        console.warn(
                                            `Failed to remove reaction for user ${user.id} after page update:`,
                                            error
                                        );
                                    }
                                } catch (editError) {
                                    console.error(
                                        'Failed to edit message for pagination:',
                                        editError
                                    );
                                    collector.stop('editError'); // Stop collecting if editing fails
                                }
                            });

                            collector.on('end', async (_collected, reason) => {
                                // Don't try to remove reactions if message was deleted or we don't have perms
                                if (reason !== 'messageDelete' && reason !== 'channelDelete') {
                                    try {
                                        // Attempt to remove all reactions if the message still exists
                                        await message.reactions.removeAll();
                                    } catch (error) {
                                        // Ignore errors (e.g., missing permissions, message deleted)
                                        Logger.warn(
                                            `Could not remove reactions after pagination timeout: ${error}`
                                        );
                                    }
                                }
                                // When pagination ends, we don't need to update the message
                            });
                        } catch (error) {
                            console.error('Error listing feeds:', error);
                            await InteractionUtils.editReply(
                                intr,
                                '❌ An error occurred while listing the feeds. Please check the logs.'
                            );
                        }
                        break;
                    }
                    case 'edit': {
                        const feedIdentifier = intr.options.getString('feed_id', true);
                        const targetChannel = intr.options.getChannel('channel') ?? intr.channel;
                        const newNickname = intr.options.getString('nickname');
                        const newCategory = intr.options.getString('category');
                        const newFrequency = intr.options.getInteger('frequency');
                        const newSummarize = intr.options.getBoolean('summarize');
                        const newUseArchiveLinks = intr.options.getBoolean('use_archive_links');
                        const newLanguageInput = intr.options.getString('language');
                        // Empty string or whitespace means clear the language (null)
                        const newLanguage =
                            newLanguageInput?.trim() === ''
                                ? null
                                : validateLanguageCode(newLanguageInput);

                        if (
                            newLanguageInput !== null &&
                            newLanguageInput.trim() !== '' &&
                            !newLanguage
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                `❌ Invalid language code: ${inlineCode(newLanguageInput)}. Language codes should be 2-10 characters and may include a region (e.g., "en", "es", "en-us", "es-es", "pt-br").`
                            );
                            return;
                        }

                        // Validate channel type
                        if (
                            !targetChannel ||
                            (targetChannel.type !== ChannelType.GuildText &&
                                targetChannel.type !== ChannelType.GuildAnnouncement)
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                'Feeds can only be edited within text or announcement channels.'
                            );
                            return;
                        }

                        // Check if at least one optional field is provided
                        if (
                            newNickname === null &&
                            newCategory === null &&
                            newFrequency === null &&
                            newSummarize === null &&
                            newUseArchiveLinks === null &&
                            newLanguage === null
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                'Please provide at least one detail to update (nickname, category, frequency, summarize, use_archive_links, or language).'
                            );
                            return;
                        }

                        try {
                            // Search for feeds using text-based search (nickname, URL, or ID)
                            const matchingFeeds = await FeedStorageService.searchFeeds(
                                intr.guild.id,
                                feedIdentifier,
                                targetChannel.id
                            );

                            if (matchingFeeds.length === 0) {
                                await InteractionUtils.editReply(
                                    intr,
                                    `❓ Could not find a feed matching \`${feedIdentifier}\` in this server.`
                                );
                                return;
                            }

                            // Use the first result (already prioritized by channel)
                            const targetFeed = matchingFeeds[0];

                            // Prepare updates - pass undefined if option not given, null if explicitly meant to clear (future potential?)
                            // Currently, getString/Integer return null if not provided.
                            const updates: {
                                nickname?: string | null;
                                category?: string | null;
                                frequencyOverrideMinutes?: number | null;
                                summarize?: boolean | null;
                                useArchiveLinks?: boolean | null;
                                language?: string | null;
                                lastArticleSummary?: string | null;
                                lastCommentsSummary?: string | null;
                            } = {};
                            const originalValues: Partial<FeedConfig> = {
                                // Store original values for comparison
                                nickname: targetFeed.nickname,
                                category: targetFeed.category,
                                frequencyOverrideMinutes: targetFeed.frequencyOverrideMinutes,
                                summarize: targetFeed.summarize,
                                useArchiveLinks: targetFeed.useArchiveLinks,
                            };

                            // Only include fields that were actually provided in the command
                            if (intr.options.getString('nickname') !== null)
                                updates.nickname = newNickname;
                            if (intr.options.getString('category') !== null)
                                updates.category = newCategory;
                            if (intr.options.getInteger('frequency') !== null)
                                updates.frequencyOverrideMinutes = newFrequency;
                            if (intr.options.getBoolean('summarize') !== null)
                                updates.summarize = newSummarize;
                            if (intr.options.getBoolean('use_archive_links') !== null)
                                updates.useArchiveLinks = newUseArchiveLinks;
                            if (intr.options.getString('language') !== null)
                                updates.language = newLanguage; // Already validated above

                            // Call the update service
                            const updated = await FeedStorageService.updateFeedDetails(
                                targetFeed.id,
                                targetChannel.id,
                                intr.guild.id,
                                updates
                            );

                            if (updated) {
                                // --- PostHog Tracking --- START
                                if (posthog) {
                                    const changes: Record<string, any> = {};
                                    if (updates.nickname !== undefined)
                                        changes.nickname = {
                                            old: originalValues.nickname,
                                            new: updates.nickname,
                                        };
                                    if (updates.category !== undefined)
                                        changes.category = {
                                            old: originalValues.category,
                                            new: updates.category,
                                        };
                                    if (updates.frequencyOverrideMinutes !== undefined)
                                        changes.frequency = {
                                            old: originalValues.frequencyOverrideMinutes,
                                            new: updates.frequencyOverrideMinutes,
                                        };
                                    if (updates.summarize !== undefined)
                                        changes.summarize = {
                                            old: originalValues.summarize,
                                            new: updates.summarize,
                                        };
                                    if (updates.useArchiveLinks !== undefined)
                                        changes.useArchiveLinks = {
                                            old: originalValues.useArchiveLinks,
                                            new: updates.useArchiveLinks,
                                        };

                                    if (Object.keys(changes).length > 0) {
                                        // Only capture if something changed
                                        posthog.capture({
                                            distinctId: intr.user.id,
                                            event: 'feed_edited',
                                            properties: {
                                                feedId: targetFeed.id,
                                                guildId: intr.guild.id,
                                                channelId: targetChannel.id,
                                                editedBy: intr.user.id,
                                                changes: changes,
                                            },
                                            groups: { guild: intr.guild.id },
                                        });
                                    }
                                }
                                // --- PostHog Tracking --- END

                                let changesSummary = Object.entries(updates)
                                    .filter(
                                        ([key, _value]) =>
                                            key !== 'lastArticleSummary' &&
                                            key !== 'lastCommentsSummary'
                                    ) // Don't show lastSummary in user reply
                                    .map(([key, value]) => {
                                        let displayValue =
                                            value === null || value === ''
                                                ? 'cleared'
                                                : inlineCode(String(value));
                                        if (key === 'frequencyOverrideMinutes' && value !== null)
                                            displayValue += ' min';
                                        return `${key.replace('OverrideMinutes', '')}: ${displayValue}`;
                                    })
                                    .join(', ');
                                await InteractionUtils.editReply(
                                    intr,
                                    `✅ Feed \`${getShortId(targetFeed.id)}\` updated successfully in <#${targetChannel.id}>. Changes: ${changesSummary}`
                                );
                            } else {
                                await InteractionUtils.editReply(
                                    intr,
                                    `❌ Failed to update feed \`${getShortId(targetFeed.id)}\`. Please check logs or try again.`
                                );
                            }

                            if (newSummarize) {
                                // Try to re-summarize latest item
                                let contentToSummarize = '';
                                try {
                                    const rssParser = getRSSParser();
                                    const feed = await rssParser.parseURL(targetFeed.url);
                                    if (feed.items && feed.items[0] && feed.items[0].content) {
                                        contentToSummarize = feed.items[0].content;
                                    } else if (feed.items && feed.items[0] && feed.items[0].link) {
                                        const pageContent = await fetchPageContent(
                                            feed.items[0].link
                                        );
                                        if (pageContent) contentToSummarize = pageContent;
                                    }
                                    if (contentToSummarize) {
                                        // Get effective language for this feed
                                        const effectiveLanguage =
                                            await FeedStorageService.getEffectiveLanguage(
                                                targetFeed.id,
                                                targetFeed.guildId
                                            );
                                        const { articleSummary, commentsSummary } =
                                            await summarizeContent(
                                                contentToSummarize,
                                                null,
                                                feed.items[0].link,
                                                effectiveLanguage
                                            );
                                        updates.lastArticleSummary = articleSummary;
                                        updates.lastCommentsSummary = commentsSummary;
                                    }
                                } catch (err) {
                                    console.error('Error fetching/summarizing for feed:', err);
                                }
                            }
                        } catch (error) {
                            console.error('Error editing feed:', error);
                            await InteractionUtils.editReply(
                                intr,
                                '❌ An error occurred while editing the feed. Please check the logs.'
                            );
                        }
                        break;
                    }
                    case 'test': {
                        const url = intr.options.getString('url', true);
                        const summarize = intr.options.getBoolean('summarize') ?? false;
                        try {
                            const rssParser = getRSSParser();
                            const feed = await rssParser.parseURL(url);
                            const embed = new EmbedBuilder()
                                .setTitle(
                                    `Test Feed: ${StringUtils.truncate(feed.title || 'No Title', 150)}`
                                )
                                .setURL(feed.link || url)
                                .setDescription(
                                    StringUtils.truncate(
                                        feed.description || 'No description available.',
                                        500
                                    )
                                )
                                .setColor('Blue')
                                .setTimestamp();

                            let summary: string | null = null;
                            let articleContent: string | null = null;
                            let commentsContent: string | null = null;
                            const firstItem = feed.items?.[0];

                            if (summarize && firstItem) {
                                try {
                                    // Fetch article content
                                    if (firstItem.link) {
                                        const feedItemContent =
                                            firstItem['content:encoded'] || firstItem.content;
                                        if (feedItemContent && feedItemContent.length > 200) {
                                            articleContent = feedItemContent;
                                        } else {
                                            articleContent = await fetchPageContent(firstItem.link);
                                        }
                                    }
                                    // Fetch comments content if available
                                    if (
                                        firstItem.comments &&
                                        firstItem.comments !== firstItem.link
                                    ) {
                                        commentsContent = await fetchPageContent(
                                            firstItem.comments
                                        );
                                    }

                                    // Generate summary if any content was fetched
                                    if (articleContent || commentsContent) {
                                        // Get guild language for test summaries
                                        const guildLanguage =
                                            await FeedStorageService.getGuildLanguage(
                                                intr.guild.id
                                            );
                                        const { articleSummary, commentsSummary } =
                                            await summarizeContent(
                                                articleContent,
                                                commentsContent,
                                                firstItem.link || url,
                                                guildLanguage
                                            );
                                        summary =
                                            articleSummary ||
                                            commentsSummary ||
                                            'No summary generated.';
                                    } else {
                                        summary = 'Could not generate summary: No content fetched.';
                                    }
                                } catch (summaryError: any) {
                                    Logger.error(
                                        `[Feed Test] Error summarizing ${url}:`,
                                        summaryError
                                    );
                                    summary = `Could not generate summary: Error during processing.`; // More specific error
                                }
                            } else if (summarize) {
                                summary = 'Could not generate summary: Feed has no items.';
                            }

                            if (feed.items && feed.items.length > 0) {
                                // Show the latest item(s) as a preview
                                const previewItems = feed.items
                                    .slice(0, 1) // Show only the latest for test command brevity
                                    .map(item => {
                                        const itemTitle = StringUtils.truncate(
                                            item.title || 'No Title',
                                            100
                                        );
                                        const itemLink = item.link;
                                        const pubDate = item.pubDate
                                            ? `<t:${Math.floor(new Date(item.pubDate).getTime() / 1000)}:R>`
                                            : 'N/A';

                                        // Format link with paywall check
                                        let linkLine = itemLink ? `<${itemLink}>` : 'No link';
                                        let hasPaywalledLink = false;
                                        if (itemLink && isPaywalled(itemLink)) {
                                            linkLine += ` | [Archive](${getArchiveUrl(itemLink)})`;
                                            hasPaywalledLink = true;
                                        }
                                        // Add comments link if present and different
                                        if (item.comments && item.comments !== itemLink) {
                                            linkLine += ` | [Comments](<${item.comments}>)`;
                                            if (isPaywalled(item.comments)) {
                                                linkLine += ` ([Archive](${getArchiveUrl(item.comments)}))`;
                                                hasPaywalledLink = true;
                                            }
                                        }

                                        // Add snippet
                                        let snippet = StringUtils.truncate(
                                            item.contentSnippet || item.content || '',
                                            200
                                        );
                                        if (snippet)
                                            snippet = `
> ${snippet}`; // Indent snippet

                                        return `**[${itemTitle}](${itemLink || '#'})**
*Published: ${pubDate}*
${linkLine}${snippet}`;
                                    })
                                    .join('\n\n');
                                embed.addFields({
                                    name: 'Latest Item Preview',
                                    value: previewItems || 'No items found.',
                                });
                            } else {
                                embed.addFields({
                                    name: 'Latest Items Preview',
                                    value: 'No items found.',
                                });
                            }

                            // Add summary field if generated or if summarization failed
                            if (summary) {
                                embed.addFields({
                                    name: 'AI Summary (Latest Item)',
                                    // Display summary or failure message
                                    value: StringUtils.truncate(summary, 1000),
                                });
                            }

                            // Determine flags based on paywalled links in the previewed item
                            let messageFlags: MessageFlags.SuppressEmbeds | undefined = undefined;
                            if (
                                firstItem &&
                                ((firstItem.link && isPaywalled(firstItem.link)) ||
                                    (firstItem.comments &&
                                        firstItem.comments !== firstItem.link &&
                                        isPaywalled(firstItem.comments)))
                            ) {
                                messageFlags = MessageFlags.SuppressEmbeds;
                            }

                            await InteractionUtils.editReply(intr, {
                                embeds: [embed],
                                flags: messageFlags,
                            });
                        } catch (error) {
                            console.error(`Error testing feed URL ${url}:`, error);
                            let errorMsg =
                                'Failed to fetch or parse the RSS feed. Please check the URL and ensure it points to a valid RSS/Atom feed.';
                            if (error instanceof Error) {
                                errorMsg += `\n${codeBlock(error.message)}`;
                            }
                            await InteractionUtils.editReply(intr, errorMsg);
                        }
                        break;
                    }
                    case 'poke': {
                        // --- POKE SUBCOMMAND ---
                        const feedIdentifier = intr.options.getString('feed_id', true);
                        const targetChannel = intr.options.getChannel('channel') ?? intr.channel;

                        // Validate channel type
                        if (
                            !targetChannel ||
                            (targetChannel.type !== ChannelType.GuildText &&
                                targetChannel.type !== ChannelType.GuildAnnouncement)
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                'Feeds can only be poked within text or announcement channels.'
                            );
                            return;
                        }

                        try {
                            // Search for feeds using text-based search (nickname, URL, or ID)
                            const matchingFeeds = await FeedStorageService.searchFeeds(
                                intr.guild.id,
                                feedIdentifier,
                                targetChannel.id
                            );

                            if (matchingFeeds.length === 0) {
                                await InteractionUtils.editReply(
                                    intr,
                                    `❓ Could not find a feed matching \`${feedIdentifier}\` in this server.`
                                );
                                return;
                            }

                            // Use the first result (already prioritized by channel)
                            const targetFeed = matchingFeeds[0];

                            // Feed found, now try to fetch and parse it
                            try {
                                const rssParser = getRSSParser();
                                const feed = await rssParser.parseURL(targetFeed.url);
                                const embed = new EmbedBuilder()
                                    .setTitle(
                                        `Poke Result: ${feed.title || targetFeed.nickname || 'No Title'}`
                                    )
                                    .setURL(feed.link || targetFeed.url)
                                    .setDescription(
                                        `Poking feed \`${getShortId(targetFeed.id)}\` (${targetFeed.nickname ? targetFeed.nickname : 'No Nickname'}) in <#${targetChannel.id}>.`
                                    )
                                    .setColor('Green')
                                    .setTimestamp();

                                if (feed.items && feed.items.length > 0) {
                                    const latestItem = feed.items[0];
                                    const title = latestItem.title || 'No Title';
                                    const link = latestItem.link || '#';
                                    const pubDate = latestItem.pubDate
                                        ? new Date(latestItem.pubDate).toLocaleString(data.lang)
                                        : 'N/A';
                                    const snippet =
                                        latestItem.contentSnippet ||
                                        latestItem.content ||
                                        'No content snippet available.';

                                    embed.addFields({
                                        name: 'Latest Item',
                                        value: `**[${title}](${link})**\n*Published: ${pubDate}*\n\n${snippet.substring(0, 1000)}${snippet.length > 1000 ? '...' : ''}`, // Limit snippet length
                                    });

                                    // Optionally add summary if the feed has it enabled
                                    if (targetFeed.summarize) {
                                        let contentToSummarize =
                                            latestItem.content || latestItem.contentSnippet || '';
                                        if (!contentToSummarize && latestItem.link) {
                                            const pageContent = await fetchPageContent(
                                                latestItem.link
                                            );
                                            if (pageContent) contentToSummarize = pageContent;
                                        }

                                        if (contentToSummarize) {
                                            // Get effective language for this feed
                                            const effectiveLanguage =
                                                await FeedStorageService.getEffectiveLanguage(
                                                    targetFeed.id,
                                                    targetFeed.guildId
                                                );
                                            const { articleSummary, commentsSummary } =
                                                await summarizeContent(
                                                    contentToSummarize,
                                                    null,
                                                    latestItem.link,
                                                    effectiveLanguage
                                                );
                                            if (articleSummary) {
                                                embed.addFields({
                                                    name: 'AI Summary (Latest Item)',
                                                    value: articleSummary,
                                                });
                                            }
                                            if (commentsSummary) {
                                                embed.addFields({
                                                    name: 'AI Summary (Latest Item)',
                                                    value: commentsSummary,
                                                });
                                            }
                                        } else {
                                            embed.addFields({
                                                name: 'AI Summary (Latest Item)',
                                                value: 'No content found to summarize.',
                                            });
                                        }
                                    }
                                } else {
                                    embed.addFields({
                                        name: 'Latest Item',
                                        value: 'No items found.',
                                    });
                                }

                                await InteractionUtils.editReply(intr, { embeds: [embed] });
                            } catch (parseError) {
                                console.error(
                                    `Error parsing feed URL ${targetFeed.url} during poke:`,
                                    parseError
                                );
                                let errorMsg = `Failed to fetch or parse the feed URL for \`${getShortId(targetFeed.id)}\`.`;
                                if (parseError instanceof Error) {
                                    errorMsg += `\n${codeBlock(parseError.message)}`;
                                }
                                await InteractionUtils.editReply(intr, errorMsg);
                            }
                        } catch (error) {
                            console.error('Error poking feed:', error);
                            await InteractionUtils.editReply(
                                intr,
                                '❌ An error occurred while trying to find or poke the feed. Please check the logs.'
                            );
                        }
                        break;
                    }
                    case 'setlanguage': {
                        const languageInput = intr.options.getString('language');
                        // Empty string or whitespace means clear the language (null)
                        const language =
                            languageInput?.trim() === ''
                                ? null
                                : validateLanguageCode(languageInput);

                        if (languageInput && languageInput.trim() !== '' && !language) {
                            await InteractionUtils.editReply(
                                intr,
                                `❌ Invalid language code: ${inlineCode(languageInput)}. Language codes should be 2-10 characters and may include a region (e.g., "en", "es", "en-us", "es-es", "pt-br").`
                            );
                            return;
                        }

                        try {
                            await FeedStorageService.setGuildLanguage(intr.guild.id, language);

                            const currentLanguage = await FeedStorageService.getGuildLanguage(
                                intr.guild.id
                            );
                            const languageDisplay =
                                currentLanguage || 'not set (defaults to English)';

                            await InteractionUtils.editReply(
                                intr,
                                `✅ Server language has been set to ${inlineCode(languageDisplay)}. All feed summaries will be generated in this language unless a feed has its own language setting.`
                            );

                            if (posthog) {
                                posthog.capture({
                                    distinctId: intr.user.id,
                                    event: 'guild_language_set',
                                    properties: {
                                        guildId: intr.guild.id,
                                        language: language,
                                        setBy: intr.user.id,
                                    },
                                });
                            }
                        } catch (error) {
                            console.error('Error setting guild language:', error);
                            await InteractionUtils.editReply(
                                intr,
                                '❌ An error occurred while setting the server language. Please check the logs.'
                            );
                        }
                        break;
                    }
                    case 'errors': {
                        const feedIdentifier = intr.options.getString('feed_id');
                        const limit = intr.options.getInteger('limit') ?? 10;

                        try {
                            let targetFeedId: string | undefined;

                            if (feedIdentifier) {
                                const allFeeds = await FeedStorageService.getFeeds(intr.guild.id);
                                let targetFeed: FeedConfig | undefined = allFeeds.find(
                                    f =>
                                        f.id === feedIdentifier ||
                                        f.nickname?.toLowerCase() === feedIdentifier.toLowerCase()
                                );

                                if (
                                    !targetFeed &&
                                    feedIdentifier.length === 8 &&
                                    /^[a-f0-9-]+$/.test(feedIdentifier)
                                ) {
                                    targetFeed = allFeeds.find(f =>
                                        f.id.startsWith(feedIdentifier)
                                    );
                                }

                                if (!targetFeed) {
                                    await InteractionUtils.editReply(
                                        intr,
                                        `❓ Could not find a feed with ID, Short ID, or Nickname \`${feedIdentifier}\` in this server.`
                                    );
                                    return;
                                }

                                targetFeedId = targetFeed.id;
                            }

                            const failures = await FeedStorageService.getFeedFailures(
                                targetFeedId,
                                intr.guild.id,
                                limit
                            );

                            if (failures.length === 0) {
                                const message = targetFeedId
                                    ? `✅ No errors found for feed \`${getShortId(targetFeedId)}\` in this server.`
                                    : `✅ No feed errors found for this server.`;
                                await InteractionUtils.editReply(intr, message);
                                return;
                            }

                            const embed = new EmbedBuilder()
                                .setTitle(
                                    targetFeedId
                                        ? `Feed Errors: ${getShortId(targetFeedId)}`
                                        : `Feed Errors for This Server`
                                )
                                .setColor('Red')
                                .setTimestamp()
                                .setFooter({
                                    text: `Showing ${failures.length} most recent error(s)`,
                                });

                            const errorFields = failures.slice(0, 25).map((failure, index) => {
                                const feedName = failure.feedNickname || getShortId(failure.feedId);
                                const errorMsg = failure.errorMessage || 'Unknown error';
                                const timeAgo = formatRelativeTime(failure.timestamp);
                                const statusIcon = failure.ignoreErrors ? '🔇' : '⚠️';

                                const urlDisplay =
                                    failure.feedUrl.length > 60
                                        ? failure.feedUrl.substring(0, 57) + '...'
                                        : failure.feedUrl;

                                const errorDisplay =
                                    errorMsg.length > 600
                                        ? errorMsg.substring(0, 597) + '...'
                                        : errorMsg;

                                let value = `${statusIcon} **${feedName}**\n`;
                                value += `Feed: \`${getShortId(failure.feedId)}\`\n`;
                                value += `URL: ${urlDisplay}\n`;
                                value += `Time: ${timeAgo}\n`;
                                value += `Consecutive: ${failure.consecutiveFailures}\n`;
                                value += `Error: ${codeBlock(errorDisplay)}`;

                                if (value.length > 1024) {
                                    value = value.substring(0, 1021) + '...';
                                }

                                return {
                                    name: `Error #${index + 1}`,
                                    value: value,
                                };
                            });

                            embed.addFields(errorFields);

                            if (failures.length > 25) {
                                embed.setDescription(
                                    `Showing the 25 most recent errors. Total: ${failures.length}`
                                );
                            }

                            await InteractionUtils.editReply(intr, { embeds: [embed] });
                        } catch (error) {
                            console.error('Error fetching feed errors:', error);
                            await InteractionUtils.editReply(
                                intr,
                                '❌ An error occurred while fetching feed errors. Please check the logs.'
                            );
                        }
                        break;
                    }
                    default: {
                        // Should not happen with defined subcommands, but good practice
                        await InteractionUtils.send(intr, 'Unknown feed command.', true);
                    }
                }
            } else if (subCommandGroup === 'youtube') {
                // --- YOUTUBE SUBCOMMAND GROUP ---
                switch (subCommand) {
                    case 'add': {
                        const channelId = intr.options.getString('channel_id', true);
                        const targetChannel = intr.options.getChannel('channel') ?? intr.channel;
                        const summarize = intr.options.getBoolean('summarize') ?? false;

                        if (
                            !targetChannel ||
                            (targetChannel.type !== ChannelType.GuildText &&
                                targetChannel.type !== ChannelType.GuildAnnouncement)
                        ) {
                            await InteractionUtils.editReply(
                                intr,
                                'YouTube feeds can only be added to text or announcement channels.'
                            );
                            return;
                        }
                        // Construct YouTube Feed URL
                        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
                        const category = 'YouTube';
                        let feedNickname: string | null = null;

                        // Validate channel ID by trying to fetch the feed
                        try {
                            const rssParser = getRSSParser();
                            const feed = await rssParser.parseURL(feedUrl);
                            if (feed.title) {
                                feedNickname = feed.title.trim();
                            } else {
                                // Fallback nickname if title is missing (unlikely for YT)
                                feedNickname = `YouTube Channel: ${channelId}`;
                            }
                        } catch (parseError) {
                            Logger.error(
                                `[Feed YT Add] Error fetching YouTube feed ${feedUrl}:`,
                                parseError
                            );
                            await InteractionUtils.editReply(
                                intr,
                                '❌ Could not fetch feed data for that YouTube Channel ID. Please ensure it is correct and public.'
                            );
                            return;
                        }

                        // Proceed with adding the feed
                        try {
                            let initialSummary: string | null = null;
                            // Attempt summarization if requested (usually from video link/description)
                            if (summarize) {
                                try {
                                    const rssParser = getRSSParser();
                                    const feed = await rssParser.parseURL(feedUrl);
                                    const firstItem = feed.items?.[0];
                                    if (firstItem?.link) {
                                        // YouTube feeds don't have typical article content, summarize based on link/metadata?
                                        // Let's just pass the link and title to the summarizer for YT.
                                        const contentToSummarize = `Title: ${firstItem.title}\nLink: ${firstItem.link}\nDescription: ${firstItem.contentSnippet || ''}`;
                                        // Use guild language for YT feed initial summary
                                        const guildLanguage =
                                            await FeedStorageService.getGuildLanguage(
                                                intr.guild.id
                                            );
                                        const { articleSummary, commentsSummary } =
                                            await summarizeContent(
                                                contentToSummarize,
                                                null,
                                                firstItem.link,
                                                guildLanguage
                                            );
                                        initialSummary = articleSummary;
                                        if (
                                            initialSummary?.startsWith(
                                                'Could not generate summary:'
                                            )
                                        ) {
                                            await InteractionUtils.send(
                                                intr,
                                                `⚠️ ${initialSummary}. YT Feed will be added without summary check.`,
                                                true
                                            );
                                            initialSummary = null;
                                        }
                                    } else {
                                        await InteractionUtils.send(
                                            intr,
                                            '⚠️ No videos found for initial summary check. YT Feed will be added.',
                                            true
                                        );
                                    }
                                } catch (err: any) {
                                    Logger.error(
                                        `[Feed YT Add] Error summarizing initial YT video for ${feedUrl}:`,
                                        err
                                    );
                                    await InteractionUtils.send(
                                        intr,
                                        `⚠️ Error summarizing initial video: ${err.message}. YT Feed will be added without summary check.`,
                                        true
                                    );
                                    initialSummary = null;
                                }
                            }

                            const feedData: Omit<
                                FeedConfig,
                                | 'id'
                                | 'consecutiveFailures'
                                | 'createdAt'
                                | 'lastChecked'
                                | 'lastItemGuid'
                                | 'recentLinks'
                                | 'lastSummary'
                            > = {
                                url: feedUrl,
                                channelId: targetChannel.id,
                                guildId: intr.guild.id,
                                nickname: feedNickname,
                                category: category,
                                addedBy: intr.user.id,
                                frequencyOverrideMinutes: null, // YT feeds use default/category frequency
                                summarize: summarize,
                                useArchiveLinks: false, // YouTube feeds don't need archive links
                                ignoreErrors: false,
                                disableFailureNotifications: true, // Enable quiet failures for YouTube feeds
                                disabled: false,
                            };

                            const newFeedId = await FeedStorageService.addFeed(feedData);

                            if (
                                initialSummary &&
                                !initialSummary.startsWith('Could not generate summary:')
                            ) {
                                await FeedStorageService.updateFeedDetails(
                                    newFeedId,
                                    targetChannel.id,
                                    intr.guild.id,
                                    { lastArticleSummary: initialSummary }
                                );
                            }

                            // --- PostHog Tracking ---
                            if (posthog) {
                                posthog.capture({
                                    distinctId: intr.user.id,
                                    event: 'feed_yt_added', // Specific event
                                    properties: {
                                        feedId: newFeedId,
                                        guildId: intr.guild.id,
                                        channelId: targetChannel.id,
                                        ytChannelId: channelId, // The YT channel ID provided by user
                                        nickname: feedNickname,
                                        summarize: summarize,
                                        addedBy: intr.user.id,
                                    },
                                    groups: { guild: intr.guild.id },
                                });
                            }
                            // --- PostHog Tracking ---

                            const shortId = getShortId(newFeedId);
                            const removeCommand = `/feed remove feed_id:${shortId} channel:${targetChannel.id}`; // Use the correct command format
                            await InteractionUtils.editReply(
                                intr,
                                `✅ YouTube feed for "${feedNickname}" added successfully to <#${targetChannel.id}>!
   Category: ${inlineCode(category)}
   Short ID: ${inlineCode(shortId)}${summarize ? ' (Summarization Enabled)' : ''}
   Use ${inlineCode(removeCommand)} to remove it.`
                            );
                        } catch (error) {
                            if (
                                error instanceof Error &&
                                error.message.includes('already exists')
                            ) {
                                await InteractionUtils.editReply(
                                    intr,
                                    `⚠️ This YouTube feed (Channel ID: ${channelId}) is already registered for <#${targetChannel.id}>.`
                                );
                            } else {
                                Logger.error('Error adding YouTube feed:', error);
                                await InteractionUtils.editReply(
                                    intr,
                                    '❌ An error occurred while adding the YouTube feed. Please check the logs.'
                                );
                            }
                        }
                        break;
                    }
                    default: {
                        await InteractionUtils.editReply(intr, 'Unknown YouTube subcommand.');
                    }
                }
            }
        } catch (error) {
            // Catch-all for unexpected errors during subcommand routing or setup
            console.error('Unhandled error in FeedCommand execute:', error);
            // --- PostHog Error Capture --- START
            if (posthog) {
                posthog.capture({
                    distinctId: intr.user?.id ?? 'unknown_user',
                    event: '$exception', // Use PostHog's standard exception event
                    properties: {
                        $exception_type: 'FeedCommandUnhandled',
                        $exception_message: error instanceof Error ? error.message : String(error),
                        $exception_stack_trace: error instanceof Error ? error.stack : undefined,
                        command: 'feed',
                        subcommand: subCommand,
                        guildId: intr.guild?.id ?? 'N/A',
                        channelId: intr.channel?.id ?? 'N/A',
                        userId: intr.user?.id ?? 'N/A',
                    },
                    groups: intr.guild ? { guild: intr.guild.id } : undefined,
                });
            }
            // --- PostHog Error Capture --- END
            // Ensure reply/editReply is used consistently based on whether deferReply was called
            const replyOptions = {
                content: '❌ An unexpected error occurred. Please contact the bot administrator.',
                ephemeral: true,
            };
            if (intr.deferred || intr.replied) {
                await InteractionUtils.editReply(intr, replyOptions);
            } else {
                await InteractionUtils.send(intr, replyOptions.content, replyOptions.ephemeral);
            }
        }
    }
}
