import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import fetch from 'node-fetch';

import { EventData } from '../../models/internal-models.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';
import { env } from '../../utils/env.js';

const GITHUB_REPO_URL = 'https://github.com/mergd/discorss';
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues/new`;

export class FeedbackCommand implements Command {
    public names = ['feedback'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        const message = intr.options.getString('message', true);
        const webhook = env.FEEDBACK_WEBHOOK_URL;

        if (webhook) {
            try {
                await fetch(webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `Feedback from ${intr.user.tag} (${intr.user.id}) in ${intr.guild?.name ?? 'DM'}: ${message}`,
                    }),
                });
            } catch {
                // ignore errors sending feedback
            }
        }

        await InteractionUtils.send(
            intr,
            `Thank you for your feedback! For bug reports and feature requests, please consider opening an issue on GitHub:\n${GITHUB_ISSUES_URL}`,
            true
        );
    }
}
