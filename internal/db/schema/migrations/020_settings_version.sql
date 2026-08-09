-- 020_settings_version.sql - 配置版本管理
-- settings 结构升级按版本号记录（与 schema_migrations 平行），升级配置不再靠猜。
CREATE TABLE IF NOT EXISTS settings_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
