-- Add column for disabling failure threshold notifications for individual feeds
ALTER TABLE feeds
ADD COLUMN disable_failure_notifications BOOLEAN NOT NULL DEFAULT false;
