package application

import (
	models "shop/internal/modules/admin/domain"

	productdomain "shop/internal/modules/product/domain"

	orderdomain "shop/internal/modules/order/domain"

	productapp "shop/internal/modules/product/application"

	inventoryapp "shop/internal/modules/inventory/application"

	orderapp "shop/internal/modules/order/application"
)

// StatsService 仪表盘/销售报表聚合（跨订单/卡密/商品仓储）。
type StatsService struct {
	orders   orderapp.OrderRepository
	keys     inventoryapp.KeyRepository
	products *productapp.ProductService
	store    StatsStore
}

func NewStatsService(orders orderapp.OrderRepository, keys inventoryapp.KeyRepository, products *productapp.ProductService, store StatsStore) *StatsService {
	return &StatsService{orders: orders, keys: keys, products: products, store: store}
}

// LowStockItem 低库存商品。
type LowStockItem struct {
	Product   productdomain.Product
	Available int
}

// DashboardData 仪表盘聚合数据。
type DashboardData struct {
	TodayOrders    int
	TodaySales     int
	TodayRevenue   int64
	TodayCost      int64
	TodayProfit    int64
	TodayPaidCards int
	PendingOrders  int
	PaymentFailed  int
	DeliveryFailed int
	Products       int
	AvailableCards int
	SoldCards      int
	LockedCards    int
	LowStock       []LowStockItem
	RecentOrders   []orderdomain.Order
}

// Dashboard 返回仪表盘数据。
func (s *StatsService) Dashboard(dayStart int64, threshold int) (DashboardData, error) {
	var out DashboardData
	todayOrders, todaySales, pending, paymentFailed, deliveryFailed, todayRevenue, err := s.orders.OrderCounts()
	if err != nil {
		return out, err
	}
	out.TodayOrders = todayOrders
	out.TodaySales = todaySales
	out.TodayRevenue = todayRevenue
	out.PendingOrders = pending
	out.PaymentFailed = paymentFailed
	out.DeliveryFailed = deliveryFailed
	out.TodayPaidCards, _ = s.keys.SoldCountSince(dayStart)
	out.TodayCost, _ = s.orders.CostSince(dayStart)
	out.TodayProfit = out.TodayRevenue - out.TodayCost
	available, sold, locked, err := s.keys.StockStats()
	if err != nil {
		return out, err
	}
	out.Products, _ = s.products.Count()
	out.AvailableCards = available
	out.SoldCards = sold
	out.LockedCards = locked
	lowViews, _ := s.products.LowStock(threshold)
	for _, v := range lowViews {
		out.LowStock = append(out.LowStock, LowStockItem{Product: v.Product, Available: v.Available})
	}
	out.RecentOrders, _ = s.orders.RecentOrders(8)
	return out, nil
}

// SalesReport 返回销售报表（近 N 日营收 + 商品销售占比 + 成本来源统计）。
func (s *StatsService) SalesReport(days int) ([]orderdomain.DailyRevenueRow, []orderdomain.ProductSaleRow, int, int, int, error) {
	daily, err := s.orders.DailyRevenue(days)
	if err != nil {
		return nil, nil, 0, 0, 0, err
	}
	products, err := s.orders.ProductSales(10)
	if err != nil {
		return nil, nil, 0, 0, 0, err
	}
	orderTime, migrationEstimate, unknown, err := s.orders.CostSourceStats()
	if err != nil {
		return nil, nil, 0, 0, 0, err
	}
	return daily, products, orderTime, migrationEstimate, unknown, nil
}

// HealthInfo 健康检查聚合指标。
type HealthInfo struct {
	SchemaVersion    int
	IntegrityOK      bool
	MailQueuePending int
	LastJobSuccess   int64
}

// Health 返回数据库/任务健康指标。
func (s *StatsService) Health() (HealthInfo, error) {
	var h HealthInfo
	h.SchemaVersion = s.store.SchemaVersion()
	h.IntegrityOK = s.store.IntegrityOK()
	pending, err := s.store.PendingMailCount()
	if err != nil {
		return h, err
	}
	h.MailQueuePending = pending
	runs, err := s.store.LatestJobRuns()
	if err != nil {
		return h, err
	}
	for _, r := range runs {
		if r.Status == models.JobRunOK && r.FinishedAt > h.LastJobSuccess {
			h.LastJobSuccess = r.FinishedAt
		}
	}
	return h, nil
}
