import * as dotenv from 'dotenv';
import { FeedStorageService } from '../services/feed-storage-service.js';

dotenv.config({ path: '.env' });

const GUILD_ID = '781679792121708556';
const ADDED_BY = process.env.DEVELOPER_IDS?.split(',')[0] || 'system-restore';

const FEEDS_TO_RESTORE = [
    {
        url: 'https://semafor.com/rss.xml',
        nickname: 'Semafor',
        channelId: '1360884155390496778',
        summarize: true,
    },
    {
        url: 'https://hnrss.org/newest?points=100',
        nickname: 'Hacker News',
        channelId: '1368835925597224970',
        summarize: true,
    },
    {
        url: 'https://hnrss.org/newest?points=100',
        nickname: 'Hacker News',
        channelId: '1192527354396954687',
        summarize: true,
    },
    {
        url: 'https://mattlakeman.org/feed/',
        nickname: 'Matt Lakeman',
        channelId: '781679792667492375',
        summarize: false,
    },
    {
        url: 'https://status.cursor.com/history.rss',
        nickname: 'Cursor Status',
        channelId: '781679792667492375',
        summarize: false,
    },
    {
        url: 'https://www.joshwcomeau.com/rss.xml',
        nickname: 'Josh Comeau',
        channelId: '781679792667492375',
        summarize: false,
    },
] as const;

async function main() {
    console.log(`Restoring news feeds for guild ${GUILD_ID}...\n`);

    let added = 0;
    let skipped = 0;

    for (const feed of FEEDS_TO_RESTORE) {
        try {
            const id = await FeedStorageService.addFeed({
                url: feed.url,
                nickname: feed.nickname,
                channelId: feed.channelId,
                guildId: GUILD_ID,
                addedBy: ADDED_BY,
                summarize: feed.summarize,
                useArchiveLinks: false,
            });
            console.log(`✅ Added ${feed.nickname} → <#${feed.channelId}> (${id})`);
            added++;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('already exists')) {
                console.log(`⏭️  Skipped ${feed.nickname} in <#${feed.channelId}> (already exists)`);
                skipped++;
            } else {
                console.error(`❌ Failed ${feed.nickname}: ${message}`);
            }
        }
    }

    console.log(`\nDone. Added ${added}, skipped ${skipped}.`);
    process.exit(0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
