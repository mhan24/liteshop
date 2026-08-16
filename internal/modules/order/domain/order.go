package domain

import "errors"

// Order 订单。
type Order struct {
	ID                 int64
	OrderNo            string
	ProductID          int64
	ProductName        string
	Qty                int
	AmountCents        int64
	CostCents          int64
	CostSnapshotSource string
	Fiat               string
	TradeType          string
	PaymentGateway     string
	BuyerContact       string
	ViewToken          string
	Status             Status
	PaymentStatus      PaymentStatus
	TradeID            string
	PaymentURL         string
	BlockTransactionID string
	DeliveryType       string
	DeliveryContent    string
	CreatedAt          int64
	UpdatedAt          int64
	PaidAt             int64
}

// OrderEvent 订单事件日志。
type OrderEvent struct {
	ID        int64
	OrderID   int64
	Event     string
	Message   string
	From      string
	To        string
	AdminID   int64
	Metadata  string
	CreatedAt int64
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

var (
	// ErrCardOpsNotInjected 卡密事务端口未注入（组合根装配缺失）。
	ErrCardOpsNotInjected = errors.New("card tx ops not injected")
)

// InsufficientError 库存不足错误。
type InsufficientError struct{}

func (e *InsufficientError) Error() string { return "insufficient card stock" }

var (
	// ErrNoCards 订单已支付但发卡数量为 0（需管理员处理）。
	ErrNoCards = errors.New("order paid but no cards delivered")
	// ErrAlreadyProcessed 外部事件已处理（幂等）。
	ErrAlreadyProcessed = errors.New("event already processed")
)
