import { randomBytes } from 'node:crypto';
import { Request, Response, Router } from 'express';
import router from 'express-promise-router';

import {
    buildSession,
    clearSessionCookie,
    createSessionCookie,
    parseSessionCookie,
} from '../services/admin-session.js';
import {
    exchangeOAuthCode,
    fetchOAuthUser,
    getDiscordOAuthUrl,
} from '../services/discord-oauth-service.js';
import { env } from '../utils/env.js';
import { getAdminOAuthMissingVars, isAdminOAuthConfigured } from '../utils/admin-oauth.js';
import { Controller } from './controller.js';

const OAUTH_STATE_COOKIE = 'discorss_oauth_state';

function setOAuthStateCookie(state: string): string {
    return `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`;
}

function clearOAuthStateCookie(): string {
    return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getOAuthState(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${OAUTH_STATE_COOKIE}=`));
    return match ? match.slice(OAUTH_STATE_COOKIE.length + 1) : null;
}

export class AuthController implements Controller {
    public path = '/auth';
    public router: Router = router();

    public register(): void {
        this.router.get('/status', (_req, res) => this.getStatus(res));
        this.router.get('/discord', (req, res) => this.startDiscordOAuth(req, res));
        this.router.get('/callback', (req, res) => this.handleCallback(req, res));
        this.router.get('/me', (req, res) => this.getMe(req, res));
        this.router.post('/logout', (req, res) => this.logout(req, res));
    }

    private getStatus(res: Response): void {
        res.json({
            configured: isAdminOAuthConfigured(),
            missing: getAdminOAuthMissingVars(),
        });
    }

    private startDiscordOAuth(_req: Request, res: Response): void {
        if (!isAdminOAuthConfigured()) {
            res.redirect('/?error=oauth_not_configured');
            return;
        }

        const state = randomBytes(16).toString('hex');
        res.setHeader('Set-Cookie', setOAuthStateCookie(state));
        res.redirect(getDiscordOAuthUrl(state));
    }

    private async handleCallback(req: Request, res: Response): Promise<void> {
        const { code, state, error } = req.query;

        if (error || typeof error === 'string') {
            res.redirect('/?error=oauth_denied');
            return;
        }

        if (typeof code !== 'string' || typeof state !== 'string') {
            res.status(400).send('Invalid OAuth callback');
            return;
        }

        const savedState = getOAuthState(req.headers.cookie);
        if (!savedState || savedState !== state) {
            res.status(400).send('Invalid OAuth state');
            return;
        }

        try {
            const accessToken = await exchangeOAuthCode(code);
            const user = await fetchOAuthUser(accessToken);
            const session = buildSession(user, accessToken);

            res.setHeader('Set-Cookie', [
                createSessionCookie(session, env.ADMIN_SESSION_SECRET),
                clearOAuthStateCookie(),
            ]);
            res.redirect('/');
        } catch {
            res.redirect('/?error=oauth_failed');
        }
    }

    private getMe(req: Request, res: Response): void {
        const session = parseSessionCookie(req.headers.cookie, env.ADMIN_SESSION_SECRET);
        if (!session) {
            res.status(401).json({ authenticated: false });
            return;
        }

        res.json({
            authenticated: true,
            user: {
                id: session.userId,
                username: session.username,
                avatar: session.avatar,
            },
        });
    }

    private logout(_req: Request, res: Response): void {
        res.setHeader('Set-Cookie', clearSessionCookie());
        res.status(204).end();
    }
}
