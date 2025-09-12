-- Add column for tracking the last error message sent to channel
ALTER TABLE feeds
ADD COLUMN last_error_message_at TIMESTAMP;