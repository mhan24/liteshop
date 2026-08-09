-- 024_audit_log_indexes.sql - 审计日志查询优化（按管理员/动作/资源检索）
-- id 自增可作时间序，索引按 (维度, id) 覆盖"最近 N 条"查询。
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_time ON audit_logs(admin_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id, id);
