import { subHours } from 'date-fns';
import { and, asc, count, eq, gte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { categories, feedFailures, feeds } from '../db/schema.js';

// Interface for Feed Configuration
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
    lastSummary?: string | null;
    recentLinks?: string[] | null;
}

// Interface for Category Configuration
export interface CategoryConfig {
    guildId: string;
    name: string;
    frequencyMinutes: number;
}

const MAX_RECENT_LINKS = 5;

export class FeedStorageService {
    // --- Feed Operations ---

    /**
     * Adds a new feed configuration using Drizzle.
     * @returns The ID of the newly added feed.
     * @throws Error if a feed with the same URL already exists in the target channel.
     */
    public static async addFeed(
        feedData: Omit<
            FeedConfig,
            | 'id'
            | 'consecutiveFailures'
            | 'createdAt'
            | 'lastChecked'
            | 'lastSummary'
            | 'recentLinks'
        >
    ): Promise<string> {
        const id = uuidv4(); // Generate UUID in application code
        const newFeed = {
            id,
            ...feedData,
            nickname: feedData.nickname || null, // Ensure null if empty/undefined
            category: feedData.category || null,
            frequencyOverrideMinutes: feedData.frequencyOverrideMinutes ?? null,
            summarize: feedData.summarize ?? false,
            // createdAt is handled by defaultNow() in pg schema
            // consecutiveFailures defaults to 0 in pg schema
            recentLinks: JSON.stringify([]), // Initialize with empty JSON array string
        };

        try {
            // Drizzle uses $defaultFn for id if not provided and configured
            // createdAt is handled by PG defaultNow()
            await (db as any).insert(feeds).values(newFeed);
            return id;
        } catch (error: any) {
            // Check for unique constraint violation (adapt based on specific driver/DB)
            // PostgreSQL unique violation code is '23505'
            if (error.code === '23505') {
                // Check if the violation is on our specific unique index
                if (error.constraint === 'feeds_url_channel_guild_unique') {
                    throw new Error(
                        `Feed with URL ${feedData.url} already exists in this channel (guild: ${feedData.guildId}, channel: ${feedData.channelId}).`
                    );
                } else {
                    // Fallback for other unique constraints
                    throw new Error(
                        `Could not add feed due to a unique constraint violation. Please check the details.`
                    );
                }
            }
            console.error('Error adding feed:', error);
            throw new Error(
                `Failed to add feed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Removes a feed configuration using Drizzle.
     * @returns True if a feed was removed, false otherwise.
     */
    public static async removeFeed(
        feedId: string,
        channelId: string,
        guildId: string
    ): Promise<boolean> {
        try {
            const result = await (db as any)
                .delete(feeds)
                .where(
                    and(
                        eq(feeds.id, feedId),
                        eq(feeds.channelId, channelId),
                        eq(feeds.guildId, guildId)
                    )
                )
                .returning({ deletedId: feeds.id }); // Request the ID of the deleted row

            return result.length > 0;
        } catch (error) {
            console.error(`Error removing feed with ID ${feedId}:`, error);
            return false;
        }
    }

    // Helper to parse recentLinks JSON string
    private static parseRecentLinks(jsonString: string | null | undefined): string[] {
        if (!jsonString) return [];
        try {
            const links = JSON.parse(jsonString);
            return Array.isArray(links) ? links : [];
        } catch {
            return []; // Return empty array if parsing fails
        }
    }

    /**
     * Retrieves feed configurations using Drizzle, optionally filtered by channel.
     */
    public static async getFeeds(guildId: string, channelId?: string): Promise<FeedConfig[]> {
        try {
            const query = (db as any)
                .select()
                .from(feeds)
                .where(
                    channelId
                        ? and(eq(feeds.guildId, guildId), eq(feeds.channelId, channelId)) // Filter by guild and channel
                        : eq(feeds.guildId, guildId) // Filter only by guild
                )
                .orderBy(asc(feeds.channelId), asc(feeds.createdAt)); // Consistent ordering

            const results = await query;
            // Parse recentLinks for each feed
            return results.map(feed => ({
                ...feed,
                recentLinks: this.parseRecentLinks(feed.recentLinks),
            }));
        } catch (error) {
            console.error(
                `Error getting feeds for guild ${guildId}${channelId ? ` channel ${channelId}` : ''}:`,
                error
            );
            return []; // Return empty array on error
        }
    }

    /**
     * Retrieves all feed configurations using Drizzle.
     */
    public static async getAllFeeds(): Promise<FeedConfig[]> {
        try {
            const results = await (db as any)
                .select()
                .from(feeds)
                .orderBy(asc(feeds.guildId), asc(feeds.channelId), asc(feeds.createdAt));
            // Parse recentLinks for each feed
            return results.map(feed => ({
                ...feed,
                recentLinks: this.parseRecentLinks(feed.recentLinks),
            }));
        } catch (error) {
            console.error('Error getting all feeds:', error);
            return []; // Return empty array on error
        }
    }

    /**
     * Retrieves a single feed configuration by its ID, parsing recentLinks.
     */
    public static async getFeedById(feedId: string): Promise<FeedConfig | null> {
        try {
            const result = await (db as any)
                .select()
                .from(feeds)
                .where(eq(feeds.id, feedId))
                .limit(1);

            if (result.length === 0) {
                return null;
            }
            const feed = result[0];
            return {
                ...feed,
                recentLinks: this.parseRecentLinks(feed.recentLinks),
            };
        } catch (error) {
            console.error(`Error getting feed by ID ${feedId}:`, error);
            return null;
        }
    }

    /**
     * Updates feed details (nickname, category, frequency, summarize, lastSummary) using Drizzle.
     * @returns True if the feed was found and updated, false otherwise.
     */
    public static async updateFeedDetails(
        feedId: string,
        channelId: string,
        guildId: string,
        updates: {
            nickname?: string | null;
            category?: string | null;
            frequencyOverrideMinutes?: number | null;
            summarize?: boolean | null; // Use boolean directly
            lastSummary?: string | null;
            // Note: recentLinks is handled separately by updateRecentLinks
        }
    ): Promise<boolean> {
        // Build the object with fields to update
        const valuesToUpdate: Partial<typeof feeds.$inferInsert> = {};
        if ('nickname' in updates) valuesToUpdate.nickname = updates.nickname;
        if ('category' in updates) valuesToUpdate.category = updates.category;
        if ('frequencyOverrideMinutes' in updates)
            valuesToUpdate.frequencyOverrideMinutes = updates.frequencyOverrideMinutes;
        if ('summarize' in updates) valuesToUpdate.summarize = updates.summarize;
        if ('lastSummary' in updates) valuesToUpdate.lastSummary = updates.lastSummary;

        if (Object.keys(valuesToUpdate).length === 0) {
            console.log(`[FeedStorageService] No details provided to update for feed ${feedId}`);
            return true; // Nothing to update is considered success
        }

        try {
            const result = await (db as any)
                .update(feeds)
                .set(valuesToUpdate)
                .where(
                    and(
                        eq(feeds.id, feedId),
                        eq(feeds.channelId, channelId),
                        eq(feeds.guildId, guildId)
                    )
                )
                .returning({ updatedId: feeds.id }); // Check if the row was matched and updated

            return result.length > 0;
        } catch (error) {
            console.error(`Error updating feed details for ${feedId}:`, error);
            return false;
        }
    }

    /**
     * Updates the last fetched item's GUID using Drizzle.
     */
    public static async updateLastItemGuid(
        feedId: string,
        lastItemGuid: string | null
    ): Promise<void> {
        try {
            await (db as any)
                .update(feeds)
                .set({
                    lastItemGuid: lastItemGuid,
                    lastChecked: new Date(), // Also update lastChecked on successful item update
                })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating last item GUID for feed ${feedId}:`, error);
            // Optionally re-throw or handle
        }
    }

    /**
     * Updates the list of recent links for a feed.
     * Adds new links, ensures uniqueness, and caps the list size.
     */
    public static async updateRecentLinks(feedId: string, newLinks: string[]): Promise<void> {
        if (newLinks.length === 0) return; // Nothing to add

        try {
            // Retrieve the current links first to merge and cap
            const currentFeed = await this.getFeedById(feedId);
            if (!currentFeed) return; // Feed not found

            const currentLinks = currentFeed.recentLinks || [];
            const combinedLinks = [...newLinks, ...currentLinks];
            // Use Set for efficient deduplication, then convert back to array
            const uniqueLinks = [...new Set(combinedLinks)];
            // Cap the number of links stored
            const cappedLinks = uniqueLinks.slice(0, MAX_RECENT_LINKS);
            const linksJson = JSON.stringify(cappedLinks);

            await (db as any)
                .update(feeds)
                .set({ recentLinks: linksJson })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating recent links for feed ${feedId}:`, error);
        }
    }

    /**
     * Records a feed failure event with a timestamp.
     */
    public static async recordFailure(feedId: string, errorMessage?: string): Promise<void> {
        try {
            await (db as any).insert(feedFailures).values({
                feedId: feedId,
                // timestamp: new Date(), // Handled by defaultNow() in pg schema
                errorMessage: errorMessage || null,
            });
            // Also update the main feed's lastChecked timestamp during a failure
            await (db as any)
                .update(feeds)
                .set({ lastChecked: new Date() })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error recording failure for feed ${feedId}:`, error);
        }
    }

    /**
     * Gets the count of failures for a feed within the last 24 hours.
     */
    public static async getFailureCountLast24h(feedId: string): Promise<number> {
        try {
            const twentyFourHoursAgo = subHours(new Date(), 24);
            const result = await (db as any)
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
            return 0; // Return 0 on error to avoid accidental notifications
        }
    }

    /**
     * Clears all failure records for a specific feed.
     * Typically called after a successful feed check.
     */
    public static async clearFeedFailures(feedId: string): Promise<void> {
        try {
            await (db as any).delete(feedFailures).where(eq(feedFailures.feedId, feedId));
            // Reset consecutiveFailures (legacy, but good practice)
            await (db as any)
                .update(feeds)
                .set({ consecutiveFailures: 0 })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error clearing failures for feed ${feedId}:`, error);
        }
    }

    /**
     * Updates the last checked timestamp for a feed.
     */
    public static async updateLastChecked(feedId: string): Promise<void> {
        try {
            await (db as any)
                .update(feeds)
                .set({ lastChecked: new Date() })
                .where(eq(feeds.id, feedId));
        } catch (error) {
            console.error(`Error updating last checked timestamp for feed ${feedId}:`, error);
        }
    }

    // --- Category Operations ---

    /**
     * Sets (or updates) the frequency for a category in a specific guild using Drizzle's upsert.
     */
    public static async setCategoryFrequency(
        guildId: string,
        name: string,
        frequencyMinutes: number
    ): Promise<void> {
        const nameLower = name.toLowerCase(); // Use lowercase for the key/lookup
        try {
            await (db as any)
                .insert(categories)
                .values({ guildId, name, nameLower, frequencyMinutes })
                .onConflictDoUpdate({
                    target: [categories.guildId, categories.nameLower], // Target the columns in the unique index
                    set: {
                        frequencyMinutes: frequencyMinutes,
                        name: name, // Update original case name too
                    },
                });
        } catch (error) {
            console.error(
                `Error setting category frequency for '${name}' in guild ${guildId}:`,
                error
            );
            throw error; // Re-throw the error for the caller to handle
        }
    }

    /**
     * Retrieves the frequency for a specific category in a guild using Drizzle.
     * @returns The frequency in minutes, or null if the category doesn't exist.
     */
    public static async getCategoryFrequency(
        guildId: string,
        name: string
    ): Promise<number | null> {
        const nameLower = name.toLowerCase();
        try {
            const result = await (db as any)
                .select({ frequencyMinutes: categories.frequencyMinutes })
                .from(categories)
                .where(and(eq(categories.guildId, guildId), eq(categories.nameLower, nameLower)))
                .limit(1);
            return result[0]?.frequencyMinutes ?? null;
        } catch (error) {
            console.error(
                `Error getting category frequency for '${name}' in guild ${guildId}:`,
                error
            );
            return null;
        }
    }

    /**
     * Retrieves all category configurations for a specific guild using Drizzle.
     */
    public static async getGuildCategories(guildId: string): Promise<CategoryConfig[]> {
        try {
            return await (db as any)
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

    /**
     * Deletes a category from a specific guild using Drizzle.
     * @returns True if the category was deleted, false otherwise.
     */
    public static async deleteCategory(guildId: string, name: string): Promise<boolean> {
        const nameLower = name.toLowerCase();
        try {
            const result = await (db as any)
                .delete(categories)
                .where(and(eq(categories.guildId, guildId), eq(categories.nameLower, nameLower)))
                .returning({ deletedName: categories.name });

            return result.length > 0;
        } catch (error) {
            console.error(`Error deleting category '${name}' in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Retrieves all category configurations across all guilds using Drizzle.
     */
    public static async getAllCategoryConfigs(): Promise<CategoryConfig[]> {
        try {
            return await (db as any)
                .select({
                    guildId: categories.guildId,
                    name: categories.name,
                    frequencyMinutes: categories.frequencyMinutes,
                })
                .from(categories)
                .orderBy(asc(categories.guildId), asc(categories.name));
        } catch (error) {
            console.error('Error getting all category configs:', error);
            return [];
        }
    }
}
