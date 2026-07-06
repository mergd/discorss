import {
    DEFAULT_FREQUENCY_MINUTES,
    MAX_FREQUENCY_MINUTES,
    MIN_FREQUENCY_MINUTES,
} from '../constants.js';
import type { Env, FeedQueueMessage } from '../env.js';
import { FeedPollConfig, FeedStorageService } from '../services/feed-storage.js';

function getEffectiveFrequency(
    feed: FeedPollConfig,
    categoryFrequencies: Map<string, number>
): number {
    if (feed.frequencyOverrideMinutes != null && feed.frequencyOverrideMinutes > 0) {
        return Math.max(
            MIN_FREQUENCY_MINUTES,
            Math.min(feed.frequencyOverrideMinutes, MAX_FREQUENCY_MINUTES)
        );
    }
    if (feed.category) {
        const freq = categoryFrequencies.get(`${feed.guildId}:${feed.category.toLowerCase()}`);
        if (freq !== undefined) {
            return Math.max(MIN_FREQUENCY_MINUTES, Math.min(freq, MAX_FREQUENCY_MINUTES));
        }
    }
    return DEFAULT_FREQUENCY_MINUTES;
}

/**
 * Cron entrypoint: selects feeds that are due (lastChecked + effective frequency
 * elapsed, not disabled, not in backoff) and enqueues them for the queue consumer.
 * Also runs periodic cleanup of old failure records (top of each hour).
 */
export async function scheduleDueFeeds(env: Env, scheduledTime: number): Promise<void> {
    const [allFeeds, allCategoryConfigs] = await Promise.all([
        FeedStorageService.getAllFeedsForPolling(),
        FeedStorageService.getAllCategoryConfigs(),
    ]);

    const categoryFrequencies = new Map<string, number>();
    for (const catConfig of allCategoryConfigs) {
        categoryFrequencies.set(
            `${catConfig.guildId}:${catConfig.name.toLowerCase()}`,
            catConfig.frequencyMinutes
        );
    }

    const now = Date.now();
    const due: FeedQueueMessage[] = [];
    for (const feed of allFeeds) {
        if (feed.backoffUntil && new Date(feed.backoffUntil).getTime() > now) continue;

        const frequencyMs =
            getEffectiveFrequency(feed, categoryFrequencies) * 60 * 1000;
        const lastChecked = feed.lastChecked ? new Date(feed.lastChecked).getTime() : 0;
        if (now - lastChecked >= frequencyMs) {
            due.push({ feedId: feed.id });
        }
    }

    console.log(`[Scheduler] ${due.length}/${allFeeds.length} feeds due for polling`);

    // sendBatch accepts at most 100 messages per call
    for (let i = 0; i < due.length; i += 100) {
        await env.FEED_QUEUE.sendBatch(
            due.slice(i, i + 100).map(body => ({ body, contentType: 'json' as const }))
        );
    }

    // Stamp lastChecked now so a check that outlives one cron interval is not
    // enqueued twice (which would double-post items).
    await FeedStorageService.markPolled(due.map(m => m.feedId));

    // Hourly maintenance
    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate.getMinutes() === 0) {
        const deleted = await FeedStorageService.cleanupOldFailures(7);
        if (deleted > 0) {
            console.log(`[Scheduler] Cleaned up ${deleted} old failure records`);
        }
    }
}
