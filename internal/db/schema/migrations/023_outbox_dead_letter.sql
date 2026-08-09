-- 023_outbox_dead_letter.sql - Outbox 死信机制
-- outbox_events 增加 attempts / status（pending / sent / dead）；连续失败进入 dead_events 供人工处理。
ALTER TABLE outbox_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
UPDATE outbox_events SET status = 'sent' WHERE published_at != 0;

CREATE TABLE IF NOT EXISTS dead_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    dead_at INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
);
