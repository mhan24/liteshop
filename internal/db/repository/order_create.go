package repository

import "shop/internal/models"

var errInsufficient = &models.InsufficientError{}

// CreatePendingOrder 创建订单并锁定对应数量的可用卡密（事务）。
func (r *OrderRepository) CreatePendingOrder(order *models.Order) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, view_token, delivery_type, status, payment_status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'created', ?, ?)`, order.OrderNo, order.ProductID, order.ProductName, order.Qty, order.AmountCents, order.CostCents, order.CostSnapshotSource, order.Fiat, order.TradeType, order.BuyerContact, order.ViewToken, order.DeliveryType, order.CreatedAt, order.UpdatedAt)
	if err != nil {
		return err
	}
	order.ID, _ = res.LastInsertId()
	// 人工手动交付：不锁定卡密库存，支付成功后等待管理员人工发货。
	if order.DeliveryType == models.DeliveryTypeManual {
		return tx.Commit()
	}
	// 原子锁卡：单条条件 UPDATE（子查询限量为"扣库存"），以受影响行数判定成功。
	// 并发下多个事务同时抢最后一张卡时，只有一个事务能锁到足够数量，其余 affected < qty。
	res, err = tx.Exec(`UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ?
		WHERE id IN (
			SELECT id FROM cards
			WHERE product_id = ? AND status = 'available'
			ORDER BY id
			LIMIT ?
		)`, order.ID, models.Now(), order.ProductID, order.Qty)
	if err != nil {
		return err
	}
	if locked, _ := res.RowsAffected(); locked != int64(order.Qty) {
		return errInsufficient
	}
	return tx.Commit()
}

// SetTradeInfo 保存支付交易信息。
func (r *OrderRepository) SetTradeInfo(orderID int64, tradeID, paymentURL string) error {
	_, err := r.db.Exec(`UPDATE orders SET trade_id = ?, payment_url = ?, updated_at = ? WHERE id = ?`, tradeID, paymentURL, models.Now(), orderID)
	return err
}

// ReserveCardsFromStock 从同商品可用库存锁定指定数量卡密（补发用）。
// 注意：不使用 UPDATE ... LIMIT（modernc/sqlite 未启用 SQLITE_ENABLE_UPDATE_DELETE_LIMIT），
// 改用子查询 IN (SELECT id ... LIMIT ?)。
func (r *OrderRepository) ReserveCardsFromStock(productID int64, qty int, orderID int64) (int, error) {
	res, err := r.db.Exec(`
		UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ?
		WHERE id IN (
			SELECT id FROM cards
			WHERE product_id = ? AND status = 'available'
			ORDER BY id
			LIMIT ?
		)`, orderID, models.Now(), productID, qty)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

// DeliverCards 将订单锁定的卡密标记为售出（事务）。
func (r *OrderRepository) DeliverCards(orderID int64) error {
	_, err := r.db.Exec(`UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, orderID, models.Now(), models.Now(), orderID)
	return err
}
