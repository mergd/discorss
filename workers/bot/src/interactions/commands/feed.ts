import { getArchiveUrl, isPaywalled } from '../../constants.js';
import {
    ChannelTypes,
    MessageFlags,
    getBoolean,
    getChannelOption,
    getInteger,
    getString,
    getSubcommand,
    getSubcommandGroup,
    Interaction,
    interactionUser,
    ResolvedChannel,
} from '../../discord/interaction.js';
import { fetchPageContent, summarizeContent } from '../../feeds/summarizer.js';
import { parseFeedUrl } from '../../feeds/rss.js';
import { FeedConfig, FeedStorageService } from '../../services/feed-storage.js';
import {
    detectAndConvertTwitterUrl,
    formatRelativeTime,
    getShortId,
    truncate,
    validateLanguageCode,
} from '../../utils.js';
import { CommandContext } from '../context.js';
import { buildFeedListMessage } from '../components/feed-list.js';

const inlineCode = (s: string): string => `\`${s}\``;
const codeBlock = (s: string): string => `\`\`\`\n${s}\n\`\`\``;

function isPostableChannel(channel: ResolvedChannel | null): channel is ResolvedChannel {
    return (
        !!channel &&
        (channel.type === ChannelTypes.GuildText || channel.type === ChannelTypes.GuildAnnouncement)
    );
}

export async function handleFeedCommand(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    if (!intr.guild_id) {
        await ctx.editReply('This command can only be used inside a server.');
        return;
    }

    const subCommandGroup = getSubcommandGroup(intr);
    const subCommand = getSubcommand(intr);

    try {
        if (subCommandGroup === 'youtube') {
            if (subCommand === 'add') {
                await handleYoutubeAdd(ctx);
            } else {
                await ctx.editReply('Unknown YouTube subcommand.');
            }
            return;
        }

        switch (subCommand) {
            case 'add':
                await handleAdd(ctx);
                break;
            case 'remove':
                await handleRemove(ctx);
                break;
            case 'list':
                await handleList(ctx);
                break;
            case 'edit':
                await handleEdit(ctx);
                break;
            case 'test':
                await handleTest(ctx);
                break;
            case 'poke':
                await handlePoke(ctx);
                break;
            case 'setlanguage':
                await handleSetLanguage(ctx);
                break;
            case 'errors':
                await handleErrors(ctx);
                break;
            default:
                await ctx.editReply('Unknown feed command.');
        }
    } catch (error) {
        console.error('Unhandled error in feed command:', error);
        await ctx.analytics.captureException(
            interactionUser(intr).id,
            'FeedCommandUnhandled',
            error,
            { command: 'feed', subcommand: subCommand, guildId: intr.guild_id },
            { guild: intr.guild_id }
        );
        await ctx.editReply(
            '❌ An unexpected error occurred. Please contact the bot administrator.'
        );
    }
}

async function handleAdd(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const user = interactionUser(intr);

    const url = getString(intr, 'url')!;
    const targetChannel = getChannelOption(intr, 'channel');
    const nickname = getString(intr, 'nickname');
    const category = getString(intr, 'category');
    const frequency = getInteger(intr, 'frequency');
    const summarize = getBoolean(intr, 'summarize') ?? false;
    const useArchiveLinks = getBoolean(intr, 'use_archive_links') ?? false;
    const suppressLinkPreview = getBoolean(intr, 'suppress_link_preview') ?? false;
    const languageInput = getString(intr, 'language');
    const language = validateLanguageCode(languageInput);

    if (languageInput && languageInput.trim() !== '' && !language) {
        await ctx.editReply(
            `❌ Invalid language code: ${inlineCode(languageInput)}. Language codes should be 2-10 characters and may include a region (e.g., "en", "es", "en-us", "es-es", "pt-br").`
        );
        return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await ctx.editReply('Please provide a valid URL starting with http:// or https://.');
        return;
    }

    const twitterCheck = detectAndConvertTwitterUrl(url);
    let feedUrl = url;
    if (twitterCheck.isTwitter) {
        feedUrl = twitterCheck.convertedUrl!;
        await ctx.editReply(
            `⚠️ **Twitter/X Profile Detected**\n\nTwitter/X doesn't provide RSS feeds. I've converted this to use Nitter (a Twitter RSS proxy):\n\n**Original:** ${inlineCode(url)}\n**RSS Feed:** ${inlineCode(feedUrl)}\n\n*Note: Nitter instances can be unreliable. If this feed fails, try a different Nitter instance or remove the feed.*`
        );
    }

    if (!isPostableChannel(targetChannel)) {
        await ctx.editReply('Feeds can only be added to text or announcement channels.');
        return;
    }

    // Validate feed works before adding (fail early)
    let finalNickname = nickname;
    let validatedFeed;
    try {
        validatedFeed = await parseFeedUrl(feedUrl);
        if (!validatedFeed || !validatedFeed.items || validatedFeed.items.length === 0) {
            await ctx.editReply(
                `❌ **Feed Validation Failed**\n\nThe feed at ${inlineCode(feedUrl)} appears to be empty or invalid. Please check the URL and try again.\n\n💡 You can test feeds with ${inlineCode('/feed test')}.`
            );
            return;
        }
        if (!finalNickname && validatedFeed.title) {
            finalNickname = validatedFeed.title.trim();
        }
    } catch (parseError: any) {
        const errorMsg = parseError?.message || 'Unknown error';
        await ctx.editReply(
            `❌ **Feed Validation Failed**\n\nCould not fetch or parse the RSS feed at ${inlineCode(feedUrl)}.\n\n**Error:** ${codeBlock(errorMsg.substring(0, 500))}\n\nPlease check:\n- The URL is correct and accessible\n- The feed is a valid RSS/Atom feed\n\n*Feeds must be valid RSS/Atom feeds. Twitter/X profile URLs are not RSS feeds.*`
        );
        return;
    }

    try {
        let initialSummary: string | null = null;

        if (summarize) {
            try {
                const firstItem = validatedFeed.items?.[0];
                if (firstItem) {
                    let articleContent: string | null = null;
                    let commentsContent: string | null = null;

                    if (firstItem.link) {
                        const feedItemContent = firstItem['content:encoded'] || firstItem.content;
                        if (feedItemContent && feedItemContent.length > 200) {
                            articleContent = feedItemContent;
                        } else {
                            articleContent = await fetchPageContent(firstItem.link);
                        }
                    }
                    if (firstItem.comments && firstItem.comments !== firstItem.link) {
                        commentsContent = await fetchPageContent(firstItem.comments);
                    }

                    if (articleContent || commentsContent) {
                        const effectiveLanguage =
                            language || (await FeedStorageService.getGuildLanguage(guildId));
                        const { articleSummary } = await summarizeContent(
                            ctx.env,
                            ctx.analytics,
                            articleContent,
                            commentsContent,
                            firstItem.link || feedUrl,
                            effectiveLanguage,
                            guildId
                        );
                        if (articleSummary?.startsWith('Could not generate summary:')) {
                            await ctx.followUpEphemeral(
                                `⚠️ ${articleSummary}. Feed will be added without an initial summary check.`
                            );
                        } else {
                            initialSummary = articleSummary;
                        }
                    } else {
                        await ctx.followUpEphemeral(
                            '⚠️ Could not fetch initial content to generate a summary. Feed will be added without summary check.'
                        );
                    }
                } else {
                    await ctx.followUpEphemeral(
                        '⚠️ Feed has no items, cannot generate initial summary. Feed will be added.'
                    );
                }
            } catch (err: any) {
                await ctx.followUpEphemeral(
                    `⚠️ Error fetching or summarizing initial item: ${err.message}. Feed will be added without summary check.`
                );
            }
        }

        const newFeedId = await FeedStorageService.addFeed({
            url: feedUrl,
            channelId: targetChannel.id,
            guildId,
            nickname: finalNickname,
            category,
            addedBy: user.id,
            frequencyOverrideMinutes: frequency,
            summarize,
            useArchiveLinks,
            suppressLinkPreview,
            language: language || null,
        });

        if (initialSummary && !initialSummary.startsWith('Could not generate summary:')) {
            await FeedStorageService.updateFeedDetails(newFeedId, targetChannel.id, guildId, {
                lastArticleSummary: initialSummary,
            });
        }

        const shortId = getShortId(newFeedId);
        const nicknameString = finalNickname ? ` Nickname: ${inlineCode(finalNickname)}.` : '';
        const categoryString = category ? ` Category: ${inlineCode(category)}.` : '';
        const frequencyString = frequency
            ? ` Frequency: ${inlineCode(frequency.toString())} min.`
            : '';
        const summarizeString = summarize ? ' Summarization: Enabled.' : '';
        const identifierHint = finalNickname ? `feed_id:"${finalNickname}"` : `feed_id:${shortId}`;
        const removeCommand = `/feed remove ${identifierHint} channel:${targetChannel.id}`;

        void ctx.analytics.capture({
            distinctId: user.id,
            event: 'feed_added',
            properties: {
                feedId: newFeedId,
                guildId,
                channelId: targetChannel.id,
                url,
                nickname: finalNickname,
                category,
                frequency,
                summarize,
                addedBy: user.id,
            },
            groups: { guild: guildId },
        });

        await ctx.editReply(
            `✅ Feed added successfully to <#${targetChannel.id}>!${nicknameString}${categoryString}${frequencyString}${summarizeString}
   Short ID: ${inlineCode(shortId)}
   Use ${inlineCode(removeCommand)} to remove it.`
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
            await ctx.editReply(
                `⚠️ This feed URL is already registered for <#${targetChannel.id}>.`
            );
        } else {
            console.error('Error adding feed:', error);
            await ctx.editReply(
                '❌ An error occurred while adding the feed. Please check the logs.'
            );
        }
    }
}

async function handleRemove(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const user = interactionUser(intr);
    const feedIdentifier = getString(intr, 'feed_id')!;
    const targetChannel = getChannelOption(intr, 'channel');

    if (!isPostableChannel(targetChannel)) {
        await ctx.editReply('Feeds can only be removed from text or announcement channels.');
        return;
    }

    const matchingFeeds = await FeedStorageService.searchFeeds(
        guildId,
        feedIdentifier,
        targetChannel.id
    );
    if (matchingFeeds.length === 0) {
        await ctx.editReply(
            `❓ Could not find a feed matching \`${feedIdentifier}\` in this server.`
        );
        return;
    }

    const targetFeed = matchingFeeds[0];
    const removed = await FeedStorageService.removeFeed(targetFeed.id, targetChannel.id, guildId);

    if (removed) {
        void ctx.analytics.capture({
            distinctId: user.id,
            event: 'feed_removed',
            properties: {
                guildId,
                channelId: targetChannel.id,
                removedFeedIdentifier: feedIdentifier,
                removedFeedId: targetFeed.id,
                removedBy: user.id,
            },
            groups: { guild: guildId },
        });

        const title = targetFeed.nickname || 'Untitled Feed';
        await ctx.editReply(
            `✅ Feed **${title}** (${inlineCode(getShortId(targetFeed.id))}) pointing to <${targetFeed.url}> has been removed from <#${targetChannel.id}>.`
        );
    } else {
        await ctx.editReply(
            `❌ Failed to remove feed \`${feedIdentifier}\`. It might have been deleted by another user just now. Please try listing the feeds again.`
        );
    }
}

async function handleList(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const channelOption = getString(intr, 'channel');
    let targetChannelId: string | undefined;

    if (channelOption) {
        const channel = intr.data?.resolved?.channels?.[channelOption];
        if (!isPostableChannel(channel ?? null)) {
            await ctx.editReply('Can only list feeds for text or announcement channels.');
            return;
        }
        targetChannelId = channel!.id;
    }

    const message = await buildFeedListMessage(
        ctx.rest,
        guildId,
        1,
        targetChannelId,
        interactionUser(intr).id
    );
    if (!message) {
        const emptyMsg = targetChannelId
            ? `No feeds found for channel <#${targetChannelId}>.`
            : 'No feeds configured for this server yet.';
        await ctx.editReply(emptyMsg);
        return;
    }

    await ctx.editReply(message);
}

async function handleEdit(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const user = interactionUser(intr);
    const feedIdentifier = getString(intr, 'feed_id')!;
    const targetChannel = getChannelOption(intr, 'channel');
    const newNickname = getString(intr, 'nickname');
    const newCategory = getString(intr, 'category');
    const newFrequency = getInteger(intr, 'frequency');
    const newSummarize = getBoolean(intr, 'summarize');
    const newUseArchiveLinks = getBoolean(intr, 'use_archive_links');
    const newSuppressLinkPreview = getBoolean(intr, 'suppress_link_preview');
    const newEnabled = getBoolean(intr, 'enabled');
    const newLanguageInput = getString(intr, 'language');
    const newLanguage =
        newLanguageInput?.trim() === '' ? null : validateLanguageCode(newLanguageInput);

    if (newLanguageInput !== null && newLanguageInput.trim() !== '' && !newLanguage) {
        await ctx.editReply(
            `❌ Invalid language code: ${inlineCode(newLanguageInput)}. Language codes should be 2-10 characters and may include a region (e.g., "en", "es", "en-us", "es-es", "pt-br").`
        );
        return;
    }

    if (!isPostableChannel(targetChannel)) {
        await ctx.editReply('Feeds can only be edited within text or announcement channels.');
        return;
    }

    if (
        newNickname === null &&
        newCategory === null &&
        newFrequency === null &&
        newSummarize === null &&
        newUseArchiveLinks === null &&
        newSuppressLinkPreview === null &&
        newLanguageInput === null &&
        newEnabled === null
    ) {
        await ctx.editReply(
            'Please provide at least one detail to update (nickname, category, frequency, summarize, use_archive_links, suppress_link_preview, language, or enabled).'
        );
        return;
    }

    const matchingFeeds = await FeedStorageService.searchFeeds(
        guildId,
        feedIdentifier,
        targetChannel.id
    );
    if (matchingFeeds.length === 0) {
        await ctx.editReply(
            `❓ Could not find a feed matching \`${feedIdentifier}\` in this server.`
        );
        return;
    }

    const targetFeed = matchingFeeds[0];
    const updates: Record<string, unknown> = {};
    if (newNickname !== null) updates.nickname = newNickname;
    if (newCategory !== null) updates.category = newCategory;
    if (newFrequency !== null) updates.frequencyOverrideMinutes = newFrequency;
    if (newSummarize !== null) updates.summarize = newSummarize;
    if (newUseArchiveLinks !== null) updates.useArchiveLinks = newUseArchiveLinks;
    if (newSuppressLinkPreview !== null) updates.suppressLinkPreview = newSuppressLinkPreview;
    if (newLanguageInput !== null) updates.language = newLanguage;
    if (newEnabled !== null) updates.disabled = newEnabled === false;

    const updated = await FeedStorageService.updateFeedDetails(
        targetFeed.id,
        targetChannel.id,
        guildId,
        updates
    );

    if (updated) {
        void ctx.analytics.capture({
            distinctId: user.id,
            event: 'feed_edited',
            properties: {
                feedId: targetFeed.id,
                guildId,
                channelId: targetChannel.id,
                editedBy: user.id,
                changes: updates,
            },
            groups: { guild: guildId },
        });

        const changesSummary = Object.entries(updates)
            .map(([key, value]) => {
                let displayValue =
                    value === null || value === '' ? 'cleared' : inlineCode(String(value));
                if (key === 'frequencyOverrideMinutes' && value !== null) displayValue += ' min';
                if (key === 'disabled') displayValue = value ? 'disabled' : 'enabled';
                const displayKey =
                    key === 'disabled' ? 'enabled' : key.replace('OverrideMinutes', '');
                return `${displayKey}: ${displayValue}`;
            })
            .join(', ');

        await ctx.editReply(
            `✅ Feed \`${getShortId(targetFeed.id)}\` updated successfully in <#${targetChannel.id}>. Changes: ${changesSummary}`
        );
    } else {
        await ctx.editReply(
            `❌ Failed to update feed \`${getShortId(targetFeed.id)}\`. Please check logs or try again.`
        );
    }
}

async function handleTest(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const url = getString(intr, 'url')!;
    const summarize = getBoolean(intr, 'summarize') ?? false;

    try {
        const feed = await parseFeedUrl(url);
        const fields: Array<{ name: string; value: string }> = [];
        const firstItem = feed.items?.[0];

        let summary: string | null = null;
        if (summarize && firstItem) {
            try {
                let articleContent: string | null = null;
                let commentsContent: string | null = null;

                if (firstItem.link) {
                    const feedItemContent = firstItem['content:encoded'] || firstItem.content;
                    if (feedItemContent && feedItemContent.length > 200) {
                        articleContent = feedItemContent;
                    } else {
                        articleContent = await fetchPageContent(firstItem.link);
                    }
                }
                if (firstItem.comments && firstItem.comments !== firstItem.link) {
                    commentsContent = await fetchPageContent(firstItem.comments);
                }

                if (articleContent || commentsContent) {
                    const guildLanguage = await FeedStorageService.getGuildLanguage(guildId);
                    const { articleSummary, commentsSummary } = await summarizeContent(
                        ctx.env,
                        ctx.analytics,
                        articleContent,
                        commentsContent,
                        firstItem.link || url,
                        guildLanguage,
                        guildId
                    );
                    summary = articleSummary || commentsSummary || 'No summary generated.';
                } else {
                    summary = 'Could not generate summary: No content fetched.';
                }
            } catch {
                summary = 'Could not generate summary: Error during processing.';
            }
        } else if (summarize) {
            summary = 'Could not generate summary: Feed has no items.';
        }

        if (firstItem) {
            const itemTitle = truncate(firstItem.title || 'No Title', 100);
            const itemLink = firstItem.link;
            const pubDate = firstItem.pubDate
                ? `<t:${Math.floor(new Date(firstItem.pubDate).getTime() / 1000)}:R>`
                : 'N/A';

            let linkLine = itemLink ? itemLink : 'No link';
            if (itemLink && isPaywalled(itemLink)) {
                linkLine += ` | [Archive](${getArchiveUrl(itemLink)})`;
            }
            if (firstItem.comments && firstItem.comments !== itemLink) {
                linkLine += ` | [Comments](${firstItem.comments})`;
                if (isPaywalled(firstItem.comments)) {
                    linkLine += ` ([Archive](${getArchiveUrl(firstItem.comments)}))`;
                }
            }

            let snippet = truncate(firstItem.contentSnippet || firstItem.content || '', 200);
            if (snippet) snippet = `\n> ${snippet}`;

            fields.push({
                name: 'Latest Item Preview',
                value: `**[${itemTitle}](${itemLink || '#'})**\n*Published: ${pubDate}*\n${linkLine}${snippet}`,
            });
        } else {
            fields.push({ name: 'Latest Items Preview', value: 'No items found.' });
        }

        if (summary) {
            fields.push({ name: 'AI Summary (Latest Item)', value: truncate(summary, 1000) });
        }

        const suppressEmbeds =
            firstItem &&
            ((firstItem.link && isPaywalled(firstItem.link)) ||
                (firstItem.comments &&
                    firstItem.comments !== firstItem.link &&
                    isPaywalled(firstItem.comments)));

        await ctx.editReply({
            embeds: [
                {
                    title: `Test Feed: ${truncate(feed.title || 'No Title', 150)}`,
                    url: feed.link || url,
                    description: truncate(feed.description || 'No description available.', 500),
                    color: 0x3498db,
                    fields,
                    timestamp: new Date().toISOString(),
                },
            ],
            flags: suppressEmbeds ? MessageFlags.SuppressEmbeds : undefined,
        });
    } catch (error) {
        let errorMsg =
            'Failed to fetch or parse the RSS feed. Please check the URL and ensure it points to a valid RSS/Atom feed.';
        if (error instanceof Error) {
            errorMsg += `\n${codeBlock(error.message)}`;
        }
        await ctx.editReply(errorMsg);
    }
}

async function handlePoke(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const feedIdentifier = getString(intr, 'feed_id')!;
    const targetChannel = getChannelOption(intr, 'channel');

    if (!isPostableChannel(targetChannel)) {
        await ctx.editReply('Feeds can only be poked within text or announcement channels.');
        return;
    }

    const matchingFeeds = await FeedStorageService.searchFeeds(
        guildId,
        feedIdentifier,
        targetChannel.id
    );
    if (matchingFeeds.length === 0) {
        await ctx.editReply(
            `❓ Could not find a feed matching \`${feedIdentifier}\` in this server.`
        );
        return;
    }

    const targetFeed = matchingFeeds[0];
    try {
        const feed = await parseFeedUrl(targetFeed.url);
        const fields: Array<{ name: string; value: string }> = [];

        if (feed.items && feed.items.length > 0) {
            const latestItem = feed.items[0];
            const title = latestItem.title || 'No Title';
            const link = latestItem.link || '#';
            const pubDate = latestItem.pubDate
                ? new Date(latestItem.pubDate).toLocaleString()
                : 'N/A';
            const snippet =
                latestItem.contentSnippet || latestItem.content || 'No content snippet available.';

            fields.push({
                name: 'Latest Item',
                value: `**[${title}](${link})**\n*Published: ${pubDate}*\n\n${snippet.substring(0, 1000)}${snippet.length > 1000 ? '...' : ''}`,
            });

            if (targetFeed.summarize) {
                let contentToSummarize =
                    latestItem.content || latestItem.contentSnippet || '';
                if (!contentToSummarize && latestItem.link) {
                    const pageContent = await fetchPageContent(latestItem.link);
                    if (pageContent) contentToSummarize = pageContent;
                }

                if (contentToSummarize) {
                    const effectiveLanguage = await FeedStorageService.getEffectiveLanguage(
                        targetFeed.id,
                        targetFeed.guildId
                    );
                    const { articleSummary, commentsSummary } = await summarizeContent(
                        ctx.env,
                        ctx.analytics,
                        contentToSummarize,
                        null,
                        latestItem.link,
                        effectiveLanguage,
                        targetFeed.guildId
                    );
                    if (articleSummary) {
                        fields.push({ name: 'AI Summary (Latest Item)', value: truncate(articleSummary, 1000) });
                    }
                    if (commentsSummary) {
                        fields.push({ name: 'AI Summary (Comments)', value: truncate(commentsSummary, 1000) });
                    }
                } else {
                    fields.push({
                        name: 'AI Summary (Latest Item)',
                        value: 'No content found to summarize.',
                    });
                }
            }
        } else {
            fields.push({ name: 'Latest Item', value: 'No items found.' });
        }

        await ctx.editReply({
            embeds: [
                {
                    title: `Poke Result: ${feed.title || targetFeed.nickname || 'No Title'}`,
                    url: feed.link || targetFeed.url,
                    description: `Poking feed \`${getShortId(targetFeed.id)}\` (${targetFeed.nickname ? targetFeed.nickname : 'No Nickname'}) in <#${targetChannel.id}>.`,
                    color: 0x57f287,
                    fields,
                    timestamp: new Date().toISOString(),
                },
            ],
        });
    } catch (parseError) {
        let errorMsg = `Failed to fetch or parse the feed URL for \`${getShortId(targetFeed.id)}\`.`;
        if (parseError instanceof Error) {
            errorMsg += `\n${codeBlock(parseError.message)}`;
        }
        await ctx.editReply(errorMsg);
    }
}

async function handleSetLanguage(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const user = interactionUser(intr);
    const languageInput = getString(intr, 'language');
    const language = languageInput?.trim() === '' ? null : validateLanguageCode(languageInput);

    if (languageInput && languageInput.trim() !== '' && !language) {
        await ctx.editReply(
            `❌ Invalid language code: ${inlineCode(languageInput)}. Language codes should be 2-10 characters and may include a region (e.g., "en", "es", "en-us", "es-es", "pt-br").`
        );
        return;
    }

    try {
        await FeedStorageService.setGuildLanguage(guildId, language);
        const currentLanguage = await FeedStorageService.getGuildLanguage(guildId);
        const languageDisplay = currentLanguage || 'not set (defaults to English)';

        void ctx.analytics.capture({
            distinctId: user.id,
            event: 'guild_language_set',
            properties: { guildId, language, setBy: user.id },
        });

        await ctx.editReply(
            `✅ Server language has been set to ${inlineCode(languageDisplay)}. All feed summaries will be generated in this language unless a feed has its own language setting.`
        );
    } catch (error) {
        console.error('Error setting guild language:', error);
        await ctx.editReply(
            '❌ An error occurred while setting the server language. Please check the logs.'
        );
    }
}

async function handleErrors(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const feedIdentifier = getString(intr, 'feed_id');
    const limit = getInteger(intr, 'limit') ?? 10;

    let targetFeedId: string | undefined;
    if (feedIdentifier) {
        const allFeeds = await FeedStorageService.getFeeds(guildId);
        let targetFeed: FeedConfig | undefined = allFeeds.find(
            f =>
                f.id === feedIdentifier ||
                f.nickname?.toLowerCase() === feedIdentifier.toLowerCase()
        );
        if (!targetFeed && feedIdentifier.length === 8 && /^[a-f0-9-]+$/.test(feedIdentifier)) {
            targetFeed = allFeeds.find(f => f.id.startsWith(feedIdentifier));
        }
        if (!targetFeed) {
            await ctx.editReply(
                `❓ Could not find a feed with ID, Short ID, or Nickname \`${feedIdentifier}\` in this server.`
            );
            return;
        }
        targetFeedId = targetFeed.id;
    }

    const failures = await FeedStorageService.getFeedFailures(targetFeedId, guildId, limit);
    if (failures.length === 0) {
        const message = targetFeedId
            ? `✅ No errors found for feed \`${getShortId(targetFeedId)}\` in this server.`
            : `✅ No feed errors found for this server.`;
        await ctx.editReply(message);
        return;
    }

    const errorFields = failures.slice(0, 25).map((failure, index) => {
        const feedName = failure.feedNickname || getShortId(failure.feedId);
        const errorMsg = failure.errorMessage || 'Unknown error';
        const timeAgo = formatRelativeTime(failure.timestamp);
        const statusIcon = failure.ignoreErrors ? '🔇' : '⚠️';
        const urlDisplay =
            failure.feedUrl.length > 60 ? failure.feedUrl.substring(0, 57) + '...' : failure.feedUrl;
        const errorDisplay = errorMsg.length > 600 ? errorMsg.substring(0, 597) + '...' : errorMsg;

        let value = `${statusIcon} **${feedName}**\n`;
        value += `Feed: \`${getShortId(failure.feedId)}\`\n`;
        value += `URL: ${urlDisplay}\n`;
        value += `Time: ${timeAgo}\n`;
        value += `Consecutive: ${failure.consecutiveFailures}\n`;
        value += `Error: ${codeBlock(errorDisplay)}`;
        if (value.length > 1024) {
            value = value.substring(0, 1021) + '...';
        }
        return { name: `Error #${index + 1}`, value };
    });

    await ctx.editReply({
        embeds: [
            {
                title: targetFeedId
                    ? `Feed Errors: ${getShortId(targetFeedId)}`
                    : `Feed Errors for This Server`,
                color: 0xed4245,
                fields: errorFields,
                description:
                    failures.length > 25
                        ? `Showing the 25 most recent errors. Total: ${failures.length}`
                        : undefined,
                footer: { text: `Showing ${failures.length} most recent error(s)` },
                timestamp: new Date().toISOString(),
            },
        ],
    });
}

export async function handleYoutubeAdd(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const guildId = intr.guild_id!;
    const user = interactionUser(intr);
    const channelId = getString(intr, 'channel_id')!;
    const targetChannel = getChannelOption(intr, 'channel');
    const summarize = getBoolean(intr, 'summarize') ?? false;

    if (!isPostableChannel(targetChannel)) {
        await ctx.editReply('YouTube feeds can only be added to text or announcement channels.');
        return;
    }

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const category = 'YouTube';
    let feedNickname: string;

    try {
        const feed = await parseFeedUrl(feedUrl);
        feedNickname = feed.title?.trim() || `YouTube Channel: ${channelId}`;
    } catch {
        await ctx.editReply(
            '❌ Could not fetch feed data for that YouTube Channel ID. Please ensure it is correct and public.'
        );
        return;
    }

    try {
        const newFeedId = await FeedStorageService.addFeed({
            url: feedUrl,
            channelId: targetChannel.id,
            guildId,
            nickname: feedNickname,
            category,
            addedBy: user.id,
            frequencyOverrideMinutes: null,
            summarize,
            useArchiveLinks: false,
            suppressLinkPreview: false,
            disableFailureNotifications: true,
            skipYoutubeShorts: true,
            skipYoutubeLivestreams: true,
        });

        void ctx.analytics.capture({
            distinctId: user.id,
            event: 'feed_yt_added',
            properties: {
                feedId: newFeedId,
                guildId,
                channelId: targetChannel.id,
                ytChannelId: channelId,
                nickname: feedNickname,
                summarize,
                addedBy: user.id,
            },
            groups: { guild: guildId },
        });

        const shortId = getShortId(newFeedId);
        const removeCommand = `/feed remove feed_id:${shortId} channel:${targetChannel.id}`;
        await ctx.editReply(
            `✅ YouTube feed for "${feedNickname}" added successfully to <#${targetChannel.id}>!
   Category: ${inlineCode(category)}
   Short ID: ${inlineCode(shortId)}${summarize ? ' (Summarization Enabled)' : ''}
   Use ${inlineCode(removeCommand)} to remove it.`
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
            await ctx.editReply(
                `⚠️ This YouTube feed (Channel ID: ${channelId}) is already registered for <#${targetChannel.id}>.`
            );
        } else {
            console.error('Error adding YouTube feed:', error);
            await ctx.editReply(
                '❌ An error occurred while adding the YouTube feed. Please check the logs.'
            );
        }
    }
}
