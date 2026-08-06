-- 011_log_indexes.sql - 日志清理索引（180 天保留期删除加速）
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_order_logs_created ON order_logs(created_at);
