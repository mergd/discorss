import { COMMAND_METADATA } from '../../discord/command-metadata.js';
import {
    getInteger,
    getString,
    getSubcommand,
    interactionUser,
    userTag,
} from '../../discord/interaction.js';
import { CategoryConfig, FeedStorageService } from '../../services/feed-storage.js';
import { CommandContext } from '../context.js';

const inlineCode = (s: string): string => `\`${s}\``;

const GITHUB_REPO_URL = 'https://github.com/mergd/discorss';
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues/new`;

export async function handleCategoryCommand(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    if (!intr.guild_id) {
        await ctx.editReply('This command can only be used inside a server.');
        return;
    }

    const subCommand = getSubcommand(intr);
    switch (subCommand) {
        case 'setfrequency': {
            const categoryName = getString(intr, 'category')!;
            const frequencyMinutes = getInteger(intr, 'minutes')!;

            if (frequencyMinutes < 3 || frequencyMinutes > 1440) {
                await ctx.editReply('Frequency must be between 3 and 1440 minutes (24 hours).');
                return;
            }

            try {
                await FeedStorageService.setCategoryFrequency(
                    intr.guild_id,
                    categoryName,
                    frequencyMinutes
                );
                await ctx.editReply(
                    `✅ Polling frequency for category ${inlineCode(categoryName)} set to **${frequencyMinutes} minutes**.`
                );
            } catch (error) {
                console.error('Error setting category frequency:', error);
                await ctx.editReply('❌ An error occurred while setting the category frequency.');
            }
            break;
        }
        case 'list': {
            const categories: CategoryConfig[] = await FeedStorageService.getGuildCategories(
                intr.guild_id
            );
            const description =
                categories.length === 0
                    ? 'No custom category frequencies have been set for this server.'
                    : categories
                          .map(
                              cat =>
                                  `• ${inlineCode(cat.name)}: **${cat.frequencyMinutes} minutes**`
                          )
                          .join('\n');

            await ctx.editReply({
                embeds: [
                    {
                        title: '⚙️ Configured Category Frequencies',
                        color: 0xf1c40f,
                        description,
                        footer: {
                            text: 'Categories without a specific frequency use the default (15 minutes).',
                        },
                        timestamp: new Date().toISOString(),
                    },
                ],
            });
            break;
        }
        default:
            await ctx.editReply('Unknown category command.');
    }
}

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
    const commandDescriptions = COMMAND_METADATA.filter(cmd => cmd.type === 1)
        .map(cmd => `• **/${cmd.name}**: ${cmd.description}`)
        .join('\n');

    await ctx.editReply({
        embeds: [
            {
                title: 'Command List',
                color: 0x57f287,
                description: `Here are the available commands:\n\n${commandDescriptions}\n\nNeed help? Use \`/feedback\` to report issues or provide feedback.`,
            },
        ],
    });
}

export async function handleInfoCommand(ctx: CommandContext): Promise<void> {
    await ctx.editReply({
        embeds: [
            {
                title: 'About Me',
                color: 0x5865f2,
                description:
                    `Hi! I'm an RSS Bot.\n\n` +
                    `I can monitor RSS feeds and post updates to your channels.\n` +
                    `Use \`/help\` to see available commands.`,
            },
        ],
    });
}

export async function handleFeedbackCommand(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const user = interactionUser(intr);
    const message = getString(intr, 'message')!;
    const webhook = ctx.env.FEEDBACK_WEBHOOK_URL;

    if (webhook) {
        try {
            await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `Feedback from ${userTag(user)} (${user.id}) in ${intr.guild_id ?? 'DM'}: ${message}`,
                }),
            });
        } catch {
            // ignore errors sending feedback
        }
    }

    await ctx.editReply(
        `Thank you for your feedback! For bug reports and feature requests, please consider opening an issue on GitHub:\n${GITHUB_ISSUES_URL}`
    );
}

export async function handleServersCommand(ctx: CommandContext): Promise<void> {
    const guilds = await ctx.rest.getBotGuilds();
    await ctx.editReply(
        `This bot is currently installed in **${guilds.length.toLocaleString()}** servers.`
    );
}

export async function handleDevCommand(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const user = interactionUser(intr);
    const developers = ctx.env.DEVELOPER_IDS.split(',').map(id => id.trim());

    if (!developers.includes(user.id)) {
        await ctx.editReply('This command is only available to developers.');
        return;
    }

    const guilds = await ctx.rest.getBotGuilds();
    await ctx.editReply({
        embeds: [
            {
                title: 'Developer Information',
                fields: [
                    { name: 'Runtime', value: 'Cloudflare Workers', inline: true },
                    {
                        name: 'Total Servers',
                        value: guilds.length.toLocaleString(),
                        inline: true,
                    },
                    { name: 'Current Server ID', value: intr.guild_id ?? 'N/A', inline: true },
                    { name: 'User ID', value: user.id, inline: true },
                ],
                timestamp: new Date().toISOString(),
            },
        ],
    });
}

export async function handleReleaseNotesCommand(ctx: CommandContext): Promise<void> {
    try {
        const { default: releaseNotes } = (await import('../../../../../config/release-notes.json')) as {
            default: Array<{
                version: string;
                date: string;
                title: string;
                features?: string[];
                improvements?: string[];
                bugfixes?: string[];
                url?: string;
            }>;
        };

        if (!releaseNotes || releaseNotes.length === 0) {
            await ctx.editReply('No release notes available yet. Check back later!');
            return;
        }

        const latestRelease = releaseNotes[0];
        const parts: string[] = [];
        if (latestRelease.version) parts.push(`**Version:** ${latestRelease.version}`);
        if (latestRelease.features?.length) {
            parts.push('\n**New Features:**');
            latestRelease.features.forEach(feature => parts.push(`• ${feature}`));
        }
        if (latestRelease.improvements?.length) {
            parts.push('\n**Improvements:**');
            latestRelease.improvements.forEach(improvement => parts.push(`• ${improvement}`));
        }
        if (latestRelease.bugfixes?.length) {
            parts.push('\n**Bug Fixes:**');
            latestRelease.bugfixes.forEach(fix => parts.push(`• ${fix}`));
        }
        let description = parts.join('\n') || 'No release notes provided.';
        if (description.length > 4096) {
            description = description.substring(0, 4093) + '...';
        }

        const fields: Array<{ name: string; value: string }> = [];
        if (releaseNotes.length > 1) {
            const previousReleases = releaseNotes
                .slice(1, 6)
                .map(release => {
                    const displayName = release.title || release.version;
                    return release.url ? `[${displayName}](${release.url})` : `**${displayName}**`;
                })
                .join('\n');
            if (previousReleases) {
                fields.push({ name: 'Previous Releases', value: previousReleases });
            }
        }

        await ctx.editReply({
            embeds: [
                {
                    title: `Release Notes: ${latestRelease.title || latestRelease.version}`,
                    url: latestRelease.url,
                    color: 0x5865f2,
                    description,
                    fields,
                    timestamp: new Date(latestRelease.date).toISOString(),
                },
            ],
        });
    } catch {
        await ctx.editReply('Unable to load release notes at this time.');
    }
}

/** "View Date Sent" message context command */
export async function handleViewDateSent(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const targetId = intr.data?.target_id;
    const message = targetId ? intr.data?.resolved?.messages?.[targetId] : undefined;
    if (!message) {
        await ctx.editReply('Could not resolve the target message.');
        return;
    }
    const unix = Math.floor(new Date(message.timestamp).getTime() / 1000);
    await ctx.editReply(`This message was sent <t:${unix}:R> (<t:${unix}:F>).`);
}

/** "View Date Joined" user context command */
export async function handleViewDateJoined(ctx: CommandContext): Promise<void> {
    const intr = ctx.intr;
    const targetId = intr.data?.target_id;
    const member = targetId ? intr.data?.resolved?.members?.[targetId] : undefined;
    if (!member?.joined_at) {
        await ctx.editReply('Could not resolve the join date for that user.');
        return;
    }
    const unix = Math.floor(new Date(member.joined_at).getTime() / 1000);
    await ctx.editReply(`This user joined <t:${unix}:R> (<t:${unix}:F>).`);
}
