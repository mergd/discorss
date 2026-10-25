import { expect, mock, spyOn, test } from 'bun:test';

import type { FeedQueueMessage } from '../env.js';
import { consumeFeedChecks, groupFeedChecks } from './queue.js';

function delivery(body: FeedQueueMessage) {
    return { body, ack: mock(() => {}) };
}

async function consume(
    messages: ReturnType<typeof delivery>[],
    checkFeed: (feedId: string) => Promise<void>
) {
    await consumeFeedChecks({ messages } as unknown as MessageBatch<FeedQueueMessage>, checkFeed);
}

test('groups all feed checks into bounded messages, including a partial final group', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `feed-${i}`);
    const messages = groupFeedChecks(ids);
    expect(messages).toEqual([
        { feedIds: ids.slice(0, 5) },
        { feedIds: ids.slice(5, 10) },
        { feedIds: ids.slice(10) },
    ]);
    expect(groupFeedChecks([])).toEqual([]);
});

test('consumes old and grouped messages during rollout without dropping feed checks', async () => {
    const messages = [delivery({ feedId: 'old' }), delivery({ feedIds: ['new-1', 'new-2'] })];
    const checked: string[] = [];
    await consume(messages, async id => {
        checked.push(id);
    });
    expect(checked).toEqual(['old', 'new-1', 'new-2']);
    for (const message of messages) expect(message.ack).toHaveBeenCalledTimes(1);
});

test('a failed feed does not skip later feeds or replay successful feeds', async () => {
    const messages = [delivery({ feedIds: ['first', 'broken', 'last'] })];
    const checked: string[] = [];
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
        await consume(messages, async id => {
            checked.push(id);
            if (id === 'broken') throw new Error('feed failed');
        });
        expect(checked).toEqual(['first', 'broken', 'last']);
        expect(messages[0]!.ack).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(1);
    } finally {
        log.mockRestore();
    }
});
