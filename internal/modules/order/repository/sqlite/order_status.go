package sqlite

import (
	"shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
)

// SetOrderStatus 直接更新订单状态。
func (r *OrderRepository) SetOrderStatus(orderID int64, status domain.Status) error {
	_, err := r.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`, string(status), clock.Now(), orderID)
	return err
}

// SetOrderStatusFrom 从指定旧状态更新（防并发）。
func (r *OrderRepository) SetOrderStatusFrom(orderID int64, from, to domain.Status) error {
	res, err := r.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?`, string(to), clock.Now(), orderID, string(from))
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNoRows
	}
	return nil
}

// MarkPaymentFailed 原子完成"支付失败"：订单置 payment_failed、支付状态置 failed，
// 并释放该订单锁定的卡密（单事务，避免残留锁定卡密/库存泄漏）。
func (r *OrderRepository) MarkPaymentFailed(orderID int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE orders SET status = 'payment_failed', payment_status = 'failed', updated_at = ? WHERE id = ?`,
		clock.Now(), orderID); err != nil {
		return err
	}
	if r.cards == nil {
		return domain.ErrCardOpsNotInjected
	}
	if _, err := r.cards.ReleaseReservationTx(tx, orderID); err != nil {
		return err
	}
	return tx.Commit()
}

// SetPaymentStatus 更新支付状态（与订单状态解耦，单独维护）。
func (r *OrderRepository) SetPaymentStatus(orderID int64, status domain.PaymentStatus) error {
	_, err := r.db.Exec(`UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?`, string(status), clock.Now(), orderID)
	return err
}

// GetPaymentStatus 返回订单的支付状态。
func (r *OrderRepository) GetPaymentStatus(orderID int64) (domain.PaymentStatus, error) {
	var status domain.PaymentStatus
	err := r.db.QueryRow(`SELECT payment_status FROM orders WHERE id = ?`, orderID).Scan(&status)
	return status, err
}
