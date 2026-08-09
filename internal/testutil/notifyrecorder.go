package testutil

import (
	"sync"

	"shop/internal/models"
	"shop/internal/service"
)

// NotifyRecorder 收集 OrderService 的通知回调（内存 recorder，替代真实 SMTP/Telegram）。
type NotifyRecorder struct {
	mu sync.Mutex

	Paid           []models.Order
	Created        []models.Order
	PaymentSuccess []models.Order
	Delivered      []models.Order
	SystemErrors   []string
	LinksSent      []string
}

func (r *NotifyRecorder) SendPaid(o models.Order, _ []models.Card) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Paid = append(r.Paid, o)
}

func (r *NotifyRecorder) OnOrderCreated(o models.Order) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Created = append(r.Created, o)
}

func (r *NotifyRecorder) OnPaymentSuccess(o models.Order, _ []models.Card) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.PaymentSuccess = append(r.PaymentSuccess, o)
}

func (r *NotifyRecorder) OnDelivered(o models.Order, _ []models.Card) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Delivered = append(r.Delivered, o)
}

func (r *NotifyRecorder) OnSystemError(msg string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.SystemErrors = append(r.SystemErrors, msg)
}

func (r *NotifyRecorder) SendLinks(contact string, _ []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.LinksSent = append(r.LinksSent, contact)
	return nil
}

// Wire 把 recorder 接到 OrderService 的通知回调上。
func (r *NotifyRecorder) Wire(s *service.OrderService) {
	s.SendPaid = r.SendPaid
	s.OnOrderCreated = r.OnOrderCreated
	s.OnPaymentSuccess = r.OnPaymentSuccess
	s.OnDelivered = r.OnDelivered
	s.OnSystemError = r.OnSystemError
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
