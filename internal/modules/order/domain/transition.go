package domain

import "errors"

// ErrInvalidStatusTransition 非法状态迁移。
var ErrInvalidStatusTransition = errors.New("invalid order status transition")

// validOrderTransitions 定义状态机的合法迁移。
var validOrderTransitions = map[Status]map[Status]bool{
	OrderCreated: {
		OrderWaitingPayment: true,
		OrderPaymentFailed:  true,
		OrderCancelled:      true,
		OrderExpired:        true,
	},
	OrderWaitingPayment: {
		OrderPaid:      true,
		OrderExpired:   true,
		OrderCancelled: true,
	},
	OrderPaid: {
		OrderProcessing:      true,
		OrderPendingDelivery: true,
		OrderDeliveryFailed:  true,
	},
	OrderPendingDelivery: {
		OrderDelivered: true,
	},
	OrderProcessing: {
		OrderDelivered:      true,
		OrderDeliveryFailed: true,
	},
	OrderDelivered: {
		OrderCompleted: true,
	},
}

// IsValidOrderTransition 判断状态迁移是否合法。
func IsValidOrderTransition(from, to Status) bool {
	next, ok := validOrderTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// CanTransitionTo 订单能否迁移到目标状态（业务规则集中于此）。
func (o *Order) CanTransitionTo(to Status) bool {
	return IsValidOrderTransition(o.Status, to)
}

// TransitionTo 校验并迁移订单状态；非法迁移返回 ErrInvalidStatusTransition。
func (o *Order) TransitionTo(to Status) error {
	if !o.CanTransitionTo(to) {
		return ErrInvalidStatusTransition
	}
	o.Status = to
	return nil
}

// ConfirmPayment 确认支付：waiting_payment → paid，并记录交易信息与支付时间。
func (o *Order) ConfirmPayment(tradeID string, paidAt int64) error {
	if o.Status != OrderWaitingPayment {
		return ErrInvalidStatusTransition
	}
	o.TradeID = tradeID
	o.PaidAt = paidAt
	o.PaymentStatus = PaymentConfirmed
	return o.TransitionTo(OrderPaid)
}

// ConfirmPaidPendingDelivery 人工交付订单支付确认：waiting_payment → pending_delivery。
func (o *Order) ConfirmPaidPendingDelivery(tradeID string, paidAt int64) error {
	if o.Status != OrderWaitingPayment {
		return ErrInvalidStatusTransition
	}
	o.TradeID = tradeID
	o.PaidAt = paidAt
	o.PaymentStatus = PaymentConfirmed
	return o.TransitionTo(OrderPendingDelivery)
}

// Cancel 取消订单：created/waiting_payment → cancelled。
func (o *Order) Cancel() error {
	return o.TransitionTo(OrderCancelled)
}

// Expire 订单过期：created/waiting_payment → expired。
func (o *Order) Expire() error {
	return o.TransitionTo(OrderExpired)
}
