import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { HelpOption } from '../../enums/index.js';
import { EventData } from '../../models/internal-models.js';
import { ClientUtils, FormatUtils, InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class HelpCommand implements Command {
    public names = ['help'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        let args = {
            option: intr.options.getString('option') as HelpOption,
        };

        let embed: EmbedBuilder;
        switch (args.option) {
            case HelpOption.CONTACT_SUPPORT: {
                embed = new EmbedBuilder()
                    .setTitle('Contact Support')
                    .setDescription('To get support, contact williamx on discord :)')
                    .setColor('Blue');
                break;
            }
            case HelpOption.COMMANDS: {
                const testCmd = FormatUtils.commandMention(
                    await ClientUtils.findAppCommand(intr.client, 'test')
                );
                const infoCmd = FormatUtils.commandMention(
                    await ClientUtils.findAppCommand(intr.client, 'info')
                );
                const feedCmd = FormatUtils.commandMention(
                    await ClientUtils.findAppCommand(intr.client, 'feed')
                );
                const categoryCmd = FormatUtils.commandMention(
                    await ClientUtils.findAppCommand(intr.client, 'category')
                );

                embed = new EmbedBuilder()
                    .setTitle('Command List')
                    .setDescription(
                        `Here are the main commands:\n\n` +
                            `• ${testCmd}: A generic test command.\n` +
                            `• ${infoCmd}: Shows information about the bot.\n` +
                            `• ${feedCmd}: Manage RSS feed subscriptions (use subcommands \`add\`, \`remove\`, \`list\`, \`test\`).\n` +
                            `• ${categoryCmd}: Manage feed categories (use subcommands \`setfrequency\`, \`list\`).\n\n` +
                            `Use </help option:Contact Support> for support details.`
                    )
                    .setColor('Green');
                break;
            }
            default: {
                await InteractionUtils.send(
                    intr,
                    `Invalid help option specified: ${args.option}`,
                    true
                );
                return;
            }
        }

        await InteractionUtils.send(intr, { embeds: [embed] });
    }
}
