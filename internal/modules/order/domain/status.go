// Package domain 订单领域模型：状态机与订单结构。
package domain

// Status 订单状态（强类型，业务规则由迁移方法表达）。
type Status string

// 订单状态机状态值（值与数据库存储一致）。
const (
	OrderCreated         Status = "created"
	OrderWaitingPayment  Status = "waiting_payment"
	OrderPaid            Status = "paid"
	OrderProcessing      Status = "processing"
	OrderPendingDelivery Status = "pending_delivery"
	OrderDelivered       Status = "delivered"
	OrderCompleted       Status = "completed"
	OrderPaymentFailed   Status = "payment_failed"
	OrderDeliveryFailed  Status = "delivery_failed"
	OrderCancelled       Status = "cancelled"
	OrderExpired         Status = "expired"
)

// PaymentStatus 支付生命周期状态（与订单状态解耦）。
type PaymentStatus string

// 支付生命周期状态值。
const (
	PaymentCreated   PaymentStatus = "created"
	PaymentPending   PaymentStatus = "pending"
	PaymentConfirmed PaymentStatus = "confirmed"
	PaymentFailed    PaymentStatus = "failed"
	PaymentCancelled PaymentStatus = "cancelled"
)

// IsOrderFinal 判断是否为终态。
func IsOrderFinal(status Status) bool {
	switch status {
	case OrderCompleted, OrderPaymentFailed, OrderDeliveryFailed, OrderCancelled, OrderExpired:
		return true
	}
	return false
}

// IsValidOrderStatus 判断是否为已知订单状态值。
func IsValidOrderStatus(s Status) bool {
	switch s {
	case OrderCreated, OrderWaitingPayment, OrderPaid, OrderProcessing,
		OrderPendingDelivery, OrderDelivered, OrderCompleted, OrderPaymentFailed,
		OrderDeliveryFailed, OrderCancelled, OrderExpired:
		return true
	}
	return false
}
