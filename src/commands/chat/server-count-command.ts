import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';

import { EventData } from '../../models/internal-models.js';
import { InteractionUtils, ShardUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class ServerCountCommand implements Command {
    public names = ['servers'];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        let serverCount: number;

        if (intr.client.shard) {
            try {
                serverCount = await ShardUtils.serverCount(intr.client.shard);
            } catch (error) {
                if (error.name?.includes('ShardingInProcess')) {
                    await InteractionUtils.send(
                        intr,
                        'Still starting up shard data. Please try again in a moment.',
                        true
                    );
                    return;
                }

                throw error;
            }
        } else {
            serverCount = intr.client.guilds.cache.size;
        }

        await InteractionUtils.send(
            intr,
            `This bot is currently installed in **${serverCount.toLocaleString()}** servers.`
        );
    }
}
