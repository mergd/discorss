import { Analytics } from './analytics.js';
import { createAdminApp } from './admin/routes.js';
import { runWithDb } from './db/index.js';
import { DiscordRest } from './discord/rest.js';
import type { Env, FeedQueueMessage } from './env.js';
import { FeedPoller } from './feeds/poller.js';
import { consumeFeedChecks } from './feeds/queue.js';
import { scheduleDueFeeds } from './feeds/scheduler.js';
import { handleInteractionRequest } from './interactions/router.js';

const adminApp = createAdminApp();

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({ status: 'healthy' });
        }

        if (url.pathname === '/interactions' && request.method === 'POST') {
            // DB scoping happens inside (per deferred handler), not here.
            return handleInteractionRequest(request, env, ctx);
        }

        if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) {
            return runWithDb(env, async () => adminApp.fetch(request, env, ctx));
        }

        // Everything else is the admin UI (static assets, SPA fallback).
        return env.ASSETS.fetch(request);
    },

    async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        await runWithDb(env, () => scheduleDueFeeds(env, controller.scheduledTime));
    },

    async queue(batch: MessageBatch<FeedQueueMessage>, env: Env, _ctx: ExecutionContext) {
        await runWithDb(env, async () => {
            const rest = new DiscordRest(env.DISCORD_BOT_TOKEN, env.DISCORD_CLIENT_ID);
            const poller = new FeedPoller(env, rest, Analytics.fromEnv(env));

            await consumeFeedChecks(batch, feedId => poller.checkFeed(feedId));
        });
    },
};
