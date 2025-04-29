import {
    ChatInputCommandInteraction,
    PermissionsString,
    EmbedBuilder,
    inlineCode,
} from 'discord.js';

import { EventData } from '../../models/internal-models.js';
import { FeedStorageService, CategoryConfig } from '../../services/feed-storage-service.js'; // Use the storage service
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class CategoryCommand implements Command {
    public names = ['category'];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = ['SendMessages', 'EmbedLinks'];
    // Optional: Require user to have Manage Server permissions
    // public requireUserPerms: PermissionsString[] = ['ManageGuild'];
    
    public metadata = {
        name: 'category',
        description: 'Manage feed categories and their polling frequencies.',
        options: [
            {
                name: 'setfrequency',
                description: 'Set the polling frequency (in minutes) for a category.',
                type: 1, // SUB_COMMAND
                options: [
                    { name: 'category', description: 'The name of the category.', type: 3, required: true },
                    { name: 'minutes', description: 'Polling frequency in minutes (1-1440).', type: 4, required: true }
                ]
            },
            {
                name: 'list',
                description: 'List configured categories and their frequencies.',
                type: 1, // SUB_COMMAND
                options: []
            }
        ]
    }

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        if (!intr.guild) {
            await InteractionUtils.send(
                intr,
                'This command can only be used inside a server.',
                true
            );
            return;
        }
        // Optional: Check for ManageGuild permission
        // if (!intr.memberPermissions?.has('ManageGuild')) { ... }

        const subCommand = intr.options.getSubcommand();

        try {
            switch (subCommand) {
                case 'setfrequency': {
                    const categoryName = intr.options.getString('category', true);
                    const frequencyMinutes = intr.options.getInteger('minutes', true);

                    if (frequencyMinutes < 1 || frequencyMinutes > 1440) {
                        await InteractionUtils.editReply(
                            intr,
                            'Frequency must be between 1 and 1440 minutes (24 hours).'
                        );
                        return;
                    }

                    try {
                        await FeedStorageService.setCategoryFrequency(
                            intr.guild.id,
                            categoryName,
                            frequencyMinutes
                        );
                        await InteractionUtils.editReply(
                            intr,
                            `✅ Polling frequency for category ${inlineCode(categoryName)} set to **${frequencyMinutes} minutes**.`
                        );
                    } catch (error) {
                        console.error('Error setting category frequency:', error);
                        await InteractionUtils.editReply(
                            intr,
                            '❌ An error occurred while setting the category frequency.'
                        );
                    }
                    break;
                }
                case 'list': {
                    try {
                        const categories: CategoryConfig[] =
                            await FeedStorageService.getGuildCategories(intr.guild.id);

                        const embed = new EmbedBuilder()
                            .setTitle(`⚙️ Configured Category Frequencies`)
                            .setColor('Gold')
                            .setTimestamp()
                            .setFooter({
                                text: 'Categories without a specific frequency use the default (15 minutes).',
                            });

                        if (categories.length === 0) {
                            embed.setDescription(
                                'No custom category frequencies have been set for this server.'
                            );
                        } else {
                            const description = categories
                                .map(
                                    cat =>
                                        `• ${inlineCode(cat.name)}: **${cat.frequencyMinutes} minutes**`
                                )
                                .join('\n');
                            embed.setDescription(description);
                        }

                        await InteractionUtils.editReply(intr, { embeds: [embed] });
                    } catch (error) {
                        console.error('Error listing categories:', error);
                        await InteractionUtils.editReply(
                            intr,
                            '❌ An error occurred while listing the categories.'
                        );
                    }
                    break;
                }
                default: {
                    await InteractionUtils.send(intr, 'Unknown category command.', true);
                }
            }
        } catch (error) {
            console.error('Unhandled error in CategoryCommand execute:', error);
            const replyOptions = {
                content: '❌ An unexpected error occurred.',
                ephemeral: true,
            };
            if (intr.deferred || intr.replied) {
                await InteractionUtils.editReply(intr, replyOptions);
            } else {
                await InteractionUtils.send(intr, replyOptions.content, replyOptions.ephemeral);
            }
        }
    }
}
