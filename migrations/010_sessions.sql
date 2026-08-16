-- 010_sessions.sql - 会话持久化（重启不丢失登录态）
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
