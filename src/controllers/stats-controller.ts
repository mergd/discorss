import { ShardingManager } from 'discord.js';
import { Request, Response, Router } from 'express';
import router from 'express-promise-router';
import { createRequire } from 'node:module';
import { sql, count, desc, eq, gte } from 'drizzle-orm';

import { Controller } from './index.js';
import { db } from '../db/index.js';
import { feeds, feedFailures } from '../db/schema.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

interface AppStats {
    totalFeeds: number;
    activeFeeds: number;
    feedsWithFailures: number;
    totalFailuresLast24h: number;
    totalFailuresLast7d: number;
    averageFailuresPerFeed: number;
    feedsInBackoff: number;
    guilds: number;
    shards: {
        total: number;
        ready: number;
    };
    topFailingFeeds: Array<{
        id: string;
        url: string;
        nickname?: string;
        consecutiveFailures: number;
        failuresLast24h: number;
        lastChecked?: string;
    }>;
    recentFailures: Array<{
        feedId: string;
        feedUrl: string;
        feedNickname?: string;
        timestamp: string;
        errorMessage?: string;
    }>;
}

export class StatsController implements Controller {
    public path = '/stats';
    public router: Router = router();
    public authToken: string = Config.api.secret;

    constructor(private shardManager: ShardingManager) {}

    public register(): void {
        this.router.get('/', (req, res) => this.getStats(req, res));
        this.router.get('/text', (req, res) => this.getStatsText(req, res));
        this.router.get('/html', (req, res) => this.getStatsHtml(req, res));
    }

    private async getStats(req: Request, res: Response): Promise<void> {
        const stats = await this.gatherStats();
        res.status(200).json(stats);
    }

    private async getStatsText(req: Request, res: Response): Promise<void> {
        const stats = await this.gatherStats();
        const textOutput = this.formatStatsAsText(stats);
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(textOutput);
    }

    private async getStatsHtml(req: Request, res: Response): Promise<void> {
        const stats = await this.gatherStats();
        const htmlOutput = this.formatStatsAsHtml(stats);
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(htmlOutput);
    }

    private async gatherStats(): Promise<AppStats> {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Basic feed counts
        const [totalFeedsResult] = await db.select({ count: count() }).from(feeds);
        const totalFeeds = totalFeedsResult.count;

        const [activeFeedsResult] = await db
            .select({ count: count() })
            .from(feeds)
            .where(eq(feeds.consecutiveFailures, 0));
        const activeFeeds = activeFeedsResult.count;

        const [feedsWithFailuresResult] = await db
            .select({ count: count() })
            .from(feeds)
            .where(sql`${feeds.consecutiveFailures} > 0`);
        const feedsWithFailures = feedsWithFailuresResult.count;

        const [feedsInBackoffResult] = await db
            .select({ count: count() })
            .from(feeds)
            .where(sql`${feeds.backoffUntil} > ${now}`);
        const feedsInBackoff = feedsInBackoffResult.count;

        // Failure counts
        const [failuresLast24hResult] = await db
            .select({ count: count() })
            .from(feedFailures)
            .where(gte(feedFailures.timestamp, last24h));
        const totalFailuresLast24h = failuresLast24hResult.count;

        const [failuresLast7dResult] = await db
            .select({ count: count() })
            .from(feedFailures)
            .where(gte(feedFailures.timestamp, last7d));
        const totalFailuresLast7d = failuresLast7dResult.count;

        const averageFailuresPerFeed = totalFeeds > 0 ? totalFailuresLast24h / totalFeeds : 0;

        // Top failing feeds
        const topFailingFeeds = await db
            .select({
                id: feeds.id,
                url: feeds.url,
                nickname: feeds.nickname,
                consecutiveFailures: feeds.consecutiveFailures,
                lastChecked: feeds.lastChecked,
            })
            .from(feeds)
            .where(sql`${feeds.consecutiveFailures} > 0`)
            .orderBy(desc(feeds.consecutiveFailures))
            .limit(10);

        // Get failure counts for top failing feeds
        const topFailingFeedsWithCounts = await Promise.all(
            topFailingFeeds.map(async feed => {
                const [failureCount] = await db
                    .select({ count: count() })
                    .from(feedFailures)
                    .where(sql`${feedFailures.feedId} = ${feed.id} AND ${feedFailures.timestamp} >= ${last24h}`);

                return {
                    ...feed,
                    failuresLast24h: failureCount.count,
                    lastChecked: feed.lastChecked?.toISOString(),
                };
            })
        );

        // Recent failures
        const recentFailures = await db
            .select({
                feedId: feedFailures.feedId,
                feedUrl: feeds.url,
                feedNickname: feeds.nickname,
                timestamp: feedFailures.timestamp,
                errorMessage: feedFailures.errorMessage,
            })
            .from(feedFailures)
            .innerJoin(feeds, eq(feedFailures.feedId, feeds.id))
            .orderBy(desc(feedFailures.timestamp))
            .limit(20);

        // Discord stats
        const guilds = await this.getGuildCount();
        const shardStats = await this.getShardStats();

        return {
            totalFeeds,
            activeFeeds,
            feedsWithFailures,
            totalFailuresLast24h,
            totalFailuresLast7d,
            averageFailuresPerFeed: Math.round(averageFailuresPerFeed * 100) / 100,
            feedsInBackoff,
            guilds,
            shards: shardStats,
            topFailingFeeds: topFailingFeedsWithCounts,
            recentFailures: recentFailures.map(failure => ({
                ...failure,
                timestamp: failure.timestamp.toISOString(),
            })),
        };
    }

    private async getGuildCount(): Promise<number> {
        try {
            const guilds: string[] = [
                ...new Set(
                    (
                        await this.shardManager.broadcastEval(client => [...client.guilds.cache.keys()])
                    ).flat()
                ),
            ];
            return guilds.length;
        } catch (error) {
            return 0;
        }
    }

    private async getShardStats(): Promise<{ total: number; ready: number }> {
        try {
            const shardStatuses = await this.shardManager.broadcastEval(client => client.ws.status);
            const totalShards = shardStatuses.length;
            const readyShards = shardStatuses.filter(status => status === 0).length; // 0 = READY
            
            return {
                total: totalShards,
                ready: readyShards,
            };
        } catch (error) {
            return {
                total: 0,
                ready: 0,
            };
        }
    }

    private formatStatsAsText(stats: AppStats): string {
        const lines: string[] = [];
        
        lines.push('═══════════════════════════════════════════');
        lines.push('           DISCORSS BOT STATS');
        lines.push('═══════════════════════════════════════════');
        lines.push('');
        
        // Overview
        lines.push('📊 OVERVIEW');
        lines.push('─────────────────────────────────────────');
        lines.push(`Total Feeds:              ${stats.totalFeeds.toLocaleString()}`);
        lines.push(`Active Feeds:             ${stats.activeFeeds.toLocaleString()}`);
        lines.push(`Feeds with Failures:      ${stats.feedsWithFailures.toLocaleString()}`);
        lines.push(`Feeds in Backoff:         ${stats.feedsInBackoff.toLocaleString()}`);
        lines.push(`Discord Guilds:           ${stats.guilds.toLocaleString()}`);
        lines.push(`Shards:                   ${stats.shards.ready}/${stats.shards.total} ready`);
        lines.push('');

        // Failure stats
        lines.push('⚠️  FAILURE STATISTICS');
        lines.push('─────────────────────────────────────────');
        lines.push(`Failures (Last 24h):     ${stats.totalFailuresLast24h.toLocaleString()}`);
        lines.push(`Failures (Last 7d):      ${stats.totalFailuresLast7d.toLocaleString()}`);
        lines.push(`Avg Failures per Feed:   ${stats.averageFailuresPerFeed}`);
        lines.push('');

        // Top failing feeds
        if (stats.topFailingFeeds.length > 0) {
            lines.push('🔥 TOP FAILING FEEDS');
            lines.push('─────────────────────────────────────────');
            stats.topFailingFeeds.forEach((feed, index) => {
                const name = feed.nickname || feed.url.substring(0, 50) + (feed.url.length > 50 ? '...' : '');
                const lastChecked = feed.lastChecked 
                    ? new Date(feed.lastChecked).toLocaleString()
                    : 'Never';
                lines.push(`${(index + 1).toString().padStart(2)}. ${name}`);
                lines.push(`    Consecutive: ${feed.consecutiveFailures}, 24h: ${feed.failuresLast24h}`);
                lines.push(`    Last Checked: ${lastChecked}`);
                lines.push(`    URL: ${feed.url}`);
                lines.push('');
            });
        }

        // Recent failures
        if (stats.recentFailures.length > 0) {
            lines.push('🕒 RECENT FAILURES (Last 20)');
            lines.push('─────────────────────────────────────────');
            stats.recentFailures.forEach(failure => {
                const name = failure.feedNickname || failure.feedUrl.substring(0, 40) + (failure.feedUrl.length > 40 ? '...' : '');
                const timestamp = new Date(failure.timestamp).toLocaleString();
                const error = failure.errorMessage ? ` - ${failure.errorMessage.substring(0, 100)}${failure.errorMessage.length > 100 ? '...' : ''}` : '';
                lines.push(`${timestamp} | ${name}${error}`);
            });
        }

        lines.push('');
        lines.push('═══════════════════════════════════════════');
        lines.push(`Generated: ${new Date().toLocaleString()}`);
        lines.push('═══════════════════════════════════════════');

        return lines.join('\n');
    }

    private formatStatsAsHtml(stats: AppStats): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Discorss Bot Stats</title>
    <style>
        body {
            font-family: 'Courier New', monospace;
            background: #1e1e1e;
            color: #d4d4d4;
            margin: 0;
            padding: 20px;
            line-height: 1.4;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: #569cd6;
            text-align: center;
            border-bottom: 2px solid #569cd6;
            padding-bottom: 10px;
        }
        .section {
            background: #252526;
            border: 1px solid #3c3c3c;
            border-radius: 4px;
            margin: 20px 0;
            padding: 15px;
        }
        .section h2 {
            color: #4ec9b0;
            margin-top: 0;
            border-bottom: 1px solid #3c3c3c;
            padding-bottom: 5px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
            margin: 10px 0;
        }
        .stat-item {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
        }
        .stat-label {
            color: #9cdcfe;
        }
        .stat-value {
            color: #b5cea8;
            font-weight: bold;
        }
        .feed-item {
            background: #2d2d30;
            border: 1px solid #3c3c3c;
            border-radius: 3px;
            padding: 10px;
            margin: 5px 0;
        }
        .feed-name {
            color: #dcdcaa;
            font-weight: bold;
        }
        .feed-url {
            color: #9cdcfe;
            font-size: 0.9em;
            word-break: break-all;
        }
        .feed-details {
            color: #ce9178;
            font-size: 0.9em;
            margin-top: 5px;
        }
        .failure-item {
            background: #2d2d30;
            border-left: 3px solid #f44747;
            padding: 8px 12px;
            margin: 3px 0;
            font-size: 0.9em;
        }
        .failure-timestamp {
            color: #569cd6;
        }
        .failure-feed {
            color: #dcdcaa;
        }
        .failure-error {
            color: #f44747;
            margin-top: 3px;
        }
        .refresh-info {
            text-align: center;
            color: #6a9955;
            font-size: 0.9em;
            margin-top: 20px;
        }
        .auto-refresh {
            background: #0e639c;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin: 10px 5px;
        }
        .auto-refresh:hover {
            background: #1177bb;
        }
        .auto-refresh.active {
            background: #f44747;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 Discorss Bot Statistics</h1>
        
        <div style="text-align: center; margin-bottom: 20px;">
            <button id="refreshBtn" class="auto-refresh" onclick="location.reload()">🔄 Refresh Now</button>
            <button id="autoRefreshBtn" class="auto-refresh" onclick="toggleAutoRefresh()">⏱️ Auto Refresh: OFF</button>
        </div>

        <div class="section">
            <h2>📊 Overview</h2>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Total Feeds:</span>
                    <span class="stat-value">${stats.totalFeeds.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Active Feeds:</span>
                    <span class="stat-value">${stats.activeFeeds.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Feeds with Failures:</span>
                    <span class="stat-value">${stats.feedsWithFailures.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Feeds in Backoff:</span>
                    <span class="stat-value">${stats.feedsInBackoff.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Discord Guilds:</span>
                    <span class="stat-value">${stats.guilds.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Shards:</span>
                    <span class="stat-value">${stats.shards.ready}/${stats.shards.total}</span>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>⚠️ Failure Statistics</h2>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Failures (Last 24h):</span>
                    <span class="stat-value">${stats.totalFailuresLast24h.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Failures (Last 7d):</span>
                    <span class="stat-value">${stats.totalFailuresLast7d.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg Failures per Feed:</span>
                    <span class="stat-value">${stats.averageFailuresPerFeed}</span>
                </div>
            </div>
        </div>

        ${stats.topFailingFeeds.length > 0 ? `
        <div class="section">
            <h2>🔥 Top Failing Feeds</h2>
            ${stats.topFailingFeeds.map((feed, index) => {
                const name = feed.nickname || feed.url.substring(0, 60) + (feed.url.length > 60 ? '...' : '');
                const lastChecked = feed.lastChecked 
                    ? new Date(feed.lastChecked).toLocaleString()
                    : 'Never';
                return `
                <div class="feed-item">
                    <div class="feed-name">${index + 1}. ${name}</div>
                    <div class="feed-details">
                        Consecutive: ${feed.consecutiveFailures} | 24h Failures: ${feed.failuresLast24h} | Last Checked: ${lastChecked}
                    </div>
                    <div class="feed-url">${feed.url}</div>
                </div>`;
            }).join('')}
        </div>
        ` : ''}

        ${stats.recentFailures.length > 0 ? `
        <div class="section">
            <h2>🕒 Recent Failures (Last 20)</h2>
            ${stats.recentFailures.map(failure => {
                const name = failure.feedNickname || failure.feedUrl.substring(0, 40) + (failure.feedUrl.length > 40 ? '...' : '');
                const timestamp = new Date(failure.timestamp).toLocaleString();
                const error = failure.errorMessage || '';
                return `
                <div class="failure-item">
                    <div>
                        <span class="failure-timestamp">${timestamp}</span> | 
                        <span class="failure-feed">${name}</span>
                    </div>
                    ${error ? `<div class="failure-error">${error}</div>` : ''}
                </div>`;
            }).join('')}
        </div>
        ` : ''}

        <div class="refresh-info">
            Generated: ${new Date().toLocaleString()}
        </div>
    </div>

    <script>
        let autoRefreshInterval = null;
        let autoRefreshEnabled = false;

        function toggleAutoRefresh() {
            const btn = document.getElementById('autoRefreshBtn');
            
            if (autoRefreshEnabled) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
                autoRefreshEnabled = false;
                btn.textContent = '⏱️ Auto Refresh: OFF';
                btn.classList.remove('active');
            } else {
                autoRefreshInterval = setInterval(() => {
                    location.reload();
                }, 30000); // Refresh every 30 seconds
                autoRefreshEnabled = true;
                btn.textContent = '⏱️ Auto Refresh: ON (30s)';
                btn.classList.add('active');
            }
        }

        // Keyboard shortcut: R to refresh
        document.addEventListener('keydown', function(e) {
            if (e.key === 'r' || e.key === 'R') {
                if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    location.reload();
                }
            }
        });
    </script>
</body>
</html>`;
    }
}
