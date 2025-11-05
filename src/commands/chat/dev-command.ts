import djs, { ChatInputCommandInteraction, PermissionsString, EmbedBuilder } from 'discord.js';
import { createRequire } from 'node:module';
import os from 'node:os';
import typescript from 'typescript';

import { DevCommandName } from '../../enums/index.js';
import { EventData } from '../../models/internal-models.js';
import { FormatUtils, InteractionUtils, ShardUtils, memoryProfiler, getMemoryInfo } from '../../utils/index.js';
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
            case DevCommandName.MEMORY: {
                await intr.deferReply({ ephemeral: true });

                const stats = memoryProfiler.getStats();
                const uptimeMinutes = (Date.now() - process.uptime() * 1000) / 1000 / 60;

                const memoryEmbed = new EmbedBuilder()
                    .setColor(stats.leakDetected ? 'Red' : 'Green')
                    .setTitle('🔍 Memory Profiler Report')
                    .setDescription(
                        stats.leakDetected
                            ? `⚠️ **MEMORY LEAK DETECTED**\nGrowth rate: ${stats.growthRate.toFixed(2)} MB/min`
                            : `✓ Memory usage appears normal\nGrowth rate: ${stats.growthRate.toFixed(2)} MB/min`
                    )
                    .addFields(
                        {
                            name: '📊 Current Memory',
                            value: [
                                `RSS: ${(stats.current.rss / 1024 / 1024).toFixed(2)} MB`,
                                `Heap Used: ${(stats.current.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                                `Heap Total: ${(stats.current.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                                `External: ${(stats.current.external / 1024 / 1024).toFixed(2)} MB`,
                                `Array Buffers: ${(stats.current.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
                            ].join('\n'),
                            inline: false,
                        },
                        {
                            name: '📈 Peak Memory',
                            value: [
                                `RSS: ${(stats.peak.rss / 1024 / 1024).toFixed(2)} MB`,
                                `Heap Used: ${(stats.peak.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                            ].join('\n'),
                            inline: false,
                        },
                        {
                            name: '📉 Statistics',
                            value: [
                                `Snapshots: ${stats.snapshots.length}`,
                                `Growth Rate: ${stats.growthRate.toFixed(2)} MB/min`,
                                `Leak Status: ${stats.leakDetected ? '⚠️ Detected' : '✓ Normal'}`,
                            ].join('\n'),
                            inline: false,
                        }
                    )
                    .setFooter({ text: `Run /dev heap-snapshot to capture detailed heap analysis` })
                    .setTimestamp();

                await InteractionUtils.editReply(intr, { embeds: [memoryEmbed] });
                break;
            }
            case DevCommandName.HEAP_SNAPSHOT: {
                await intr.deferReply({ ephemeral: true });

                try {
                    const v8 = require('v8');
                    if (!v8.writeHeapSnapshot) {
                        await InteractionUtils.editReply(
                            intr,
                            '❌ Heap snapshots not available in this Node.js version'
                        );
                        return;
                    }

                    // Force GC before snapshot if available
                    if (typeof global.gc === 'function') {
                        global.gc();
                    }

                    const filename = `/tmp/heap-${Date.now()}.heapsnapshot`;
                    v8.writeHeapSnapshot(filename);

                    await InteractionUtils.editReply(
                        intr,
                        `✅ Heap snapshot saved to \`${filename}\`\n\n` +
                            `**To analyze:**\n` +
                            `1. Download the file from the server\n` +
                            `2. Open Chrome DevTools (chrome://inspect)\n` +
                            `3. Go to Memory tab → Load snapshot\n` +
                            `4. Look for objects with high retained size`
                    );
                } catch (error) {
                    await InteractionUtils.editReply(
                        intr,
                        `❌ Failed to create heap snapshot: ${error.message}`
                    );
                }
                break;
            }
            case DevCommandName.FORCE_GC: {
                await intr.deferReply({ ephemeral: true });

                if (typeof global.gc !== 'function') {
                    await InteractionUtils.editReply(
                        intr,
                        '❌ Garbage collection not available. Start with `--expose-gc` flag'
                    );
                    return;
                }

                const before = process.memoryUsage();
                global.gc();
                const after = process.memoryUsage();

                const freed = (before.heapUsed - after.heapUsed) / 1024 / 1024;

                const gcEmbed = new EmbedBuilder()
                    .setColor(freed > 0 ? 'Green' : 'Yellow')
                    .setTitle('🗑️ Garbage Collection Complete')
                    .addFields(
                        {
                            name: 'Before GC',
                            value: `Heap: ${(before.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                            inline: true,
                        },
                        {
                            name: 'After GC',
                            value: `Heap: ${(after.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                            inline: true,
                        },
                        {
                            name: 'Freed',
                            value: `${freed.toFixed(2)} MB`,
                            inline: true,
                        }
                    )
                    .setTimestamp();

                await InteractionUtils.editReply(intr, { embeds: [gcEmbed] });
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
