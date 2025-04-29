import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { InfoOption } from '../../enums/index.js';
import { EventData } from '../../models/internal-models.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class InfoCommand implements Command {
    public names = ['info'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        let args = {
            option: intr.options.getString('option') as InfoOption,
        };

        let embed: EmbedBuilder;
        switch (args.option) {
            case InfoOption.ABOUT: {
                embed = new EmbedBuilder()
                    .setTitle('About Me')
                    .setDescription(
                        `Hi! I'm an RSS Bot.\n\n` +
                            `I can monitor RSS feeds and post updates to your channels.\n` +
                            `Use \`/help\` to see available commands.`
                    )
                    .setColor('Blurple');
                break;
            }
            case InfoOption.TRANSLATE: {
                await InteractionUtils.send(
                    intr,
                    'Translation information is not available.',
                    true
                );
                return;
            }
            default: {
                await InteractionUtils.send(
                    intr,
                    `Invalid info option specified: ${args.option}`,
                    true
                );
                return;
            }
        }

        await InteractionUtils.send(intr, { embeds: [embed] });
    }
}
