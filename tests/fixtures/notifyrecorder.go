package fixtures

import (
	"sync"

	inventorydomain "shop/internal/modules/inventory/domain"
	orderapp "shop/internal/modules/order/application"
	orderdomain "shop/internal/modules/order/domain"
	platformevents "shop/internal/platform/events"
)

// NotifyRecorder 收集 OrderService 发布的领域事件（内存 recorder，替代真实 SMTP/Telegram）。
type NotifyRecorder struct {
	mu sync.Mutex

	Paid           []orderdomain.Order
	Created        []orderdomain.Order
	PaymentSuccess []orderdomain.Order
	Delivered      []orderdomain.Order
	Expired        []string
	Cancelled      []string
	DeliveryFailed []string
	LowStock       []orderapp.LowStockEvent
	LinksSent      []string
}

// Publish 实现 events.Publisher，按事件类型记录。
func (r *NotifyRecorder) Publish(e platformevents.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch ev := e.(type) {
	case orderapp.OrderCreatedEvent:
		r.Created = append(r.Created, ev.Order)
	case orderapp.OrderPaidEvent:
		r.Paid = append(r.Paid, ev.Order)
		r.PaymentSuccess = append(r.PaymentSuccess, ev.Order)
	case orderapp.OrderDeliveredEvent:
		r.Delivered = append(r.Delivered, ev.Order)
	case orderapp.OrderExpiredEvent:
		r.Expired = append(r.Expired, ev.OrderNo)
	case orderapp.OrderCancelledEvent:
		r.Cancelled = append(r.Cancelled, ev.OrderNo)
	case orderapp.DeliveryFailedEvent:
		r.DeliveryFailed = append(r.DeliveryFailed, ev.OrderNo)
	case orderapp.LowStockEvent:
		r.LowStock = append(r.LowStock, ev)
	}
}

func (r *NotifyRecorder) SendPaid(o orderdomain.Order, _ []inventorydomain.Card) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Paid = append(r.Paid, o)
}

func (r *NotifyRecorder) SendLinks(contact string, _ []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.LinksSent = append(r.LinksSent, contact)
	return nil
}

// Wire 把 recorder 接入 OrderService：领域事件 + 重发邮件回调。
func (r *NotifyRecorder) Wire(s *orderapp.OrderService) {
	s.SetEvents(platformevents.Func(r.Publish))
	s.SendPaid = r.SendPaid
	s.SendLinks = r.SendLinks
}

func (r *NotifyRecorder) count(f func() int) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return f()
}

func (r *NotifyRecorder) PaidCount() int { return r.count(func() int { return len(r.Paid) }) }
func (r *NotifyRecorder) CreatedCount() int {
	return r.count(func() int { return len(r.Created) })
}
func (r *NotifyRecorder) PaymentSuccessCount() int {
	return r.count(func() int { return len(r.PaymentSuccess) })
}
func (r *NotifyRecorder) DeliveredCount() int { return r.count(func() int { return len(r.Delivered) }) }
