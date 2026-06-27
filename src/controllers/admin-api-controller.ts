import { ChannelType, Client } from 'discord.js';
import { Request, Response, Router } from 'express';
import router from 'express-promise-router';

import {
    MAX_FREQUENCY_MINUTES,
    MIN_FREQUENCY_MINUTES,
} from '../constants/misc.js';
import { requireAdminSession } from '../middleware/require-admin-session.js';
import { FeedStorageService } from '../services/feed-storage-service.js';
import { getManageableGuilds, hasGuildAccess } from '../services/admin-guild-access.js';
import { detectAndConvertTwitterUrl } from '../utils/twitter-url.js';
import { parseFeedUrl } from '../utils/rss-parser.js';
import { Controller } from './controller.js';

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

export class AdminApiController implements Controller {
    public path = '/api';
    public router: Router = router();

    constructor(private client: Client) {}

    public register(): void {
        this.router.use(requireAdminSession);

        this.router.get('/guilds', (req, res) => this.listGuilds(req, res));
        this.router.get('/guilds/:guildId/channels', (req, res) => this.listChannels(req, res));
        this.router.get('/guilds/:guildId/feeds', (req, res) => this.listFeeds(req, res));
        this.router.post('/guilds/:guildId/feeds', (req, res) => this.addFeed(req, res));
        this.router.patch('/guilds/:guildId/feeds/:feedId', (req, res) =>
            this.updateFeed(req, res)
        );
        this.router.delete('/guilds/:guildId/feeds/:feedId', (req, res) =>
            this.deleteFeed(req, res)
        );
    }

    private async assertGuildAccess(req: Request, guildId: string): Promise<boolean> {
        return hasGuildAccess(req.adminSession!, this.client, guildId);
    }

    private async listGuilds(req: Request, res: Response): Promise<void> {
        const manageable = await getManageableGuilds(req.adminSession!, this.client);

        res.json({
            guilds: manageable.map(g => ({
                id: g.id,
                name: g.name,
                iconUrl: guildIconUrl(g.id, g.icon),
            })),
            user: {
                avatarUrl: userAvatarUrl(req.adminSession!.userId, req.adminSession!.avatar),
            },
        });
    }

    private async listChannels(req: Request, res: Response): Promise<void> {
        const { guildId } = req.params;
        if (!(await this.assertGuildAccess(req, guildId))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Guild not found' });
            return;
        }

        const channels = guild.channels.cache
            .filter(
                ch =>
                    ch.type === ChannelType.GuildText ||
                    ch.type === ChannelType.GuildAnnouncement
            )
            .map(ch => ({
                id: ch.id,
                name: ch.name,
                type: ch.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text',
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json({ channels });
    }

    private async listFeeds(req: Request, res: Response): Promise<void> {
        const { guildId } = req.params;
        const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : undefined;

        if (!(await this.assertGuildAccess(req, guildId))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const feeds = await FeedStorageService.getFeeds(guildId, channelId);
        res.json({ feeds });
    }

    private async addFeed(req: Request, res: Response): Promise<void> {
        const { guildId } = req.params;
        const { url, channelId, nickname, summarize, useArchiveLinks, suppressLinkPreview, category, frequencyOverrideMinutes } =
            req.body ?? {};

        if (!(await this.assertGuildAccess(req, guildId))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        if (typeof url !== 'string' || !url.startsWith('http')) {
            res.status(400).json({ error: 'Invalid URL' });
            return;
        }

        if (typeof channelId !== 'string') {
            res.status(400).json({ error: 'channelId is required' });
            return;
        }

        const guild = this.client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(channelId);
        if (
            !channel ||
            (channel.type !== ChannelType.GuildText &&
                channel.type !== ChannelType.GuildAnnouncement)
        ) {
            res.status(400).json({ error: 'Invalid channel' });
            return;
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
                res.status(400).json({ error: 'Feed is empty or invalid' });
                return;
            }
            if (!finalNickname && feed.title) {
                finalNickname = feed.title.trim();
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to parse feed';
            res.status(400).json({ error: message });
            return;
        }

        if (
            frequencyOverrideMinutes != null &&
            (typeof frequencyOverrideMinutes !== 'number' ||
                frequencyOverrideMinutes < MIN_FREQUENCY_MINUTES ||
                frequencyOverrideMinutes > MAX_FREQUENCY_MINUTES)
        ) {
            res.status(400).json({
                error: `Frequency must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
            });
            return;
        }

        try {
            const feedId = await FeedStorageService.addFeed({
                url: feedUrl,
                channelId,
                guildId,
                nickname: finalNickname,
                category: typeof category === 'string' ? category.trim() || null : null,
                addedBy: req.adminSession!.userId,
                summarize: Boolean(summarize),
                useArchiveLinks: Boolean(useArchiveLinks),
                suppressLinkPreview: Boolean(suppressLinkPreview),
                frequencyOverrideMinutes: frequencyOverrideMinutes ?? null,
            });

            res.status(201).json({
                id: feedId,
                convertedFromTwitter: twitterCheck.isTwitter ? url : undefined,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to add feed';
            res.status(409).json({ error: message });
        }
    }

    private async updateFeed(req: Request, res: Response): Promise<void> {
        const { guildId, feedId } = req.params;
        const { channelId, ...updates } = req.body ?? {};

        if (!(await this.assertGuildAccess(req, guildId))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        if (typeof channelId !== 'string') {
            res.status(400).json({ error: 'channelId is required' });
            return;
        }

        if (
            updates.frequencyOverrideMinutes != null &&
            (typeof updates.frequencyOverrideMinutes !== 'number' ||
                updates.frequencyOverrideMinutes < MIN_FREQUENCY_MINUTES ||
                updates.frequencyOverrideMinutes > MAX_FREQUENCY_MINUTES)
        ) {
            res.status(400).json({
                error: `Frequency must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
            });
            return;
        }

        const allowed: Record<string, unknown> = {};
        if ('nickname' in updates) allowed.nickname = updates.nickname ?? null;
        if ('category' in updates) allowed.category = updates.category ?? null;
        if ('frequencyOverrideMinutes' in updates)
            allowed.frequencyOverrideMinutes = updates.frequencyOverrideMinutes;
        if ('summarize' in updates) allowed.summarize = Boolean(updates.summarize);
        if ('useArchiveLinks' in updates) allowed.useArchiveLinks = Boolean(updates.useArchiveLinks);
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

        const ok = await FeedStorageService.updateFeedDetails(
            feedId,
            channelId,
            guildId,
            allowed
        );

        if (!ok) {
            res.status(404).json({ error: 'Feed not found' });
            return;
        }

        res.json({ ok: true });
    }

    private async deleteFeed(req: Request, res: Response): Promise<void> {
        const { guildId, feedId } = req.params;
        const channelId =
            typeof req.query.channelId === 'string'
                ? req.query.channelId
                : req.body?.channelId;

        if (!(await this.assertGuildAccess(req, guildId))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        if (typeof channelId !== 'string') {
            res.status(400).json({ error: 'channelId is required' });
            return;
        }

        const ok = await FeedStorageService.removeFeed(feedId, channelId, guildId);
        if (!ok) {
            res.status(404).json({ error: 'Feed not found' });
            return;
        }

        res.status(204).end();
    }
}
