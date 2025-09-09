import { subHours } from 'date-fns';
import {
    ChannelType,
    DiscordAPIError,
    EmbedBuilder,
    MessageFlags,
    NewsChannel,
    ShardingManager,
    TextChannel,
    codeBlock,
} from 'discord.js';
import Parser from 'rss-parser';
import {
    BASE_MINUTES,
    DEFAULT_FREQUENCY_MINUTES,
    FAILURE_NOTIFICATION_THRESHOLD,
    MAX_FREQUENCY_MINUTES,
    MAX_ITEM_HOURS,
    MAX_MINUTES,
    MIN_FREQUENCY_MINUTES,
} from '../constants/index.js';

import { PAYWALLED_DOMAINS } from '../constants/paywalled-sites.js';
import {
    CategoryConfig,
    FeedConfig,
    FeedStorageService,
} from '../services/feed-storage-service.js';
import { Logger } from '../services/index.js';
import { posthog } from '../utils/analytics.js';
import { fetchPageContent, summarizeContent } from '../utils/feed-summarizer.js';
import { formatReadTime } from '../utils/read-time.js';
import { Job } from './job.js';

interface ParsedFeedItem {
    title?: string;
    link?: string;
    pubDate?: string;
    isoDate?: string;
    guid?: string;
    creator?: string;
    author?: string;
    content?: string;
    contentSnippet?: string;
    'content:encoded'?: string;
    comments?: string;
    articleSummary?: string;
    commentsSummary?: string;
    articleReadTime?: number;
}

const feedCheckIntervals: { [feedId: string]: NodeJS.Timeout } = {};
const categoryFrequencies: Map<string, number> = new Map();

// Store enum values for context passing
const GuildTextChannelTypeValue = ChannelType.GuildText; // 0
const GuildAnnouncementChannelTypeValue = ChannelType.GuildAnnouncement; // 5

// Helper function to get effective frequency
function getEffectiveFrequency(feed: FeedConfig): number {
    // 1. Use feed-specific override if set
    if (feed.frequencyOverrideMinutes != null && feed.frequencyOverrideMinutes > 0) {
        return Math.max(
            MIN_FREQUENCY_MINUTES,
            Math.min(feed.frequencyOverrideMinutes, MAX_FREQUENCY_MINUTES)
        );
    }

    // 2. Use category frequency if set and feed has a category
    if (feed.category) {
        const categoryKey = `${feed.guildId}:${feed.category.toLowerCase()}`;
        const freq = categoryFrequencies.get(categoryKey);
        if (freq !== undefined) {
            return Math.max(MIN_FREQUENCY_MINUTES, Math.min(freq, MAX_FREQUENCY_MINUTES));
        }
    }

    // 3. Fallback to default
    return DEFAULT_FREQUENCY_MINUTES;
}

export class FeedPollJob extends Job {
    public name = 'Feed Poll Job';
    public schedule: string = '* * * * *'; // Placeholder, we use dynamic intervals
    public log: boolean = false; // Disable default interval logging, we log activity manually

    private manager: ShardingManager;
    private parser: Parser<any, ParsedFeedItem>;

    constructor(manager: ShardingManager) {
        super();
        this.manager = manager;
        // Configure parser - add custom fields
        this.parser = new Parser({
            customFields: {
                item: [
                    'guid',
                    'isoDate',
                    'creator',
                    'author',
                    'content',
                    'contentSnippet',
                    'comments',
                ],
            },
        });
    }

    public async run(): Promise<void> {
        // This run method is called by the scheduler (if configured), but we use dynamic intervals
        // So, this method primarily ensures the polling starts/restarts if the bot restarts.
        Logger.info('[FeedPollJob] Initializing dynamic polling intervals...');
        this.loadAndScheduleFeeds().catch(error => {
            Logger.error('[FeedPollJob] Error during initial load/schedule:', error);
        });
    }

    // Load all feeds and set/update their individual polling intervals
    private async loadAndScheduleFeeds(): Promise<void> {
        // Load all category frequencies first
        const allCategoryConfigs: CategoryConfig[] =
            await FeedStorageService.getAllCategoryConfigs();
        categoryFrequencies.clear();
        for (const catConfig of allCategoryConfigs) {
            categoryFrequencies.set(
                `${catConfig.guildId}:${catConfig.name.toLowerCase()}`,
                catConfig.frequencyMinutes
            );
        }
        Logger.info(
            `[FeedPollJob] Loaded ${categoryFrequencies.size} custom category frequencies.`
        );

        // Load all feeds (now includes recentLinks)
        const allFeeds: FeedConfig[] = await FeedStorageService.getAllFeeds();
        Logger.info(`[FeedPollJob] Processing ${allFeeds.length} feeds.`);

        // Clear existing intervals that might be for removed feeds
        const currentFeedIds = new Set(allFeeds.map(f => f.id));
        for (const feedId in feedCheckIntervals) {
            if (!currentFeedIds.has(feedId)) {
                clearInterval(feedCheckIntervals[feedId]);
                delete feedCheckIntervals[feedId];
                // --- REMOVED recentLinksCache cleanup ---
                Logger.info(`[FeedPollJob] Cleared interval for removed feed ID: ${feedId}`);
            }
        }

        // Schedule/reschedule feeds
        for (const feed of allFeeds) {
            const frequencyMinutes = getEffectiveFrequency(feed);
            const intervalMillis = frequencyMinutes * 60 * 1000;

            // Clear existing interval for this feed if it exists (frequency might have changed)
            if (feedCheckIntervals[feed.id]) {
                clearInterval(feedCheckIntervals[feed.id]);
            }

            // Schedule the check immediately and then at the determined interval
            this.checkFeed(feed.id).catch(error => {
                // Pass ID instead of full config initially
                Logger.error(
                    `[FeedPollJob] Error during initial check for feed ${feed.id} (${feed.url}):`,
                    error
                );
            });

            feedCheckIntervals[feed.id] = setInterval(() => {
                this.checkFeed(feed.id).catch(error => {
                    // Pass ID instead of full config
                    Logger.error(
                        `[FeedPollJob] Error during scheduled check for feed ${feed.id} (${feed.url}):`,
                        error
                    );
                });
            }, intervalMillis);

            // Logger.info(`[FeedPollJob] Scheduled feed ${feed.id} (${feed.nickname || feed.url}) every ${frequencyMinutes} minutes.`);
        }
        Logger.info(
            `[FeedPollJob] Finished scheduling ${Object.keys(feedCheckIntervals).length} feeds.`
        );
    }

    // Check a single feed for new items (now fetches fresh config including links)
    private async checkFeed(feedId: string): Promise<void> {
        // Fetch the latest feed config from DB, including recent links
        const feedConfig = await FeedStorageService.getFeedById(feedId);
        if (!feedConfig) {
            Logger.warn(`[FeedPollJob] Feed config not found for ID ${feedId}. Skipping check.`);
            // Consider clearing interval if feed is permanently gone
            if (feedCheckIntervals[feedId]) {
                clearInterval(feedCheckIntervals[feedId]);
                delete feedCheckIntervals[feedId];
                Logger.info(
                    `[FeedPollJob] Cleared interval for potentially deleted feed ID: ${feedId}`
                );
            }
            return;
        }

        // --- Backoff check ---
        if (feedConfig.backoffUntil && new Date(feedConfig.backoffUntil) > new Date()) {
            Logger.info(
                `[FeedPollJob] Skipping feed ${feedConfig.id} due to backoff. Next poll after: ${feedConfig.backoffUntil}`
            );
            return;
        }

        try {
            const fetchedFeed = await this.parser.parseURL(feedConfig.url);

            // Update last checked time regardless of items found, as long as fetch succeeded
            await FeedStorageService.updateLastChecked(feedConfig.id);

            // On success, clear backoff
            await FeedStorageService.clearBackoffUntil(feedConfig.id);

            if (!fetchedFeed.items || fetchedFeed.items.length === 0) {
                await FeedStorageService.clearFeedFailures(feedConfig.id);
                await FeedStorageService.clearBackoffUntil(feedConfig.id);
                return; // No items in feed
            }

            // Determine the unique identifier for items (GUID preferred, fallback to link)
            const getIdentifier = (item: ParsedFeedItem): string | null => {
                return item.guid || item.link || null; // Prioritize GUID/Link
            };

            const lastKnownGuid = feedConfig.lastItemGuid;
            const knownRecentLinks = new Set(feedConfig.recentLinks || []); // Use Set for quick lookup
            let latestItemGuid: string | null = null;
            const newItems: ParsedFeedItem[] = [];
            const maxTime = subHours(new Date(), MAX_ITEM_HOURS);

            // Process items from newest to oldest
            for (let i = 0; i < fetchedFeed.items.length; i++) {
                const item = fetchedFeed.items[i];
                const currentItemGuid = getIdentifier(item); // Use GUID or Link as primary ID

                // --- Date Sanity Check ---
                let itemDate: Date | null = null;
                if (item.isoDate) {
                    try {
                        itemDate = new Date(item.isoDate);
                    } catch {
                        /* ignore invalid date */
                    }
                } else if (item.pubDate) {
                    try {
                        itemDate = new Date(item.pubDate);
                    } catch {
                        /* ignore invalid date */
                    }
                }

                if (itemDate && itemDate < maxTime) {
                    // Logger.info(`[FeedPollJob] Skipping old item (older than ${MAX_ITEM_HOURS} days) for feed ${feedConfig.id}: ${item.title || item.link}`);
                    continue; // Skip item if it's too old
                }
                // --- End Date Sanity Check ---

                if (!currentItemGuid) continue; // Skip if no GUID or Link
                if (i === 0) latestItemGuid = currentItemGuid;

                // Stop if we hit the last known GUID (primary check)
                if (lastKnownGuid && currentItemGuid === lastKnownGuid) break;

                // Stop if we are past the first item AND there was no last GUID (initial run)
                if (!lastKnownGuid && i > 0) break;

                // --- Link Deduplication Check ---
                if (item.link && knownRecentLinks.has(item.link)) {
                    // Logger.info(`[FeedPollJob] Skipping item with recently seen link for feed ${feedConfig.id}: ${item.link}`);
                    continue; // Skip if link was recently posted
                }
                // --- End Link Deduplication Check ---

                newItems.push(item); // Add to new items if passes checks
            }

            // Update the last known GUID in the database if it changed
            if (latestItemGuid && latestItemGuid !== lastKnownGuid) {
                await FeedStorageService.updateLastItemGuid(feedConfig.id, latestItemGuid);
            }

            // If no new items were found after all checks.
            if (newItems.length === 0) {
                await FeedStorageService.clearFeedFailures(feedConfig.id);
                await FeedStorageService.clearBackoffUntil(feedConfig.id);
                return;
            }

            // If new items were found, attempt to post them
            if (newItems.length > 0) {
                Logger.info(
                    `[FeedPollJob] Found ${newItems.length} new item(s) for feed ${feedConfig.id} after checks.`
                );
                // postNewItems now handles its own success/failure reporting and link updating.
                await this.postNewItems(feedConfig, newItems.reverse(), fetchedFeed.title);
            }
        } catch (error: any) {
            // Handle common errors gracefully & Record failure
            const errorMessage = error.message || 'Unknown fetch/parse error';
            Logger.warn(
                `[FeedPollJob] Error checking feed ${feedConfig.id} (${feedConfig.url}): ${errorMessage}`
            );
            try {
                // Record the failure event
                await FeedStorageService.recordFailure(feedConfig.id, errorMessage);

                // --- Backoff calculation ---
                // Exponential backoff: BASE * 2^consecutiveFailures, capped

                const fails = (feedConfig.consecutiveFailures ?? 0) + 1; // +1 because recordFailure increments after this call
                const backoffMinutes = Math.min(BASE_MINUTES * Math.pow(2, fails), MAX_MINUTES);
                const backoffUntil = new Date(Date.now() + backoffMinutes * 60 * 1000);
                await FeedStorageService.setBackoffUntil(feedConfig.id, backoffUntil);

                // Check the failure count within the last 24 hours
                const failureCountLast24h = await FeedStorageService.getFailureCountLast24h(
                    feedConfig.id
                );

                // Notify if threshold reached
                const isPermissionError = false; // Assume not permission error for fetch/parse failures
                if (failureCountLast24h === FAILURE_NOTIFICATION_THRESHOLD) {
                    // Check if a notification was already sent in the last 24 hours
                    const lastNotified = await FeedStorageService.getLastFailureNotificationAt(
                        feedConfig.id
                    );
                    const now = new Date();
                    if (
                        !lastNotified ||
                        now.getTime() - new Date(lastNotified).getTime() > 24 * 60 * 60 * 1000
                    ) {
                        Logger.info(
                            `[FeedPollJob] Failure threshold (${FAILURE_NOTIFICATION_THRESHOLD}) reached for feed ${feedConfig.id} due to send failure. Notifying.`
                        );
                        await this.notifyFeedFailure(
                            feedConfig,
                            error,
                            failureCountLast24h,
                            isPermissionError
                        );
                        await FeedStorageService.setLastFailureNotificationNow(feedConfig.id);
                    } else {
                        Logger.info(
                            `[FeedPollJob] Failure notification for feed ${feedConfig.id} already sent in the last 24 hours. Skipping repeat notification.`
                        );
                    }
                }
            } catch (dbError) {
                Logger.error(
                    `[FeedPollJob] Failed to record failure or check count for feed ${feedConfig.id}:`,
                    dbError
                );
            }

            // --- PostHog Error Capture --- START
            if (posthog) {
                posthog.capture({
                    distinctId: 'system_feed_poll', // Use a system ID
                    event: '$exception',
                    properties: {
                        $exception_type: 'FeedPollCheckFeed',
                        $exception_message: errorMessage,
                        $exception_stack_trace: error instanceof Error ? error.stack : undefined,
                        feedId: feedConfig.id,
                        feedUrl: feedConfig.url,
                        guildId: feedConfig.guildId,
                        channelId: feedConfig.channelId,
                    },
                    groups: { guild: feedConfig.guildId },
                });
            }
            // --- PostHog Error Capture --- END
        }
    }

    /**
     * Post new items to the designated channel, individually.
     * Updates recent links in the DB upon success.
     * Includes AI summarization if enabled for the feed.
     * Handles paywalled links and summarizing comments.
     */
    private async postNewItems(
        feedConfig: FeedConfig,
        items: ParsedFeedItem[],
        feedTitle?: string
    ): Promise<void> {
        if (!items || items.length === 0) {
            return;
        }

        const itemsToPost = items;
        let successfullyPostedLinks: string[] = [];

        // Prepare items with potential summaries *before* broadcastEval
        const itemsToSend = await Promise.all(
            itemsToPost.map(async item => {
                let summary: string | null = null;
                let articleContent: string | null = null;
                let commentsContent: string | null = null;
                const sourceUrl = item.link || feedConfig.url; // Use item link if available

                // --- Content Fetching --- (Only if summarization enabled)
                if (feedConfig.summarize) {
                    try {
                        // 1. Try fetching main article content
                        if (item.link) {
                            // Prioritize 'content:encoded' or 'content' if present and seemingly substantial
                            const feedItemContent = item['content:encoded'] || item.content;
                            if (feedItemContent && feedItemContent.length > 200) {
                                // Heuristic: content exists
                                articleContent = feedItemContent;
                                Logger.info(
                                    `[FeedPollJob] Using feed item content for: ${item.link}`
                                );
                            } else {
                                articleContent = await fetchPageContent(item.link);
                            }
                        }

                        // 2. Try fetching comments content (if comments link exists and differs)
                        if (item.comments && item.comments !== item.link) {
                            commentsContent = await fetchPageContent(item.comments);
                        }

                        // 3. Generate Summary (if we have *any* content)
                        if (articleContent || commentsContent) {
                            Logger.info(
                                `[FeedPollJob] Attempting summarization for: ${sourceUrl}` +
                                    (item.comments ? ` (incl. comments: ${item.comments})` : '')
                            );
                            const summaries = await summarizeContent(
                                articleContent,
                                commentsContent,
                                sourceUrl
                            );
                            // Store summaries and read time in the item
                            item.articleSummary = summaries.articleSummary;
                            item.commentsSummary = summaries.commentsSummary;
                            item.articleReadTime = summaries.articleReadTime;
                            if (
                                (summaries.articleSummary &&
                                    !summaries.articleSummary.startsWith(
                                        'Could not generate summary:'
                                    )) ||
                                (summaries.commentsSummary &&
                                    !summaries.commentsSummary.startsWith(
                                        'Could not generate summary:'
                                    ))
                            ) {
                                Logger.info(
                                    `[FeedPollJob] Successfully generated summaries for: ${sourceUrl}`
                                );
                            } else {
                                Logger.warn(
                                    `[FeedPollJob] Summarization failed or insufficient content for: ${sourceUrl}. Article: ${summaries.articleSummary} Comments: ${summaries.commentsSummary}`
                                );
                            }
                        } else {
                            Logger.warn(
                                `[FeedPollJob] No content fetched to summarize for: ${sourceUrl}`
                            );
                            summary = 'Could not generate summary: No content fetched.'; // Set specific error
                        }
                    } catch (fetchOrSummarizeError) {
                        Logger.error(
                            `[FeedPollJob] Error fetching content or summarizing for ${sourceUrl}:`,
                            fetchOrSummarizeError
                        );
                        // PostHog capture is now inside summarizeContent/fetchPageContent
                        summary = 'Could not generate summary: Error during processing.'; // Set specific error
                    }
                }
                // Add summary (even if it's an error message) and original item data
                return { ...item, summary };
            })
        );

        // --- Message Sending (broadcastEval) ---
        try {
            const results = await this.manager.broadcastEval(
                async (client, context) => {
                    // Define truncate directly inside the broadcastEval context
                    const truncate = (input: any, length: number, addEllipsis = false): string => {
                        if (input === null || input === undefined) return '';
                        input = String(input); // Ensure input is a string
                        if (input.length <= length) {
                            return input;
                        }
                        let output = input.substring(0, addEllipsis ? length - 3 : length);
                        if (addEllipsis) {
                            output += '...';
                        }
                        return output;
                    };

                    // Define isPaywalled and getArchiveUrl inside context as well
                    const isPaywalledInner = (
                        url: string | undefined,
                        paywalledDomains: string[]
                    ): boolean => {
                        if (!url) return false;
                        try {
                            // Ensure the URL has a protocol for correct parsing
                            let fullUrl = url;
                            if (!/^https?:\/\//i.test(url)) {
                                fullUrl = `https://${url}`; // Assume https if missing
                            }
                            const parsedUrl = new URL(fullUrl);
                            const domain = parsedUrl.hostname.startsWith('www.')
                                ? parsedUrl.hostname.substring(4)
                                : parsedUrl.hostname;
                            return paywalledDomains.includes(domain.toLowerCase());
                        } catch {
                            return false;
                        }
                    };
                    const getArchiveUrlInner = (url: string): string => {
                        // Ensure the URL starts with http:// or https:// for archive.is
                        if (!/^https?:\/\//i.test(url)) {
                            return `https://archive.is/https://${url}`; // Attempt to prefix with https:// as a default
                        }
                        return `https://archive.is/${url}`;
                    };

                    const {
                        channelId,
                        itemsToSendWithSummaries, // Renamed context variable
                        guildTextChannelType,
                        guildAnnouncementChannelType,
                        feedId,
                        paywalledDomainsList, // Receive the list of domains
                        messageFlags, // Import MessageFlags
                    } = context;
                    const channel = await client.channels.fetch(channelId).catch(() => null);

                    if (
                        channel &&
                        (channel.type === guildTextChannelType ||
                            channel.type === guildAnnouncementChannelType)
                    ) {
                        const shardId = client.shard?.ids[0] ?? 'N/A';
                        const postedLinksInShard: string[] = [];
                        const errorsInShard: any[] = [];

                        for (const item of itemsToSendWithSummaries) {
                            // Iterate through items with summaries
                            const title = truncate(item.title || 'New Item', 150, true);
                            const link = item.link; // Keep original link
                            const author = item.creator || item.author;
                            const authorText = author
                                ? `\n*by ${truncate(author, 100, true)}*`
                                : '';

                            let dateTimestamp = '';
                            const itemDateString = item.isoDate || item.pubDate;
                            if (itemDateString) {
                                try {
                                    const date = new Date(itemDateString);
                                    if (!isNaN(date.getTime())) {
                                        const unixTimestamp = Math.floor(date.getTime() / 1000);
                                        dateTimestamp = ` <t:${unixTimestamp}:R>`;
                                    }
                                } catch {
                                    /* Ignore invalid date formats */
                                }
                            }

                            // --- Link Formatting ---
                            let displayLink = link;
                            if (displayLink?.includes('youtube.com/shorts/')) {
                                displayLink = displayLink.replace('/shorts/', '/watch?v=');
                            }
                            let linkLine = displayLink ? `<${displayLink}>` : 'No link available.';
                            let hasPaywalledLink = false; // Track if we added an archive link
                            if (link && isPaywalledInner(link, paywalledDomainsList)) {
                                linkLine += ` | [Archive](${getArchiveUrlInner(link)})`;
                                hasPaywalledLink = true;
                            }
                            // Add comments link if present and different from main link
                            if (item.comments && item.comments !== link) {
                                const commentsIsPaywalled = isPaywalledInner(
                                    item.comments,
                                    paywalledDomainsList
                                );
                                linkLine += ` | [Comments](<${item.comments}>)`;
                                if (commentsIsPaywalled) {
                                    linkLine += ` ([Archive](${getArchiveUrlInner(item.comments)}))`;
                                    hasPaywalledLink = true; // Also suppress embeds if comments are archived
                                }
                            }
                            // --- End Link Formatting ---

                            // Base content
                            let contentToSend = `📰 | **${title}**${dateTimestamp}${authorText}\n${linkLine}`;

                            // Show Article Summary first if present and not an error
                            if (
                                item.articleSummary &&
                                !item.articleSummary.startsWith('Could not generate summary:')
                            ) {
                                const readTimeText = item.articleReadTime
                                    ? ` *${formatReadTime(item.articleReadTime)}*`
                                    : '';
                                contentToSend += `\n\n**Article Summary:**${readTimeText}\n${truncate(item.articleSummary, 1500, true)}`;
                            }
                            // Then show Comments Summary if present and not an error
                            if (
                                item.commentsSummary &&
                                !item.commentsSummary.startsWith('Could not generate summary:')
                            ) {
                                contentToSend += `\n\n**Comments Summary:**\n${truncate(item.commentsSummary, 1500, true)}`;
                            }
                            // If both are missing or are error messages, show error(s) only (but not both together)
                            if (
                                (!item.articleSummary ||
                                    item.articleSummary.startsWith(
                                        'Could not generate summary:'
                                    )) &&
                                (!item.commentsSummary ||
                                    item.commentsSummary.startsWith('Could not generate summary:'))
                            ) {
                                // Prefer article error if both are present, else comments error
                                const errorMsg = item.articleSummary || item.commentsSummary;
                                if (errorMsg) {
                                    contentToSend += `\n\n*(${errorMsg})*`;
                                }
                            }

                            try {
                                // Ensure message is not too long
                                if (contentToSend.length > 2000) {
                                    contentToSend = contentToSend.substring(0, 1997) + '...';
                                    console.warn(
                                        `[FeedPollJob][Shard ${shardId}] Truncated message for feed ${feedId} due to length limit.`
                                    );
                                }

                                await (channel as TextChannel | NewsChannel).send({
                                    content: contentToSend,
                                    embeds: [],
                                    allowedMentions: { parse: [] },
                                    // Suppress embeds if a paywalled link (article or comments) was detected
                                    flags: hasPaywalledLink
                                        ? [messageFlags.SuppressEmbeds]
                                        : undefined,
                                });
                                if (item.link) {
                                    postedLinksInShard.push(item.link);
                                }
                            } catch (sendError) {
                                console.error(
                                    `[FeedPollJob][Shard ${shardId}] Error sending item for feed ${feedId} to ${channelId}:`,
                                    sendError
                                );
                                errorsInShard.push({
                                    code: (sendError as DiscordAPIError)?.code,
                                    message: (sendError as DiscordAPIError)?.message,
                                    itemTitle: item.title,
                                    itemLink: item.link,
                                });
                            }
                        }

                        return {
                            success:
                                postedLinksInShard.length > 0 ||
                                errorsInShard.length < itemsToSendWithSummaries.length,
                            postedLinks: postedLinksInShard,
                            errors: errorsInShard,
                            itemsAttempted: itemsToSendWithSummaries.length,
                            itemsSent: postedLinksInShard.length,
                        };
                    }
                    return {
                        success: false,
                        postedLinks: [],
                        errors: [
                            {
                                code: 'CHANNEL_NOT_FOUND_OR_INVALID_TYPE',
                                message: `Channel ${channelId} not found or invalid type on this shard.`,
                            },
                        ],
                        itemsAttempted: itemsToSendWithSummaries.length, // Use correct variable
                        itemsSent: 0,
                    };
                },
                {
                    context: {
                        channelId: feedConfig.channelId,
                        itemsToSendWithSummaries: itemsToSend, // Pass items including summaries
                        guildTextChannelType: GuildTextChannelTypeValue,
                        guildAnnouncementChannelType: GuildAnnouncementChannelTypeValue,
                        feedId: feedConfig.id,
                        paywalledDomainsList: Array.from(PAYWALLED_DOMAINS), // Pass the set as an array
                        messageFlags: MessageFlags, // Pass MessageFlags enum
                    },
                }
            );

            // Process results from shards
            let totalSuccessfullySentItems = 0;
            let allPostedLinks: string[] = [];
            let firstPermissionError: any = null;
            let firstOtherError: any = null;
            let hadAnySuccess = false;

            for (const res of results) {
                if (!res) continue; // Skip potentially undefined results if a shard crashed

                totalSuccessfullySentItems += res.itemsSent || 0;
                allPostedLinks.push(...(res.postedLinks || []));
                if (res.success) hadAnySuccess = true;

                if (res.errors && res.errors.length > 0) {
                    for (const err of res.errors) {
                        const errorCode = err.code;
                        if ((errorCode === 50001 || errorCode === 50013) && !firstPermissionError) {
                            firstPermissionError = err;
                        } else if (errorCode !== 50001 && errorCode !== 50013 && !firstOtherError) {
                            firstOtherError = err;
                        }
                    }
                }
            }
            // Deduplicate links gathered from different shards (though usually only one shard posts)
            successfullyPostedLinks = [...new Set(allPostedLinks)];

            // Update recent links in DB if any posts were successful
            if (successfullyPostedLinks.length > 0) {
                await FeedStorageService.updateRecentLinks(feedConfig.id, successfullyPostedLinks);
                Logger.info(
                    `[FeedPollJob] Posted ${successfullyPostedLinks.length}/${itemsToSend.length} item(s) for feed ${feedConfig.id}. Updated recent links.`
                );
            }

            // Determine overall success and handle failures/notifications
            const allItemsAttempted = itemsToSend.length; // Use itemsToSend length
            const allSucceeded =
                totalSuccessfullySentItems === allItemsAttempted &&
                !firstPermissionError &&
                !firstOtherError;
            const partialSuccess =
                totalSuccessfullySentItems > 0 && totalSuccessfullySentItems < allItemsAttempted;
            const totalFailure = totalSuccessfullySentItems === 0;

            if (allSucceeded) {
                // All items sent successfully across relevant shards
                await FeedStorageService.clearFeedFailures(feedConfig.id);
                await FeedStorageService.clearLastFailureNotification(feedConfig.id);
            } else if (partialSuccess || totalFailure) {
                // Some or all items failed to send
                const errorToReport =
                    firstPermissionError || firstOtherError || new Error('Unknown send error');
                const isPermissionError = firstPermissionError !== null;
                const failureReason = partialSuccess
                    ? 'Partial send failure'
                    : 'Total send failure';
                const errorMessage = `[FeedPollJob] ${failureReason} for feed ${feedConfig.id}. Sent ${totalSuccessfullySentItems}/${allItemsAttempted}. Last error: ${errorToReport.message} (Code: ${errorToReport.code})`;

                Logger.warn(errorMessage);

                // Record a failure
                await FeedStorageService.recordFailure(feedConfig.id, errorMessage);
                const failureCountLast24h = await FeedStorageService.getFailureCountLast24h(
                    feedConfig.id
                );

                // Notify if threshold reached
                if (failureCountLast24h === FAILURE_NOTIFICATION_THRESHOLD) {
                    // Check if a notification was already sent in the last 24 hours
                    const lastNotified = await FeedStorageService.getLastFailureNotificationAt(
                        feedConfig.id
                    );
                    const now = new Date();
                    if (
                        !lastNotified ||
                        now.getTime() - new Date(lastNotified).getTime() > 24 * 60 * 60 * 1000
                    ) {
                        Logger.info(
                            `[FeedPollJob] Failure threshold (${FAILURE_NOTIFICATION_THRESHOLD}) reached for feed ${feedConfig.id} due to send failure. Notifying.`
                        );
                        await this.notifyFeedFailure(
                            feedConfig,
                            errorToReport,
                            failureCountLast24h,
                            isPermissionError
                        );
                        await FeedStorageService.setLastFailureNotificationNow(feedConfig.id);
                    } else {
                        Logger.info(
                            `[FeedPollJob] Failure notification for feed ${feedConfig.id} already sent in the last 24 hours. Skipping repeat notification.`
                        );
                    }
                }
            }
        } catch (error: any) {
            // Error during broadcastEval setup itself or summary generation before broadcast
            const errorMessage =
                error.message || 'Unknown pre-broadcast or broadcastEval setup error';
            Logger.error(
                `[FeedPollJob] Error during postNewItems setup/broadcast for feed ${feedConfig.id}:`,
                error
            );

            // --- PostHog Error Capture --- START
            if (posthog) {
                posthog.capture({
                    distinctId: 'system_feed_poll', // Use a system ID
                    event: '$exception',
                    properties: {
                        // Distinguish between setup error and summary error if possible?
                        $exception_type: 'FeedPollPostItemsSetup',
                        $exception_message: errorMessage,
                        $exception_stack_trace: error instanceof Error ? error.stack : undefined,
                        feedId: feedConfig.id,
                        feedUrl: feedConfig.url,
                        guildId: feedConfig.guildId,
                        channelId: feedConfig.channelId,
                    },
                    groups: { guild: feedConfig.guildId },
                });
            }
            // --- PostHog Error Capture --- END

            // Record the failure (important even if it was summary error)
            try {
                await FeedStorageService.recordFailure(feedConfig.id, errorMessage);
                const failureCountLast24h = await FeedStorageService.getFailureCountLast24h(
                    feedConfig.id
                );

                if (failureCountLast24h === FAILURE_NOTIFICATION_THRESHOLD) {
                    // Check if a notification was already sent in the last 24 hours
                    const lastNotified = await FeedStorageService.getLastFailureNotificationAt(
                        feedConfig.id
                    );
                    const now = new Date();
                    if (
                        !lastNotified ||
                        now.getTime() - new Date(lastNotified).getTime() > 24 * 60 * 60 * 1000
                    ) {
                        Logger.info(
                            `[FeedPollJob] Failure threshold (${FAILURE_NOTIFICATION_THRESHOLD}) reached for feed ${feedConfig.id} due to post setup/broadcast error. Notifying.`
                        );
                        // Assuming not a permission error if it fails before broadcast setup
                        await this.notifyFeedFailure(feedConfig, error, failureCountLast24h, false);
                        await FeedStorageService.setLastFailureNotificationNow(feedConfig.id);
                    } else {
                        Logger.info(
                            `[FeedPollJob] Failure notification for feed ${feedConfig.id} already sent in the last 24 hours. Skipping repeat notification.`
                        );
                    }
                }
            } catch (dbError) {
                Logger.error(
                    `[FeedPollJob] Failed to record failure or check count after postItems error for feed ${feedConfig.id}:`,
                    dbError
                );
            }
        }
    }

    /**
     * Sends a notification about a failing feed to the feed's channel.
     * Updated to mention 24-hour period.
     */
    private async notifyFeedFailure(
        feedConfig: FeedConfig,
        error: any,
        failureCount: number, // This is now the 24-hour count
        isPermissionError: boolean = false
    ): Promise<void> {
        // --- Reusable truncate function (defined once) ---
        const truncate = (input: string, length: number, addEllipsis: boolean = false): string => {
            if (input === null || input === undefined) return '';
            input = String(input); // Ensure input is a string
            if (input.length <= length) {
                return input;
            }
            let output = input.substring(0, addEllipsis ? length - 3 : length);
            if (addEllipsis) {
                output += '...';
            }
            return output;
        };

        const reason = isPermissionError
            ? `Bot lacks permissions (e.g., Send Messages) in this channel (<#${feedConfig.channelId}>).`
            : `Failed to fetch, parse, or send feed content. Please check the URL (\`${feedConfig.url}\`) or the feed source.`;
        const baseDescription = `The feed subscription (<${feedConfig.url}>, ID: \`${feedConfig.id}\`) has failed ${failureCount} times in the last 24 hours.`;

        const errorMessageBlock = error?.message ? codeBlock(truncate(error.message, 1000)) : '';

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle(
                `🚨 Feed Error: ${truncate(feedConfig.nickname || feedConfig.url, 100, true)}`
            )
            .setDescription(
                `${baseDescription}\n\n**Reason:** ${reason}\n${errorMessageBlock}\n\nNo further error notifications will be sent for this feed until it recovers.\nPlease use \`/feed remove\` if the feed is permanently broken or no longer needed.`
            )
            .setTimestamp();

        try {
            // No need to pass truncate function string here, as it's only used before broadcastEval
            const postResult = await this.manager.broadcastEval(
                async (client, context) => {
                    const {
                        channelId,
                        embedData,
                        guildTextChannelType,
                        guildAnnouncementChannelType,
                    } = context;
                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (
                        channel &&
                        (channel.type === guildTextChannelType ||
                            channel.type === guildAnnouncementChannelType)
                    ) {
                        try {
                            await (channel as TextChannel | NewsChannel).send({
                                embeds: [embedData],
                            });
                            return true;
                        } catch {
                            return false;
                        }
                    }
                    return false;
                },
                {
                    context: {
                        channelId: feedConfig.channelId,
                        embedData: embed.toJSON(), // Pass the generated embed data
                        guildTextChannelType: GuildTextChannelTypeValue,
                        guildAnnouncementChannelType: GuildAnnouncementChannelTypeValue,
                    },
                }
            );

            if (postResult.some(sent => sent)) {
                Logger.info(
                    `[FeedPollJob] Sent failure notification for feed ${feedConfig.id} to channel ${feedConfig.channelId}.`
                );
            } else {
                Logger.warn(
                    `[FeedPollJob] Failed to send failure notification for feed ${feedConfig.id} to channel ${feedConfig.channelId} (Channel missing or permissions error?).`
                );
            }
        } catch (broadcastError) {
            Logger.error(
                `[FeedPollJob] Error broadcasting failure notification for feed ${feedConfig.id}:`,
                broadcastError
            );

            // --- PostHog Error Capture --- START
            if (posthog) {
                posthog.capture({
                    distinctId: 'system_feed_poll', // Use a system ID
                    event: '$exception',
                    properties: {
                        $exception_type: 'FeedPollNotifyFailureBroadcast',
                        $exception_message:
                            broadcastError instanceof Error
                                ? broadcastError.message
                                : String(broadcastError),
                        $exception_stack_trace:
                            broadcastError instanceof Error ? broadcastError.stack : undefined,
                        feedId: feedConfig.id,
                        feedUrl: feedConfig.url,
                        guildId: feedConfig.guildId,
                        channelId: feedConfig.channelId,
                    },
                    groups: { guild: feedConfig.guildId },
                });
            }
            // --- PostHog Error Capture --- END
        }
    }
}
