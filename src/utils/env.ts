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
    OPENROUTER_API_KEY: getEnvVar('OPENROUTER_API_KEY', true),
    FEEDBACK_WEBHOOK_URL: getEnvVar('FEEDBACK_WEBHOOK_URL', true),
    POSTHOG_API_KEY: getEnvVar('POSTHOG_API_KEY', true),
};
