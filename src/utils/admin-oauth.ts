import { env, isAdminOAuthConfigured } from '../utils/env.js';

export function getAdminOAuthMissingVars(): string[] {
    const missing: string[] = [];
    if (!env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
    if (!env.ADMIN_SESSION_SECRET) missing.push('ADMIN_SESSION_SECRET');
    if (!env.ADMIN_OAUTH_REDIRECT_URI) missing.push('ADMIN_OAUTH_REDIRECT_URI');
    return missing;
}

export { isAdminOAuthConfigured };
