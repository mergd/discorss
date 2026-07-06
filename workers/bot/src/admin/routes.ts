import { Hono } from 'hono';

import { DiscordRest } from '../discord/rest.js';
import { ChannelTypes } from '../discord/interaction.js';
import { getAdminOAuthMissingVars, isAdminOAuthConfigured, type Env } from '../env.js';
import { MAX_FREQUENCY_MINUTES, MIN_FREQUENCY_MINUTES } from '../constants.js';
import { parseFeedUrl } from '../feeds/rss.js';
import { FeedStorageService } from '../services/feed-storage.js';
import { detectAndConvertTwitterUrl } from '../utils.js';
import { getManageableGuilds, hasGuildAccess } from './guild-access.js';
import {
    AdminSession,
    buildSession,
    clearSessionCookie,
    createSessionCookie,
    parseSessionCookie,
} from './session.js';
import { exchangeOAuthCode, fetchOAuthUser, getDiscordOAuthUrl } from './oauth.js';

const OAUTH_STATE_COOKIE = 'discorss_oauth_state';

function guildIconUrl(guildId: string, icon: string | null): string | null {
    if (!icon) return null;
    const ext = icon.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}`;
}

function userAvatarUrl(userId: string, avatar: string | null): string | null {
    if (!avatar) return null;
    const ext = avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}`;
}

function getOAuthState(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${OAUTH_STATE_COOKIE}=`));
    return match ? match.slice(OAUTH_STATE_COOKIE.length + 1) : null;
}

type Variables = { session: AdminSession; rest: DiscordRest };

export function createAdminApp(): Hono<{ Bindings: Env; Variables: Variables }> {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();

    // ---- /auth ----

    app.get('/auth/status', c =>
        c.json({
            configured: isAdminOAuthConfigured(c.env),
            missing: getAdminOAuthMissingVars(c.env),
        })
    );

    app.get('/auth/discord', c => {
        if (!isAdminOAuthConfigured(c.env)) {
            return c.redirect('/?error=oauth_not_configured');
        }
        const state = crypto.randomUUID().replaceAll('-', '');
        c.header(
            'Set-Cookie',
            `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`
        );
        return c.redirect(getDiscordOAuthUrl(c.env, state));
    });

    app.get('/auth/callback', async c => {
        const code = c.req.query('code');
        const state = c.req.query('state');
        const error = c.req.query('error');

        if (error) {
            return c.redirect('/?error=oauth_denied');
        }
        if (typeof code !== 'string' || typeof state !== 'string') {
            return c.text('Invalid OAuth callback', 400);
        }

        const savedState = getOAuthState(c.req.header('Cookie') ?? null);
        if (!savedState || savedState !== state) {
            return c.text('Invalid OAuth state', 400);
        }

        try {
            const accessToken = await exchangeOAuthCode(c.env, code);
            const user = await fetchOAuthUser(accessToken);
            const session = buildSession(user, accessToken);

            c.header('Set-Cookie', createSessionCookie(session, c.env.ADMIN_SESSION_SECRET!), {
                append: true,
            });
            c.header(
                'Set-Cookie',
                `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
                { append: true }
            );
            return c.redirect('/');
        } catch {
            return c.redirect('/?error=oauth_failed');
        }
    });

    app.get('/auth/me', c => {
        const session = parseSessionCookie(
            c.req.header('Cookie'),
            c.env.ADMIN_SESSION_SECRET ?? ''
        );
        if (!c.env.ADMIN_SESSION_SECRET || !session) {
            return c.json({ authenticated: false }, 401);
        }
        return c.json({
            authenticated: true,
            user: {
                id: session.userId,
                username: session.username,
                avatar: session.avatar,
            },
        });
    });

    app.post('/auth/logout', c => {
        c.header('Set-Cookie', clearSessionCookie());
        return c.body(null, 204);
    });

    // ---- /api (session required) ----

    app.use('/api/*', async (c, next) => {
        if (!isAdminOAuthConfigured(c.env)) {
            return c.json({ error: 'Admin OAuth not configured' }, 503);
        }
        const session = parseSessionCookie(c.req.header('Cookie'), c.env.ADMIN_SESSION_SECRET!);
        if (!session) {
            return c.json({ error: 'Unauthorized' }, 401);
        }
        c.set('session', session);
        c.set('rest', new DiscordRest(c.env.DISCORD_BOT_TOKEN, c.env.DISCORD_CLIENT_ID));
        await next();
    });

    app.get('/api/guilds', async c => {
        const session = c.get('session');
        const manageable = await getManageableGuilds(session, c.get('rest'));
        return c.json({
            guilds: manageable.map(g => ({
                id: g.id,
                name: g.name,
                iconUrl: guildIconUrl(g.id, g.icon),
            })),
            user: {
                avatarUrl: userAvatarUrl(session.userId, session.avatar),
            },
        });
    });

    app.get('/api/guilds/:guildId/channels', async c => {
        const guildId = c.req.param('guildId');
        const rest = c.get('rest');
        if (!(await hasGuildAccess(c.get('session'), rest, guildId))) {
            return c.json({ error: 'Forbidden' }, 403);
        }

        try {
            const allChannels = await rest.getGuildChannels(guildId);
            const channels = allChannels
                .filter(
                    ch =>
                        ch.type === ChannelTypes.GuildText ||
                        ch.type === ChannelTypes.GuildAnnouncement
                )
                .map(ch => ({
                    id: ch.id,
                    name: ch.name,
                    type: ch.type === ChannelTypes.GuildAnnouncement ? 'announcement' : 'text',
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            return c.json({ channels });
        } catch {
            return c.json({ error: 'Guild not found' }, 404);
        }
    });

    app.get('/api/guilds/:guildId/feeds', async c => {
        const guildId = c.req.param('guildId');
        const channelId = c.req.query('channelId');
        if (!(await hasGuildAccess(c.get('session'), c.get('rest'), guildId))) {
            return c.json({ error: 'Forbidden' }, 403);
        }
        const feeds = await FeedStorageService.getFeeds(guildId, channelId || undefined);
        return c.json({ feeds });
    });

    app.post('/api/guilds/:guildId/feeds', async c => {
        const guildId = c.req.param('guildId');
        const rest = c.get('rest');
        const session = c.get('session');
        const body = await c.req.json().catch(() => ({}));
        const {
            url,
            channelId,
            nickname,
            summarize,
            useArchiveLinks,
            suppressLinkPreview,
            category,
            frequencyOverrideMinutes,
        } = body ?? {};

        if (!(await hasGuildAccess(session, rest, guildId))) {
            return c.json({ error: 'Forbidden' }, 403);
        }
        if (typeof url !== 'string' || !url.startsWith('http')) {
            return c.json({ error: 'Invalid URL' }, 400);
        }
        if (typeof channelId !== 'string') {
            return c.json({ error: 'channelId is required' }, 400);
        }

        const channel = await rest.getChannel(channelId);
        if (
            !channel ||
            (channel.type !== ChannelTypes.GuildText &&
                channel.type !== ChannelTypes.GuildAnnouncement)
        ) {
            return c.json({ error: 'Invalid channel' }, 400);
        }

        let feedUrl = url.trim();
        const twitterCheck = detectAndConvertTwitterUrl(feedUrl);
        if (twitterCheck.isTwitter) {
            feedUrl = twitterCheck.convertedUrl!;
        }

        let finalNickname = typeof nickname === 'string' ? nickname.trim() || null : null;

        try {
            const feed = await parseFeedUrl(feedUrl);
            if (!feed?.items?.length) {
                return c.json({ error: 'Feed is empty or invalid' }, 400);
            }
            if (!finalNickname && feed.title) {
                finalNickname = feed.title.trim();
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to parse feed';
            return c.json({ error: message }, 400);
        }

        if (
            frequencyOverrideMinutes != null &&
            (typeof frequencyOverrideMinutes !== 'number' ||
                frequencyOverrideMinutes < MIN_FREQUENCY_MINUTES ||
                frequencyOverrideMinutes > MAX_FREQUENCY_MINUTES)
        ) {
            return c.json(
                {
                    error: `Frequency must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
                },
                400
            );
        }

        try {
            const feedId = await FeedStorageService.addFeed({
                url: feedUrl,
                channelId,
                guildId,
                nickname: finalNickname,
                category: typeof category === 'string' ? category.trim() || null : null,
                addedBy: session.userId,
                summarize: Boolean(summarize),
                useArchiveLinks: Boolean(useArchiveLinks),
                suppressLinkPreview: Boolean(suppressLinkPreview),
                frequencyOverrideMinutes: frequencyOverrideMinutes ?? null,
            });
            return c.json(
                {
                    id: feedId,
                    convertedFromTwitter: twitterCheck.isTwitter ? url : undefined,
                },
                201
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to add feed';
            return c.json({ error: message }, 409);
        }
    });

    app.patch('/api/guilds/:guildId/feeds/:feedId', async c => {
        const guildId = c.req.param('guildId');
        const feedId = c.req.param('feedId');
        const body = await c.req.json().catch(() => ({}));
        const { channelId, ...updates } = body ?? {};

        if (!(await hasGuildAccess(c.get('session'), c.get('rest'), guildId))) {
            return c.json({ error: 'Forbidden' }, 403);
        }
        if (typeof channelId !== 'string') {
            return c.json({ error: 'channelId is required' }, 400);
        }

        if (
            updates.frequencyOverrideMinutes != null &&
            (typeof updates.frequencyOverrideMinutes !== 'number' ||
                updates.frequencyOverrideMinutes < MIN_FREQUENCY_MINUTES ||
                updates.frequencyOverrideMinutes > MAX_FREQUENCY_MINUTES)
        ) {
            return c.json(
                {
                    error: `Frequency must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
                },
                400
            );
        }

        const allowed: Record<string, unknown> = {};
        if ('nickname' in updates) allowed.nickname = updates.nickname ?? null;
        if ('category' in updates) allowed.category = updates.category ?? null;
        if ('frequencyOverrideMinutes' in updates)
            allowed.frequencyOverrideMinutes = updates.frequencyOverrideMinutes;
        if ('summarize' in updates) allowed.summarize = Boolean(updates.summarize);
        if ('useArchiveLinks' in updates)
            allowed.useArchiveLinks = Boolean(updates.useArchiveLinks);
        if ('suppressLinkPreview' in updates)
            allowed.suppressLinkPreview = Boolean(updates.suppressLinkPreview);
        if ('disabled' in updates) allowed.disabled = Boolean(updates.disabled);
        if ('ignoreErrors' in updates) allowed.ignoreErrors = Boolean(updates.ignoreErrors);
        if ('disableFailureNotifications' in updates)
            allowed.disableFailureNotifications = Boolean(updates.disableFailureNotifications);
        if ('language' in updates)
            allowed.language = typeof updates.language === 'string' ? updates.language : null;
        if ('skipYoutubeShorts' in updates)
            allowed.skipYoutubeShorts = Boolean(updates.skipYoutubeShorts);
        if ('skipYoutubeLivestreams' in updates)
            allowed.skipYoutubeLivestreams = Boolean(updates.skipYoutubeLivestreams);

        const ok = await FeedStorageService.updateFeedDetails(feedId, channelId, guildId, allowed);
        if (!ok) {
            return c.json({ error: 'Feed not found' }, 404);
        }
        return c.json({ ok: true });
    });

    app.delete('/api/guilds/:guildId/feeds/:feedId', async c => {
        const guildId = c.req.param('guildId');
        const feedId = c.req.param('feedId');
        const channelId =
            c.req.query('channelId') ??
            ((await c.req.json().catch(() => ({}))) as { channelId?: string })?.channelId;

        if (!(await hasGuildAccess(c.get('session'), c.get('rest'), guildId))) {
            return c.json({ error: 'Forbidden' }, 403);
        }
        if (typeof channelId !== 'string') {
            return c.json({ error: 'channelId is required' }, 400);
        }

        const ok = await FeedStorageService.removeFeed(feedId, channelId, guildId);
        if (!ok) {
            return c.json({ error: 'Feed not found' }, 404);
        }
        return c.body(null, 204);
    });

    return app;
}
