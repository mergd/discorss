import {
    ApplicationCommand,
    Channel,
    Client,
    DiscordAPIError,
    RESTJSONErrorCodes as DiscordApiErrors,
    Guild,
    GuildMember,
    Locale,
    NewsChannel,
    Role,
    StageChannel,
    TextChannel,
    User,
    VoiceChannel,
    TextBasedChannel,
    GuildChannel,
} from 'discord.js';

import { PermissionUtils, RegexUtils } from './index.js';

const FETCH_MEMBER_LIMIT = 20;
const IGNORED_ERRORS = [
    DiscordApiErrors.UnknownMessage,
    DiscordApiErrors.UnknownChannel,
    DiscordApiErrors.UnknownGuild,
    DiscordApiErrors.UnknownMember,
    DiscordApiErrors.UnknownUser,
    DiscordApiErrors.UnknownInteraction,
    DiscordApiErrors.MissingAccess,
];

export class ClientUtils {
    public static async getGuild(client: Client, discordId: string): Promise<Guild> {
        discordId = RegexUtils.discordId(discordId);
        if (!discordId) {
            return;
        }

        try {
            return await client.guilds.fetch(discordId);
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async getChannel(client: Client, discordId: string): Promise<Channel> {
        discordId = RegexUtils.discordId(discordId);
        if (!discordId) {
            return;
        }

        try {
            return await client.channels.fetch(discordId);
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async getUser(client: Client, discordId: string): Promise<User> {
        discordId = RegexUtils.discordId(discordId);
        if (!discordId) {
            return;
        }

        try {
            return await client.users.fetch(discordId);
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async findAppCommand(client: Client, name: string): Promise<ApplicationCommand> {
        let commands = await client.application.commands.fetch();
        return commands.find(command => command.name === name);
    }

    public static async findMember(guild: Guild, input: string): Promise<GuildMember> {
        try {
            let discordId = RegexUtils.discordId(input);
            if (discordId) {
                return await guild.members.fetch(discordId);
            }

            let tag = RegexUtils.tag(input);
            if (tag) {
                return (
                    await guild.members.fetch({ query: tag.username, limit: FETCH_MEMBER_LIMIT })
                ).find(member => member.user.discriminator === tag.discriminator);
            }

            return (await guild.members.fetch({ query: input, limit: 1 })).first();
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async findRole(guild: Guild, input: string): Promise<Role> {
        try {
            let discordId = RegexUtils.discordId(input);
            if (discordId) {
                return await guild.roles.fetch(discordId);
            }

            let search = input.trim().toLowerCase().replace(/^@/, '');
            let roles = await guild.roles.fetch();
            return (
                roles.find(role => role.name.toLowerCase() === search) ??
                roles.find(role => role.name.toLowerCase().includes(search))
            );
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async findTextChannel(
        guild: Guild,
        input: string
    ): Promise<NewsChannel | TextChannel> {
        try {
            let discordId = RegexUtils.discordId(input);
            if (discordId) {
                let channel = await guild.channels.fetch(discordId);
                if (channel instanceof NewsChannel || channel instanceof TextChannel) {
                    return channel;
                } else {
                    return;
                }
            }

            let search = input.trim().toLowerCase().replace(/^#/, '').replaceAll(' ', '-');
            let channels = [...(await guild.channels.fetch()).values()].filter(
                channel => channel instanceof NewsChannel || channel instanceof TextChannel
            );
            return (
                channels.find(channel => channel.name.toLowerCase() === search) ??
                channels.find(channel => channel.name.toLowerCase().includes(search))
            );
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async findVoiceChannel(
        guild: Guild,
        input: string
    ): Promise<VoiceChannel | StageChannel> {
        try {
            let discordId = RegexUtils.discordId(input);
            if (discordId) {
                let channel = await guild.channels.fetch(discordId);
                if (channel instanceof VoiceChannel || channel instanceof StageChannel) {
                    return channel;
                } else {
                    return;
                }
            }

            let search = input.trim().toLowerCase().replace(/^#/, '');
            let channels = [...(await guild.channels.fetch()).values()].filter(
                channel => channel instanceof VoiceChannel || channel instanceof StageChannel
            );
            return (
                channels.find(channel => channel.name.toLowerCase() === search) ??
                channels.find(channel => channel.name.toLowerCase().includes(search))
            );
        } catch (error) {
            if (
                error instanceof DiscordAPIError &&
                typeof error.code == 'number' &&
                IGNORED_ERRORS.includes(error.code)
            ) {
                return;
            } else {
                throw error;
            }
        }
    }

    public static async findNotifyChannel(
        guild: Guild,
        langCode: string
    ): Promise<TextBasedChannel> {
        // Find channel with administrator permissions
        // prioritize channel names: 'bot-updates', 'bot-log', 'system-messages'
        // Can remove langCode parameter if no longer needed

        let targetChannelNames = ['bot-updates', 'bot-log', 'system-messages'];

        let channels = [...guild.channels.cache.values()].filter(
            channel =>
                channel instanceof GuildChannel &&
                PermissionUtils.canSend(channel, true) &&
                targetChannelNames.includes(channel.name)
        ) as GuildChannel[];

        // Sort by position
        channels.sort((first, second) => first.position - second.position);

        // Send to first channel with highest position
        if (channels.length > 0) {
            return channels[0] as TextBasedChannel;
        }

        // Else find the first channel with SEND_MESSAGE permission
        return [...guild.channels.cache.values()].find(
            channel => channel instanceof GuildChannel && PermissionUtils.canSend(channel, true)
        ) as TextBasedChannel;
    }
}
