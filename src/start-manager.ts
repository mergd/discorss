import { ShardingManager } from 'discord.js';
import { createRequire } from 'node:module';
import 'reflect-metadata';

import { GuildsController, ShardsController, StatsController } from './controllers/index.js';
import { FeedPollJob, Job, UpdateServerCountJob } from './jobs/index.js';
import { Api } from './models/api.js';
import { Manager } from './models/manager.js';
import { HttpService, JobService, Logger, MasterApiService } from './services/index.js';
import { JobRegistry } from './services/job-registry.js';
import { shutdownPostHog } from './utils/analytics.js';
import { env } from './utils/env.js';
import { MathUtils, ShardUtils } from './utils/index.js';

const require = createRequire(import.meta.url);
let Config = require('../config/config.json');
let Debug = require('../config/debug.json');
let Logs = require('../lang/logs.json');

// Load sensitive values from env
Config.client.id = env.DISCORD_CLIENT_ID;
Config.client.token = env.DISCORD_BOT_TOKEN;
Config.developers = env.DEVELOPER_IDS.split(',');

async function start(): Promise<void> {
    Logger.info(Logs.info.appStarted);

    // Dependencies
    let httpService = new HttpService();
    let masterApiService = new MasterApiService(httpService);
    if (Config.clustering.enabled) {
        await masterApiService.register();
    }

    // Sharding
    let shardList: number[];
    let totalShards: number;
    try {
        if (Config.clustering.enabled) {
            let resBody = await masterApiService.login();
            shardList = resBody.shardList;
            let requiredShards = await ShardUtils.requiredShardCount(Config.client.token);
            totalShards = Math.max(requiredShards, resBody.totalShards);
        } else {
            let recommendedShards = await ShardUtils.recommendedShardCount(
                Config.client.token,
                Config.sharding.serversPerShard
            );
            shardList = MathUtils.range(0, recommendedShards);
            totalShards = recommendedShards;
        }
    } catch (error) {
        Logger.error(Logs.error.retrieveShards, error);
        return;
    }

    if (shardList.length === 0) {
        Logger.warn(Logs.warn.managerNoShards);
        return;
    }

    let shardManager = new ShardingManager('dist/start-bot.js', {
        token: Config.client.token,
        mode: Debug.override.shardMode.enabled ? Debug.override.shardMode.value : 'process',
        respawn: true,
        totalShards,
        shardList,
    });

    // Jobs
    let feedPollJob = new FeedPollJob(shardManager);
    let jobs: Job[] = [
        Config.clustering.enabled ? undefined : new UpdateServerCountJob(shardManager, httpService),
        feedPollJob,
    ].filter(Boolean);

    // Register the FeedPollJob in the global registry for access from commands
    JobRegistry.getInstance().setFeedPollJob(feedPollJob);

    let manager = new Manager(shardManager, new JobService(jobs));

    // API
    let guildsController = new GuildsController(shardManager);
    let shardsController = new ShardsController(shardManager);
    let statsController = new StatsController(shardManager);
    let api = new Api([guildsController, shardsController, statsController]);

    // Start
    await manager.start();
    await api.start();
    if (Config.clustering.enabled) {
        await masterApiService.ready();
    }

    // Store instances for graceful shutdown
    let managerInstance = manager;
    let apiInstance = api;
    let masterApiServiceInstance = masterApiService;

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
        Logger.info(`[StartManager] Received ${signal}, starting graceful shutdown...`);
        try {
            if (Config.clustering.enabled && masterApiServiceInstance) {
                try {
                    await masterApiServiceInstance.unregister();
                } catch (error) {
                    Logger.error('[StartManager] Error unregistering from master API:', error);
                }
            }

            if (apiInstance) {
                try {
                    await apiInstance.stop();
                } catch (error) {
                    Logger.error('[StartManager] Error stopping API:', error);
                }
            }

            if (managerInstance) {
                await managerInstance.stop();
            }

            // Shutdown PostHog analytics
            await shutdownPostHog();

            // Close database connection
            const { closeDb } = await import('./db/index.js');
            await closeDb();

            // Reset RSS parser
            const { resetRSSParser } = await import('./utils/rss-parser.js');
            resetRSSParser();

            await new Promise(resolve => setTimeout(resolve, 1000));
            Logger.info('[StartManager] Graceful shutdown complete.');
            process.exit(0);
        } catch (error) {
            Logger.error('[StartManager] Error during shutdown:', error);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason, _promise) => {
    Logger.error(Logs.error.unhandledRejection, reason);
});

start().catch(error => {
    Logger.error(Logs.error.unspecified, error);
});
