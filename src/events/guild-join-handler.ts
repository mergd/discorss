import { EmbedBuilder, Guild, TextChannel } from 'discord.js';
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

        // Build welcome embed
        const feedCmd = await ClientUtils.findAppCommand(guild.client, ChatCommandMetadata.FEED.name);
        const feedMention = feedCmd
            ? FormatUtils.commandMention(feedCmd)
            : `\`/${ChatCommandMetadata.FEED.name}\``;

        const youtubeCmd = await ClientUtils.findAppCommand(
            guild.client,
            ChatCommandMetadata.YOUTUBE.name
        );
        const youtubeMention = youtubeCmd
            ? FormatUtils.commandMention(youtubeCmd)
            : `\`/${ChatCommandMetadata.YOUTUBE.name}\``;

        const helpCmd = await ClientUtils.findAppCommand(
            guild.client,
            ChatCommandMetadata.HELP.name
        );
        const helpMention = helpCmd
            ? FormatUtils.commandMention(helpCmd)
            : `\`/${ChatCommandMetadata.HELP.name}\``;

        const welcomeEmbed = new EmbedBuilder()
            .setTitle('👋 Welcome to Discorss!')
            .setDescription(
                `Thanks for adding me to **${guild.name}**! I'm here to help you stay updated by automatically bringing RSS feed and YouTube channel updates directly into your Discord server.`
            )
            .setColor('Aqua')
            .addFields(
                {
                    name: '🚀 Quick Start',
                    value: `**Add an RSS feed:**
${feedMention} \`add\` \`url:https://example.com/feed.xml\`

**Add a YouTube channel:**
${youtubeMention} \`add\` \`channel_id:UC...\`

**List your feeds:**
${feedMention} \`list\`

**Get help:**
${helpMention}`,
                    inline: false,
                },
                {
                    name: '✨ Key Features',
                    value: `• **RSS Feed Monitoring** - Track any RSS or Atom feed
• **YouTube Integration** - Follow YouTube channels automatically
• **AI Summaries** - Get AI-powered summaries of articles (optional)
• **Categories** - Organize feeds with custom categories
• **Custom Frequencies** - Control how often feeds are checked`,
                    inline: false,
                },
                {
                    name: '📚 Need Help?',
                    value: `Use ${helpMention} to see all available commands and get detailed information about how to use them.`,
                    inline: false,
                }
            )
            .setTimestamp()
            .setFooter({
                text: 'Happy feed monitoring! 🎉',
            });

        // Send welcome message to the server's notify channel
        let notifyChannel = await ClientUtils.findNotifyChannel(guild, data.langGuild);
        if (notifyChannel) {
            try {
                await MessageUtils.send(notifyChannel, welcomeEmbed);
            } catch (error) {
                Logger.error(Logs.error.messageSend, error);
            }
        }

        // Send welcome message to owner
        if (owner) {
            try {
                await MessageUtils.send(owner.user, welcomeEmbed);
            } catch (error) {
                // Ignore DMs not sending
            }
        }
    }
}
