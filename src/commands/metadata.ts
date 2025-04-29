import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js';

import { Args } from './index.js';

export const ChatCommandMetadata: {
    [command: string]: RESTPostAPIChatInputApplicationCommandsJSONBody;
} = {
    DEV: {
        type: ApplicationCommandType.ChatInput,
        name: 'dev',
        description: 'Developer commands',
        dm_permission: true,
        default_member_permissions: PermissionsBitField.resolve([
            PermissionFlagsBits.Administrator,
        ]).toString(),
        options: [
            {
                ...Args.DEV_COMMAND,
                required: true,
            },
        ],
    },
    HELP: {
        type: ApplicationCommandType.ChatInput,
        name: 'help',
        description: 'Show help information',
        dm_permission: true,
        default_member_permissions: undefined,
        options: [
            {
                ...Args.HELP_OPTION,
                required: true,
            },
        ],
    },
    INFO: {
        type: ApplicationCommandType.ChatInput,
        name: 'info',
        description: 'Show information about the bot',
        dm_permission: true,
        default_member_permissions: undefined,
        options: [
            {
                ...Args.INFO_OPTION,
                required: true,
            },
        ],
    },
    TEST: {
        type: ApplicationCommandType.ChatInput,
        name: 'test',
        description: 'Run a test command',
        dm_permission: true,
        default_member_permissions: undefined,
    },
    FEED: {
        type: ApplicationCommandType.ChatInput,
        name: 'feed',
        description: 'Manage RSS feeds for this server.',
        dm_permission: false,
        default_member_permissions: undefined,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'add',
                description: 'Add a new RSS feed to a channel.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'url',
                        description: 'The URL of the RSS feed.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Channel,
                        name: 'channel',
                        description: 'Channel to post updates to (defaults to current channel)',
                        required: false,
                        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    },
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'nickname',
                        description: 'An optional nickname for the feed.',
                        required: false,
                    },
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'category',
                        description: 'An optional category for the feed.',
                        required: false,
                    },
                    {
                        type: ApplicationCommandOptionType.Integer,
                        name: 'frequency',
                        description:
                            'Polling frequency in minutes (1-1440). Overrides category frequency.',
                        required: false,
                        min_value: 1,
                        max_value: 1440,
                    },
                    {
                        type: ApplicationCommandOptionType.Boolean,
                        name: 'summarize',
                        description: 'Enable AI summaries for this feed (default: off)',
                        required: false,
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'remove',
                description: 'Remove an RSS feed from a channel.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'feed_id',
                        description: 'The ID or nickname of the feed to remove.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Channel,
                        name: 'channel',
                        description: 'Channel the feed is in (defaults to current channel)',
                        required: false,
                        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'list',
                description: 'List active RSS feeds.',
                options: [
                    {
                        type: ApplicationCommandOptionType.Channel,
                        name: 'channel',
                        description: 'List feeds only for a specific channel.',
                        required: false,
                        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'test',
                description: 'Test an RSS feed URL and show a preview.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'url',
                        description: 'The URL of the RSS feed to test.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Boolean,
                        name: 'summarize',
                        description:
                            'Attempt to generate an AI summary of the latest item (default: false)',
                        required: false,
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'edit',
                description: 'Edit the details of an existing RSS feed.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'feed_id',
                        description: 'The ID, Short ID, or Nickname of the feed to edit.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Channel,
                        name: 'channel',
                        description: 'Channel the feed is in (defaults to current channel).',
                        required: false,
                        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    },
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'nickname',
                        description: 'Set a new nickname for the feed.',
                        required: false,
                    },
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'category',
                        description: 'Set a new category for the feed.',
                        required: false,
                    },
                    {
                        type: ApplicationCommandOptionType.Integer,
                        name: 'frequency',
                        description: 'Set a specific polling frequency in minutes (1-1440).',
                        required: false,
                        min_value: 1,
                        max_value: 1440,
                    },
                    {
                        type: ApplicationCommandOptionType.Boolean,
                        name: 'summarize',
                        description: 'Enable or disable AI summaries for this feed',
                        required: false,
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'poke',
                description: 'Manually check the latest entry for a configured feed.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'feed_id',
                        description: 'The ID, Short ID, or Nickname of the feed to poke.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Channel,
                        name: 'channel',
                        description: 'Channel the feed is in (defaults to current channel).',
                        required: false,
                        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    },
                ],
            },
        ],
    },
    CATEGORY: {
        type: ApplicationCommandType.ChatInput,
        name: 'category',
        description: 'Manage feed categories and their polling frequencies.',
        dm_permission: false,
        default_member_permissions: undefined,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'setfrequency',
                description: 'Set the polling frequency (in minutes) for a category.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'category',
                        description: 'The name of the category.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Integer,
                        name: 'minutes',
                        description: 'Polling frequency in minutes (1-1440). Default: 10.',
                        required: true,
                        min_value: 1,
                        max_value: 1440,
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'list',
                description: 'List configured categories and their frequencies.',
                options: [],
            },
        ],
    },
    YOUTUBE: {
        type: ApplicationCommandType.ChatInput,
        name: 'youtube',
        description: 'Add a YouTube channel feed to this server.',
        dm_permission: false,
        default_member_permissions: undefined,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'add',
                description: 'Add a new YouTube channel feed to a channel.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'channel_id',
                        description: 'The YouTube channel ID.',
                        required: true,
                    },
                    {
                        type: ApplicationCommandOptionType.Boolean,
                        name: 'summarize',
                        description: 'Enable AI summaries for this YouTube feed (default: off)',
                        required: false,
                    },
                ],
            },
        ],
    },
};

export const MessageCommandMetadata: {
    [command: string]: RESTPostAPIContextMenuApplicationCommandsJSONBody;
} = {
    VIEW_DATE_SENT: {
        type: ApplicationCommandType.Message,
        name: 'View Date Sent',
        default_member_permissions: undefined,
        dm_permission: true,
    },
};

export const UserCommandMetadata: {
    [command: string]: RESTPostAPIContextMenuApplicationCommandsJSONBody;
} = {
    VIEW_DATE_JOINED: {
        type: ApplicationCommandType.User,
        name: 'View Date Joined',
        default_member_permissions: undefined,
        dm_permission: true,
    },
};
