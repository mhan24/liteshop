package sqlite

import (
	"database/sql"

	"shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
)

// AddOrderLog 追加一条订单事件日志（包级函数，供通知等适配层直接写日志）。
func AddOrderLog(d *sql.DB, orderID int64, event, message string, fromStatus, toStatus domain.Status, adminID int64, metadata string) error {
	_, err := d.Exec(`INSERT INTO order_logs(order_id, event, message, from_status, to_status, admin_id, metadata, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, orderID, event, message, string(fromStatus), string(toStatus), adminID, metadata, clock.Now())
	return err
}

// OrderLogs 返回某订单的事件日志（按时间正序）。
func OrderLogs(d *sql.DB, orderID int64) ([]domain.OrderEvent, error) {
	rows, err := d.Query(`SELECT id, order_id, event, message, from_status, to_status, admin_id, metadata, created_at FROM order_logs WHERE order_id = ? ORDER BY id ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.OrderEvent{}
	for rows.Next() {
		var e domain.OrderEvent
		if err := rows.Scan(&e.ID, &e.OrderID, &e.Event, &e.Message, &e.From, &e.To, &e.AdminID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// DeleteOldOrderLogs 删除 created_at 早于 cutoff 的订单事件日志。
func DeleteOldOrderLogs(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM order_logs WHERE created_at < ?`, cutoff)
	return err
}

// DeleteOldLogs 实现 OrderRepository 端口（清理任务经应用用例调用）。
func (r *OrderRepository) DeleteOldLogs(cutoff int64) error {
	return DeleteOldOrderLogs(r.db, cutoff)
}

// AddLog 追加订单事件日志。
func (r *OrderRepository) AddLog(orderID int64, event, message string, from, to domain.Status, adminID int64) error {
	_, err := r.db.Exec(`INSERT INTO order_logs(order_id, event, message, from_status, to_status, admin_id, metadata, created_at)
		VALUES(?, ?, ?, ?, ?, ?, '', ?)`, orderID, event, message, string(from), string(to), adminID, clock.Now())
	return err
}
