package sqlite

import (
	models "shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
	"shop/internal/shared/clock"
)

var errInsufficient = &models.InsufficientError{}

// CreatePendingOrder 创建订单并锁定对应数量的可用卡密（事务）。
func (r *OrderRepository) CreatePendingOrder(order *models.Order) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, payment_gateway, buyer_contact, view_token, delivery_type, status, payment_status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'created', ?, ?)`, order.OrderNo, order.ProductID, order.ProductName, order.Qty, order.AmountCents, order.CostCents, order.CostSnapshotSource, order.Fiat, order.TradeType, order.PaymentGateway, order.BuyerContact, order.ViewToken, order.DeliveryType, order.CreatedAt, order.UpdatedAt)
	if err != nil {
		return err
	}
	order.ID, _ = res.LastInsertId()
	// 人工手动交付：不锁定卡密库存，支付成功后等待管理员人工发货。
	if order.DeliveryType == productdomain.DeliveryTypeManual {
		return tx.Commit()
	}
	if r.cards == nil {
		return models.ErrCardOpsNotInjected
	}
	// 原子锁卡：通过注入的卡密端口（inventory 模块实现），本仓储只编排事务。
	locked, err := r.cards.ReserveCardsTx(tx, order.ID, order.ProductID, order.Qty)
	if err != nil {
		return err
	}
	if locked != int64(order.Qty) {
		return errInsufficient
	}
	return tx.Commit()
}

// SetTradeInfo 保存支付交易信息。
func (r *OrderRepository) SetTradeInfo(orderID int64, tradeID, paymentURL string) error {
	_, err := r.db.Exec(`UPDATE orders SET trade_id = ?, payment_url = ?, updated_at = ? WHERE id = ?`, tradeID, paymentURL, clock.Now(), orderID)
	return err
}
