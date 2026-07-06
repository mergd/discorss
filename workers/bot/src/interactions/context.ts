import { Analytics } from '../analytics.js';
import { DiscordRest } from '../discord/rest.js';
import { Interaction, MessageFlags } from '../discord/interaction.js';
import type { Env } from '../env.js';

/** Everything a deferred command handler needs to finish its work. */
export class CommandContext {
    constructor(
        public env: Env,
        public rest: DiscordRest,
        public analytics: Analytics,
        public intr: Interaction
    ) {}

    /** Edits the deferred original response. */
    editReply(
        content: string | { content?: string; embeds?: unknown[]; components?: unknown[]; flags?: number }
    ): Promise<void> {
        const message = typeof content === 'string' ? { content } : content;
        return this.rest.editOriginalResponse(this.intr.token, message);
    }

    /** Sends an ephemeral follow-up message. */
    followUpEphemeral(content: string): Promise<void> {
        return this.rest.createFollowup(this.intr.token, {
            content,
            flags: MessageFlags.Ephemeral,
        });
    }
}
