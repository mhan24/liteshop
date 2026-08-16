package sqlite

import (
	models "shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
)

// CancelOrder 在单事务内完成：条件状态迁移（created/waiting_payment → cancelled）、
// 释放锁定卡密、回滚优惠券。返回订单号与是否发生变更。
// 若支付回调恰好在状态读取之后提交，事务内的条件更新会失败并返回 ErrNoRows，保证不会覆盖已支付订单。
func (r *OrderRepository) CancelOrder(orderID int64) (string, bool, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback()
	var orderNo, status string
	if err := tx.QueryRow(`SELECT order_no, status FROM orders WHERE id = ?`, orderID).Scan(&orderNo, &status); err != nil {
		return "", false, err
	}
	if models.Status(status) != models.OrderCreated && models.Status(status) != models.OrderWaitingPayment {
		return orderNo, false, nil
	}
	res, err := tx.Exec(`UPDATE orders SET status = ?, payment_status = 'cancelled', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
		models.OrderCancelled, clock.Now(), orderID, models.OrderCreated, models.OrderWaitingPayment)
	if err != nil {
		return "", false, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return "", false, ErrNoRows
	}
	if r.cards != nil {
		if _, err := r.cards.ReleaseReservationTx(tx, orderID); err != nil {
			return "", false, err
		}
	}
	if r.coupons != nil {
		if _, err := r.coupons.RefundByOrderNoTx(tx, orderNo); err != nil {
			return "", false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", false, err
	}
	return orderNo, true, nil
}

// ExpireOrder 与 CancelOrder 等价，仅目标状态为 expired。
func (r *OrderRepository) ExpireOrder(orderID int64) (string, bool, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback()
	var orderNo, status string
	if err := tx.QueryRow(`SELECT order_no, status FROM orders WHERE id = ?`, orderID).Scan(&orderNo, &status); err != nil {
		return "", false, err
	}
	if models.Status(status) != models.OrderCreated && models.Status(status) != models.OrderWaitingPayment {
		return orderNo, false, nil
	}
	res, err := tx.Exec(`UPDATE orders SET status = ?, payment_status = 'cancelled', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
		models.OrderExpired, clock.Now(), orderID, models.OrderCreated, models.OrderWaitingPayment)
	if err != nil {
		return "", false, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return "", false, ErrNoRows
	}
	if r.cards != nil {
		if _, err := r.cards.ReleaseReservationTx(tx, orderID); err != nil {
			return "", false, err
		}
	}
	if r.coupons != nil {
		if _, err := r.coupons.RefundByOrderNoTx(tx, orderNo); err != nil {
			return "", false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", false, err
	}
	return orderNo, true, nil
}
