-- 021_processed_events.sql - 外部事件幂等台账
-- 所有外部事件（如支付网关回调）以 event_key 唯一键登记，防止重复处理。
CREATE TABLE IF NOT EXISTS processed_events (
    event_key TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at INTEGER NOT NULL
);
