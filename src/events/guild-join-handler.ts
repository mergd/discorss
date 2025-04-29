import { Guild, TextChannel } from 'discord.js';
import { createRequire } from 'node:module';

import { ChatCommandMetadata } from '../commands/metadata.js';
import { EventHandler } from './index.js';
import { EventDataService, Logger } from '../services/index.js';
import { ClientUtils, FormatUtils, MessageUtils } from '../utils/index.js';
import { posthog } from '../utils/analytics.js';

const require = createRequire(import.meta.url);
let Logs = require('../../lang/logs.json');

export class GuildJoinHandler implements EventHandler {
    constructor(private eventDataService: EventDataService) {}

    public async process(guild: Guild): Promise<void> {
        Logger.info(
            Logs.info.guildJoined
                .replaceAll('{GUILD_NAME}', guild.name)
                .replaceAll('{GUILD_ID}', guild.id)
        );

        // --- PostHog Tracking --- START
        if (posthog) {
            posthog.capture({
                distinctId: guild.ownerId,
                event: 'guild_joined',
                properties: {
                    guildId: guild.id,
                    guildName: guild.name,
                    guildMemberCount: guild.memberCount,
                    guildOwnerId: guild.ownerId,
                    shardId: guild.shardId,
                },
                groups: { guild: guild.id },
            });
            posthog.groupIdentify({
                groupType: 'guild',
                groupKey: guild.id,
                properties: {
                    name: guild.name,
                    member_count: guild.memberCount,
                    joined_at: new Date().toISOString(),
                },
            });
        }
        // --- PostHog Tracking --- END

        let owner = await guild.fetchOwner();

        // Get data from database
        let data = await this.eventDataService.create({
            user: owner?.user,
            guild,
        });

        // Welcome message
        const commandData = [
            ChatCommandMetadata.FEED,
            ChatCommandMetadata.CATEGORY,
            ChatCommandMetadata.YOUTUBE,
            ChatCommandMetadata.HELP,
            ChatCommandMetadata.INFO,
        ];

        let commandList = '';
        for (const cmd of commandData) {
            const appCommand = await ClientUtils.findAppCommand(guild.client, cmd.name);
            const mention = appCommand
                ? FormatUtils.commandMention(appCommand)
                : `\`/${cmd.name}\``;
            commandList += `> ${mention}: ${cmd.description}\\n`;
        }

        const helpCmd = await ClientUtils.findAppCommand(
            guild.client,
            ChatCommandMetadata.HELP.name
        );
        const helpMention = helpCmd
            ? FormatUtils.commandMention(helpCmd)
            : `\`/${ChatCommandMetadata.HELP.name}\``;

        const welcomeMessage = `👋 **Hello! I'm Discorss, your RSS feed companion!**

        I can help you stay updated by bringing RSS and YouTube channel updates directly into your server.

        Here are my main commands:
        ${commandList}

        For more details on any command, use ${helpMention}. Let's get started!`;

        // Send welcome message to the server's notify channel
        let notifyChannel = await ClientUtils.findNotifyChannel(guild, data.langGuild);
        if (notifyChannel) {
            try {
                await MessageUtils.send(notifyChannel, welcomeMessage);
            } catch (error) {
                Logger.error(Logs.error.messageSend, error);
            }
        }

        // Send welcome message to owner
        if (owner) {
            try {
                await MessageUtils.send(owner.user, welcomeMessage);
            } catch (error) {
                // Ignore DMs not sending
            }
        }
    }
}
