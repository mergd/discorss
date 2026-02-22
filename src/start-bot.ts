import { REST } from '@discordjs/rest';
import { Options, Partials } from 'discord.js';
import { createRequire } from 'node:module';
import { shutdownPostHog } from './utils/analytics.js';
import { env } from './utils/env.js';

import { Button } from './buttons/index.js';
import {
    DevCommand,
    HelpCommand,
    InfoCommand,
    CategoryCommand,
    FeedCommand,
    FeedbackCommand,
    ReleaseNotesCommand,
    ServerCountCommand,
} from './commands/chat/index.js';
import {
    ChatCommandMetadata,
    Command,
    MessageCommandMetadata,
    UserCommandMetadata,
} from './commands/index.js';
import { ViewDateSent } from './commands/message/index.js';
import { ViewDateJoined } from './commands/user/index.js';
import {
    ButtonHandler,
    CommandHandler,
    GuildJoinHandler,
    GuildLeaveHandler,
    MessageHandler,
    ReactionHandler,
    TriggerHandler,
} from './events/index.js';
import { CustomClient } from './extensions/index.js';
import { FeedPollJob, Job } from './jobs/index.js';
import { Api } from './models/api.js';
import { Bot } from './models/bot.js';
import { ServerCountController } from './controllers/index.js';
import { Reaction } from './reactions/index.js';
import { JobRegistry } from './services/job-registry.js';
import {
    CommandRegistrationService,
    EventDataService,
    JobService,
    Logger,
} from './services/index.js';
import { Trigger } from './triggers/index.js';
import { SingleClientBroadcast } from './utils/single-client-broadcast.js';

const require = createRequire(import.meta.url);
let Config = require('../config/config.json');
let Logs = require('../lang/logs.json');

// Load sensitive values from env
Config.client.id = env.DISCORD_CLIENT_ID;
Config.client.token = env.DISCORD_BOT_TOKEN;
Config.developers = env.DEVELOPER_IDS.split(',');

async function start(): Promise<void> {
    // Services
    let eventDataService = new EventDataService();

    // Client
    let client = new CustomClient({
        intents: Config.client.intents,
        partials: (Config.client.partials as string[]).map(partial => Partials[partial]),
        makeCache: Options.cacheWithLimits({
            // Keep default caching behavior
            ...Options.DefaultMakeCacheSettings,
            // Override specific options from config
            ...Config.client.caches,
        }),
    });

    // Commands
    let commands: Command[] = [
        // Chat Commands
        new DevCommand(),
        new HelpCommand(),
        new InfoCommand(),
        new ServerCountCommand(),
        new FeedbackCommand(),
        new ReleaseNotesCommand(),
        new FeedCommand(),
        new CategoryCommand(),
    ];

    // Buttons
    let buttons: Button[] = [];

    // Reactions
    let reactions: Reaction[] = [];

    // Triggers
    let triggers: Trigger[] = [];

    // Event handlers
    let guildJoinHandler = new GuildJoinHandler(eventDataService);
    let guildLeaveHandler = new GuildLeaveHandler();
    let commandHandler = new CommandHandler(commands, eventDataService);
    let buttonHandler = new ButtonHandler(buttons, eventDataService);
    let triggerHandler = new TriggerHandler(triggers, eventDataService);
    let messageHandler = new MessageHandler(triggerHandler);
    let reactionHandler = new ReactionHandler(reactions, eventDataService);

    // Jobs
    const singleClientBroadcast = new SingleClientBroadcast(client);
    const feedPollJob = new FeedPollJob(singleClientBroadcast);
    JobRegistry.getInstance().setFeedPollJob(feedPollJob);
    let jobs: Job[] = [feedPollJob];

    // Bot
    let bot = new Bot(
        Config.client.token,
        client,
        guildJoinHandler,
        guildLeaveHandler,
        messageHandler,
        commandHandler,
        buttonHandler,
        reactionHandler,
        new JobService(jobs)
    );

    // Register
    if (process.argv[2] == 'commands') {
        try {
            let rest = new REST({ version: '10' }).setToken(Config.client.token);
            let commandRegistrationService = new CommandRegistrationService(rest);
            let localCmds = [
                ...Object.values(ChatCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
                ...Object.values(MessageCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
                ...Object.values(UserCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
            ];
            await commandRegistrationService.process(localCmds, process.argv);
        } catch (error) {
            Logger.error(Logs.error.commandAction, error);
        }
        // Wait for any final logs to be written.
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit();
    }

    // Start lightweight API for health checks and server count
    const serverCountController = new ServerCountController(client);
    const api = new Api([serverCountController]);

    await bot.start();
    await api.start();

    // Store instances for graceful shutdown
    let botInstance = bot;
    let apiInstance = api;

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
        Logger.info(`[StartBot] Received ${signal}, starting graceful shutdown...`);
        try {
            if (apiInstance) {
                await apiInstance.stop();
            }

            await botInstance.stop();

            // Shutdown PostHog analytics
            await shutdownPostHog();

            // Reset RSS parser
            const { resetRSSParser } = await import('./utils/rss-parser.js');
            resetRSSParser();

            await new Promise(resolve => setTimeout(resolve, 1000));
            Logger.info('[StartBot] Graceful shutdown complete.');
            process.exit(0);
        } catch (error) {
            Logger.error('[StartBot] Error during shutdown:', error);
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
