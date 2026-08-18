package http

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"shop/internal/platform/httpserver"
	"shop/internal/shared/clock"
	"strconv"
	"time"
)

func (h *Handlers) Dashboard(w http.ResponseWriter, r *http.Request) {
	dayStart := clock.StartOfDayIn(clock.Now(), clock.LocationFromTimezone(h.deps.Settings.SiteSettings().Timezone))
	data, err := h.deps.Stats.Dashboard(dayStart, h.deps.Settings.LowStockThreshold())
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	lowStock := []map[string]any{}
	for _, v := range data.LowStock {
		lowStock = append(lowStock, map[string]any{"id": v.Product.ID, "name": v.Product.Name, "price_cents": v.Product.PriceCents, "available": v.Available})
	}
	recent := []map[string]any{}
	for _, o := range data.RecentOrders {
		recent = append(recent, map[string]any{
			"id": o.ID, "order_no": o.OrderNo, "product_name": o.ProductName,
			"qty": o.Qty, "amount": fmt.Sprintf("%.2f", float64(o.AmountCents)/100),
			"fiat": o.Fiat, "status": o.Status, "created_at": o.CreatedAt,
		})
	}

	// 系统状态
	var dbSize int64
	if st, err := os.Stat(h.deps.DBPath); err == nil {
		dbSize = st.Size()
	}
	ver := runtime.Version()
	uptime := int64(time.Since(h.deps.StartTime).Seconds())

	resp := map[string]any{
		"today_orders":     data.TodayOrders,
		"today_sales":      data.TodaySales,
		"today_revenue":    data.TodayRevenue,
		"today_paid_cards": data.TodayPaidCards,
		"pending_orders":   data.PendingOrders,
		"payment_failed":   data.PaymentFailed,
		"delivery_failed":  data.DeliveryFailed,
		"products":         data.Products,
		"available_cards":  data.AvailableCards,
		"sold_cards":       data.SoldCards,
		"locked_cards":     data.LockedCards,
		"low_stock":        lowStock,
		"recent_orders":    recent,
		"system": map[string]any{
			"go_version": ver,
			"db_size":    dbSize,
			"uptime":     uptime,
		},
	}
	if h.currentRole(r) != "viewer" {
		resp["today_cost"] = data.TodayCost
		resp["today_profit"] = data.TodayProfit
	}
	httpserver.WriteJSON(w, 200, resp)
}

func (h *Handlers) currentRole(r *http.Request) string {
	if h.deps.CurrentRole == nil {
		return "viewer"
	}
	return h.deps.CurrentRole(r)
}

// apiAdminSalesReport 返回销售报表（近 N 日营收曲线 + 商品销售占比）。

func (h *Handlers) AdminSalesReport(w http.ResponseWriter, r *http.Request) {
	days := 14
	if d, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && d > 0 && d <= 90 {
		days = d
	}
	daily, products, orderTime, migrationEstimate, unknown, err := h.deps.Stats.SalesReport(days)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{
		"daily":    daily,
		"products": products,
		"cost_source_stats": map[string]int{
			"order_time":         orderTime,
			"migration_estimate": migrationEstimate,
			"unknown":            unknown,
		},
	})
}
