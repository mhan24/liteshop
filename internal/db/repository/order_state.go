package repository

import "shop/internal/models"

// ErrNoRows 数据不存在或无变更。
var ErrNoRows = &NoRowsError{}

type NoRowsError struct{}

func (e *NoRowsError) Error() string { return "no rows affected" }

// MarkPaid 将订单从 waiting_payment 置为 paid（事务）。
func (r *OrderRepository) MarkPaid(orderID int64, tradeID, blockTx string, paidAt int64) error {
	res, err := r.db.Exec(`UPDATE orders SET status = 'paid', payment_status = 'confirmed', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_payment'`, tradeID, blockTx, paidAt, paidAt, orderID)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNoRows
	}
	return nil
}

// MarkPaidAndDeliver 在单事务内完成支付确认与发卡（waiting_payment → paid，locked → sold）。
// 返回实际售出卡密数；若订单状态已不是 waiting_payment（如已被取消），返回 ErrNoRows 且不产生任何变更。
func (r *OrderRepository) MarkPaidAndDeliver(orderID int64, tradeID, blockTx string, paidAt int64) (int64, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE orders SET status = 'paid', payment_status = 'confirmed', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_payment'`, tradeID, blockTx, paidAt, paidAt, orderID)
	if err != nil {
		return 0, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return 0, ErrNoRows
	}
	res, err = tx.Exec(`UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, orderID, models.Now(), models.Now(), orderID)
	if err != nil {
		return 0, err
	}
	delivered, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return delivered, nil
}

// CompleteFreeOrder 零金额订单（100% 折扣券）直接完成：created → paid 并发卡（单事务）。
// 返回实际售出卡密数；订单状态已不是 created 时返回 ErrNoRows。
func (r *OrderRepository) CompleteFreeOrder(orderID int64, paidAt int64) (int64, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE orders SET status = 'paid', payment_status = 'confirmed', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'created'`, paidAt, paidAt, orderID)
	if err != nil {
		return 0, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return 0, ErrNoRows
	}
	res, err = tx.Exec(`UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, orderID, models.Now(), models.Now(), orderID)
	if err != nil {
		return 0, err
	}
	delivered, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return delivered, nil
}

// ReleaseLockedCards 释放订单锁定的卡密（取消/过期）。
func (r *OrderRepository) ReleaseLockedCards(orderID int64) error {
	_, err := r.db.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, models.Now(), orderID)
	return err
}

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
	if status != models.OrderCreated && status != models.OrderWaitingPayment {
		return orderNo, false, nil
	}
	res, err := tx.Exec(`UPDATE orders SET status = ?, payment_status = 'cancelled', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
		models.OrderCancelled, models.Now(), orderID, models.OrderCreated, models.OrderWaitingPayment)
	if err != nil {
		return "", false, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return "", false, ErrNoRows
	}
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, models.Now(), orderID); err != nil {
		return "", false, err
	}
	if _, err := refundCouponTx(tx, orderNo); err != nil {
		return "", false, err
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
	if status != models.OrderCreated && status != models.OrderWaitingPayment {
		return orderNo, false, nil
	}
	res, err := tx.Exec(`UPDATE orders SET status = ?, payment_status = 'cancelled', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
		models.OrderExpired, models.Now(), orderID, models.OrderCreated, models.OrderWaitingPayment)
	if err != nil {
		return "", false, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return "", false, ErrNoRows
	}
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, models.Now(), orderID); err != nil {
		return "", false, err
	}
	if _, err := refundCouponTx(tx, orderNo); err != nil {
		return "", false, err
	}
	if err := tx.Commit(); err != nil {
		return "", false, err
	}
	return orderNo, true, nil
}

// SetOrderStatus 直接更新订单状态。
func (r *OrderRepository) SetOrderStatus(orderID int64, status string) error {
	_, err := r.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`, status, models.Now(), orderID)
	return err
}

// SetOrderStatusFrom 从指定旧状态更新（防并发）。
func (r *OrderRepository) SetOrderStatusFrom(orderID int64, from, to string) error {
	res, err := r.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?`, to, models.Now(), orderID, from)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNoRows
	}
	return nil
}

// SetPaymentStatus 更新支付状态（与订单状态解耦，单独维护）。
func (r *OrderRepository) SetPaymentStatus(orderID int64, status string) error {
	_, err := r.db.Exec(`UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?`, status, models.Now(), orderID)
	return err
}

// GetPaymentStatus 返回订单的支付状态。
func (r *OrderRepository) GetPaymentStatus(orderID int64) (string, error) {
	var status string
	err := r.db.QueryRow(`SELECT payment_status FROM orders WHERE id = ?`, orderID).Scan(&status)
	return status, err
}
