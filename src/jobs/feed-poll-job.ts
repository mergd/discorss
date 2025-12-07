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
import {
    BASE_MINUTES,
    CATEGORY_BACKOFF_COORDINATION_FACTOR,
    DEFAULT_FREQUENCY_MINUTES,
    FAILURE_NOTIFICATION_THRESHOLD,
    FAILURE_QUIET_PERIOD_HOURS,
    MAX_FREQUENCY_MINUTES,
    MAX_ITEM_HOURS,
    MAX_MINUTES,
    MIN_FREQUENCY_MINUTES,
} from '../constants/index.js';

import { PAYWALLED_DOMAINS } from '../constants/paywalled-sites.js';
import {
    CategoryConfig,
    FeedConfig,
    FeedPollConfig,
    FeedStorageService,
} from '../services/feed-storage-service.js';
import { Logger } from '../services/index.js';
import { resetOpenAIClient } from '../services/openai-service.js';
import { posthog } from '../utils/analytics.js';
import { fetchPageContent, summarizeContent } from '../utils/feed-summarizer.js';
import { getRSSParser, resetRSSParser } from '../utils/rss-parser.js';
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

// Replace individual intervals with batch processing
const categoryFrequencies: Map<string, number> = new Map();
// Use lightweight FeedPollConfig to reduce memory usage - excludes large summary fields
const feedQueue: Map<string, { feed: FeedPollConfig; nextCheck: number }> = new Map();
let batchProcessorInterval: NodeJS.Timeout | null = null;

// Store enum values for context passing
const GuildTextChannelTypeValue = ChannelType.GuildText; // 0
const GuildAnnouncementChannelTypeValue = ChannelType.GuildAnnouncement; // 5

// Helper function to get effective frequency
function getEffectiveFrequency(feed: FeedPollConfig): number {
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
    public schedule: string = '0 */10 * * * *'; // Run every 10 minutes to reload feeds, not every minute!
    public log: boolean = false; // Disable default interval logging, we log activity manually

    private manager: ShardingManager;
    private isInitialized: boolean = false;
    private isProcessingBatch: boolean = false;

    constructor(manager: ShardingManager) {
        super();
        this.manager = manager;
    }

    public async run(): Promise<void> {
        // Only run full initialization once, then just reload feeds periodically
        if (!this.isInitialized) {
            Logger.info('[FeedPollJob] Initial startup - loading and scheduling all feeds...');
            this.isInitialized = true;
        } else {
            Logger.info('[FeedPollJob] Periodic reload - checking for new/updated feeds...');
        }

        this.loadAndScheduleFeeds().catch(error => {
            Logger.error('[FeedPollJob] Error during load/schedule:', error);
        });
    }

    // Clean up batch processor when job stops
    public async stop(): Promise<void> {
        Logger.info('[FeedPollJob] Stopping batch processor...');
        if (batchProcessorInterval) {
            clearInterval(batchProcessorInterval);
            batchProcessorInterval = null;
        }
        feedQueue.clear();
        categoryFrequencies.clear();
        Logger.info('[FeedPollJob] Batch processor stopped and queues cleared.');
    }

    // Load all feeds and add them to batch processing queue
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

        // Load all feeds using lightweight polling config to save memory
        const allFeeds: FeedPollConfig[] = await FeedStorageService.getAllFeedsForPolling();
        Logger.info(`[FeedPollJob] Processing ${allFeeds.length} feeds.`);

        // Update feed queue with current feeds
        const currentFeedIds = new Set(allFeeds.map(f => f.id));

        // Remove feeds that no longer exist
        for (const [feedId] of feedQueue) {
            if (!currentFeedIds.has(feedId)) {
                feedQueue.delete(feedId);
                Logger.info(`[FeedPollJob] Removed feed ${feedId} from queue`);
            }
        }

        // Add/update feeds in queue
        const now = Date.now();
        for (const feed of allFeeds) {
            const frequencyMinutes = getEffectiveFrequency(feed);
            const intervalMillis = frequencyMinutes * 60 * 1000;

            // Schedule immediate check for new feeds, or update existing
            const existing = feedQueue.get(feed.id);
            const nextCheck = existing ? existing.nextCheck : now; // Immediate for new feeds

            feedQueue.set(feed.id, {
                feed,
                nextCheck,
            });
        }

        // Start batch processor if not already running
        if (!batchProcessorInterval) {
            this.startBatchProcessor();
        }

        Logger.info(`[FeedPollJob] Added ${allFeeds.length} feeds to batch queue.`);
    }

    // Batch processor that checks feeds when they're due
    private startBatchProcessor(): void {
        const BATCH_CHECK_INTERVAL = 30000; // Check every 30 seconds
        const MAX_CONCURRENT_FEEDS = 5; // Limit concurrent feed checks
        const MAX_QUEUE_SIZE = 5000; // Maximum feed queue size before warning
        const STALE_FEED_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days
        let cycleCount = 0;

        batchProcessorInterval = setInterval(async () => {
            if (this.isProcessingBatch) {
                Logger.warn('[FeedPollJob] Batch processor still running, skipping interval');
                return;
            }
            this.isProcessingBatch = true;

            try {
                const now = Date.now();
                const feedsToCheck: string[] = [];

                // Find feeds that are due for checking
                for (const [feedId, queueItem] of feedQueue) {
                    if (queueItem.nextCheck <= now) {
                        feedsToCheck.push(feedId);
                    }
                }

                if (feedsToCheck.length === 0) {
                    return; // Nothing to check
                }

                Logger.info(`[FeedPollJob] Batch checking ${feedsToCheck.length} feeds`);

                // Track memory before batch processing
                const memBefore = process.memoryUsage();

                // Process feeds in batches to avoid overwhelming the system
                const batches = [];
                for (let i = 0; i < feedsToCheck.length; i += MAX_CONCURRENT_FEEDS) {
                    batches.push(feedsToCheck.slice(i, i + MAX_CONCURRENT_FEEDS));
                }

                for (const batch of batches) {
                    const promises = batch.map(feedId => this.processFeedInQueue(feedId));
                    await Promise.allSettled(promises);

                    // Clear promises array to help GC
                    promises.length = 0;

                    // Small delay between batches to prevent overwhelming
                    if (batches.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Clear batches array
                batches.length = 0;

                // Track memory after batch processing
                const memAfter = process.memoryUsage();
                const rssMB = Math.round(memAfter.rss / 1024 / 1024);

                // CRITICAL: Check memory on EVERY batch - lower threshold to leave room for spikes
                const RSS_CRITICAL_MB = 350;
                if (rssMB > RSS_CRITICAL_MB) {
                    Logger.error(
                        `[FeedPollJob] 🚨 CRITICAL: RSS ${rssMB}MB exceeds ${RSS_CRITICAL_MB}MB! Exiting for restart...`
                    );
                    process.exit(1);
                }

                const heapDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
                if (heapDelta > 10) {
                    Logger.warn(
                        `[FeedPollJob] High memory delta after batch: ${heapDelta.toFixed(2)}MB (RSS: ${rssMB}MB)`
                    );
                }

                // Periodic memory logging (every 10 cycles = 5 minutes)
                cycleCount++;
                if (cycleCount % 10 === 0) {
                    const memUsage = process.memoryUsage();
                    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
                    const currentRssMB = Math.round(memUsage.rss / 1024 / 1024);

                    Logger.info(
                        `[FeedPollJob] Memory - RSS: ${currentRssMB}MB, Heap: ${heapUsedMB}MB, Queue: ${feedQueue.size}`
                    );

                    // Warning threshold - try cleanup at 280MB
                    if (currentRssMB > 280) {
                        Logger.warn(`[FeedPollJob] ⚠️ High memory: RSS ${currentRssMB}MB. Forcing cleanup...`);
                        resetRSSParser();
                        resetOpenAIClient();
                        if (global.gc) global.gc();
                    }

                    // Check for queue size overflow
                    if (feedQueue.size > MAX_QUEUE_SIZE) {
                        Logger.error(
                            `[FeedPollJob] ⚠️  Feed queue size exceeded limit! Size: ${feedQueue.size}, Limit: ${MAX_QUEUE_SIZE}`
                        );
                    }
                }

                // Periodic cleanup of stale feeds (every 20 cycles = 10 minutes)
                if (cycleCount % 20 === 0) {
                    let staleCount = 0;
                    for (const [feedId, queueItem] of feedQueue) {
                        const timeSinceCheck = now - queueItem.nextCheck;
                        if (timeSinceCheck > STALE_FEED_THRESHOLD) {
                            feedQueue.delete(feedId);
                            staleCount++;
                            Logger.info(
                                `[FeedPollJob] Removed stale feed ${feedId} from queue (no check in 7 days)`
                            );
                        }
                    }
                    if (staleCount > 0) {
                        Logger.info(
                            `[FeedPollJob] Cleaned up ${staleCount} stale feeds from queue`
                        );
                    }
                }

                // Periodic maintenance (every 120 cycles = ~1 hour)
                if (cycleCount % 120 === 0) {
                    // Clean up old feed_failures records (older than 7 days)
                    const deletedFailures = await FeedStorageService.cleanupOldFailures(7);
                    if (deletedFailures > 0) {
                        Logger.info(
                            `[FeedPollJob] Cleaned up ${deletedFailures} old failure records`
                        );
                    }

                    // Reset singletons to clear accumulated state
                    resetRSSParser();
                    resetOpenAIClient();
                    Logger.info('[FeedPollJob] Reset RSS parser and OpenAI client to free memory');
                }
            } catch (error) {
                Logger.error('[FeedPollJob] Error in batch processor:', error);
            } finally {
                this.isProcessingBatch = false;
            }
        }, BATCH_CHECK_INTERVAL);

        Logger.info('[FeedPollJob] Batch processor started');
    }

    // Process a single feed and update its next check time
    private async processFeedInQueue(feedId: string): Promise<void> {
        const queueItem = feedQueue.get(feedId);
        if (!queueItem) return;

        try {
            await this.checkFeed(feedId);

            // Schedule next check
            const frequencyMinutes = getEffectiveFrequency(queueItem.feed);
            const nextCheck = Date.now() + frequencyMinutes * 60 * 1000;

            feedQueue.set(feedId, {
                feed: queueItem.feed,
                nextCheck,
            });
        } catch (error) {
            Logger.error(`[FeedPollJob] Error processing feed ${feedId} in batch:`, error);

            // Reschedule with backoff on error
            const nextCheck = Date.now() + 5 * 60 * 1000; // 5 minutes
            feedQueue.set(feedId, {
                feed: queueItem.feed,
                nextCheck,
            });
        }
    }

    /**
     * Applies exponential backoff to a feed and coordinates backoff with other feeds in the same category.
     */
    private async applyBackoffWithCategoryCoordination(
        feedConfig: FeedConfig | FeedPollConfig
    ): Promise<void> {
        const fails =
            ('consecutiveFailures' in feedConfig ? (feedConfig.consecutiveFailures ?? 0) : 0) + 1;
        const backoffMinutes = Math.min(BASE_MINUTES * Math.pow(2, fails), MAX_MINUTES);
        const backoffUntil = new Date(Date.now() + backoffMinutes * 60 * 1000);
        await FeedStorageService.setBackoffUntil(feedConfig.id, backoffUntil);

        if (feedConfig.category) {
            const categoryFeedIds = await FeedStorageService.getFeedIdsByCategory(
                feedConfig.guildId,
                feedConfig.category,
                feedConfig.id
            );
            if (categoryFeedIds.length > 0) {
                const coordinatedBackoffMinutes = Math.floor(
                    backoffMinutes * CATEGORY_BACKOFF_COORDINATION_FACTOR
                );
                const coordinatedBackoffUntil = new Date(
                    Date.now() + coordinatedBackoffMinutes * 60 * 1000
                );
                for (const categoryFeedId of categoryFeedIds) {
                    const categoryFeed = await FeedStorageService.getFeedById(categoryFeedId);
                    if (categoryFeed) {
                        const existingBackoff = categoryFeed.backoffUntil
                            ? new Date(categoryFeed.backoffUntil)
                            : null;
                        if (!existingBackoff || coordinatedBackoffUntil > existingBackoff) {
                            await FeedStorageService.setBackoffUntil(
                                categoryFeedId,
                                coordinatedBackoffUntil
                            );
                            Logger.info(
                                `[FeedPollJob] Applied coordinated backoff (${coordinatedBackoffMinutes} min) to category feed ${categoryFeedId} due to failure in feed ${feedConfig.id} (category: ${feedConfig.category})`
                            );
                        }
                    }
                }
            }
        }
    }

    // Check a single feed for new items (now fetches fresh config including links)
    public async checkFeed(feedId: string): Promise<void> {
        // Fetch the latest feed config from DB, including recent links
        const feedConfig = await FeedStorageService.getFeedById(feedId);
        if (!feedConfig) {
            Logger.warn(`[FeedPollJob] Feed config not found for ID ${feedId}. Skipping check.`);
            // Remove from queue if feed is permanently gone
            feedQueue.delete(feedId);
            Logger.info(`[FeedPollJob] Removed potentially deleted feed ID from queue: ${feedId}`);
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
            const parser = getRSSParser();
            const fetchedFeed = await parser.parseURL(feedConfig.url);

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

                // Limit items per batch to prevent memory spikes
                const MAX_ITEMS_PER_FEED = 5;
                if (newItems.length >= MAX_ITEMS_PER_FEED) {
                    Logger.info(
                        `[FeedPollJob] Limiting to ${MAX_ITEMS_PER_FEED} items for feed ${feedConfig.id} (had more available)`
                    );
                    break;
                }
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

            // Send user-friendly error message to channel (rate limited) - only if not ignoring errors and failure notifications are enabled
            if (!feedConfig.ignoreErrors && !feedConfig.disableFailureNotifications) {
                await this.sendFeedErrorMessage(feedConfig, error, 'fetch');
            }

            try {
                // Record the failure event
                await FeedStorageService.recordFailure(feedConfig.id, errorMessage);

                // Check if feed should be auto-disabled due to persistent errors
                if (!feedConfig.ignoreErrors && !feedConfig.disabled) {
                    const isDeadFeed = await FeedStorageService.shouldAutoDisableDeadFeed(
                        feedConfig.id
                    );
                    if (isDeadFeed) {
                        await FeedStorageService.autoDisableFeed(
                            feedConfig.id,
                            `Feed has been returning 400-level errors for more than 3 days: ${feedConfig.url}`
                        );
                        Logger.info(
                            `[FeedPollJob] Auto-disabled feed ${feedConfig.id} (${feedConfig.url}) - dead feed (400-level for >3 days)`
                        );
                        await this.sendFeedDisabledNotification(
                            feedConfig,
                            '400-level errors',
                            '3 days'
                        );
                    } else {
                        const isServerErrorFeed =
                            await FeedStorageService.shouldAutoDisableServerErrorFeed(
                                feedConfig.id
                            );
                        if (isServerErrorFeed) {
                            await FeedStorageService.autoDisableFeed(
                                feedConfig.id,
                                `Feed has been returning 500+ errors for more than 1 week: ${feedConfig.url}`
                            );
                            Logger.info(
                                `[FeedPollJob] Auto-disabled feed ${feedConfig.id} (${feedConfig.url}) - server errors (500+ for >1 week)`
                            );
                            await this.sendFeedDisabledNotification(
                                feedConfig,
                                '500+ server errors',
                                '1 week'
                            );
                        }
                    }
                }

                // Apply backoff with category coordination
                await this.applyBackoffWithCategoryCoordination(feedConfig);

                // Check the failure count within the last 24 hours
                const failureCountLast24h = await FeedStorageService.getFailureCountLast24h(
                    feedConfig.id
                );

                // Notify if threshold reached and failure notifications are enabled
                const isPermissionError = false; // Assume not permission error for fetch/parse failures
                if (
                    !feedConfig.ignoreErrors &&
                    !feedConfig.disableFailureNotifications &&
                    failureCountLast24h === FAILURE_NOTIFICATION_THRESHOLD
                ) {
                    // Check if a notification was already sent in the last quiet period
                    const lastNotified = await FeedStorageService.getLastFailureNotificationAt(
                        feedConfig.id
                    );
                    const now = new Date();
                    const quietPeriodMs = FAILURE_QUIET_PERIOD_HOURS * 60 * 60 * 1000;
                    if (
                        !lastNotified ||
                        now.getTime() - new Date(lastNotified).getTime() > quietPeriodMs
                    ) {
                        Logger.info(
                            `[FeedPollJob] Failure threshold (${FAILURE_NOTIFICATION_THRESHOLD}) reached for feed ${feedConfig.id} due to fetch failure. Notifying and entering ${FAILURE_QUIET_PERIOD_HOURS}h quiet period.`
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
                            `[FeedPollJob] Failure notification for feed ${feedConfig.id} already sent in the last ${FAILURE_QUIET_PERIOD_HOURS} hours. Still in quiet period.`
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
        const itemsToSend: ParsedFeedItem[] = [];
        for (const item of itemsToPost) {
            let articleContent: string | null = null;
            let commentsContent: string | null = null;
            const sourceUrl = item.link || feedConfig.url; // Use item link if available

            // --- Content Fetching --- (Only if summarization enabled)
            if (feedConfig.summarize) {
                // Skip summarization for YouTube feeds (they don't have scrapable text content)
                const isYouTubeFeed =
                    feedConfig.url?.includes('youtube.com/feeds/videos.xml') ||
                    feedConfig.category === 'YouTube' ||
                    item.link?.includes('youtube.com/watch') ||
                    item.link?.includes('youtu.be/');

                if (isYouTubeFeed) {
                    Logger.info(
                        `[FeedPollJob] Skipping summarization for YouTube feed item: ${item.link}`
                    );
                    item.articleSummary = null;
                } else {
                    try {
                        // Check memory before heavy operations - exit early if too high
                        const preOpMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
                        if (preOpMem > 320) {
                            Logger.error(`[FeedPollJob] 🚨 RSS ${preOpMem}MB too high before fetch, exiting...`);
                            process.exit(1);
                        }

                        // 1. Try fetching main article content
                        if (item.link) {
                            const feedItemContent = item['content:encoded'] || item.content;
                            if (feedItemContent && feedItemContent.length > 200) {
                                articleContent = feedItemContent;
                                Logger.info(`[FeedPollJob] Using feed item content for: ${item.link}`);
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
                            // Get effective language (feed language overrides guild language)
                            const effectiveLanguage = await FeedStorageService.getEffectiveLanguage(
                                feedConfig.id,
                                feedConfig.guildId
                            );
                            const summaries = await summarizeContent(
                                articleContent,
                                commentsContent,
                                sourceUrl,
                                effectiveLanguage,
                                feedConfig.guildId
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
                            item.articleSummary = 'Could not generate summary: No content fetched.';
                        }
                    } catch (fetchOrSummarizeError) {
                        Logger.error(
                            `[FeedPollJob] Error fetching content or summarizing for ${sourceUrl}:`,
                            fetchOrSummarizeError
                        );

                        // Send user-friendly error message for summarization failures (rate limited) - only if not ignoring errors and failure notifications are enabled
                        if (!feedConfig.ignoreErrors && !feedConfig.disableFailureNotifications) {
                            await this.sendFeedErrorMessage(
                                feedConfig,
                                fetchOrSummarizeError,
                                'summary'
                            );
                        }

                        // PostHog capture is now inside summarizeContent/fetchPageContent
                        item.articleSummary =
                            'Could not generate summary: Error during processing.';
                    }
                }
            }

            itemsToSend.push(item);
        }

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
                        useArchiveLinks, // Pass archive links setting
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
                            // Show archive link if useArchiveLinks is enabled OR if the link is paywalled
                            const shouldShowArchive =
                                useArchiveLinks || isPaywalledInner(link, paywalledDomainsList);
                            if (link && shouldShowArchive) {
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
                                // Show archive for comments if useArchiveLinks is enabled OR if comments are paywalled
                                const shouldShowArchiveComments =
                                    useArchiveLinks || commentsIsPaywalled;
                                if (shouldShowArchiveComments) {
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
                                contentToSend += `\n\n**Article Summary:**\n${truncate(item.articleSummary, 1500, true)}`;
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
                                        ? [messageFlags] // messageFlags is 4 (MessageFlags.SuppressEmbeds)
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
                        // Reduce payload size by only sending essential data
                        itemsToSendWithSummaries: itemsToSend.map(item => ({
                            title: item.title,
                            link: item.link,
                            pubDate: item.pubDate,
                            isoDate: item.isoDate,
                            creator: item.creator,
                            author: item.author,
                            comments: item.comments,
                            articleSummary: item.articleSummary,
                            commentsSummary: item.commentsSummary,
                            articleReadTime: item.articleReadTime,
                        })),
                        guildTextChannelType: 0, // Use literal value instead of imported constant
                        guildAnnouncementChannelType: 5, // Use literal value instead of imported constant
                        feedId: feedConfig.id,
                        useArchiveLinks: feedConfig.useArchiveLinks,
                        paywalledDomainsList: Array.from(PAYWALLED_DOMAINS), // Pass the set as an array
                        messageFlags: 4, // MessageFlags.SuppressEmbeds value
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
                        } else if (errorCode === 'CHANNEL_NOT_FOUND_OR_INVALID_TYPE') {
                            // Channel not found - delete the feed
                            Logger.warn(
                                `[FeedPollJob] Channel not found for feed ${feedConfig.id}. Deleting feed.`
                            );
                            try {
                                await FeedStorageService.removeFeed(
                                    feedConfig.id,
                                    feedConfig.channelId,
                                    feedConfig.guildId
                                );
                                Logger.info(
                                    `[FeedPollJob] Successfully deleted feed ${feedConfig.id} due to missing channel`
                                );

                                // Remove the feed from queue
                                feedQueue.delete(feedConfig.id);
                                return; // Exit early since feed is deleted
                            } catch (deleteError) {
                                Logger.error(
                                    `[FeedPollJob] Failed to delete feed ${feedConfig.id}:`,
                                    deleteError
                                );
                            }
                        } else if (errorCode !== 50001 && errorCode !== 50013 && !firstOtherError) {
                            firstOtherError = err;
                        }
                    }
                }
            }
            // Deduplicate links gathered from different shards (though usually only one shard posts)
            successfullyPostedLinks = [...new Set(allPostedLinks)];

            // Clear results array to help GC
            results.length = 0;
            allPostedLinks.length = 0;

            // Update recent links in DB if any posts were successful
            if (successfullyPostedLinks.length > 0) {
                await FeedStorageService.updateRecentLinks(feedConfig.id, successfullyPostedLinks);
                Logger.info(
                    `[FeedPollJob] Posted ${successfullyPostedLinks.length}/${itemsToSend.length} item(s) for feed ${feedConfig.id}. Updated recent links.`
                );
            }

            // Clear items arrays to help GC
            itemsToSend.length = 0;

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

                // Notify if threshold reached and failure notifications are enabled
                if (
                    !feedConfig.ignoreErrors &&
                    !feedConfig.disableFailureNotifications &&
                    failureCountLast24h === FAILURE_NOTIFICATION_THRESHOLD
                ) {
                    // Check if a notification was already sent in the last quiet period
                    const lastNotified = await FeedStorageService.getLastFailureNotificationAt(
                        feedConfig.id
                    );
                    const now = new Date();
                    const quietPeriodMs = FAILURE_QUIET_PERIOD_HOURS * 60 * 60 * 1000;
                    if (
                        !lastNotified ||
                        now.getTime() - new Date(lastNotified).getTime() > quietPeriodMs
                    ) {
                        Logger.info(
                            `[FeedPollJob] Failure threshold (${FAILURE_NOTIFICATION_THRESHOLD}) reached for feed ${feedConfig.id} due to send failure. Notifying and entering ${FAILURE_QUIET_PERIOD_HOURS}h quiet period.`
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
                            `[FeedPollJob] Failure notification for feed ${feedConfig.id} already sent in the last ${FAILURE_QUIET_PERIOD_HOURS} hours. Still in quiet period.`
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

                if (
                    !feedConfig.ignoreErrors &&
                    !feedConfig.disableFailureNotifications &&
                    failureCountLast24h === FAILURE_NOTIFICATION_THRESHOLD
                ) {
                    // Check if a notification was already sent in the last quiet period
                    const lastNotified = await FeedStorageService.getLastFailureNotificationAt(
                        feedConfig.id
                    );
                    const now = new Date();
                    const quietPeriodMs = FAILURE_QUIET_PERIOD_HOURS * 60 * 60 * 1000;
                    if (
                        !lastNotified ||
                        now.getTime() - new Date(lastNotified).getTime() > quietPeriodMs
                    ) {
                        Logger.info(
                            `[FeedPollJob] Failure threshold (${FAILURE_NOTIFICATION_THRESHOLD}) reached for feed ${feedConfig.id} due to post setup/broadcast error. Notifying and entering ${FAILURE_QUIET_PERIOD_HOURS}h quiet period.`
                        );
                        // Assuming not a permission error if it fails before broadcast setup
                        await this.notifyFeedFailure(feedConfig, error, failureCountLast24h, false);
                        await FeedStorageService.setLastFailureNotificationNow(feedConfig.id);
                    } else {
                        Logger.info(
                            `[FeedPollJob] Failure notification for feed ${feedConfig.id} already sent in the last ${FAILURE_QUIET_PERIOD_HOURS} hours. Still in quiet period.`
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
        // Skip notifications for YouTube feeds (they're known to be unreliable)
        const isYouTubeFeed =
            feedConfig.url?.includes('youtube.com/feeds/videos.xml') ||
            feedConfig.category === 'YouTube';
        if (isYouTubeFeed || feedConfig.disableFailureNotifications) {
            Logger.info(
                `[FeedPollJob] Skipping failure notification for feed ${feedConfig.id} - YouTube feed or notifications disabled`
            );
            return;
        }

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

        const effectiveFrequency = getEffectiveFrequency(feedConfig);
        const baseDescription = `The feed subscription (<${feedConfig.url}>, ID: \`${feedConfig.id}\`) has failed ${failureCount} times in the last 24 hours.`;

        const pollSuggestion = !isPermissionError
            ? `\n\n**💡 Suggestion:** Consider increasing the poll frequency from ${effectiveFrequency} minutes to reduce load on the feed source. Use \`/feed edit\` to adjust the frequency.`
            : '';

        const ignoreErrorsHint = `\n\n**🔇 Note:** You can disable notifications for this feed using \`/feed edit\`:\n• **Ignore Errors**: Disables all error messages\n• **Disable Failure Notifications**: Disables only these threshold alerts`;

        const errorMessageBlock = error?.message ? codeBlock(truncate(error.message, 1000)) : '';

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle(
                `🚨 Feed Error: ${truncate(feedConfig.nickname || feedConfig.url, 100, true)}`
            )
            .setDescription(
                `${baseDescription}\n\n**Reason:** ${reason}\n${errorMessageBlock}${pollSuggestion}${ignoreErrorsHint}\n\nNo further error notifications will be sent for this feed for ${FAILURE_QUIET_PERIOD_HOURS} hours.\nPlease use \`/feed remove\` if the feed is permanently broken or no longer needed.`
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

    /**
     * Sends a lightweight error message to the feed channel when errors occur.
     * Rate limited to avoid spamming users.
     */
    private async sendFeedErrorMessage(
        feedConfig: FeedConfig,
        error: any,
        errorType: 'fetch' | 'parse' | 'summary'
    ): Promise<void> {
        // Skip notifications for YouTube feeds (they're known to be unreliable)
        const isYouTubeFeed =
            feedConfig.url?.includes('youtube.com/feeds/videos.xml') ||
            feedConfig.category === 'YouTube';
        if (isYouTubeFeed) {
            Logger.info(`[FeedPollJob] Skipping error message for YouTube feed ${feedConfig.id}`);
            return;
        }

        // Skip if errors are being ignored for this feed
        if (feedConfig.ignoreErrors) {
            Logger.info(
                `[FeedPollJob] Skipping error message for feed ${feedConfig.id} - errors are ignored`
            );
            return;
        }

        // Skip if failure notifications are disabled for this feed
        if (feedConfig.disableFailureNotifications) {
            Logger.info(
                `[FeedPollJob] Skipping error message for feed ${feedConfig.id} - failure notifications are disabled`
            );
            return;
        }

        // Check if we can send an error message (rate limited)
        const canSend = await FeedStorageService.canSendErrorMessage(feedConfig.id, 6); // 1 hour rate limit
        if (!canSend) {
            Logger.info(`[FeedPollJob] Error message rate limited for feed ${feedConfig.id}`);
            return;
        }

        const errorTypeText = {
            fetch: 'fetching',
            parse: 'parsing',
            summary: 'summarizing',
        }[errorType];

        const feedName = feedConfig.nickname || feedConfig.url;
        const errorMessage = error?.message
            ? ` (${error.message.substring(0, 100)}${error.message.length > 100 ? '...' : ''})`
            : '';

        const content = `⚠️ **Feed Error**\nThere was an issue ${errorTypeText} the feed "${feedName}"${errorMessage}.\n\n*This message is rate limited to once per six hours. The feed will continue trying automatically.*`;

        try {
            const results = await this.manager.broadcastEval(
                async (client, context) => {
                    const { channelId, content } = context;
                    const channel = client.channels.cache.get(channelId);
                    if (!channel || !channel.isTextBased()) {
                        return null;
                    }

                    // Type guard to ensure channel has send method
                    if (!('send' in channel)) {
                        return null;
                    }

                    try {
                        await channel.send(content);
                        return 'success';
                    } catch (error: any) {
                        return { error: error.message };
                    }
                },
                { context: { channelId: feedConfig.channelId, content } }
            );

            // Check if message was sent successfully
            const success = results.some(result => result === 'success');
            if (success) {
                // Update the last error message timestamp
                await FeedStorageService.updateLastErrorMessageAt(feedConfig.id);
                Logger.info(`[FeedPollJob] Sent error message for feed ${feedConfig.id}`);
            } else {
                Logger.warn(
                    `[FeedPollJob] Failed to send error message for feed ${feedConfig.id}: ${JSON.stringify(results)}`
                );
            }
        } catch (broadcastError: any) {
            Logger.error(
                `[FeedPollJob] Error sending feed error message for ${feedConfig.id}:`,
                broadcastError
            );
        }
    }

    /**
     * Sends a notification when a feed is auto-disabled due to persistent errors.
     */
    private async sendFeedDisabledNotification(
        feedConfig: FeedConfig,
        errorType: string,
        timePeriod: string
    ): Promise<void> {
        const feedName = feedConfig.nickname || feedConfig.url;
        const content = `🔴 **Feed Auto-Disabled**\n\nThe feed "${feedName}" has been automatically disabled because it has been consistently returning ${errorType} for more than ${timePeriod}.\n\n**Feed URL:** ${feedConfig.url}\n**Feed ID:** \`${feedConfig.id.substring(0, 8)}\`\n\n*The feed will no longer be polled. You can re-enable it with \`/feed edit\` if the issue is resolved.*`;

        try {
            const results = await this.manager.broadcastEval(
                async (client, context) => {
                    const { channelId, content } = context;
                    const channel = client.channels.cache.get(channelId);
                    if (!channel || !channel.isTextBased()) {
                        return null;
                    }

                    if (!('send' in channel)) {
                        return null;
                    }

                    try {
                        await channel.send(content);
                        return 'success';
                    } catch (error: any) {
                        return { error: error.message };
                    }
                },
                { context: { channelId: feedConfig.channelId, content } }
            );

            const success = results.some(result => result === 'success');
            if (success) {
                Logger.info(
                    `[FeedPollJob] Sent auto-disable notification for feed ${feedConfig.id}`
                );
            } else {
                Logger.warn(
                    `[FeedPollJob] Failed to send auto-disable notification for feed ${feedConfig.id}: ${JSON.stringify(results)}`
                );
            }
        } catch (broadcastError: any) {
            Logger.error(
                `[FeedPollJob] Error sending auto-disable notification for ${feedConfig.id}:`,
                broadcastError
            );
        }
    }
}
