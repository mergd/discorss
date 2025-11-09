import { desc, eq } from 'drizzle-orm';
import { db, feedFailures, feeds } from '../db/index.js';

async function analyzeFeedFailures() {
    try {
        console.log('Querying last 30 feed failures...\n');

        const failures = await db
            .select({
                failureId: feedFailures.id,
                timestamp: feedFailures.timestamp,
                errorMessage: feedFailures.errorMessage,
                feedId: feedFailures.feedId,
                feedUrl: feeds.url,
                feedNickname: feeds.nickname,
                guildId: feeds.guildId,
                channelId: feeds.channelId,
                consecutiveFailures: feeds.consecutiveFailures,
                ignoreErrors: feeds.ignoreErrors,
            })
            .from(feedFailures)
            .innerJoin(feeds, eq(feedFailures.feedId, feeds.id))
            .orderBy(desc(feedFailures.timestamp))
            .limit(30);

        if (failures.length === 0) {
            console.log('No feed failures found in the database.');
            return;
        }

        console.log(`Found ${failures.length} failures:\n`);
        console.log('='.repeat(80));

        const errorPatterns: Map<string, number> = new Map();
        const feedErrorCounts: Map<string, number> = new Map();
        const guildErrorCounts: Map<string, number> = new Map();

        failures.forEach((failure, index) => {
            console.log(`\n[${index + 1}] Failure ID: ${failure.failureId}`);
            console.log(`  Timestamp: ${failure.timestamp}`);
            console.log(`  Feed ID: ${failure.feedId}`);
            console.log(`  Feed URL: ${failure.feedUrl}`);
            console.log(`  Nickname: ${failure.feedNickname || '(none)'}`);
            console.log(`  Guild ID: ${failure.guildId}`);
            console.log(`  Channel ID: ${failure.channelId}`);
            console.log(`  Consecutive Failures: ${failure.consecutiveFailures}`);
            console.log(`  Ignore Errors: ${failure.ignoreErrors}`);
            console.log(`  Error Message: ${failure.errorMessage || '(no message)'}`);

            const errorMsg = failure.errorMessage || 'Unknown error';
            const errorType = categorizeError(errorMsg);
            errorPatterns.set(errorType, (errorPatterns.get(errorType) || 0) + 1);

            const feedKey = `${failure.feedUrl} (${failure.feedId})`;
            feedErrorCounts.set(feedKey, (feedErrorCounts.get(feedKey) || 0) + 1);

            guildErrorCounts.set(failure.guildId, (guildErrorCounts.get(failure.guildId) || 0) + 1);
        });

        console.log('\n' + '='.repeat(80));
        console.log('\nERROR PATTERN ANALYSIS:');
        console.log('-'.repeat(80));
        const sortedPatterns = Array.from(errorPatterns.entries()).sort((a, b) => b[1] - a[1]);
        sortedPatterns.forEach(([pattern, count]) => {
            console.log(`  ${pattern}: ${count} occurrence(s)`);
        });

        console.log('\n' + '='.repeat(80));
        console.log('\nFEEDS WITH MOST FAILURES:');
        console.log('-'.repeat(80));
        const sortedFeeds = Array.from(feedErrorCounts.entries()).sort((a, b) => b[1] - a[1]);
        sortedFeeds.slice(0, 10).forEach(([feed, count]) => {
            console.log(`  ${feed}: ${count} failure(s)`);
        });

        console.log('\n' + '='.repeat(80));
        console.log('\nGUILDS WITH MOST FAILURES:');
        console.log('-'.repeat(80));
        const sortedGuilds = Array.from(guildErrorCounts.entries()).sort((a, b) => b[1] - a[1]);
        sortedGuilds.slice(0, 10).forEach(([guildId, count]) => {
            console.log(`  ${guildId}: ${count} failure(s)`);
        });

        console.log('\n' + '='.repeat(80));
        console.log('\nRECOMMENDATIONS:');
        console.log('-'.repeat(80));

        const networkErrors = sortedPatterns.filter(([p]) =>
            p.toLowerCase().includes('network') || p.toLowerCase().includes('timeout') || p.toLowerCase().includes('fetch')
        );
        const parseErrors = sortedPatterns.filter(([p]) =>
            p.toLowerCase().includes('parse') || p.toLowerCase().includes('xml') || p.toLowerCase().includes('invalid')
        );
        const authErrors = sortedPatterns.filter(([p]) =>
            p.toLowerCase().includes('401') || p.toLowerCase().includes('403') || p.toLowerCase().includes('unauthorized') || p.toLowerCase().includes('forbidden')
        );

        if (networkErrors.length > 0) {
            console.log('  ⚠️  Network/timeout errors detected. Consider:');
            console.log('     - Increasing timeout values');
            console.log('     - Adding retry logic with exponential backoff');
            console.log('     - Checking if feeds are down or blocking requests');
        }

        if (parseErrors.length > 0) {
            console.log('  ⚠️  Parse errors detected. Consider:');
            console.log('     - Validating RSS feed format');
            console.log('     - Adding better error messages with feed URL');
            console.log('     - Checking if feed format changed');
        }

        if (authErrors.length > 0) {
            console.log('  ⚠️  Authentication errors detected. Consider:');
            console.log('     - Checking if feeds require authentication');
            console.log('     - Verifying API keys or tokens');
        }

        const feedsWithManyFailures = sortedFeeds.filter(([, count]) => count >= 3);
        if (feedsWithManyFailures.length > 0) {
            console.log(`  ⚠️  ${feedsWithManyFailures.length} feed(s) have 3+ failures. Consider disabling or investigating.`);
        }

        console.log('\n  ✅ Consider adding a command to view errors:');
        console.log('     /feed errors [feed_id] [guild_id]');
        console.log('     This would help users debug issues faster.');

    } catch (error) {
        console.error('Error analyzing feed failures:', error);
        throw error;
    } finally {
        await db.$client.end();
    }
}

function categorizeError(errorMessage: string): string {
    const msg = errorMessage.toLowerCase();

    if (msg.includes('timeout') || msg.includes('timed out')) {
        return 'Timeout';
    }
    if (msg.includes('status code 410')) {
        return 'Gone (410)';
    }
    if (msg.includes('status code 404') || msg.includes('not found')) {
        return 'Not Found (404)';
    }
    if (msg.includes('status code 500')) {
        return 'Server Error (500)';
    }
    if (msg.includes('status code 401') || msg.includes('unauthorized')) {
        return 'Authentication Error (401)';
    }
    if (msg.includes('status code 403') || msg.includes('forbidden')) {
        return 'Permission Error (403)';
    }
    if (msg.includes('status code 429') || msg.includes('rate limit')) {
        return 'Rate Limit (429)';
    }
    if (msg.includes('unexpected close tag') || msg.includes('invalid character in entity name') || msg.includes('attribute without value')) {
        return 'XML Parse Error';
    }
    if (msg.includes('unable to parse xml') || msg.includes('feed not recognized')) {
        return 'Invalid Feed Format';
    }
    if (msg.includes('network') || msg.includes('econnreset') || msg.includes('enotfound')) {
        return 'Network Error';
    }
    if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
        return 'SSL/TLS Error';
    }

    return 'Other/Unknown';
}

analyzeFeedFailures().catch(console.error);

