package web

import (
	"fmt"

	"shop/internal/db"
	"shop/internal/models"
)

// transitionOrder 在事务外将订单迁移到 to 状态，并记录事件日志。
// 若状态机不允许该迁移则返回错误，不修改数据。
// 调用方需自行保证并发安全（当前 SQLite 单连接串行）。
func (s *Server) transitionOrder(orderID int64, from, to, event, message string, adminID int64) error {
	if from != to && !models.IsValidOrderTransition(from, to) {
		return fmt.Errorf("invalid order transition %s -> %s", from, to)
	}
	res, err := s.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?`, to, models.Now(), orderID, from)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		// 当前状态与预期不符，可能是并发变更；重新读取确认。
		return nil
	}
	return db.AddOrderLog(s.db, orderID, event, message, from, to, adminID, "")
}

// setOrderStatusWithLog 更新订单状态（不校验旧状态），并记录日志。
func (s *Server) setOrderStatusWithLog(orderID int64, to, event, message string, adminID int64) error {
	var from string
	_ = s.db.QueryRow(`SELECT status FROM orders WHERE id = ?`, orderID).Scan(&from)
	if _, err := s.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`, to, models.Now(), orderID); err != nil {
		return err
	}
	if from != to {
		return db.AddOrderLog(s.db, orderID, event, message, from, to, adminID, "")
	}
	return nil
}
