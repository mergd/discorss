export type Feed = {
    id: string;
    url: string;
    channelId: string;
    guildId: string;
    nickname?: string | null;
    category?: string | null;
    summarize: boolean;
    useArchiveLinks: boolean;
    suppressLinkPreview: boolean;
    disabled: boolean;
    frequencyOverrideMinutes?: number | null;
    consecutiveFailures: number;
    lastChecked?: string | null;
};

export type Guild = {
    id: string;
    name: string;
    iconUrl: string | null;
};

export type Channel = {
    id: string;
    name: string;
    type: 'text' | 'announcement';
};

export type AuthUser = {
    id: string;
    username: string;
    avatar: string | null;
};
