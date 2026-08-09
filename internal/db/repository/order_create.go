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
	res, err := tx.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, view_token, status, payment_status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'created', ?, ?)`, order.OrderNo, order.ProductID, order.ProductName, order.Qty, order.AmountCents, order.CostCents, order.CostSnapshotSource, order.Fiat, order.TradeType, order.BuyerContact, order.ViewToken, order.CreatedAt, order.UpdatedAt)
	if err != nil {
		return err
	}
	order.ID, _ = res.LastInsertId()
	rows, err := tx.Query(`SELECT id FROM cards WHERE product_id = ? AND status = 'available' LIMIT ?`, order.ProductID, order.Qty)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != order.Qty {
		return errInsufficient
	}
	for _, id := range ids {
		if _, err := tx.Exec(`UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ? WHERE id = ? AND status = 'available'`, order.ID, models.Now(), id); err != nil {
			return err
		}
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
