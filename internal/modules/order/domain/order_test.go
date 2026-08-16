package domain

import "testing"

// TestOrderStateMachine 状态机合法迁移（贴近被测代码的单元测试）。
func TestOrderStateMachine(t *testing.T) {
	valid := []struct{ from, to Status }{
		{OrderCreated, OrderWaitingPayment},
		{OrderCreated, OrderPaymentFailed},
		{OrderCreated, OrderCancelled},
		{OrderWaitingPayment, OrderPaid},
		{OrderWaitingPayment, OrderExpired},
		{OrderWaitingPayment, OrderCancelled},
		{OrderPaid, OrderProcessing},
		{OrderPaid, OrderDeliveryFailed},
		{OrderProcessing, OrderDelivered},
		{OrderProcessing, OrderDeliveryFailed},
		{OrderPendingDelivery, OrderDelivered},
		{OrderDelivered, OrderCompleted},
	}
	for _, c := range valid {
		if !IsValidOrderTransition(c.from, c.to) {
			t.Errorf("transition %s -> %s should be valid", c.from, c.to)
		}
	}
	invalid := []struct{ from, to Status }{
		{OrderWaitingPayment, OrderProcessing},
		{OrderPaid, OrderWaitingPayment},
		{OrderPaid, OrderCompleted},
		{OrderProcessing, OrderCompleted},
		{OrderExpired, OrderPaid},
		{OrderCompleted, OrderDelivered},
		{OrderCreated, OrderDelivered},
	}
	for _, c := range invalid {
		if IsValidOrderTransition(c.from, c.to) {
			t.Errorf("transition %s -> %s should be invalid", c.from, c.to)
		}
	}
}

// TestOrderTransitionTo 迁移方法：合法迁移生效，非法迁移返回错误。
func TestOrderTransitionTo(t *testing.T) {
	o := &Order{Status: OrderWaitingPayment}
	if err := o.TransitionTo(OrderPaid); err != nil {
		t.Fatalf("TransitionTo(paid): %v", err)
	}
	if o.Status != OrderPaid {
		t.Fatalf("status = %s, want paid", o.Status)
	}
	if err := o.TransitionTo(OrderWaitingPayment); err == nil {
		t.Fatal("paid -> waiting_payment should be rejected")
	}
}

// TestConfirmPayment 支付确认业务规则：状态、交易号、支付时间、支付状态。
func TestConfirmPayment(t *testing.T) {
	o := &Order{Status: OrderWaitingPayment}
	if err := o.ConfirmPayment("T-1", 1700000000); err != nil {
		t.Fatalf("ConfirmPayment: %v", err)
	}
	if o.Status != OrderPaid || o.TradeID != "T-1" || o.PaidAt != 1700000000 || o.PaymentStatus != PaymentConfirmed {
		t.Fatalf("confirm payment not applied: %+v", o)
	}
	if err := o.ConfirmPayment("T-2", 1700000001); err == nil {
		t.Fatal("paid order should not be confirmable again")
	}
}

// TestOrderFinalStates 终态判定。
func TestOrderFinalStates(t *testing.T) {
	for _, s := range []Status{OrderCompleted, OrderPaymentFailed, OrderDeliveryFailed, OrderCancelled, OrderExpired} {
		if !IsOrderFinal(s) {
			t.Errorf("%s should be final", s)
		}
	}
	if IsOrderFinal(OrderPaid) || IsOrderFinal(OrderWaitingPayment) {
		t.Fatal("non-final states marked final")
	}
}
