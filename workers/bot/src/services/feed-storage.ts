import { and, asc, count, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

import { MAX_RECENT_LINKS } from '../constants.js';
import { getDb } from '../db/index.js';
import { categories, feedFailures, feeds, guilds } from '../db/schema.js';
import { isYouTubeFeed } from '../utils.js';

export interface FeedConfig {
    id: string;
    url: string;
    channelId: string;
    guildId: string;
    nickname?: string | null;
    category?: string | null;
    addedBy: string;
    lastItemGuid?: string | null;
    consecutiveFailures: number;
    frequencyOverrideMinutes?: number | null;
    createdAt: Date;
    lastChecked?: Date | null;
    summarize: boolean;
    useArchiveLinks: boolean;
    suppressLinkPreview: boolean;
    lastArticleSummary?: string | null;
    lastCommentsSummary?: string | null;
    recentLinks?: string[] | null;
    lastFailureNotificationAt?: Date | null;
    lastErrorMessageAt?: Date | null;
    backoffUntil?: Date | null;
    ignoreErrors: boolean;
    disableFailureNotifications: boolean;
    disabled: boolean;
    language?: string | null;
    skipYoutubeShorts?: boolean | null;
    skipYoutubeLivestreams?: boolean | null;
}

/** Lightweight shape used by the poll scheduler */
export interface FeedPollConfig {
    id: string;
    guildId: string;
    category?: string | null;
    frequencyOverrideMinutes?: number | null;
    lastChecked?: Date | null;
    backoffUntil?: Date | null;
}

export interface FeedRuntimeConfig {
    id: string;
    url: string;
    channelId: string;
    guildId: string;
    nickname?: string | null;
    category?: string | null;
    lastItemGuid?: string | null;
    consecutiveFailures: number;
    frequencyOverrideMinutes?: number | null;
    summarize: boolean;
    useArchiveLinks: boolean;
    suppressLinkPreview: boolean;
    recentLinks?: string[] | null;
    backoffUntil?: Date | null;
    ignoreErrors: boolean;
    disableFailureNotifications: boolean;
    disabled: boolean;
    language?: string | null;
    skipYoutubeShorts?: boolean | null;
    skipYoutubeLivestreams?: boolean | null;
}

export interface CategoryConfig {
    guildId: string;
    name: string;
    frequencyMinutes: number;
}

function subHours(date: Date, hours: number): Date {
    return new Date(date.getTime() - hours * 60 * 60 * 1000);
}

function subDays(date: Date, days: number): Date {
    return subHours(date, days * 24);
}

function parseRecentLinks(jsonString: string | null | undefined): string[] {
    if (!jsonString) return [];
    try {
        const links = JSON.parse(jsonString);
        return Array.isArray(links) ? links : [];
    } catch {
        return [];
    }
}

export class FeedStorageService {
    public static async addFeed(
        feedData: Omit<
            FeedConfig,
            | 'id'
            | 'consecutiveFailures'
            | 'createdAt'
            | 'lastChecked'
            | 'lastArticleSummary'
            | 'lastCommentsSummary'
            | 'recentLinks'
            | 'lastFailureNotificationAt'
            | 'lastErrorMessageAt'
            | 'backoffUntil'
            | 'ignoreErrors'
            | 'disableFailureNotifications'
            | 'disabled'
        > &
            Partial<Pick<FeedConfig, 'ignoreErrors' | 'disableFailureNotifications' | 'disabled'>>
    ): Promise<string> {
        const id = uuidv4();
        const newFeed = {
            id,
            ...feedData,
            nickname: feedData.nickname || null,
            category: feedData.category || null,
            frequencyOverrideMinutes: feedData.frequencyOverrideMinutes ?? null,
            summarize: feedData.summarize ?? false,
            useArchiveLinks: feedData.useArchiveLinks ?? false,
            suppressLinkPreview: feedData.suppressLinkPreview ?? false,
            skipYoutubeShorts:
                feedData.skipYoutubeShorts !== undefined
                    ? feedData.skipYoutubeShorts
                    : isYouTubeFeed(feedData)
                      ? true
                      : null,
            skipYoutubeLivestreams:
                feedData.skipYoutubeLivestreams !== undefined
                    ? feedData.skipYoutubeLivestreams
                    : isYouTubeFeed(feedData)
                      ? true
                      : null,
            recentLinks: JSON.stringify([]),
            lastFailureNotificationAt: null,
            lastErrorMessageAt: null,
            backoffUntil: null,
            ignoreErrors: feedData.ignoreErrors ?? false,
            disableFailureNotifications: feedData.disableFailureNotifications ?? false,
            disabled: feedData.disabled ?? false,
        };

        try {
            await getDb().insert(feeds).values(newFeed);
            return id;
        } catch (error: any) {
            if (String(error?.message ?? '').includes('UNIQUE constraint failed')) {
                throw new Error(
                    `Feed with URL ${feedData.url} already exists in this channel (guild: ${feedData.guildId}, channel: ${feedData.channelId}).`
                );
            }
            console.error('Error adding feed:', error);
            throw new Error(
                `Failed to add feed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public static async removeFeed(
        feedId: string,
        channelId: string,
        guildId: string
    ): Promise<boolean> {
        try {
            const result = await getDb()
                .delete(feeds)
                .where(
                    and(
                        eq(feeds.id, feedId),
                        eq(feeds.channelId, channelId),
                        eq(feeds.guildId, guildId)
                    )
                )
                .returning({ deletedId: feeds.id });
            return result.length > 0;
        } catch (error) {
            console.error(`Error removing feed with ID ${feedId}:`, error);
            return false;
        }
    }

    public static async getFeeds(guildId: string, channelId?: string): Promise<FeedConfig[]> {
        try {
            const results = await getDb()
                .select()
                .from(feeds)
                .where(
                    channelId
                        ? and(eq(feeds.guildId, guildId), eq(feeds.channelId, channelId))
                        : eq(feeds.guildId, guildId)
                )
                .orderBy(asc(feeds.channelId), asc(feeds.createdAt));

            return results.map(feed => ({
                ...feed,
                recentLinks: parseRecentLinks(feed.recentLinks),
            }));
        } catch (error) {
            console.error(`Error getting feeds for guild ${guildId}:`, error);
            return [];
        }
    }

    /** All non-disabled feeds with the fields the scheduler needs to decide due-ness. */
    public static async getAllFeedsForPolling(): Promise<FeedPollConfig[]> {
        return getDb()
            .select({
                id: feeds.id,
                guildId: feeds.guildId,
                category: feeds.category,
                frequencyOverrideMinutes: feeds.frequencyOverrideMinutes,
                lastChecked: feeds.lastChecked,
                backoffUntil: feeds.backoffUntil,
            })
            .from(feeds)
            .where(eq(feeds.disabled, false));
    }

    public static async getFeedById(feedId: string): Promise<FeedConfig | null> {
        try {
            const result = await getDb().select().from(feeds).where(eq(feeds.id, feedId)).limit(1);
            if (result.length === 0) return null;
            const feed = result[0];
            return { ...feed, recentLinks: parseRecentLinks(feed.recentLinks) };
        } catch (error) {
            console.error(`Error getting feed by ID ${feedId}:`, error);
            return null;
        }
    }

    public static async getFeedRuntimeById(feedId: string): Promise<FeedRuntimeConfig | null> {
        try {
            const result = await getDb()
                .select({
                    id: feeds.id,
                    url: feeds.url,
                    channelId: feeds.channelId,
                    guildId: feeds.guildId,
                    nickname: feeds.nickname,
                    category: feeds.category,
                    lastItemGuid: feeds.lastItemGuid,
                    consecutiveFailures: feeds.consecutiveFailures,
                    frequencyOverrideMinutes: feeds.frequencyOverrideMinutes,
                    summarize: feeds.summarize,
                    useArchiveLinks: feeds.useArchiveLinks,
                    suppressLinkPreview: feeds.suppressLinkPreview,
                    recentLinks: feeds.recentLinks,
                    backoffUntil: feeds.backoffUntil,
                    ignoreErrors: feeds.ignoreErrors,
                    disableFailureNotifications: feeds.disableFailureNotifications,
                    disabled: feeds.disabled,
                    language: feeds.language,
                    skipYoutubeShorts: feeds.skipYoutubeShorts,
                    skipYoutubeLivestreams: feeds.skipYoutubeLivestreams,
                })
                .from(feeds)
                .where(eq(feeds.id, feedId))
                .limit(1);

            if (result.length === 0) return null;
            const feed = result[0];
            return { ...feed, recentLinks: parseRecentLinks(feed.recentLinks) };
        } catch (error) {
            console.error(`Error getting runtime feed by ID ${feedId}:`, error);
            return null;
        }
    }

    public static async searchFeeds(
        guildId: string,
        query: string,
        currentChannelId?: string
    ): Promise<FeedConfig[]> {
        try {
            const normalizedQuery = query.toLowerCase().trim();
            const allGuildFeeds = await this.getFeeds(guildId);

            const matchingFeeds = allGuildFeeds.filter(feed => {
                const nicknameMatch = feed.nickname?.toLowerCase().includes(normalizedQuery);
                const urlMatch = feed.url.toLowerCase().includes(normalizedQuery);
                const idMatch =
                    feed.id.toLowerCase() === normalizedQuery ||
                    feed.id.toLowerCase().startsWith(normalizedQuery);
                const shortIdMatch = feed.id.substring(0, 8).toLowerCase() === normalizedQuery;
                return nicknameMatch || urlMatch || idMatch || shortIdMatch;
            });

            if (matchingFeeds.length > 0 && currentChannelId) {
                const currentChannelFeeds = matchingFeeds.filter(
                    f => f.channelId === currentChannelId
                );
                const otherChannelFeeds = matchingFeeds.filter(
                    f => f.channelId !== currentChannelId
                );
                return [...currentChannelFeeds, ...otherChannelFeeds];
            }

            if (matchingFeeds.length === 0) {
                return this.fuzzySearchFeeds(allGuildFeeds, normalizedQuery, currentChannelId);
            }

            return matchingFeeds;
        } catch (error) {
            console.error(`Error searching feeds for guild ${guildId}:`, error);
            return [];
        }
    }

    private static fuzzySearchFeeds(
        allFeeds: FeedConfig[],
        query: string,
        currentChannelId?: string
    ): FeedConfig[] {
        const scoredFeeds = allFeeds.map(feed => {
            let score = 0;
            if (feed.nickname) {
                const nicknameLower = feed.nickname.toLowerCase();
                if (nicknameLower.includes(query)) score += 10;
                score += this.calculateSimilarity(query, nicknameLower) * 5;
            }
            const urlLower = feed.url.toLowerCase();
            if (urlLower.includes(query)) score += 8;
            score += this.calculateSimilarity(query, urlLower) * 3;
            if (currentChannelId && feed.channelId === currentChannelId) score += 5;
            return { feed, score };
        });

        const filteredFeeds = scoredFeeds.filter(item => item.score > 0);

        if (currentChannelId) {
            const currentChannelFeeds = filteredFeeds.filter(
                item => item.feed.channelId === currentChannelId
            );
            const otherChannelFeeds = filteredFeeds.filter(
                item => item.feed.channelId !== currentChannelId
            );
            currentChannelFeeds.sort((a, b) => b.score - a.score);
            otherChannelFeeds.sort((a, b) => b.score - a.score);
            return [...currentChannelFeeds, ...otherChannelFeeds].map(item => item.feed);
        }

        return filteredFeeds.sort((a, b) => b.score - a.score).map(item => item.feed);
    }

    private static calculateSimilarity(str1: string, str2: string): number {
        if (str1 === str2) return 1.0;
        if (str2.includes(str1)) return 0.8;
        if (str1.includes(str2)) return 0.6;

        let commonChars = 0;
        const str2Chars = str2.split('');
        for (const char of str1.split('')) {
            if (str2Chars.includes(char)) commonChars++;
        }
        const maxLength = Math.max(str1.length, str2.length);
        return maxLength > 0 ? commonChars / maxLength : 0;
    }

    public static async updateFeedDetails(
        feedId: string,
        channelId: string,
        guildId: string,
        updates: {
            nickname?: string | null;
            category?: string | null;
            frequencyOverrideMinutes?: number | null;
            summarize?: boolean | null;
            useArchiveLinks?: boolean | null;
            suppressLinkPreview?: boolean | null;
            lastArticleSummary?: string | null;
            lastCommentsSummary?: string | null;
            ignoreErrors?: boolean | null;
            disableFailureNotifications?: boolean | null;
            disabled?: boolean | null;
            language?: string | null;
            skipYoutubeShorts?: boolean | null;
            skipYoutubeLivestreams?: boolean | null;
        }
    ): Promise<boolean> {
        const valuesToUpdate: Partial<typeof feeds.$inferInsert> = {};
        if ('nickname' in updates) valuesToUpdate.nickname = updates.nickname;
        if ('category' in updates) valuesToUpdate.category = updates.category;
        if ('frequencyOverrideMinutes' in updates)
            valuesToUpdate.frequencyOverrideMinutes = updates.frequencyOverrideMinutes;
        if ('summarize' in updates) valuesToUpdate.summarize = updates.summarize ?? undefined;
        if ('useArchiveLinks' in updates)
            valuesToUpdate.useArchiveLinks = updates.useArchiveLinks ?? undefined;
        if ('suppressLinkPreview' in updates)
            valuesToUpdate.suppressLinkPreview = updates.suppressLinkPreview ?? undefined;
        if ('lastArticleSummary' in updates)
            valuesToUpdate.lastArticleSummary = updates.lastArticleSummary;
        if ('lastCommentsSummary' in updates)
            valuesToUpdate.lastCommentsSummary = updates.lastCommentsSummary;
        if ('ignoreErrors' in updates)
            valuesToUpdate.ignoreErrors = updates.ignoreErrors ?? undefined;
        if ('disableFailureNotifications' in updates)
            valuesToUpdate.disableFailureNotifications =
                updates.disableFailureNotifications ?? undefined;
        if ('disabled' in updates) {
            valuesToUpdate.disabled = updates.disabled ?? undefined;
            if (updates.disabled === false) {
                valuesToUpdate.consecutiveFailures = 0;
                valuesToUpdate.backoffUntil = null;
            }
        }
        if ('language' in updates) valuesToUpdate.language = updates.language;
        if ('skipYoutubeShorts' in updates)
            valuesToUpdate.skipYoutubeShorts = updates.skipYoutubeShorts;
        if ('skipYoutubeLivestreams' in updates)
            valuesToUpdate.skipYoutubeLivestreams = updates.skipYoutubeLivestreams;

        if (Object.keys(valuesToUpdate).length === 0) {
            return true;
        }

        try {
            const result = await getDb()
                .update(feeds)
                .set(valuesToUpdate)
                .where(
                    and(
                        eq(feeds.id, feedId),
                        eq(feeds.channelId, channelId),
                        eq(feeds.guildId, guildId)
                    )
                )
                .returning({ updatedId: feeds.id });
            return result.length > 0;
        } catch (error) {
            console.error(`Error updating feed details for ${feedId}:`, error);
            return false;
        }
    }

    public static async updateLastItemGuid(
        feedId: string,
        lastItemGuid: string | null
    ): Promise<void> {
        try {
            await getDb()
                .update(feeds)
                .set({ lastItemGuid, lastChecked: new Date() })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating last item GUID for feed ${feedId}:`, error);
        }
    }

    public static async updateRecentLinks(feedId: string, newLinks: string[]): Promise<void> {
        if (newLinks.length === 0) return;
        try {
            const currentFeed = await this.getFeedRuntimeById(feedId);
            if (!currentFeed) return;

            const currentLinks = currentFeed.recentLinks || [];
            const uniqueLinks = [...new Set([...newLinks, ...currentLinks])];
            const cappedLinks = uniqueLinks.slice(0, MAX_RECENT_LINKS);

            await getDb()
                .update(feeds)
                .set({ recentLinks: JSON.stringify(cappedLinks) })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating recent links for feed ${feedId}:`, error);
        }
    }

    public static async recordFailure(feedId: string, errorMessage?: string): Promise<void> {
        try {
            await getDb().insert(feedFailures).values({
                feedId,
                errorMessage: errorMessage || null,
            });

            const [currentFeed] = await getDb()
                .select({ consecutiveFailures: feeds.consecutiveFailures })
                .from(feeds)
                .where(eq(feeds.id, feedId));

            const newConsecutiveFailures = (currentFeed?.consecutiveFailures || 0) + 1;
            const updateData: Partial<typeof feeds.$inferInsert> = {
                lastChecked: new Date(),
                consecutiveFailures: newConsecutiveFailures,
            };
            // Auto-mute error notifications for very noisy feeds
            if (newConsecutiveFailures > 4) {
                updateData.ignoreErrors = true;
            }

            await getDb().update(feeds).set(updateData).where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error recording failure for feed ${feedId}:`, error);
        }
    }

    public static async getFailureCountLast24h(feedId: string): Promise<number> {
        try {
            const twentyFourHoursAgo = subHours(new Date(), 24);
            const result = await getDb()
                .select({ value: count() })
                .from(feedFailures)
                .where(
                    and(
                        eq(feedFailures.feedId, feedId),
                        gte(feedFailures.timestamp, twentyFourHoursAgo)
                    )
                );
            return result[0]?.value || 0;
        } catch (error) {
            console.error(`Error getting recent failure count for feed ${feedId}:`, error);
            return 0;
        }
    }

    public static async clearFeedFailures(feedId: string): Promise<void> {
        try {
            await getDb().delete(feedFailures).where(eq(feedFailures.feedId, feedId));
            await getDb()
                .update(feeds)
                .set({ consecutiveFailures: 0 })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error clearing failures for feed ${feedId}:`, error);
        }
    }

    /**
     * Stamps lastChecked for a set of feeds at enqueue time so a slow check
     * (e.g. summarizing several items) is not re-enqueued by the next cron tick.
     */
    public static async markPolled(feedIds: string[]): Promise<void> {
        if (feedIds.length === 0) return;
        try {
            // D1 allows at most 100 bound parameters per query
            for (let i = 0; i < feedIds.length; i += 90) {
                await getDb()
                    .update(feeds)
                    .set({ lastChecked: new Date() })
                    .where(inArray(feeds.id, feedIds.slice(i, i + 90)));
            }
        } catch (error) {
            console.error('Error marking feeds as polled:', error);
        }
    }

    public static async updateLastChecked(feedId: string): Promise<void> {
        try {
            await getDb()
                .update(feeds)
                .set({ lastChecked: new Date() })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating last checked timestamp for feed ${feedId}:`, error);
        }
    }

    public static async getLastFailureNotificationAt(feedId: string): Promise<Date | null> {
        try {
            const result = await getDb()
                .select({ lastFailureNotificationAt: feeds.lastFailureNotificationAt })
                .from(feeds)
                .where(eq(feeds.id, feedId))
                .limit(1);
            return result[0]?.lastFailureNotificationAt ?? null;
        } catch (error) {
            console.error(`Error getting last failure notification for feed ${feedId}:`, error);
            return null;
        }
    }

    public static async setLastFailureNotificationNow(feedId: string): Promise<void> {
        try {
            await getDb()
                .update(feeds)
                .set({ lastFailureNotificationAt: new Date() })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error setting last failure notification for feed ${feedId}:`, error);
        }
    }

    public static async clearLastFailureNotification(feedId: string): Promise<void> {
        try {
            await getDb()
                .update(feeds)
                .set({ lastFailureNotificationAt: null })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error clearing last failure notification for feed ${feedId}:`, error);
        }
    }

    public static async setBackoffUntil(feedId: string, until: Date): Promise<void> {
        try {
            await getDb().update(feeds).set({ backoffUntil: until }).where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error setting backoffUntil for feed ${feedId}:`, error);
        }
    }

    public static async clearBackoffUntil(feedId: string): Promise<void> {
        try {
            await getDb().update(feeds).set({ backoffUntil: null }).where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error clearing backoffUntil for feed ${feedId}:`, error);
        }
    }

    public static async getFeedIdsByCategory(
        guildId: string,
        category: string,
        excludeFeedId?: string
    ): Promise<string[]> {
        try {
            const conditions = [eq(feeds.guildId, guildId), eq(feeds.category, category)];
            if (excludeFeedId) {
                conditions.push(ne(feeds.id, excludeFeedId));
            }
            const results = await getDb()
                .select({ id: feeds.id, backoffUntil: feeds.backoffUntil })
                .from(feeds)
                .where(and(...conditions));
            return results.map(r => r.id);
        } catch (error) {
            console.error(`Error getting feed IDs by category for guild ${guildId}:`, error);
            return [];
        }
    }

    public static async getBackoffUntil(feedId: string): Promise<Date | null> {
        try {
            const result = await getDb()
                .select({ backoffUntil: feeds.backoffUntil })
                .from(feeds)
                .where(eq(feeds.id, feedId))
                .limit(1);
            return result[0]?.backoffUntil ?? null;
        } catch (error) {
            console.error(`Error getting backoffUntil for feed ${feedId}:`, error);
            return null;
        }
    }

    // --- Categories ---

    public static async setCategoryFrequency(
        guildId: string,
        name: string,
        frequencyMinutes: number
    ): Promise<void> {
        const nameLower = name.toLowerCase();
        await getDb()
            .insert(categories)
            .values({ guildId, name, nameLower, frequencyMinutes })
            .onConflictDoUpdate({
                target: [categories.guildId, categories.nameLower],
                set: { frequencyMinutes, name },
            });
    }

    public static async getGuildCategories(guildId: string): Promise<CategoryConfig[]> {
        try {
            return await getDb()
                .select({
                    guildId: categories.guildId,
                    name: categories.name,
                    frequencyMinutes: categories.frequencyMinutes,
                })
                .from(categories)
                .where(eq(categories.guildId, guildId))
                .orderBy(asc(categories.name));
        } catch (error) {
            console.error(`Error getting categories for guild ${guildId}:`, error);
            return [];
        }
    }

    public static async getAllCategoryConfigs(): Promise<CategoryConfig[]> {
        try {
            return await getDb()
                .select({
                    guildId: categories.guildId,
                    name: categories.name,
                    frequencyMinutes: categories.frequencyMinutes,
                })
                .from(categories);
        } catch (error) {
            console.error('Error getting all category configs:', error);
            return [];
        }
    }

    // --- Error message rate limiting ---

    public static async getLastErrorMessageAt(feedId: string): Promise<Date | null> {
        try {
            const result = await getDb()
                .select({ lastErrorMessageAt: feeds.lastErrorMessageAt })
                .from(feeds)
                .where(eq(feeds.id, feedId))
                .limit(1);
            return result[0]?.lastErrorMessageAt ?? null;
        } catch (error) {
            console.error(`Error getting last error message timestamp for feed ${feedId}:`, error);
            return null;
        }
    }

    public static async updateLastErrorMessageAt(feedId: string): Promise<void> {
        try {
            await getDb()
                .update(feeds)
                .set({ lastErrorMessageAt: new Date() })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating last error message timestamp for ${feedId}:`, error);
        }
    }

    public static async canSendErrorMessage(
        feedId: string,
        rateLimitHours: number = 1
    ): Promise<boolean> {
        try {
            const lastErrorMessageAt = await this.getLastErrorMessageAt(feedId);
            if (!lastErrorMessageAt) return true;
            const timeSinceLastError = Date.now() - lastErrorMessageAt.getTime();
            return timeSinceLastError >= rateLimitHours * 60 * 60 * 1000;
        } catch (error) {
            console.error(`Error checking error message rate limit for feed ${feedId}:`, error);
            return true;
        }
    }

    // --- Guild language ---

    public static async setGuildLanguage(guildId: string, language: string | null): Promise<void> {
        await getDb()
            .insert(guilds)
            .values({ guildId, language: language || null, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: [guilds.guildId],
                set: { language: language || null, updatedAt: new Date() },
            });
    }

    public static async getGuildLanguage(guildId: string): Promise<string | null> {
        try {
            const result = await getDb()
                .select({ language: guilds.language })
                .from(guilds)
                .where(eq(guilds.guildId, guildId))
                .limit(1);
            return result[0]?.language ?? null;
        } catch (error) {
            console.error(`Error getting guild language for ${guildId}:`, error);
            return null;
        }
    }

    public static async getEffectiveLanguage(
        feedId: string,
        guildId: string
    ): Promise<string | null> {
        try {
            const feed = await this.getFeedRuntimeById(feedId);
            if (feed?.language) return feed.language;
            return await this.getGuildLanguage(guildId);
        } catch (error) {
            console.error(`Error getting effective language for feed ${feedId}:`, error);
            return null;
        }
    }

    // --- Failures / auto-disable ---

    public static async getFeedFailures(
        feedId?: string,
        guildId?: string,
        limit: number = 30
    ): Promise<
        Array<{
            failureId: number;
            timestamp: Date;
            errorMessage: string | null;
            feedId: string;
            feedUrl: string;
            feedNickname: string | null;
            guildId: string;
            channelId: string;
            consecutiveFailures: number;
            ignoreErrors: boolean;
        }>
    > {
        try {
            const conditions = [];
            if (feedId) conditions.push(eq(feedFailures.feedId, feedId));
            if (guildId) conditions.push(eq(feeds.guildId, guildId));

            const base = getDb()
                .select({
                    failureId: feedFailures.id,
                    timestamp: feedFailures.timestamp,
                    errorMessage: feedFailures.errorMessage,
                    feedId: feedFailures.feedId,
                    feedUrl: feeds.url,
                    feedNickname: feeds.nickname,
                    guildId: feeds.guildId,
                    channelId: feeds.channelId,
                    consecutiveFailures: feeds.consecutiveFailures,
                    ignoreErrors: feeds.ignoreErrors,
                })
                .from(feedFailures)
                .innerJoin(feeds, eq(feedFailures.feedId, feeds.id));

            const query = conditions.length > 0 ? base.where(and(...conditions)) : base;
            return await query.orderBy(desc(feedFailures.timestamp)).limit(limit);
        } catch (error) {
            console.error('Error getting feed failures:', error);
            return [];
        }
    }

    private static extractStatusCode(errorMessage: string | null): number | null {
        if (!errorMessage) return null;
        const statusMatch = errorMessage.match(/status code (\d{3})/i);
        return statusMatch ? parseInt(statusMatch[1], 10) : null;
    }

    public static async shouldAutoDisableDeadFeed(feedId: string): Promise<boolean> {
        try {
            const threeDaysAgo = subDays(new Date(), 3);
            const failures = await getDb()
                .select({
                    timestamp: feedFailures.timestamp,
                    errorMessage: feedFailures.errorMessage,
                })
                .from(feedFailures)
                .where(
                    and(eq(feedFailures.feedId, feedId), gte(feedFailures.timestamp, threeDaysAgo))
                );

            if (failures.length === 0) return false;

            const allDeadErrors = failures.every(failure => {
                const statusCode = this.extractStatusCode(failure.errorMessage);
                return statusCode !== null && statusCode >= 400 && statusCode < 500;
            });

            return allDeadErrors && failures.length >= 3;
        } catch (error) {
            console.error(`Error checking auto-disable (dead) for feed ${feedId}:`, error);
            return false;
        }
    }

    public static async shouldAutoDisableServerErrorFeed(feedId: string): Promise<boolean> {
        try {
            const oneWeekAgo = subDays(new Date(), 7);
            const failures = await getDb()
                .select({
                    timestamp: feedFailures.timestamp,
                    errorMessage: feedFailures.errorMessage,
                })
                .from(feedFailures)
                .where(
                    and(eq(feedFailures.feedId, feedId), gte(feedFailures.timestamp, oneWeekAgo))
                );

            if (failures.length === 0) return false;

            const allServerErrors = failures.every(failure => {
                const statusCode = this.extractStatusCode(failure.errorMessage);
                return statusCode !== null && statusCode >= 500;
            });

            return allServerErrors && failures.length >= 3;
        } catch (error) {
            console.error(`Error checking auto-disable (server error) for feed ${feedId}:`, error);
            return false;
        }
    }

    public static async autoDisableFeed(feedId: string, reason: string): Promise<void> {
        try {
            await getDb().update(feeds).set({ disabled: true }).where(eq(feeds.id, feedId));
            console.log(`[FeedStorage] Auto-disabled feed ${feedId}: ${reason}`);
        } catch (error) {
            console.error(`Error auto-disabling feed ${feedId}:`, error);
        }
    }

    public static async cleanupOldFailures(olderThanDays: number = 7): Promise<number> {
        try {
            const cutoffDate = subDays(new Date(), olderThanDays);
            const result = await getDb()
                .delete(feedFailures)
                .where(lt(feedFailures.timestamp, cutoffDate))
                .returning({ deletedId: feedFailures.id });
            return result.length;
        } catch (error) {
            console.error('Error cleaning up old feed failures:', error);
            return 0;
        }
    }
}
