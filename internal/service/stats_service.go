package service

import (
	"shop/internal/db/repository"
	"shop/internal/models"
)

// StatsService 仪表盘/销售报表聚合（跨订单/卡密/商品仓储）。
type StatsService struct {
	orders   *repository.OrderRepository
	keys     *repository.KeyRepository
	products *repository.ProductRepository
}

func NewStatsService(orders *repository.OrderRepository, keys *repository.KeyRepository, products *repository.ProductRepository) *StatsService {
	return &StatsService{orders: orders, keys: keys, products: products}
}

// LowStockItem 低库存商品。
type LowStockItem struct {
	Product   models.Product
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
	RecentOrders   []models.Order
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
	products, available, sold, locked, err := s.keys.StockStats()
	if err != nil {
		return out, err
	}
	out.Products = products
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
func (s *StatsService) SalesReport(days int) ([]repository.DailyRevenueRow, []repository.ProductSaleRow, int, int, int, error) {
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
