import type { FeedQueueMessage } from '../env.js';

// One queue message replaces the previous five-message consumer batch.
const FEEDS_PER_MESSAGE = 5;

export function groupFeedChecks(feedIds: string[]): FeedQueueMessage[] {
    const messages: FeedQueueMessage[] = [];
    for (let i = 0; i < feedIds.length; i += FEEDS_PER_MESSAGE) {
        messages.push({ feedIds: feedIds.slice(i, i + FEEDS_PER_MESSAGE) });
    }
    return messages;
}

export async function consumeFeedChecks(
    batch: MessageBatch<FeedQueueMessage>,
    checkFeed: (feedId: string) => Promise<void>
): Promise<void> {
    for (const message of batch.messages) {
        // Accept single-feed messages queued before this deployment.
        const feedIds = 'feedIds' in message.body ? message.body.feedIds : [message.body.feedId];
        for (const feedId of feedIds) {
            try {
                await checkFeed(feedId);
            } catch (error) {
                // The poller records failures and backoff; replaying the group could double-post.
                console.error(`[Queue] Unexpected error for feed ${feedId}:`, error);
            }
        }
        message.ack();
    }
}
