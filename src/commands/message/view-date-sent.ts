import { ApplicationCommandType, MessageContextMenuCommandInteraction } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { EventData } from '../../models/internal-models.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class ViewDateSent implements Command {
    public type = ApplicationCommandType.Message;
    public names = ['View Date Sent'];
    public cooldown = new RateLimiter(1, 5000);
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms = [];

    public async execute(
        intr: MessageContextMenuCommandInteraction,
        data: EventData
    ): Promise<void> {
        await InteractionUtils.send(
            intr,
            `Message sent: <t:${Math.round(intr.targetMessage.createdTimestamp / 1000)}:R>`
        );
    }
}
