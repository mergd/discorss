import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { HelpOption } from '../../enums/index.js';
import { EventData } from '../../models/internal-models.js';
import { ClientUtils, FormatUtils, InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';
import { ChatCommandMetadata } from '../metadata.js';

export class HelpCommand implements Command {
    public names = ['help'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        let args = {
            option: (intr.options.getString('option') as HelpOption) ?? HelpOption.COMMANDS,
        };

        let embed: EmbedBuilder;
        switch (args.option) {
            case HelpOption.CONTACT_SUPPORT: {
                const feedbackCmd = await ClientUtils.findAppCommand(
                    intr.client,
                    ChatCommandMetadata.FEEDBACK.name
                );
                const feedbackMention = feedbackCmd
                    ? FormatUtils.commandMention(feedbackCmd)
                    : `\`/${ChatCommandMetadata.FEEDBACK.name}\``;

                embed = new EmbedBuilder()
                    .setTitle('Contact Support')
                    .setDescription(
                        `If you're experiencing issues or have feedback, please use ${feedbackMention} to reach out to us.`
                    )
                    .setColor('Blue');
                break;
            }
            case HelpOption.COMMANDS: {
                const commandList = Object.entries(ChatCommandMetadata)
                    .map(([key, metadata]) => {
                        return ClientUtils.findAppCommand(intr.client, metadata.name).then(
                            appCmd => {
                                if (!appCmd)
                                    return `• **/${metadata.name}**: ${metadata.description}`;
                                const mention = FormatUtils.commandMention(appCmd);
                                return `• ${mention}: ${metadata.description}`;
                            }
                        );
                    })
                    .filter(item => item !== null);

                const commandDescriptions = await Promise.all(commandList);

                const feedbackCmd = await ClientUtils.findAppCommand(
                    intr.client,
                    ChatCommandMetadata.FEEDBACK.name
                );
                const feedbackMention = feedbackCmd
                    ? FormatUtils.commandMention(feedbackCmd)
                    : `\`/${ChatCommandMetadata.FEEDBACK.name}\``;

                embed = new EmbedBuilder()
                    .setTitle('Command List')
                    .setDescription(
                        `Here are the available commands:\n\n${commandDescriptions.join(
                            '\n'
                        )}\n\nNeed help? Use ${feedbackMention} to report issues or provide feedback.`
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
