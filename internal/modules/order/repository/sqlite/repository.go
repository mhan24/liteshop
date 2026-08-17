package sqlite

import (
	"database/sql"
	inventorydomain "shop/internal/modules/inventory/domain"
	models "shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
	"time"
)

type rowScanner interface {
	Scan(dest ...any) error
}

func scanOrder(row rowScanner) (models.Order, error) {
	var r orderRow
	err := row.Scan(&r.ID, &r.OrderNo, &r.ProductID, &r.ProductName, &r.Qty, &r.AmountCents, &r.CostCents, &r.Fiat, &r.TradeType, &r.PaymentGateway, &r.BuyerContact, &r.ViewToken, &r.Status, &r.PaymentStatus, &r.TradeID, &r.PaymentURL, &r.BlockTransactionID, &r.DeliveryType, &r.DeliveryContent, &r.CreatedAt, &r.UpdatedAt, &r.PaidAt)
	return toDomain(r), err
}

func scanOrderRows(rows *sql.Rows) (models.Order, error) {
	return scanOrder(rows)
}

// OrderRepository 订单数据访问（按职责拆分到 order_*.go 小文件）。
type OrderRepository struct {
	db      *sql.DB
	tz      *time.Location
	encoder OutboxEncoder
	cards   CardTxOps
	coupons CouponTxOps
}

func NewOrderRepository(db *sql.DB) *OrderRepository {
	return &OrderRepository{db: db, tz: clock.BeijingLocation}
}

// NewOrderRepositoryWithTZ 使用指定时区（用于多地区统计自然日）。
func NewOrderRepositoryWithTZ(db *sql.DB, tz *time.Location) *OrderRepository {
	if tz == nil {
		tz = clock.BeijingLocation
	}
	return &OrderRepository{db: db, tz: tz}
}

// SetCardTxOps 注入事务内卡密操作端口（实现归 inventory 模块，组合根装配）。
func (r *OrderRepository) SetCardTxOps(ops CardTxOps) {
	r.cards = ops
}

// SetCouponTxOps 注入事务内优惠券回滚端口（实现归 coupon 模块，组合根装配）。
func (r *OrderRepository) SetCouponTxOps(ops CouponTxOps) {
	r.coupons = ops
}

// OutboxEvent 一条待写出的 outbox 事件（类型 + 载荷）。
type OutboxEvent struct {
	Type    string
	Payload string
}

// OutboxEncoder 由组合根注入：把订单/卡密编码为 outbox 载荷（业务语义在订单模块，
// 仓储不感知事件结构；保证支付事务内写出 outbox）。
type OutboxEncoder func(o models.Order, cards []inventorydomain.Card) ([]OutboxEvent, error)

// SetOutboxEncoder 注入 outbox 载荷编码器。
func (r *OrderRepository) SetOutboxEncoder(encoder OutboxEncoder) {
	r.encoder = encoder
}
