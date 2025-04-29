import { ApplicationCommandType, UserContextMenuCommandInteraction } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { EventData } from '../../models/internal-models.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class ViewDateJoined implements Command {
    public type = ApplicationCommandType.User;
    public names = ['View Date Joined'];
    public cooldown = new RateLimiter(1, 5000);
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms = [];

    public async execute(intr: UserContextMenuCommandInteraction, data: EventData): Promise<void> {
        let target = intr.targetMember ?? intr.targetUser;
        let joinTimestamp: number;

        // Check if targetMember exists and is a full GuildMember instance
        if (intr.targetMember && 'joinedTimestamp' in intr.targetMember) {
            joinTimestamp = intr.targetMember.joinedTimestamp;
        } else {
            // Fallback to user creation timestamp if not in guild or not a full member object
            joinTimestamp = intr.targetUser.createdTimestamp;
        }

        await InteractionUtils.send(
            intr,
            `${target.toString()} ${intr.targetMember ? 'joined' : 'was created'}: <t:${Math.round(joinTimestamp / 1000)}:R>`
        );
    }
}
