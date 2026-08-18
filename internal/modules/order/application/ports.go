package application

import (
	"errors"

	"shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
)

// PaymentGateway 支付网关端口（由支付适配器实现，业务不绑定具体网关）。
type PaymentGateway interface {
	// CreateTransaction 创建支付交易，返回收银台地址与交易 ID。
	CreateTransaction(in CreateInput) (paymentURL, tradeID string, err error)
	// CancelTransaction 关闭指定交易（取消/过期订单时调用）。
	CancelTransaction(tradeID string) error
	// VerifyCallback 校验支付网关回调签名并解析为归一化回调（状态已转换为 PaymentTxStatus）。
	VerifyCallback(body []byte) (PaymentCallback, error)
}

// CreateInput 创建交易输入（网关无关的最小集合）。
type CreateInput struct {
	OrderID     string
	Amount      float64
	Fiat        string
	TradeType   string
	Name        string
	NotifyURL   string
	RedirectURL string
	TimeoutSec  int
}

// CallbackParams 支付回调解析结果（网关字段统一为字符串）。
type CallbackParams map[string]string

// PaymentTxStatus 网关侧交易状态（适配器把各渠道原始状态归一化为该枚举，
// 订单核心逻辑不感知 "2"/"paid" 等渠道原始值）。
type PaymentTxStatus string

const (
	PaymentTxPending PaymentTxStatus = "pending" // 待支付/处理中
	PaymentTxPaid    PaymentTxStatus = "paid"    // 已支付
	PaymentTxClosed  PaymentTxStatus = "closed"  // 已关闭（取消/过期/无效）
)

// PaymentCallback 归一化支付回调（适配器负责签名校验与字段/状态映射）。
type PaymentCallback struct {
	OrderID            string
	TradeID            string
	BlockTransactionID string
	Amount             string
	Currency           string
	Status             PaymentTxStatus
}

// GatewayProvider 由组合根注入：按网关名构造适配器（内部实现 gateways）。
type GatewayProvider func(gateway string) PaymentGateway

// ProductReader 商品读取端口（下单用例按商品 ID 获取商品，不依赖具体商品实现）。
type ProductReader interface {
	GetActiveView(id int64) (productdomain.ProductView, error)
}

var (
	// ErrGatewayNotConfigured 网关凭据未配置。
	ErrGatewayNotConfigured = errors.New("payment gateway is not configured")
	// ErrHashPayAlreadyPaid 取消/过期时发现 HashPay 订单已支付（取消与付款竞态）。
	ErrHashPayAlreadyPaid = errors.New("hashpay order already paid")
	// ErrHashPayPending HashPay 仍待支付，不能提前把本地订单标记为已取消/过期。
	ErrHashPayPending = errors.New("hashpay order still pending")
)

// OrderRepository 订单数据访问端口（由仓储层实现，测试可用 mock）。
type OrderRepository interface {
	GetOrderByNo(orderNo string) (domain.Order, error)
	GetOrderByID(id int64) (domain.Order, error)
	OrdersByContact(contact string, limit int) ([]domain.Order, error)
	ListOrders(where string, args []any, limit int) ([]domain.Order, error)
	CreatePendingOrder(order *domain.Order) error
	SetTradeInfo(orderID int64, tradeID, paymentURL string) error
	MarkPaidAndDeliver(orderID int64, gateway, tradeID, blockTx string, paidAt int64) (int64, error)
	MarkPaidPendingDelivery(orderID int64, gateway, tradeID, blockTx string, paidAt int64) error
	SetManualDelivery(orderID int64, content string) (bool, error)
	CompleteFreeOrder(orderID int64, paidAt int64) (int64, error)
	CompleteFreeOrderManual(orderID int64, paidAt int64) error
	CancelOrder(orderID int64) (string, bool, error)
	ExpireOrder(orderID int64) (string, bool, error)
	SetOrderStatus(orderID int64, status domain.Status) error
	MarkPaymentFailed(orderID int64) error
	SetPaymentStatus(orderID int64, status domain.PaymentStatus) error
	GetPaymentStatus(orderID int64) (domain.PaymentStatus, error)
	GetOrderStatus(orderID int64) (domain.Status, error)
	OrderCounts() (todayOrders, todaySales, pending, paymentFailed, deliveryFailed int, todayRevenue int64, err error)
	RecentOrders(limit int) ([]domain.Order, error)
	AddLog(orderID int64, event, message string, from, to domain.Status, adminID int64) error
	Logs(orderID int64) ([]domain.OrderEvent, error)
	DailyRevenue(days int) ([]domain.DailyRevenueRow, error)
	ProductSales(limit int) ([]domain.ProductSaleRow, error)
	CostSince(ts int64) (int64, error)
	CostSourceStats() (orderTime, migrationEstimate, unknown int, err error)
	DeleteOldLogs(cutoff int64) error
}
