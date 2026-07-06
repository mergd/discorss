// Raw application command definitions (Discord API v10 JSON shape).
// Option types: 1=SUB_COMMAND, 2=SUB_COMMAND_GROUP, 3=STRING, 4=INTEGER, 5=BOOLEAN, 7=CHANNEL
// Command types: 1=CHAT_INPUT, 2=USER, 3=MESSAGE

const TEXT_CHANNEL_TYPES = [0, 5]; // GuildText, GuildAnnouncement

const languageOption = {
    type: 3,
    name: 'language',
    description:
        'Language code for summaries (e.g., en, es, fr, de). Overrides server language.',
    required: false,
};

const channelOption = (description: string) => ({
    type: 7,
    name: 'channel',
    description,
    required: false,
    channel_types: TEXT_CHANNEL_TYPES,
});

export const COMMAND_METADATA: any[] = [
    {
        type: 1,
        name: 'dev',
        description: 'Developer commands',
        dm_permission: true,
        default_member_permissions: '8', // Administrator
        options: [
            {
                type: 3,
                name: 'command',
                description: 'Developer command to run',
                required: true,
                choices: [{ name: 'info', value: 'INFO' }],
            },
        ],
    },
    {
        type: 1,
        name: 'help',
        description: 'Show help information',
        dm_permission: true,
        options: [
            {
                type: 3,
                name: 'option',
                description: 'Help topic',
                required: false,
                choices: [
                    { name: 'commands', value: 'COMMANDS' },
                    { name: 'contactsupport', value: 'CONTACT_SUPPORT' },
                ],
            },
        ],
    },
    {
        type: 1,
        name: 'info',
        description: 'Show information about the bot',
        dm_permission: true,
        options: [
            {
                type: 3,
                name: 'option',
                description: 'Info topic',
                required: true,
                choices: [{ name: 'about', value: 'ABOUT' }],
            },
        ],
    },
    {
        type: 1,
        name: 'servers',
        description: 'Show how many servers have this bot installed',
        dm_permission: true,
    },
    {
        type: 1,
        name: 'feedback',
        description: 'Send feedback to the developer',
        dm_permission: true,
        options: [
            {
                type: 3,
                name: 'message',
                description: 'The feedback message',
                required: true,
            },
        ],
    },
    {
        type: 1,
        name: 'releasenotes',
        description: 'View the latest release notes',
        dm_permission: true,
    },
    {
        type: 1,
        name: 'feed',
        description: 'Manage RSS feeds for this server.',
        dm_permission: false,
        options: [
            {
                type: 1,
                name: 'add',
                description: 'Add a new RSS feed to a channel.',
                options: [
                    {
                        type: 3,
                        name: 'url',
                        description: 'The URL of the RSS feed.',
                        required: true,
                    },
                    channelOption('Channel to post updates to (defaults to current channel)'),
                    {
                        type: 3,
                        name: 'nickname',
                        description: 'An optional nickname for the feed.',
                        required: false,
                    },
                    {
                        type: 3,
                        name: 'category',
                        description: 'An optional category for the feed.',
                        required: false,
                    },
                    {
                        type: 4,
                        name: 'frequency',
                        description:
                            'Polling frequency in minutes (3-1440). Overrides category frequency.',
                        required: false,
                        min_value: 3,
                        max_value: 1440,
                    },
                    {
                        type: 5,
                        name: 'summarize',
                        description: 'Enable AI summaries for this feed (default: off)',
                        required: false,
                    },
                    {
                        type: 5,
                        name: 'use_archive_links',
                        description:
                            'Enable archive.is links for all links (default: only for paywalled sites)',
                        required: false,
                    },
                    {
                        type: 5,
                        name: 'suppress_link_preview',
                        description:
                            'Disable Discord link previews for posted items (default: off)',
                        required: false,
                    },
                    languageOption,
                ],
            },
            {
                type: 1,
                name: 'remove',
                description: 'Remove an RSS feed from a channel.',
                options: [
                    {
                        type: 3,
                        name: 'feed_id',
                        description: 'The ID or nickname of the feed to remove.',
                        required: true,
                    },
                    channelOption('Channel the feed is in (defaults to current channel)'),
                ],
            },
            {
                type: 1,
                name: 'list',
                description: 'List active RSS feeds.',
                options: [channelOption('List feeds only for a specific channel.')],
            },
            {
                type: 1,
                name: 'test',
                description: 'Test an RSS feed URL and show a preview.',
                options: [
                    {
                        type: 3,
                        name: 'url',
                        description: 'The URL of the RSS feed to test.',
                        required: true,
                    },
                    {
                        type: 5,
                        name: 'summarize',
                        description:
                            'Attempt to generate an AI summary of the latest item (default: false)',
                        required: false,
                    },
                ],
            },
            {
                type: 1,
                name: 'edit',
                description: 'Edit the details of an existing RSS feed.',
                options: [
                    {
                        type: 3,
                        name: 'feed_id',
                        description: 'The ID, Short ID, or Nickname of the feed to edit.',
                        required: true,
                    },
                    channelOption('Channel the feed is in (defaults to current channel).'),
                    {
                        type: 3,
                        name: 'nickname',
                        description: 'Set a new nickname for the feed.',
                        required: false,
                    },
                    {
                        type: 3,
                        name: 'category',
                        description: 'Set a new category for the feed.',
                        required: false,
                    },
                    {
                        type: 4,
                        name: 'frequency',
                        description: 'Set a specific polling frequency in minutes (3-1440).',
                        required: false,
                        min_value: 3,
                        max_value: 1440,
                    },
                    {
                        type: 5,
                        name: 'summarize',
                        description: 'Enable or disable AI summaries for this feed',
                        required: false,
                    },
                    {
                        type: 5,
                        name: 'use_archive_links',
                        description:
                            'Enable archive.is links for all links (default: only for paywalled sites)',
                        required: false,
                    },
                    {
                        type: 5,
                        name: 'suppress_link_preview',
                        description:
                            'Disable Discord link previews for posted items (default: off)',
                        required: false,
                    },
                    languageOption,
                    {
                        type: 5,
                        name: 'enabled',
                        description:
                            'Enable or disable polling for this feed (re-enables auto-disabled feeds)',
                        required: false,
                    },
                ],
            },
            {
                type: 1,
                name: 'poke',
                description: 'Manually check the latest entry for a configured feed.',
                options: [
                    {
                        type: 3,
                        name: 'feed_id',
                        description: 'The ID, Short ID, or Nickname of the feed to poke.',
                        required: true,
                    },
                    channelOption('Channel the feed is in (defaults to current channel).'),
                ],
            },
            {
                type: 1,
                name: 'setlanguage',
                description: 'Set the default language for all feed summaries in this server.',
                options: [
                    {
                        type: 3,
                        name: 'language',
                        description:
                            'Language code (e.g., en, es, fr, de). Leave empty to reset to default.',
                        required: false,
                    },
                ],
            },
            {
                type: 1,
                name: 'errors',
                description: 'View feed errors for this server or a specific feed.',
                options: [
                    {
                        type: 3,
                        name: 'feed_id',
                        description: 'The ID or nickname of the feed to view errors for (optional).',
                        required: false,
                    },
                    {
                        type: 4,
                        name: 'limit',
                        description: 'Maximum number of errors to show (default: 10, max: 30).',
                        required: false,
                        min_value: 1,
                        max_value: 30,
                    },
                ],
            },
        ],
    },
    {
        type: 1,
        name: 'category',
        description: 'Manage feed categories and their polling frequencies.',
        dm_permission: false,
        options: [
            {
                type: 1,
                name: 'setfrequency',
                description: 'Set the polling frequency (in minutes) for a category.',
                options: [
                    {
                        type: 3,
                        name: 'category',
                        description: 'The name of the category.',
                        required: true,
                    },
                    {
                        type: 4,
                        name: 'minutes',
                        description: 'Polling frequency in minutes (3-1440). Default: 10.',
                        required: true,
                        min_value: 3,
                        max_value: 1440,
                    },
                ],
            },
            {
                type: 1,
                name: 'list',
                description: 'List configured categories and their frequencies.',
                options: [],
            },
        ],
    },
    {
        type: 1,
        name: 'youtube',
        description: 'Add a YouTube channel feed to this server.',
        dm_permission: false,
        options: [
            {
                type: 1,
                name: 'add',
                description: 'Add a new YouTube channel feed to a channel.',
                options: [
                    {
                        type: 3,
                        name: 'channel_id',
                        description: 'The YouTube channel ID.',
                        required: true,
                    },
                    {
                        type: 5,
                        name: 'summarize',
                        description: 'Enable AI summaries for this YouTube feed (default: off)',
                        required: false,
                    },
                ],
            },
        ],
    },
    {
        type: 3,
        name: 'View Date Sent',
        dm_permission: true,
    },
    {
        type: 2,
        name: 'View Date Joined',
        dm_permission: true,
    },
];
