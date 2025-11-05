-- Add language column to feeds table for feed-level language override
ALTER TABLE feeds
ADD COLUMN language TEXT;

-- Create guilds table for guild-level language settings
CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    language TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

