-- 005_security.sql - 安全包（TOTP 2FA + admin 路径）
-- 由 Go 迁移器执行（ensureAdminColumns 已扩展 TOTP 列 + notify_path）

-- TOTP 列由 ensureAdminColumns 添加（Go 条件逻辑，见 005_admin_security Go 步骤）
