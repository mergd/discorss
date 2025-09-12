-- Add column for configuring feeds to ignore error notifications
ALTER TABLE feeds
ADD COLUMN ignore_errors BOOLEAN NOT NULL DEFAULT false;