import { relations } from 'drizzle-orm';
import {
    boolean,
    integer,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import { v4 as uuidv4 } from 'uuid';

// Table for storing feed configurations

export const feeds = pgTable('feeds', {
    id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv4()), // Generate UUID automatically
    url: text('url').notNull(),
    channelId: text('channel_id').notNull(),
    guildId: text('guild_id').notNull(),
    nickname: text('nickname'),
    category: text('category'),
    addedBy: text('added_by').notNull(),
    frequencyOverrideMinutes: integer('frequency_override_minutes'),
    // Change integer timestamp to native pg timestamp
    // lastChecked: integer('last_checked', { mode: 'timestamp' }), // Store as Unix timestamp (integer)
    lastChecked: timestamp('last_checked', { mode: 'date' }),
    lastItemGuid: text('last_item_guid'), // GUID of the last successfully sent item
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    // Change integer timestamp to native pg timestamp
    // createdAt: integer('created_at', { mode: 'timestamp' })
    //     .notNull()
    //     .$defaultFn(() => new Date()), // Set creation timestamp automatically
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    summarize: boolean('summarize').notNull().default(false), // AI summarization enabled
    lastArticleSummary: text('last_article_summary'), // Last article summary (nullable)
    lastCommentsSummary: text('last_comments_summary'), // Last comments summary (nullable)
    // Add the new column for recent links (store as JSON string)
    recentLinks: text('recent_links'),
    lastFailureNotificationAt: timestamp('last_failure_notification_at', { mode: 'date' }),
    lastErrorMessageAt: timestamp('last_error_message_at', { mode: 'date' }),
    backoffUntil: timestamp('backoff_until', { mode: 'date' }),
    ignoreErrors: boolean('ignore_errors').notNull().default(false), // Skip error notifications for this feed
    disableFailureNotifications: boolean('disable_failure_notifications').notNull().default(false), // Skip failure threshold notifications
});

// Table for storing individual feed failure events (for rolling 24hr checks)
export const feedFailures = pgTable('feed_failures', {
    id: serial('id').primaryKey(), // Auto-incrementing primary key
    feedId: uuid('feed_id')
        .notNull()
        .references(() => feeds.id, { onDelete: 'cascade' }), // Foreign key to feeds table
    timestamp: timestamp('timestamp', { mode: 'date' }).notNull().defaultNow(),
    errorMessage: text('error_message'), // Optional: Store the error message
});

// Table for storing category configurations
export const categories = pgTable(
    'categories',
    {
        // Add a serial primary key for easier relations, keep guildId/nameLower for uniqueness
        id: serial('id').primaryKey(),
        guildId: text('guild_id').notNull(),
        name: text('name').notNull(),
        nameLower: text('name_lower').notNull(), // Keep for case-insensitive lookups/constraints
        frequencyMinutes: integer('frequency_minutes').notNull(),
    },
    table => ({
        // Composite primary key on guildId and nameLower to ensure unique category names per guild (case-insensitive)
        // pk: primaryKey({ columns: [table.guildId, table.nameLower] }),
        // Use a unique index for PostgreSQL instead of composite PK for upsert logic
        guildNameLowerUnique: uniqueIndex('categories_guild_name_lower_idx').on(
            table.guildId,
            table.nameLower
        ),
    })
);

// Define relations using the new primary keys
export const feedRelations = relations(feeds, ({ one }) => ({
    categoryRelation: one(categories, {
        fields: [feeds.category], // Assuming feeds.category links to categories.name
        references: [categories.name], // Link to categories table name (need to ensure uniqueness)
        // Alternatively, add a categoryId to feeds and link to categories.id
    }),
}));

// Example relation for categories (a category can have many feeds)
export const categoryRelations = relations(categories, ({ many }) => ({
    feeds: many(feeds),
}));

// Define relationships (optional but good practice)
export const feedsRelations = relations(feeds, ({ many }) => ({
    failures: many(feedFailures),
}));

export const feedFailuresRelations = relations(feedFailures, ({ one }) => ({
    feed: one(feeds, {
        fields: [feedFailures.feedId],
        references: [feeds.id],
    }),
}));
