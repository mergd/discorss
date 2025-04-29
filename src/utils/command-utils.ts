import {
    Interaction,
    CommandInteraction,
    GuildChannel,
    GuildMember,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    NewsChannel,
    PermissionsBitField,
    TextChannel,
    ThreadChannel,
} from 'discord.js';
import { createRequire } from 'node:module';

import { Command } from '../commands/index.js';
import { EventData } from '../models/internal-models.js';
import { Logger } from '../services/logger.js';
import { InteractionUtils } from './index.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

export class CommandUtils {
    public static findCommand(commands: Command[], commandParts: string[]): Command {
        let found = [...commands];
        let closestMatch: Command;
        for (let [index, commandPart] of commandParts.entries()) {
            found = found.filter(command => command.names[index] === commandPart);
            if (found.length === 0) {
                return closestMatch;
            }

            if (found.length === 1) {
                return found[0];
            }

            let exactMatch = found.find(command => command.names.length === index + 1);
            if (exactMatch) {
                closestMatch = exactMatch;
            }
        }
        return closestMatch;
    }

    public static async runChecks(
        command: Command,
        intr: CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction,
        data: EventData
    ): Promise<boolean> {
        if (intr.inGuild()) {
            if (command.requireClientPerms?.length > 0) {
                let me = intr.guild.members.me;
                if (!me) {
                    try {
                        me = await intr.guild.members.fetchMe();
                    } catch (err) {
                        Logger.error('Failed to fetch self member:', err);
                    }
                }
                if (!me?.permissions) {
                    await InteractionUtils.send(intr, 'Could not determine my permissions.', true);
                    return false;
                }

                if (!intr.channel || !intr.channelId) {
                    await InteractionUtils.send(
                        intr,
                        'Could not determine the channel context.',
                        true
                    );
                    return false;
                }

                let channelPerms = me.permissionsIn(intr.channelId);
                if (!channelPerms) {
                    await InteractionUtils.send(
                        intr,
                        'Could not determine my permissions in this channel.',
                        true
                    );
                    return false;
                }

                let missingClientPerms = command.requireClientPerms.filter(
                    perm => !channelPerms.has(perm)
                );
                if (missingClientPerms.length > 0) {
                    await InteractionUtils.send(
                        intr,
                        `I am missing the following permissions in this channel: ${missingClientPerms.join(', ')}`,
                        true
                    );
                    return false;
                }
            }
        }

        if (command.cooldown) {
            let limited = command.cooldown.take(intr.user.id);
            if (limited) {
                const intervalSeconds = command.cooldown.interval / 1000;
                await InteractionUtils.send(
                    intr,
                    `This command is on cooldown. Please wait ${intervalSeconds} seconds.`,
                    true
                );
                return false;
            }
        }

        return true;
    }
}
