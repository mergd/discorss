CREATE TABLE IF NOT EXISTS system_notifications (
    notification_key TEXT PRIMARY KEY,
    last_sent_at INTEGER NOT NULL
);
