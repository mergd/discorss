-- D1 initial schema, ported from the Postgres schema (drizzle/ at repo root).
-- Timestamps are unix epoch milliseconds; booleans are 0/1.

CREATE TABLE IF NOT EXISTS feeds (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    nickname TEXT,
    category TEXT,
    added_by TEXT NOT NULL,
    frequency_override_minutes INTEGER,
    last_checked INTEGER,
    last_item_guid TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    summarize INTEGER NOT NULL DEFAULT 0,
    use_archive_links INTEGER NOT NULL DEFAULT 0,
    suppress_link_preview INTEGER NOT NULL DEFAULT 0,
    last_article_summary TEXT,
    last_comments_summary TEXT,
    recent_links TEXT,
    last_failure_notification_at INTEGER,
    last_error_message_at INTEGER,
    backoff_until INTEGER,
    ignore_errors INTEGER NOT NULL DEFAULT 0,
    disable_failure_notifications INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    language TEXT,
    skip_youtube_shorts INTEGER,
    skip_youtube_livestreams INTEGER
);

CREATE TABLE IF NOT EXISTS feed_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL,
    frequency_minutes INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_guild_name_lower_idx
    ON categories (guild_id, name_lower);

CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    language TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS feeds_guild_id_idx ON feeds (guild_id);
CREATE INDEX IF NOT EXISTS feed_failures_feed_id_timestamp_idx ON feed_failures (feed_id, timestamp);
