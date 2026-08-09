package repository

import "shop/internal/models"

// AddLog 追加订单事件日志。
func (r *OrderRepository) AddLog(orderID int64, event, message, from, to string, adminID int64) error {
	_, err := r.db.Exec(`INSERT INTO order_logs(order_id, event, message, from_status, to_status, admin_id, metadata, created_at)
		VALUES(?, ?, ?, ?, ?, ?, '', ?)`, orderID, event, message, from, to, adminID, models.Now())
	return err
}
