import { Analytics } from '../analytics.js';
import {
    deferredReply,
    deferredUpdate,
    immediateReply,
    Interaction,
    InteractionType,
    pong,
} from '../discord/interaction.js';
import { DiscordRest } from '../discord/rest.js';
import { verifyDiscordRequest } from '../discord/verify.js';
import { runWithDb } from '../db/index.js';
import type { Env } from '../env.js';
import { CommandContext } from './context.js';
import { handleFeedCommand, handleYoutubeAdd } from './commands/feed.js';
import {
    handleCategoryCommand,
    handleDevCommand,
    handleFeedbackCommand,
    handleHelpCommand,
    handleInfoCommand,
    handleReleaseNotesCommand,
    handleServersCommand,
    handleViewDateJoined,
    handleViewDateSent,
} from './commands/misc.js';
import { handleFeedListComponent } from './components/feed-list.js';

type Handler = (ctx: CommandContext) => Promise<void>;

// ephemeral mirrors the old CommandDeferType (HIDDEN vs PUBLIC)
const COMMAND_HANDLERS: Record<string, { handler: Handler; ephemeral: boolean }> = {
    feed: { handler: handleFeedCommand, ephemeral: false },
    youtube: { handler: handleYoutubeAdd, ephemeral: false },
    category: { handler: handleCategoryCommand, ephemeral: false },
    help: { handler: handleHelpCommand, ephemeral: true },
    info: { handler: handleInfoCommand, ephemeral: true },
    servers: { handler: handleServersCommand, ephemeral: true },
    feedback: { handler: handleFeedbackCommand, ephemeral: true },
    releasenotes: { handler: handleReleaseNotesCommand, ephemeral: false },
    dev: { handler: handleDevCommand, ephemeral: true },
    'View Date Sent': { handler: handleViewDateSent, ephemeral: true },
    'View Date Joined': { handler: handleViewDateJoined, ephemeral: true },
};

export async function handleInteractionRequest(
    request: Request,
    env: Env,
    ctx: ExecutionContext
): Promise<Response> {
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    const body = await request.text();

    const valid = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY, signature, timestamp, body);
    if (!valid) {
        return new Response('Bad request signature', { status: 401 });
    }

    const interaction = JSON.parse(body) as Interaction;

    if (interaction.type === InteractionType.Ping) {
        return pong();
    }

    const rest = new DiscordRest(env.DISCORD_BOT_TOKEN, env.DISCORD_CLIENT_ID);
    const analytics = Analytics.fromEnv(env);
    const commandCtx = new CommandContext(env, rest, analytics, interaction);

    if (interaction.type === InteractionType.ApplicationCommand) {
        const name = interaction.data?.name ?? '';
        const entry = COMMAND_HANDLERS[name];
        if (!entry) {
            return immediateReply({ content: `Unknown command: ${name}` }, true);
        }

        // Respond with a deferral immediately; do the work after the response.
        // The DB connection is scoped to the deferred work, not the request.
        ctx.waitUntil(
            runWithDb(env, () => entry.handler(commandCtx)).catch(async error => {
                console.error(`[Interactions] Error handling /${name}:`, error);
                await analytics.captureException('system_interactions', 'CommandError', error, {
                    command: name,
                    guildId: interaction.guild_id,
                });
                await commandCtx
                    .editReply('❌ An unexpected error occurred while running this command.')
                    .catch(() => undefined);
            })
        );
        return deferredReply(entry.ephemeral);
    }

    if (interaction.type === InteractionType.MessageComponent) {
        const customId = interaction.data?.custom_id ?? '';
        if (customId.startsWith('fl:')) {
            ctx.waitUntil(
                runWithDb(env, () => handleFeedListComponent(commandCtx)).catch(error => {
                    console.error('[Interactions] Error handling feed list pagination:', error);
                })
            );
            return deferredUpdate();
        }
        return deferredUpdate();
    }

    return immediateReply({ content: 'Unsupported interaction type.' }, true);
}
