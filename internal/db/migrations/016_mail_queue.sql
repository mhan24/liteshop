-- 016_mail_queue.sql - 邮件重试队列（后台任务 email_retry 消费）
CREATE TABLE IF NOT EXISTS mail_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    order_id INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_queue_retry ON mail_queue(next_retry_at);
