// Package order 提供订单领域的仓储与业务逻辑。
// 分层: web handler → order.Service → order.Repository → db
package order

import (
	"database/sql"
	"time"

	"shop/internal/models"
)

type rowScanner interface {
	Scan(dest ...any) error
}

func scanOrder(row rowScanner) (models.Order, error) {
	var o models.Order
	err := row.Scan(&o.ID, &o.OrderNo, &o.ProductID, &o.ProductName, &o.Qty, &o.AmountCents, &o.CostCents, &o.Fiat, &o.TradeType, &o.BuyerContact, &o.ViewToken, &o.Status, &o.TradeID, &o.PaymentURL, &o.BlockTransactionID, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt)
	return o, err
}

func scanOrderRows(rows *sql.Rows) (models.Order, error) {
	return scanOrder(rows)
}

// Repository 封装订单与卡密的所有数据访问。
type Repository struct {
	db *sql.DB
	tz *time.Location
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db, tz: models.BeijingLocation}
}

// NewRepositoryWithTZ 使用指定时区（用于多地区统计自然日）。
func NewRepositoryWithTZ(db *sql.DB, tz *time.Location) *Repository {
	if tz == nil {
		tz = models.BeijingLocation
	}
	return &Repository{db: db, tz: tz}
}

// CreatePendingOrder 创建订单并锁定对应数量的可用卡密（事务）。
func (r *Repository) CreatePendingOrder(order *models.Order) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, view_token, status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`, order.OrderNo, order.ProductID, order.ProductName, order.Qty, order.AmountCents, order.CostCents, order.CostSnapshotSource, order.Fiat, order.TradeType, order.BuyerContact, order.ViewToken, order.CreatedAt, order.UpdatedAt)
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

var errInsufficient = &InsufficientError{}

// InsufficientError 库存不足错误。
type InsufficientError struct{}

func (e *InsufficientError) Error() string { return "insufficient card stock" }

// SetTradeInfo 保存 BEpusdt 交易信息。
func (r *Repository) SetTradeInfo(orderID int64, tradeID, paymentURL string) error {
	_, err := r.db.Exec(`UPDATE orders SET trade_id = ?, payment_url = ?, updated_at = ? WHERE id = ?`, tradeID, paymentURL, models.Now(), orderID)
	return err
}

// GetOrderByNo 按订单号查订单。
func (r *Repository) GetOrderByNo(orderNo string) (models.Order, error) {
	return scanOrder(r.db.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE order_no = ?`, orderNo))
}

// GetOrderByID 按 ID 查订单。
func (r *Repository) GetOrderByID(id int64) (models.Order, error) {
	return scanOrder(r.db.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE id = ?`, id))
}

// OrdersByContact 按下单邮箱查最近订单。
func (r *Repository) OrdersByContact(contact string, limit int) ([]models.Order, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := r.db.Query(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE buyer_contact = ? ORDER BY id DESC LIMIT ?`, contact, limit)
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
func (r *Repository) ListOrders(where string, args []any, limit int) ([]models.Order, error) {
	if limit <= 0 {
		limit = 500
	}
	query := `SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE ` + where + ` ORDER BY id DESC LIMIT ?`
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
func (r *Repository) GetOrderCards(orderID int64) ([]models.Card, error) {
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

// ListCardsByProduct 返回商品卡密列表。
func (r *Repository) ListCardsByProduct(productID int64) ([]models.Card, error) {
	rows, err := r.db.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE product_id = ? ORDER BY id DESC LIMIT 500`, productID)
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

// AddCards 批量导入可用卡密。
// AddCards 批量导入可用卡密。dedupe=true 时跳过该商品下已存在的卡密内容。
// 返回新增数与跳过的重复数。
func (r *Repository) AddCards(productID int64, contents []string, dedupe bool) (added, skipped int, err error) {
	existing := map[string]bool{}
	if dedupe {
		rows, err := r.db.Query(`SELECT content FROM cards WHERE product_id = ?`, productID)
		if err != nil {
			return 0, 0, err
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				rows.Close()
				return 0, 0, err
			}
			existing[c] = true
		}
		rows.Close()
	}
	tx, err := r.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	now := models.Now()
	for _, content := range contents {
		if dedupe && existing[content] {
			skipped++
			continue
		}
		if _, err := tx.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, ?, 'available', ?, ?)`, productID, content, now, now); err != nil {
			return 0, 0, err
		}
		added++
	}
	return added, skipped, tx.Commit()
}

// DeleteAvailableCard 删除可用卡密。
func (r *Repository) DeleteAvailableCard(cardID int64) error {
	_, err := r.db.Exec(`DELETE FROM cards WHERE id = ? AND status = 'available'`, cardID)
	return err
}

// MarkPaid 将订单从 waiting_payment 置为 paid（事务）。
func (r *Repository) MarkPaid(orderID int64, tradeID, blockTx string, paidAt int64) error {
	res, err := r.db.Exec(`UPDATE orders SET status = 'paid', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_payment'`, tradeID, blockTx, paidAt, paidAt, orderID)
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
func (r *Repository) MarkPaidAndDeliver(orderID int64, tradeID, blockTx string, paidAt int64) (int64, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE orders SET status = 'paid', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting_payment'`, tradeID, blockTx, paidAt, paidAt, orderID)
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
func (r *Repository) CompleteFreeOrder(orderID int64, paidAt int64) (int64, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'created'`, paidAt, paidAt, orderID)
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

// DeliverCards 将订单锁定的卡密标记为售出（事务）。
func (r *Repository) DeliverCards(orderID int64) error {
	_, err := r.db.Exec(`UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, orderID, models.Now(), models.Now(), orderID)
	return err
}

// ReleaseLockedCards 释放订单锁定的卡密（取消/过期）。
func (r *Repository) ReleaseLockedCards(orderID int64) error {
	_, err := r.db.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, models.Now(), orderID)
	return err
}

// CancelOrder 在单事务内完成：条件状态迁移（created/waiting_payment → cancelled）、
// 释放锁定卡密、回滚优惠券。返回订单号与是否发生变更。
// 若支付回调恰好在状态读取之后提交，事务内的条件更新会失败并返回 ErrNoRows，保证不会覆盖已支付订单。
func (r *Repository) CancelOrder(orderID int64) (string, bool, error) {
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
	res, err := tx.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN (?, ?)`,
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
func (r *Repository) ExpireOrder(orderID int64) (string, bool, error) {
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
	res, err := tx.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN (?, ?)`,
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

// ReserveCardsFromStock 从同商品可用库存锁定指定数量卡密（补发用）。
// 注意：不使用 UPDATE ... LIMIT（modernc/sqlite 未启用 SQLITE_ENABLE_UPDATE_DELETE_LIMIT），
// 改用子查询 IN (SELECT id ... LIMIT ?)。
func (r *Repository) ReserveCardsFromStock(productID int64, qty int, orderID int64) (int, error) {
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

// SetOrderStatus 直接更新订单状态。
func (r *Repository) SetOrderStatus(orderID int64, status string) error {
	_, err := r.db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`, status, models.Now(), orderID)
	return err
}

// SetOrderStatusFrom 从指定旧状态更新（防并发）。
func (r *Repository) SetOrderStatusFrom(orderID int64, from, to string) error {
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

// GetOrderStatus 返回订单当前状态。
func (r *Repository) GetOrderStatus(orderID int64) (string, error) {
	var status string
	err := r.db.QueryRow(`SELECT status FROM orders WHERE id = ?`, orderID).Scan(&status)
	return status, err
}

// ErrNoRows 数据不存在或无变更。
var ErrNoRows = &NoRowsError{}

type NoRowsError struct{}

func (e *NoRowsError) Error() string { return "no rows affected" }

// OrderCounts 各类订单统计。
func (r *Repository) OrderCounts() (todayOrders, todaySales, pending, paymentFailed, deliveryFailed int, todayRevenue int64, err error) {
	dayStart := models.StartOfDayIn(models.Now(), r.tz)
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE created_at >= ?`, dayStart).Scan(&todayOrders); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status IN ('paid','processing','delivered','completed') AND paid_at >= ?`, dayStart).Scan(&todaySales); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COALESCE(SUM(amount_cents),0) FROM orders WHERE status IN ('paid','processing','delivered','completed') AND paid_at >= ?`, dayStart).Scan(&todayRevenue); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status IN ('created','waiting_payment')`).Scan(&pending); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status = 'payment_failed'`).Scan(&paymentFailed); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status = 'delivery_failed'`).Scan(&deliveryFailed); err != nil {
		return
	}
	return
}

// RecentOrders 返回最近订单（驾驶舱用）。
func (r *Repository) RecentOrders(limit int) ([]models.Order, error) {
	if limit <= 0 {
		limit = 8
	}
	rows, err := r.db.Query(`SELECT id, order_no, product_id, product_name, qty, amount_cents, cost_cents, fiat, trade_type, buyer_contact, view_token, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders ORDER BY id DESC LIMIT ?`, limit)
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

// AddLog 追加订单事件日志。
func (r *Repository) AddLog(orderID int64, event, message, from, to string, adminID int64) error {
	_, err := r.db.Exec(`INSERT INTO order_logs(order_id, event, message, from_status, to_status, admin_id, metadata, created_at)
		VALUES(?, ?, ?, ?, ?, ?, '', ?)`, orderID, event, message, from, to, adminID, models.Now())
	return err
}

// Logs 返回订单事件日志。
func (r *Repository) Logs(orderID int64) ([]models.OrderEvent, error) {
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

// DailyRevenue 返回最近 days 天每日营收（按支付时间，使用仓库时区自然日）。
// 返回 [date, revenueCents] 列表，按日期升序。
func (r *Repository) DailyRevenue(days int) ([]DailyRevenueRow, error) {
	if days <= 0 {
		days = 14
	}
	start := models.StartOfDayIn(models.Now()-int64(days-1)*86400, r.tz)
	rows, err := r.db.Query(`SELECT paid_at, COALESCE(SUM(amount_cents),0) FROM orders
		WHERE status IN ('paid','processing','delivered','completed') AND paid_at >= ?
		GROUP BY paid_at ORDER BY paid_at`, start)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 按自然日聚合
	byDay := map[string]int64{}
	for rows.Next() {
		var paidAt int64
		var rev int64
		if err := rows.Scan(&paidAt, &rev); err != nil {
			return nil, err
		}
		day := time.Unix(paidAt, 0).In(r.tz).Format("2006-01-02")
		byDay[day] += rev
	}
	var out []DailyRevenueRow
	for i := days - 1; i >= 0; i-- {
		d := time.Unix(models.Now()-int64(i)*86400, 0).In(r.tz).Format("2006-01-02")
		out = append(out, DailyRevenueRow{Date: d, Revenue: byDay[d]})
	}
	return out, nil
}

// ProductSales 返回各商品销量与销售额（已支付订单）。
func (r *Repository) ProductSales(limit int) ([]ProductSaleRow, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := r.db.Query(`SELECT product_name, SUM(qty), COALESCE(SUM(amount_cents),0) FROM orders
		WHERE status IN ('paid','processing','delivered','completed')
		GROUP BY product_name ORDER BY SUM(qty) DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProductSaleRow
	for rows.Next() {
		var s ProductSaleRow
		if err := rows.Scan(&s.Name, &s.Qty, &s.Revenue); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// DailyRevenueRow 单日营收行。
type DailyRevenueRow struct {
	Date    string
	Revenue int64
}

// ProductSaleRow 商品销量行。
type ProductSaleRow struct {
	Name    string
	Qty     int
	Revenue int64
}
