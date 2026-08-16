-- 013_low_stock_reminders.sql - 低库存提醒冷却迁移到独立表（替代 settings 键膨胀）
CREATE TABLE IF NOT EXISTS low_stock_reminders (
    product_id INTEGER PRIMARY KEY,
    notified_at INTEGER NOT NULL
);
DELETE FROM settings WHERE key LIKE 'low_stock_notified_%';
