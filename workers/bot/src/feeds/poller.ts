import { Analytics } from '../analytics.js';
import {
    BASE_MINUTES,
    CATEGORY_BACKOFF_COORDINATION_FACTOR,
    FAILURE_NOTIFICATION_THRESHOLD,
    FAILURE_QUIET_PERIOD_HOURS,
    getArchiveUrl,
    isPaywalled,
    MAX_ITEM_HOURS,
    MAX_ITEMS_PER_FEED,
    MAX_MINUTES,
} from '../constants.js';
import { DiscordRest, PERMISSION_ERROR_CODES, DiscordAPIError } from '../discord/rest.js';
import { ChannelTypes, MessageFlags } from '../discord/interaction.js';
import type { Env } from '../env.js';
import { FeedRuntimeConfig, FeedStorageService } from '../services/feed-storage.js';
import {
    isYouTubeFeed,
    isYouTubeLiveVideo,
    isYouTubeShortLink,
    shouldSkipYouTubeLivestreams,
    shouldSkipYouTubeShorts,
    truncate,
} from '../utils.js';
import { ParsedFeedItem, parseFeedUrl } from './rss.js';
import { fetchPageContent, summarizeContent } from './summarizer.js';

export class FeedPoller {
    constructor(
        private env: Env,
        private rest: DiscordRest,
        private analytics: Analytics
    ) {}

    /** Checks a single feed for new items and posts them. Queue-consumer entrypoint. */
    async checkFeed(feedId: string): Promise<void> {
        const feedConfig = await FeedStorageService.getFeedRuntimeById(feedId);
        if (!feedConfig || feedConfig.disabled) {
            return;
        }

        if (feedConfig.backoffUntil && new Date(feedConfig.backoffUntil) > new Date()) {
            return;
        }

        try {
            const fetchedFeed = await parseFeedUrl(feedConfig.url);

            await FeedStorageService.updateLastChecked(feedConfig.id);
            await FeedStorageService.clearBackoffUntil(feedConfig.id);

            if (!fetchedFeed.items || fetchedFeed.items.length === 0) {
                await FeedStorageService.clearFeedFailures(feedConfig.id);
                return;
            }

            const getIdentifier = (item: ParsedFeedItem): string | null =>
                item.guid || item.link || null;

            const lastKnownGuid = feedConfig.lastItemGuid;
            const knownRecentLinks = new Set(feedConfig.recentLinks || []);
            let latestItemGuid: string | null = null;
            const newItems: ParsedFeedItem[] = [];
            const maxTime = new Date(Date.now() - MAX_ITEM_HOURS * 60 * 60 * 1000);

            for (let i = 0; i < fetchedFeed.items.length; i++) {
                const item = fetchedFeed.items[i];
                const currentItemGuid = getIdentifier(item);

                let itemDate: Date | null = null;
                const dateString = item.isoDate || item.pubDate;
                if (dateString) {
                    const parsed = new Date(dateString);
                    if (!isNaN(parsed.getTime())) itemDate = parsed;
                }
                if (itemDate && itemDate < maxTime) continue;

                if (!currentItemGuid) continue;
                if (i === 0) latestItemGuid = currentItemGuid;

                if (shouldSkipYouTubeShorts(feedConfig) && isYouTubeShortLink(item.link)) {
                    continue;
                }

                if (
                    shouldSkipYouTubeLivestreams(feedConfig) &&
                    item.link &&
                    (await isYouTubeLiveVideo(item.link))
                ) {
                    console.log(
                        `[Poller] Skipping YouTube livestream for feed ${feedConfig.id}: ${item.link}`
                    );
                    continue;
                }

                if (lastKnownGuid && currentItemGuid === lastKnownGuid) break;
                if (!lastKnownGuid && i > 0) break;

                if (item.link && knownRecentLinks.has(item.link)) continue;

                newItems.push({ ...item });
                if (newItems.length >= MAX_ITEMS_PER_FEED) break;
            }

            if (latestItemGuid && latestItemGuid !== lastKnownGuid) {
                await FeedStorageService.updateLastItemGuid(feedConfig.id, latestItemGuid);
            }

            if (newItems.length === 0) {
                await FeedStorageService.clearFeedFailures(feedConfig.id);
                return;
            }

            await this.postNewItems(feedConfig, newItems.reverse());
        } catch (error: any) {
            await this.handleCheckError(feedConfig, error);
        }
    }

    private async handleCheckError(feedConfig: FeedRuntimeConfig, error: any): Promise<void> {
        const errorMessage = error?.message || 'Unknown fetch/parse error';
        console.warn(
            `[FeedPoller] Error checking feed ${feedConfig.id} (${feedConfig.url}): ${errorMessage}`
        );

        if (!feedConfig.ignoreErrors && !feedConfig.disableFailureNotifications) {
            await this.sendFeedErrorMessage(feedConfig, error, 'fetch');
        }

        try {
            await FeedStorageService.recordFailure(feedConfig.id, errorMessage);

            if (!feedConfig.ignoreErrors && !feedConfig.disabled && !isYouTubeFeed(feedConfig)) {
                if (await FeedStorageService.shouldAutoDisableDeadFeed(feedConfig.id)) {
                    await FeedStorageService.autoDisableFeed(
                        feedConfig.id,
                        `Feed has been returning 400-level errors for more than 3 days: ${feedConfig.url}`
                    );
                    await this.sendFeedDisabledNotification(feedConfig, '400-level errors', '3 days');
                } else if (
                    await FeedStorageService.shouldAutoDisableServerErrorFeed(feedConfig.id)
                ) {
                    await FeedStorageService.autoDisableFeed(
                        feedConfig.id,
                        `Feed has been returning 500+ errors for more than 1 week: ${feedConfig.url}`
                    );
                    await this.sendFeedDisabledNotification(
                        feedConfig,
                        '500+ server errors',
                        '1 week'
                    );
                }
            }

            await this.applyBackoffWithCategoryCoordination(feedConfig);
            await this.maybeNotifyFailureThreshold(feedConfig, error, false);
        } catch (dbError) {
            console.error(
                `[FeedPoller] Failed to record failure for feed ${feedConfig.id}:`,
                dbError
            );
        }

        await this.analytics.captureException(
            'system_feed_poll',
            'FeedPollCheckFeed',
            error,
            {
                feedId: feedConfig.id,
                feedUrl: feedConfig.url,
                guildId: feedConfig.guildId,
                channelId: feedConfig.channelId,
            },
            { guild: feedConfig.guildId }
        );
    }

    private async applyBackoffWithCategoryCoordination(
        feedConfig: FeedRuntimeConfig
    ): Promise<void> {
        const fails = (feedConfig.consecutiveFailures ?? 0) + 1;
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
                    const existingBackoff =
                        await FeedStorageService.getBackoffUntil(categoryFeedId);
                    if (!existingBackoff || coordinatedBackoffUntil > existingBackoff) {
                        await FeedStorageService.setBackoffUntil(
                            categoryFeedId,
                            coordinatedBackoffUntil
                        );
                    }
                }
            }
        }
    }

    private async maybeNotifyFailureThreshold(
        feedConfig: FeedRuntimeConfig,
        error: any,
        isPermissionError: boolean
    ): Promise<void> {
        if (feedConfig.ignoreErrors || feedConfig.disableFailureNotifications) return;

        const failureCountLast24h = await FeedStorageService.getFailureCountLast24h(feedConfig.id);
        if (failureCountLast24h !== FAILURE_NOTIFICATION_THRESHOLD) return;

        const lastNotified = await FeedStorageService.getLastFailureNotificationAt(feedConfig.id);
        const quietPeriodMs = FAILURE_QUIET_PERIOD_HOURS * 60 * 60 * 1000;
        if (lastNotified && Date.now() - new Date(lastNotified).getTime() <= quietPeriodMs) {
            return;
        }

        await this.notifyFeedFailure(feedConfig, error, failureCountLast24h, isPermissionError);
        await FeedStorageService.setLastFailureNotificationNow(feedConfig.id);
    }

    private async postNewItems(
        feedConfig: FeedRuntimeConfig,
        items: ParsedFeedItem[]
    ): Promise<void> {
        if (!items || items.length === 0) return;

        // Generate summaries first (if enabled)
        for (const item of items) {
            if (!feedConfig.summarize) continue;

            const skipYouTubeSummarization =
                isYouTubeFeed(feedConfig) ||
                item.link?.includes('youtube.com/watch') ||
                item.link?.includes('youtu.be/');
            if (skipYouTubeSummarization) {
                item.articleSummary = null;
                continue;
            }

            const sourceUrl = item.link || feedConfig.url;
            try {
                let articleContent: string | null = null;
                let commentsContent: string | null = null;

                if (item.link) {
                    const feedItemContent = item['content:encoded'] || item.content;
                    if (feedItemContent && feedItemContent.length > 200) {
                        articleContent = feedItemContent;
                    } else {
                        articleContent = await fetchPageContent(item.link);
                    }
                }
                if (item.comments && item.comments !== item.link) {
                    commentsContent = await fetchPageContent(item.comments);
                }

                if (articleContent || commentsContent) {
                    const effectiveLanguage = await FeedStorageService.getEffectiveLanguage(
                        feedConfig.id,
                        feedConfig.guildId
                    );
                    const summaries = await summarizeContent(
                        this.env,
                        this.analytics,
                        articleContent,
                        commentsContent,
                        sourceUrl,
                        effectiveLanguage,
                        feedConfig.guildId
                    );
                    item.articleSummary = summaries.articleSummary;
                    item.commentsSummary = summaries.commentsSummary;
                    item.articleReadTime = summaries.articleReadTime;
                } else {
                    item.articleSummary = 'Could not generate summary: No content fetched.';
                }
            } catch (fetchOrSummarizeError) {
                console.error(
                    `[FeedPoller] Error summarizing ${sourceUrl}:`,
                    fetchOrSummarizeError
                );
                if (!feedConfig.ignoreErrors && !feedConfig.disableFailureNotifications) {
                    await this.sendFeedErrorMessage(feedConfig, fetchOrSummarizeError, 'summary');
                }
                item.articleSummary = 'Could not generate summary: Error during processing.';
            }
        }

        // Validate the channel once up front
        const channel = await this.rest.getChannel(feedConfig.channelId);
        if (
            !channel ||
            (channel.type !== ChannelTypes.GuildText &&
                channel.type !== ChannelTypes.GuildAnnouncement)
        ) {
            console.warn(
                `[FeedPoller] Channel not found for feed ${feedConfig.id}. Deleting feed.`
            );
            await FeedStorageService.removeFeed(
                feedConfig.id,
                feedConfig.channelId,
                feedConfig.guildId
            );
            return;
        }

        const postedLinks: string[] = [];
        let firstPermissionError: DiscordAPIError | null = null;
        let firstOtherError: Error | null = null;
        let sentCount = 0;

        for (const item of items) {
            const contentToSend = formatItemMessage(feedConfig, item);
            const suppressEmbeds =
                messageHasArchiveLink(feedConfig, item) || feedConfig.suppressLinkPreview;

            try {
                await this.rest.createMessage(feedConfig.channelId, {
                    content: contentToSend,
                    allowed_mentions: { parse: [] },
                    flags: suppressEmbeds ? MessageFlags.SuppressEmbeds : undefined,
                });
                sentCount++;
                if (item.link) postedLinks.push(item.link);
            } catch (sendError) {
                console.error(
                    `[FeedPoller] Error sending item for feed ${feedConfig.id}:`,
                    sendError
                );
                if (
                    sendError instanceof DiscordAPIError &&
                    sendError.code &&
                    PERMISSION_ERROR_CODES.has(sendError.code)
                ) {
                    firstPermissionError = firstPermissionError ?? sendError;
                } else if (sendError instanceof Error) {
                    firstOtherError = firstOtherError ?? sendError;
                }
            }
        }

        if (postedLinks.length > 0) {
            await FeedStorageService.updateRecentLinks(feedConfig.id, [...new Set(postedLinks)]);
        }

        const allSucceeded = sentCount === items.length && !firstPermissionError && !firstOtherError;
        if (allSucceeded) {
            await FeedStorageService.clearFeedFailures(feedConfig.id);
            await FeedStorageService.clearLastFailureNotification(feedConfig.id);
        } else {
            const errorToReport =
                firstPermissionError || firstOtherError || new Error('Unknown send error');
            const failureReason = sentCount > 0 ? 'Partial send failure' : 'Total send failure';
            const errorMessage = `[FeedPoller] ${failureReason} for feed ${feedConfig.id}. Sent ${sentCount}/${items.length}. Last error: ${errorToReport.message}`;
            console.warn(errorMessage);

            await FeedStorageService.recordFailure(feedConfig.id, errorMessage);
            await this.maybeNotifyFailureThreshold(
                feedConfig,
                errorToReport,
                firstPermissionError !== null
            );
        }
    }

    private async notifyFeedFailure(
        feedConfig: FeedRuntimeConfig,
        error: any,
        failureCount: number,
        isPermissionError: boolean
    ): Promise<void> {
        if (isYouTubeFeed(feedConfig) || feedConfig.disableFailureNotifications) return;

        const reason = isPermissionError
            ? `Bot lacks permissions (e.g., Send Messages) in this channel (<#${feedConfig.channelId}>).`
            : `Failed to fetch, parse, or send feed content. Please check the URL (\`${feedConfig.url}\`) or the feed source.`;

        const baseDescription = `The feed subscription (<${feedConfig.url}>, ID: \`${feedConfig.id}\`) has failed ${failureCount} times in the last 24 hours.`;

        const pollSuggestion = !isPermissionError
            ? `\n\n**💡 Suggestion:** Consider increasing the poll frequency to reduce load on the feed source. Use \`/feed edit\` to adjust the frequency.`
            : '';

        const ignoreErrorsHint = `\n\n**🔇 Note:** You can disable notifications for this feed using \`/feed edit\`:\n• **Ignore Errors**: Disables all error messages\n• **Disable Failure Notifications**: Disables only these threshold alerts`;

        const errorMessageBlock = error?.message
            ? `\`\`\`\n${truncate(error.message, 1000)}\n\`\`\``
            : '';

        const embed = {
            color: 0xed4245, // red
            title: `🚨 Feed Error: ${truncate(feedConfig.nickname || feedConfig.url, 100, true)}`,
            description: `${baseDescription}\n\n**Reason:** ${reason}\n${errorMessageBlock}${pollSuggestion}${ignoreErrorsHint}\n\nNo further error notifications will be sent for this feed for ${FAILURE_QUIET_PERIOD_HOURS} hours.\nPlease use \`/feed remove\` if the feed is permanently broken or no longer needed.`,
            timestamp: new Date().toISOString(),
        };

        try {
            await this.rest.createMessage(feedConfig.channelId, { embeds: [embed] });
        } catch (sendError) {
            console.warn(
                `[FeedPoller] Failed to send failure notification for feed ${feedConfig.id}:`,
                sendError
            );
        }
    }

    private async sendFeedErrorMessage(
        feedConfig: FeedRuntimeConfig,
        error: any,
        errorType: 'fetch' | 'parse' | 'summary'
    ): Promise<void> {
        if (isYouTubeFeed(feedConfig)) return;

        // Skip transient errors — these resolve themselves
        const errorMsg = error?.message?.toLowerCase() || '';
        const isTransientError =
            errorMsg.includes('503') ||
            errorMsg.includes('502') ||
            errorMsg.includes('504') ||
            errorMsg.includes('timeout') ||
            errorMsg.includes('timed out') ||
            errorMsg.includes('econnreset') ||
            errorMsg.includes('econnrefused') ||
            errorMsg.includes('enotfound') ||
            errorMsg.includes('socket hang up') ||
            errorMsg.includes('network') ||
            errorMsg.includes('temporarily unavailable') ||
            errorMsg.includes('invalid character') ||
            errorMsg.includes('unexpected close tag') ||
            errorMsg.includes('non-whitespace before first tag');
        if (isTransientError) return;

        if (feedConfig.ignoreErrors || feedConfig.disableFailureNotifications) return;

        const canSend = await FeedStorageService.canSendErrorMessage(feedConfig.id, 6);
        if (!canSend) return;

        const errorTypeText = { fetch: 'fetching', parse: 'parsing', summary: 'summarizing' }[
            errorType
        ];
        const feedName = feedConfig.nickname || feedConfig.url;
        const errorMessage = error?.message
            ? ` (${error.message.substring(0, 100)}${error.message.length > 100 ? '...' : ''})`
            : '';

        const content = `⚠️ **Feed Error**\nThere was an issue ${errorTypeText} the feed "${feedName}"${errorMessage}.\n\n*This message is rate limited to once per six hours. The feed will continue trying automatically.*`;

        try {
            await this.rest.createMessage(feedConfig.channelId, { content });
            await FeedStorageService.updateLastErrorMessageAt(feedConfig.id);
        } catch (sendError) {
            console.warn(
                `[FeedPoller] Failed to send error message for feed ${feedConfig.id}:`,
                sendError
            );
        }
    }

    private async sendFeedDisabledNotification(
        feedConfig: FeedRuntimeConfig,
        errorType: string,
        timePeriod: string
    ): Promise<void> {
        const feedName = feedConfig.nickname || feedConfig.url;
        const content = `🔴 **Feed Auto-Disabled**\n\nThe feed "${feedName}" has been automatically disabled because it has been consistently returning ${errorType} for more than ${timePeriod}.\n\n**Feed URL:** ${feedConfig.url}\n**Feed ID:** \`${feedConfig.id.substring(0, 8)}\`\n\n*The feed will no longer be polled. You can re-enable it with \`/feed edit\` if the issue is resolved.*`;

        try {
            await this.rest.createMessage(feedConfig.channelId, { content });
        } catch (sendError) {
            console.warn(
                `[FeedPoller] Failed to send auto-disable notification for feed ${feedConfig.id}:`,
                sendError
            );
        }
    }
}

function messageHasArchiveLink(feedConfig: FeedRuntimeConfig, item: ParsedFeedItem): boolean {
    if (feedConfig.useArchiveLinks && item.link) return true;
    if (isPaywalled(item.link)) return true;
    if (item.comments && item.comments !== item.link) {
        if (feedConfig.useArchiveLinks || isPaywalled(item.comments)) return true;
    }
    return false;
}

export function formatItemMessage(feedConfig: FeedRuntimeConfig, item: ParsedFeedItem): string {
    const title = truncate(item.title || 'New Item', 150, true);
    const link = item.link;
    const author = item.creator || item.author;
    const authorText = author ? `\n*by ${truncate(author, 100, true)}*` : '';

    let dateTimestamp = '';
    const itemDateString = item.isoDate || item.pubDate;
    if (itemDateString) {
        const date = new Date(itemDateString);
        if (!isNaN(date.getTime())) {
            dateTimestamp = ` <t:${Math.floor(date.getTime() / 1000)}:R>`;
        }
    }

    let displayLink = link;
    if (displayLink?.includes('youtube.com/shorts/')) {
        displayLink = displayLink.replace('/shorts/', '/watch?v=');
    }
    let linkLine = displayLink ? displayLink : 'No link available.';
    const shouldShowArchive = feedConfig.useArchiveLinks || isPaywalled(link);
    if (link && shouldShowArchive) {
        linkLine += ` | [Archive](${getArchiveUrl(link)})`;
    }
    if (item.comments && item.comments !== link) {
        linkLine += ` | [Comments](${item.comments})`;
        if (feedConfig.useArchiveLinks || isPaywalled(item.comments)) {
            linkLine += ` ([Archive](${getArchiveUrl(item.comments)}))`;
        }
    }

    let contentToSend = `📰 | **${title}**${dateTimestamp}${authorText}\n${linkLine}`;

    const articleOk =
        item.articleSummary && !item.articleSummary.startsWith('Could not generate summary:');
    const commentsOk =
        item.commentsSummary && !item.commentsSummary.startsWith('Could not generate summary:');

    if (articleOk) {
        const readTimeText =
            item.articleReadTime && item.articleReadTime > 0
                ? ` (~${item.articleReadTime} min read)`
                : '';
        contentToSend += `\n\n**Article Summary${readTimeText}:**\n${truncate(item.articleSummary, 1500, true)}`;
    }
    if (commentsOk) {
        contentToSend += `\n\n**Comments Summary:**\n${truncate(item.commentsSummary, 1500, true)}`;
    }
    if (!articleOk && !commentsOk) {
        const errorMsg = item.articleSummary || item.commentsSummary;
        if (errorMsg) {
            contentToSend += `\n\n*(${errorMsg})*`;
        }
    }

    if (contentToSend.length > 2000) {
        contentToSend = contentToSend.substring(0, 1997) + '...';
    }
    return contentToSend;
}
