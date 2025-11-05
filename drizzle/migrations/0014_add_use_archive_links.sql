-- Add column for enabling archive.is links for paywalled content per feed
ALTER TABLE feeds
ADD COLUMN use_archive_links BOOLEAN NOT NULL DEFAULT false;

