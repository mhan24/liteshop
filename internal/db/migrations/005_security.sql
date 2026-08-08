-- 005_security.sql - 管理员 TOTP 双因素列
ALTER TABLE admins ADD COLUMN totp_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
