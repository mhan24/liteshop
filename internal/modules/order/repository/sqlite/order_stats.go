package sqlite

import (
	models "shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
	"time"
)

// OrderCounts 各类订单统计。
func (r *OrderRepository) OrderCounts() (todayOrders, todaySales, pending, paymentFailed, deliveryFailed int, todayRevenue int64, err error) {
	dayStart := clock.StartOfDayIn(clock.Now(), r.tz)
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

// DailyRevenue 返回最近 days 天每日营收（按支付时间，使用仓库时区自然日）。
// 返回 [date, revenueCents] 列表，按日期升序。
func (r *OrderRepository) DailyRevenue(days int) ([]models.DailyRevenueRow, error) {
	if days <= 0 {
		days = 14
	}
	start := clock.StartOfDayIn(clock.Now()-int64(days-1)*86400, r.tz)
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
	var out []models.DailyRevenueRow
	for i := days - 1; i >= 0; i-- {
		d := time.Unix(clock.Now()-int64(i)*86400, 0).In(r.tz).Format("2006-01-02")
		out = append(out, models.DailyRevenueRow{Date: d, Revenue: byDay[d]})
	}
	return out, nil
}

// ProductSales 返回各商品销量与销售额（已支付订单）。
func (r *OrderRepository) ProductSales(limit int) ([]models.ProductSaleRow, error) {
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
	var out []models.ProductSaleRow
	for rows.Next() {
		var s models.ProductSaleRow
		if err := rows.Scan(&s.Name, &s.Qty, &s.Revenue); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// CostSince 返回指定时间之后已支付订单的成本合计（分）。
func (r *OrderRepository) CostSince(ts int64) (int64, error) {
	var n int64
	err := r.db.QueryRow(`SELECT COALESCE(SUM(cost_cents * qty), 0)
		FROM orders
		WHERE status IN ('paid','processing','delivered','completed') AND paid_at >= ?`, ts).Scan(&n)
	return n, err
}

// CostSourceStats 返回成本来源统计（订单时间/迁移估算/未知）。
func (r *OrderRepository) CostSourceStats() (orderTime, migrationEstimate, unknown int, err error) {
	rows, qerr := r.db.Query(`SELECT cost_snapshot_source, COUNT(1) FROM orders WHERE status IN ('paid','processing','delivered','completed') GROUP BY cost_snapshot_source`)
	if qerr != nil {
		return 0, 0, 0, qerr
	}
	defer rows.Close()
	for rows.Next() {
		var src string
		var cnt int
		if serr := rows.Scan(&src, &cnt); serr != nil {
			return orderTime, migrationEstimate, unknown, serr
		}
		switch src {
		case "order_time":
			orderTime += cnt
		case "migration_estimate":
			migrationEstimate += cnt
		default:
			unknown += cnt
		}
	}
	return orderTime, migrationEstimate, unknown, rows.Err()
}
