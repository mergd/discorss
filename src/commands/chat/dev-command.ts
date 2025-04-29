import djs, { ChatInputCommandInteraction, PermissionsString, EmbedBuilder } from 'discord.js';
import { createRequire } from 'node:module';
import os from 'node:os';
import typescript from 'typescript';

import { DevCommandName } from '../../enums/index.js';
import { EventData } from '../../models/internal-models.js';
import { FormatUtils, InteractionUtils, ShardUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';
import { env } from '../../utils/env.js';

const require = createRequire(import.meta.url);
let Config = require('../../../config/config.json');

// Load developers from env
Config.developers = env.DEVELOPER_IDS.split(',');

export class DevCommand implements Command {
    public names = ['dev'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        if (!Config.developers.includes(intr.user.id)) {
            await InteractionUtils.send(
                intr,
                'This command is only available to developers specified in the config file.',
                true
            );
            return;
        }

        let args = {
            command: intr.options.getString('command') as DevCommandName,
        };

        switch (args.command) {
            case DevCommandName.INFO: {
                await intr.deferReply({ ephemeral: true });

                let shardCount = intr.client.shard?.count ?? 1;
                let serverCount: number;
                if (intr.client.shard) {
                    try {
                        serverCount = await ShardUtils.serverCount(intr.client.shard);
                    } catch (error) {
                        if (error.name.includes('ShardingInProcess')) {
                            await InteractionUtils.editReply(
                                intr,
                                'Shard manager is still starting up. Please try again in a moment.'
                            );
                            return;
                        } else {
                            throw error;
                        }
                    }
                } else {
                    serverCount = intr.client.guilds.cache.size;
                }

                let memory = process.memoryUsage();
                const naString = 'N/A';

                const devInfoEmbed = new EmbedBuilder()
                    .setColor('Default')
                    .setTitle('Developer Information')
                    .addFields(
                        { name: 'Node.js', value: process.version, inline: true },
                        { name: 'TypeScript', value: `v${typescript.version}`, inline: true },
                        { name: 'discord.js', value: `v${djs.version}`, inline: true },
                        {
                            name: 'ES Version',
                            value: 'ES2021',
                            inline: true,
                        },
                        { name: 'Shard Count', value: shardCount.toLocaleString(), inline: true },
                        {
                            name: 'Total Servers',
                            value: serverCount.toLocaleString(),
                            inline: true,
                        },
                        {
                            name: 'Avg Servers/Shard',
                            value: Math.round(serverCount / shardCount).toLocaleString(),
                            inline: true,
                        },
                        { name: '\u200b', value: '\u200b', inline: true },
                        { name: 'Hostname', value: os.hostname(), inline: true },

                        { name: 'RSS', value: FormatUtils.fileSize(memory.rss), inline: true },
                        {
                            name: 'Heap Total',
                            value: FormatUtils.fileSize(memory.heapTotal),
                            inline: true,
                        },
                        {
                            name: 'Heap Used',
                            value: FormatUtils.fileSize(memory.heapUsed),
                            inline: true,
                        },
                        {
                            name: 'RSS/Server',
                            value:
                                serverCount > 0
                                    ? FormatUtils.fileSize(memory.rss / serverCount)
                                    : naString,
                            inline: true,
                        },
                        {
                            name: 'Heap Total/Server',
                            value:
                                serverCount > 0
                                    ? FormatUtils.fileSize(memory.heapTotal / serverCount)
                                    : naString,
                            inline: true,
                        },
                        {
                            name: 'Heap Used/Server',
                            value:
                                serverCount > 0
                                    ? FormatUtils.fileSize(memory.heapUsed / serverCount)
                                    : naString,
                            inline: true,
                        },

                        {
                            name: 'Current Shard ID',
                            value: (intr.guild?.shardId ?? 0).toString(),
                            inline: true,
                        },
                        {
                            name: 'Current Server ID',
                            value: intr.guild?.id ?? naString,
                            inline: true,
                        },
                        { name: 'User ID', value: intr.user.id, inline: true }
                    )
                    .setTimestamp();

                await InteractionUtils.editReply(intr, { embeds: [devInfoEmbed] });
                break;
            }
            default: {
                await InteractionUtils.send(
                    intr,
                    `Unknown dev command option: ${args.command}`,
                    true
                );
                return;
            }
        }
    }
}
