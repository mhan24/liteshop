package repository

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

// OrderRepository 订单数据访问（按职责拆分到 order_*.go 小文件）。
type OrderRepository struct {
	db *sql.DB
	tz *time.Location
}

func NewOrderRepository(db *sql.DB) *OrderRepository {
	return &OrderRepository{db: db, tz: models.BeijingLocation}
}

// NewOrderRepositoryWithTZ 使用指定时区（用于多地区统计自然日）。
func NewOrderRepositoryWithTZ(db *sql.DB, tz *time.Location) *OrderRepository {
	if tz == nil {
		tz = models.BeijingLocation
	}
	return &OrderRepository{db: db, tz: tz}
}
