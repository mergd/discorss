import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// D1/SQLite port of the Postgres schema: uuid -> text, boolean -> integer(boolean),
// timestamp -> integer(timestamp_ms), serial -> integer autoincrement. Column names
// are unchanged so the data snapshot maps 1:1.

// Table for storing feed configurations

export const feeds = sqliteTable('feeds', {
    id: text('id')
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    url: text('url').notNull(),
    channelId: text('channel_id').notNull(),
    guildId: text('guild_id').notNull(),
    nickname: text('nickname'),
    category: text('category'),
    addedBy: text('added_by').notNull(),
    frequencyOverrideMinutes: integer('frequency_override_minutes'),
    lastChecked: integer('last_checked', { mode: 'timestamp_ms' }),
    lastItemGuid: text('last_item_guid'), // GUID of the last successfully sent item
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .$defaultFn(() => new Date()),
    summarize: integer('summarize', { mode: 'boolean' }).notNull().default(false), // AI summarization enabled
    useArchiveLinks: integer('use_archive_links', { mode: 'boolean' }).notNull().default(false), // Enable archive.is links for paywalled content
    suppressLinkPreview: integer('suppress_link_preview', { mode: 'boolean' })
        .notNull()
        .default(false), // Disable Discord OG link previews
    lastArticleSummary: text('last_article_summary'), // Last article summary (nullable)
    lastCommentsSummary: text('last_comments_summary'), // Last comments summary (nullable)
    recentLinks: text('recent_links'), // JSON string array of recently posted links
    lastFailureNotificationAt: integer('last_failure_notification_at', { mode: 'timestamp_ms' }),
    lastErrorMessageAt: integer('last_error_message_at', { mode: 'timestamp_ms' }),
    backoffUntil: integer('backoff_until', { mode: 'timestamp_ms' }),
    ignoreErrors: integer('ignore_errors', { mode: 'boolean' }).notNull().default(false), // Skip error notifications for this feed
    disableFailureNotifications: integer('disable_failure_notifications', { mode: 'boolean' })
        .notNull()
        .default(false), // Skip failure threshold notifications
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false), // Completely disable feed polling (auto-set for dead feeds)
    language: text('language'), // Language code for summaries (e.g., 'en', 'es', 'fr', 'de', etc.) - overrides guild language
    skipYoutubeShorts: integer('skip_youtube_shorts', { mode: 'boolean' }), // null = default (on for YouTube feeds)
    skipYoutubeLivestreams: integer('skip_youtube_livestreams', { mode: 'boolean' }), // null = default (on for YouTube feeds)
});

// Table for storing individual feed failure events (for rolling 24hr checks)
export const feedFailures = sqliteTable('feed_failures', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    feedId: text('feed_id')
        .notNull()
        .references(() => feeds.id, { onDelete: 'cascade' }),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' })
        .notNull()
        .$defaultFn(() => new Date()),
    errorMessage: text('error_message'),
});

// Table for storing category configurations
export const categories = sqliteTable(
    'categories',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        guildId: text('guild_id').notNull(),
        name: text('name').notNull(),
        nameLower: text('name_lower').notNull(), // Keep for case-insensitive lookups/constraints
        frequencyMinutes: integer('frequency_minutes').notNull(),
    },
    table => ({
        // Unique per guild (case-insensitive via nameLower); used as the upsert target
        guildNameLowerUnique: uniqueIndex('categories_guild_name_lower_idx').on(
            table.guildId,
            table.nameLower
        ),
    })
);

// Define relations using the new primary keys
export const feedRelations = relations(feeds, ({ one }) => ({
    categoryRelation: one(categories, {
        fields: [feeds.category],
        references: [categories.name],
    }),
}));

export const categoryRelations = relations(categories, ({ many }) => ({
    feeds: many(feeds),
}));

export const feedsRelations = relations(feeds, ({ many }) => ({
    failures: many(feedFailures),
}));

export const feedFailuresRelations = relations(feedFailures, ({ one }) => ({
    feed: one(feeds, {
        fields: [feedFailures.feedId],
        references: [feeds.id],
    }),
}));

// Table for storing guild-level settings
export const guilds = sqliteTable('guilds', {
    guildId: text('guild_id').primaryKey(),
    language: text('language'), // Language code (e.g., 'en', 'es', 'fr', 'de', etc.)
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .$defaultFn(() => new Date()),
});
