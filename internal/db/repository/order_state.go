package repository

import (
	"database/sql"

	"shop/internal/events"
	"shop/internal/models"
)

// enqueuePaidEventsTx 在支付成功事务内写入 OrderPaid + OrderDelivered 到 outbox，
// 保证"数据库状态"与"事件"永久一致（提交后崩溃也不丢事件）。
func enqueuePaidEventsTx(tx *sql.Tx, orderID int64) error {
	o, err := scanOrder(tx.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE id = ?`, orderID))
	if err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE sold_order = ? ORDER BY id`, orderID)
	if err != nil {
		return err
	}
	cards := []models.Card{}
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.ReservedOrder, &c.SoldOrder, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			rows.Close()
			return err
		}
		cards = append(cards, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	paidPayload, err := events.Encode(events.OrderPaidEvent{Order: o, Cards: cards})
	if err != nil {
		return err
	}
	if err := enqueueOutboxTx(tx, events.OrderPaidEvent{}.EventName(), paidPayload); err != nil {
		return err
	}
	deliveredPayload, err := events.Encode(events.OrderDeliveredEvent{Order: o, Cards: cards})
	if err != nil {
		return err
	}
	return enqueueOutboxTx(tx, events.OrderDeliveredEvent{}.EventName(), deliveredPayload)
}

// enqueuePaidOnlyEventTx 在支付事务内只写入 OrderPaid（人工手动交付订单无卡密可发，
// 发货事件由管理员手动发货时另行触发）。
func enqueuePaidOnlyEventTx(tx *sql.Tx, orderID int64) error {
	o, err := scanOrder(tx.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE id = ?`, orderID))
	if err != nil {
		return err
	}
	paidPayload, err := events.Encode(events.OrderPaidEvent{Order: o, Cards: nil})
	if err != nil {
		return err
	}
	return enqueueOutboxTx(tx, events.OrderPaidEvent{}.EventName(), paidPayload)
}

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
	// 幂等台账：同一网关交易号只处理一次（与订单状态迁移同一事务）。
	res, err := tx.Exec(`INSERT OR IGNORE INTO processed_events(event_key, event_type, processed_at)
		VALUES(?, 'payment', ?)`, "bepusdt:"+tradeID, models.Now())
	if err != nil {
		return 0, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return 0, models.ErrAlreadyProcessed
	}
	res, err = tx.Exec(`UPDATE orders SET status = 'paid', payment_status = 'confirmed', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_payment'`, tradeID, blockTx, paidAt, paidAt, orderID)
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
	if err := enqueuePaidEventsTx(tx, orderID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return delivered, nil
}

// MarkPaidPendingDelivery 人工手动交付订单的支付确认：waiting_payment → pending_delivery。
// 不锁卡不发卡，仅写入支付成功事件（OrderPaid）。
func (r *OrderRepository) MarkPaidPendingDelivery(orderID int64, tradeID, blockTx string, paidAt int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 幂等台账：同一网关交易号只处理一次（与订单状态迁移同一事务）。
	res, err := tx.Exec(`INSERT OR IGNORE INTO processed_events(event_key, event_type, processed_at)
		VALUES(?, 'payment', ?)`, "bepusdt:"+tradeID, models.Now())
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return models.ErrAlreadyProcessed
	}
	res, err = tx.Exec(`UPDATE orders SET status = 'pending_delivery', payment_status = 'confirmed', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_payment'`, tradeID, blockTx, paidAt, paidAt, orderID)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrNoRows
	}
	if err := enqueuePaidOnlyEventTx(tx, orderID); err != nil {
		return err
	}
	return tx.Commit()
}

// SetManualDelivery 人工发货：pending_delivery → delivered，并保存发货内容。
func (r *OrderRepository) SetManualDelivery(orderID int64, content string) (bool, error) {
	res, err := r.db.Exec(`UPDATE orders SET status = 'delivered', delivery_content = ?, updated_at = ? WHERE id = ? AND status = 'pending_delivery'`, content, models.Now(), orderID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
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
	if err := enqueuePaidEventsTx(tx, orderID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return delivered, nil
}

// CompleteFreeOrderManual 人工手动交付订单的零金额完成：created → pending_delivery。
func (r *OrderRepository) CompleteFreeOrderManual(orderID int64, paidAt int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE orders SET status = 'pending_delivery', payment_status = 'confirmed', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'created'`, paidAt, paidAt, orderID)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrNoRows
	}
	if err := enqueuePaidOnlyEventTx(tx, orderID); err != nil {
		return err
	}
	return tx.Commit()
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

// MarkPaymentFailed 原子完成"支付失败"：订单置 payment_failed、支付状态置 failed，
// 并释放该订单锁定的卡密（单事务，避免残留锁定卡密/库存泄漏）。
func (r *OrderRepository) MarkPaymentFailed(orderID int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE orders SET status = 'payment_failed', payment_status = 'failed', updated_at = ? WHERE id = ?`,
		models.Now(), orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`,
		models.Now(), orderID); err != nil {
		return err
	}
	return tx.Commit()
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
