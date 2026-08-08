-- 015_secrets.sql - 敏感配置拆表（AES 加密存储）
-- 建表由 SQL 完成；存量 settings 数据迁移由 Go 步骤完成
-- （legacyUpgrades["015_secrets"] -> ensureSecretsTable）
-- 将 settings 中的 BEpusdt Token / SMTP 密码 / Telegram Token / Webhook Secret /
-- Turnstile Secret / 维护密码 迁移到 secrets 表（AES-GCM 加密），并从 settings 删除。
CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
