package db

import "database/sql"

// DeleteOldAuditLogs 删除 created_at 早于 cutoff 的审计日志。
func DeleteOldAuditLogs(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM audit_logs WHERE created_at < ?`, cutoff)
	return err
}

// DeleteOldOrderLogs 删除 created_at 早于 cutoff 的订单事件日志。
func DeleteOldOrderLogs(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM order_logs WHERE created_at < ?`, cutoff)
	return err
}
