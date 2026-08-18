package sqlite

import (
	"database/sql"
	inventorydomain "shop/internal/modules/inventory/domain"
	models "shop/internal/modules/order/domain"
	outbox "shop/internal/platform/outbox"
	"shop/internal/shared/clock"
)

// enqueueEventsTx 在支付成功事务内写入领域事件到 outbox，
// 保证"数据库状态"与"事件"永久一致（提交后崩溃也不丢事件）。
func (r *OrderRepository) enqueueEventsTx(tx *sql.Tx, orderID int64) error {
	o, err := scanOrder(tx.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE id = ?`, orderID))
	if err != nil {
		return err
	}
	var cards []inventorydomain.Card
	if r.cards != nil {
		var err error
		cards, err = r.cards.CardsByOrderTx(tx, orderID)
		if err != nil {
			return err
		}
	}
	if r.encoder == nil {
		return nil
	}
	evs, err := r.encoder(o, cards)
	if err != nil {
		return err
	}
	for _, ev := range evs {
		if err := outbox.EnqueueOutboxTx(tx, ev.Type, ev.Payload); err != nil {
			return err
		}
	}
	return nil
}

func (r *OrderRepository) enqueueEventTypeTx(tx *sql.Tx, orderID int64, eventType string) error {
	o, err := scanOrder(tx.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE id = ?`, orderID))
	if err != nil {
		return err
	}
	var cards []inventorydomain.Card
	if r.cards != nil {
		cards, err = r.cards.CardsByOrderTx(tx, orderID)
		if err != nil {
			return err
		}
	}
	if r.encoder == nil {
		return nil
	}
	events, err := r.encoder(o, cards)
	if err != nil {
		return err
	}
	for _, ev := range events {
		if ev.Type == eventType {
			return outbox.EnqueueOutboxTx(tx, ev.Type, ev.Payload)
		}
	}
	return nil
}

func (r *OrderRepository) EnqueueDeliveredEvent(orderID int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := r.enqueueEventTypeTx(tx, orderID, "order.delivered"); err != nil {
		return err
	}
	return tx.Commit()
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
func (r *OrderRepository) MarkPaidAndDeliver(orderID int64, gateway, tradeID, blockTx string, paidAt int64) (int64, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	// 幂等台账：同一网关交易号只处理一次（与订单状态迁移同一事务）。
	res, err := tx.Exec(`INSERT OR IGNORE INTO processed_events(event_key, event_type, processed_at)
		VALUES(?, 'payment', ?)`, gatewayPrefix(gateway)+tradeID, clock.Now())
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
	if r.cards == nil {
		return 0, models.ErrCardOpsNotInjected
	}
	delivered, err := r.cards.ConfirmReservationTx(tx, orderID)
	if err != nil {
		return 0, err
	}
	if err := r.enqueueEventTypeTx(tx, orderID, "order.paid"); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return delivered, nil
}

// MarkPaidPendingDelivery 人工手动交付订单的支付确认：waiting_payment → pending_delivery。
// 不锁卡不发卡，仅写入支付成功事件（OrderPaid）。
func (r *OrderRepository) MarkPaidPendingDelivery(orderID int64, gateway, tradeID, blockTx string, paidAt int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 幂等台账：同一网关交易号只处理一次（与订单状态迁移同一事务）。
	res, err := tx.Exec(`INSERT OR IGNORE INTO processed_events(event_key, event_type, processed_at)
		VALUES(?, 'payment', ?)`, gatewayPrefix(gateway)+tradeID, clock.Now())
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
	if err := r.enqueueEventTypeTx(tx, orderID, "order.paid"); err != nil {
		return err
	}
	return tx.Commit()
}

// gatewayPrefix 归一化网关前缀（兜底 bepusdt 兼容存量台账）。
func gatewayPrefix(gateway string) string {
	if gateway == "" {
		return "bepusdt:"
	}
	return gateway + ":"
}

// SetManualDelivery 人工发货：pending_delivery → delivered，并保存发货内容。
func (r *OrderRepository) SetManualDelivery(orderID int64, content string) (bool, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE orders SET status = 'delivered', delivery_content = ?, updated_at = ? WHERE id = ? AND status = 'pending_delivery'`, content, clock.Now(), orderID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil || n == 0 {
		return n > 0, err
	}
	if err := r.enqueueEventTypeTx(tx, orderID, "order.delivered"); err != nil {
		return false, err
	}
	return true, tx.Commit()
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
	if r.cards == nil {
		return 0, models.ErrCardOpsNotInjected
	}
	delivered, err := r.cards.ConfirmReservationTx(tx, orderID)
	if err != nil {
		return 0, err
	}
	if err := r.enqueueEventTypeTx(tx, orderID, "order.paid"); err != nil {
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
	if err := r.enqueueEventTypeTx(tx, orderID, "order.paid"); err != nil {
		return err
	}
	return tx.Commit()
}
