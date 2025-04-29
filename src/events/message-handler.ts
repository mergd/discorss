import { Message } from 'discord.js';

import { EventHandler, TriggerHandler } from './index.js';
import { FormatUtils, ClientUtils } from '../utils/index.js';

export class MessageHandler implements EventHandler {
    constructor(private triggerHandler: TriggerHandler) {}

    public async process(msg: Message): Promise<void> {
        // Don't respond to system messages or self
        if (msg.system || msg.author.id === msg.client.user?.id) {
            return;
        }

        // Check if the bot was mentioned
        if (msg.mentions.has(msg.client.user.id)) {
            // Prevent responding to mentions in replies or complex mention scenarios if desired
            // Simple check: respond only if the mention is the first part of the message
            const mentionPrefix = `<@${msg.client.user.id}>`;
            if (msg.content.trim().startsWith(mentionPrefix)) {
                const helpCommand = await ClientUtils.findAppCommand(msg.client, 'help');
                const helpCommandMention = helpCommand
                    ? FormatUtils.commandMention(helpCommand)
                    : '/help';
                await msg.reply(
                    `Hi ${msg.author}! Need help? Use ${helpCommandMention} to see my commands.`
                );
                return; // Don't process triggers if responding to a ping
            }
        }

        // Process trigger
        await this.triggerHandler.process(msg);
    }
}
