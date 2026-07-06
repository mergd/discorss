export interface Env {
    // Bindings
    FEED_QUEUE: Queue<FeedQueueMessage>;
    ASSETS: Fetcher;
    DB: D1Database;

    // Secrets / vars
    DISCORD_CLIENT_ID: string;
    DISCORD_BOT_TOKEN: string;
    DISCORD_PUBLIC_KEY: string;
    DEVELOPER_IDS: string;
    OPENAI_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
    FEEDBACK_WEBHOOK_URL?: string;
    POSTHOG_API_KEY?: string;
    DISCORD_CLIENT_SECRET?: string;
    ADMIN_SESSION_SECRET?: string;
    ADMIN_OAUTH_REDIRECT_URI?: string;
}

export interface FeedQueueMessage {
    feedId: string;
}

export function isAdminOAuthConfigured(env: Env): boolean {
    return !!(env.DISCORD_CLIENT_SECRET && env.ADMIN_SESSION_SECRET && env.ADMIN_OAUTH_REDIRECT_URI);
}

export function getAdminOAuthMissingVars(env: Env): string[] {
    const missing: string[] = [];
    if (!env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
    if (!env.ADMIN_SESSION_SECRET) missing.push('ADMIN_SESSION_SECRET');
    if (!env.ADMIN_OAUTH_REDIRECT_URI) missing.push('ADMIN_OAUTH_REDIRECT_URI');
    return missing;
}
