package sqlite

import (
	models "shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
)

// ExpireOrder 将 created/waiting_payment 订单原子过期，并释放相关资源。
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
