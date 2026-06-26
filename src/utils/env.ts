function getEnvVar(key: string, optional = false): string {
    const value = process.env[key];
    if (!value || value.trim() === '') {
        if (optional) {
            return '';
        }
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

export const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: getEnvVar('DATABASE_URL'),
    DISCORD_CLIENT_ID: getEnvVar('DISCORD_CLIENT_ID'),
    DISCORD_BOT_TOKEN: getEnvVar('DISCORD_BOT_TOKEN'),
    DEVELOPER_IDS: getEnvVar('DEVELOPER_IDS'),
    OPENAI_API_KEY: getEnvVar('OPENAI_API_KEY', true),
    OPENROUTER_API_KEY: getEnvVar('OPENROUTER_API_KEY', true),
    FEEDBACK_WEBHOOK_URL: getEnvVar('FEEDBACK_WEBHOOK_URL', true),
    POSTHOG_API_KEY: getEnvVar('POSTHOG_API_KEY', true),
    FETCH_PROXY_URL: getEnvVar('FETCH_PROXY_URL', true),
    FETCH_PROXY_SECRET: getEnvVar('FETCH_PROXY_SECRET', true),
    DISCORD_CLIENT_SECRET: getEnvVar('DISCORD_CLIENT_SECRET', true),
    ADMIN_SESSION_SECRET: getEnvVar('ADMIN_SESSION_SECRET', true),
    ADMIN_OAUTH_REDIRECT_URI: getEnvVar('ADMIN_OAUTH_REDIRECT_URI', true),
};

export function isAdminOAuthConfigured(): boolean {
    return !!(
        env.DISCORD_CLIENT_SECRET &&
        env.ADMIN_SESSION_SECRET &&
        env.ADMIN_OAUTH_REDIRECT_URI
    );
}
