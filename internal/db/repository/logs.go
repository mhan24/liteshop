package repository

import (
	"database/sql"

	"shop/internal/models"
)

// AddOrderLog 追加一条订单事件日志。
func AddOrderLog(d *sql.DB, orderID int64, event, message, fromStatus, toStatus string, adminID int64, metadata string) error {
	_, err := d.Exec(`INSERT INTO order_logs(order_id, event, message, from_status, to_status, admin_id, metadata, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, orderID, event, message, fromStatus, toStatus, adminID, metadata, models.Now())
	return err
}

// AddAuditLog 追加一条管理员审计日志。
func AddAuditLog(d *sql.DB, adminID int64, username, action, targetType, targetID, before, after string) error {
	_, err := d.Exec(`INSERT INTO audit_logs(admin_id, username, action, target_type, target_id, before_value, after_value, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, adminID, username, action, targetType, targetID, before, after, models.Now())
	return err
}

// AuditLogs 返回审计日志（最新在前）。
func AuditLogs(d *sql.DB, limit int) ([]models.AuditLog, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := d.Query(`SELECT id, admin_id, username, action, target_type, target_id, before_value, after_value, created_at FROM audit_logs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.Username, &l.Action, &l.TargetType, &l.TargetID, &l.Before, &l.After, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// OrderLogs 返回某订单的事件日志（按时间正序）。
func OrderLogs(d *sql.DB, orderID int64) ([]models.OrderEvent, error) {
	rows, err := d.Query(`SELECT id, order_id, event, message, from_status, to_status, admin_id, metadata, created_at FROM order_logs WHERE order_id = ? ORDER BY id ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.OrderEvent{}
	for rows.Next() {
		var e models.OrderEvent
		if err := rows.Scan(&e.ID, &e.OrderID, &e.Event, &e.Message, &e.From, &e.To, &e.AdminID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

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
