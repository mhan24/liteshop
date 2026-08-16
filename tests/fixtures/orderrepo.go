package fixtures

import (
	"database/sql"
	"time"

	couponsqlite "shop/internal/modules/coupon/repository/sqlite"
	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	ordersqlite "shop/internal/modules/order/repository/sqlite"
)

// NewOrderRepository 返回装配好跨模块事务端口的订单仓储（测试用组合根）。
// 与 internal/app 组合根一致：卡密/优惠券 SQL 由各自模块实现，以端口注入。
func NewOrderRepository(d *sql.DB) *ordersqlite.OrderRepository {
	repo := ordersqlite.NewOrderRepository(d)
	repo.SetCardTxOps(inventorysqlite.NewTxOps())
	repo.SetCouponTxOps(couponsqlite.NewTxOps())
	return repo
}

// NewOrderRepositoryWithTZ 与 NewOrderRepository 相同，但使用指定时区。
func NewOrderRepositoryWithTZ(d *sql.DB, tz *time.Location) *ordersqlite.OrderRepository {
	repo := ordersqlite.NewOrderRepositoryWithTZ(d, tz)
	repo.SetCardTxOps(inventorysqlite.NewTxOps())
	repo.SetCouponTxOps(couponsqlite.NewTxOps())
	return repo
}
