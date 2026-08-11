package repository

import (
	"shop/internal/models"
)

// GetOrderByNo 按订单号查订单。
func (r *OrderRepository) GetOrderByNo(orderNo string) (models.Order, error) {
	return scanOrder(r.db.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE order_no = ?`, orderNo))
}

// GetOrderByID 按 ID 查订单。
func (r *OrderRepository) GetOrderByID(id int64) (models.Order, error) {
	return scanOrder(r.db.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE id = ?`, id))
}

// OrdersByContact 按下单邮箱查最近订单。
func (r *OrderRepository) OrdersByContact(contact string, limit int) ([]models.Order, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := r.db.Query(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE buyer_contact = ? ORDER BY id DESC LIMIT ?`, contact, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Order
	for rows.Next() {
		o, err := scanOrderRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ListOrders 按条件查询订单（q/status/时间范围）。
func (r *OrderRepository) ListOrders(where string, args []any, limit int) ([]models.Order, error) {
	if limit <= 0 {
		limit = 500
	}
	query := `SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders WHERE ` + where + ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Order
	for rows.Next() {
		o, err := scanOrderRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// GetOrderCards 返回订单的已售卡密。
func (r *OrderRepository) GetOrderCards(orderID int64) ([]models.Card, error) {
	rows, err := r.db.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE sold_order = ? ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Card
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.ReservedOrder, &c.SoldOrder, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetOrderStatus 返回订单当前状态。
func (r *OrderRepository) GetOrderStatus(orderID int64) (string, error) {
	var status string
	err := r.db.QueryRow(`SELECT status FROM orders WHERE id = ?`, orderID).Scan(&status)
	return status, err
}

// RecentOrders 返回最近订单（驾驶舱用）。
func (r *OrderRepository) RecentOrders(limit int) ([]models.Order, error) {
	if limit <= 0 {
		limit = 8
	}
	rows, err := r.db.Query(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, payment_gateway, buyer_contact, view_token, status, payment_status, trade_id, payment_url, block_transaction_id, delivery_type, delivery_content, created_at, updated_at, paid_at FROM orders ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Order
	for rows.Next() {
		o, err := scanOrderRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// Logs 返回订单事件日志。
func (r *OrderRepository) Logs(orderID int64) ([]models.OrderEvent, error) {
	rows, err := r.db.Query(`SELECT id, order_id, event, message, from_status, to_status, admin_id, metadata, created_at FROM order_logs WHERE order_id = ? ORDER BY id ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.OrderEvent{}
	for rows.Next() {
		var e models.OrderEvent
		if err := rows.Scan(&e.ID, &e.OrderID, &e.Event, &e.Message, &e.From, &e.To, &e.AdminID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
