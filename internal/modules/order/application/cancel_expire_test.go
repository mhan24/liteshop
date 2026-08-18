package application

import (
	"errors"
	"sync"
	"testing"
	"time"

	models "shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
	"shop/internal/platform/events"
)

// fakeOrderRepo 内嵌 OrderRepository 接口，只覆盖被测用例用到的方法。
type fakeOrderRepo struct {
	OrderRepository
	order         models.Order
	orderErr      error
	orderNo       string
	cancelChanged bool
	cancelErr     error
	expireChanged bool
	expireErr     error
	logs          []string
	list          []models.Order
}

func (f *fakeOrderRepo) GetOrderByID(id int64) (models.Order, error) {
	if f.orderErr != nil {
		return models.Order{}, f.orderErr
	}
	return f.order, nil
}

func (f *fakeOrderRepo) CancelOrder(orderID int64) (string, bool, error) {
	return f.orderNo, f.cancelChanged, f.cancelErr
}

func (f *fakeOrderRepo) ExpireOrder(orderID int64) (string, bool, error) {
	return f.orderNo, f.expireChanged, f.expireErr
}

func (f *fakeOrderRepo) AddLog(orderID int64, event, message string, from, to models.Status, adminID int64) error {
	f.logs = append(f.logs, event)
	return nil
}

func (f *fakeOrderRepo) ListOrders(where string, args []any, limit int) ([]models.Order, error) {
	return f.list, nil
}

type fakePublisher struct {
	mu  sync.Mutex
	got []events.Event
}

type cancelGatewayStub struct {
	err   error
	calls int
}

func (g *cancelGatewayStub) CreateTransaction(CreateInput) (string, string, error) {
	return "", "", nil
}
func (g *cancelGatewayStub) CancelTransaction(string) error {
	g.calls++
	return g.err
}
func (g *cancelGatewayStub) VerifyCallback([]byte) (PaymentCallback, error) {
	return PaymentCallback{}, nil
}

func (p *fakePublisher) Publish(e events.Event) {
	p.mu.Lock()
	p.got = append(p.got, e)
	p.mu.Unlock()
}

func (p *fakePublisher) names() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]string, 0, len(p.got))
	for _, e := range p.got {
		out = append(out, e.EventName())
	}
	return out
}

func newCancelExpireSvc(repo *fakeOrderRepo) (*OrderService, *fakePublisher) {
	svc := NewOrderService(repo, nil, nil)
	pub := &fakePublisher{}
	svc.SetEvents(pub)
	return svc, pub
}

// waitEvent 轮询等待异步发布的领域事件（publish 为 goroutine 异步）。
func waitEvent(t *testing.T, pub *fakePublisher, name string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		for _, n := range pub.names() {
			if n == name {
				return
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("event %s not published (got %v)", name, pub.names())
}

// TestCancelPublishesEventAndLogs 取消用例：状态迁移 + 日志 + 领域事件。
func TestCancelPublishesEventAndLogs(t *testing.T) {
	repo := &fakeOrderRepo{
		order:         models.Order{ID: 1, OrderNo: "O1", Status: models.OrderWaitingPayment},
		orderNo:       "O1",
		cancelChanged: true,
	}
	svc, pub := newCancelExpireSvc(repo)

	if err := svc.Cancel(1); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if len(repo.logs) != 1 || repo.logs[0] != "cancelled" {
		t.Fatalf("logs = %v, want [cancelled]", repo.logs)
	}
	waitEvent(t, pub, "order.cancelled")
}

// TestCancelInvalidState 取消用例：条件迁移未生效时返回错误且不发布事件。
func TestCancelInvalidState(t *testing.T) {
	repo := &fakeOrderRepo{
		order:         models.Order{ID: 1, OrderNo: "O1", Status: models.OrderDelivered},
		orderNo:       "O1",
		cancelChanged: false,
	}
	svc, pub := newCancelExpireSvc(repo)

	if err := svc.Cancel(1); err == nil {
		t.Fatal("cancel of delivered order should fail")
	}
	if names := pub.names(); len(names) != 0 {
		t.Fatalf("unexpected events: %v", names)
	}
}

// TestExpirePublishesEventAndLogs 过期用例：状态迁移 + 日志 + 领域事件。
func TestExpirePublishesEventAndLogs(t *testing.T) {
	repo := &fakeOrderRepo{
		order:         models.Order{ID: 2, OrderNo: "O2", Status: models.OrderWaitingPayment},
		orderNo:       "O2",
		expireChanged: true,
	}
	svc, pub := newCancelExpireSvc(repo)

	if err := svc.Expire(2); err != nil {
		t.Fatalf("expire: %v", err)
	}
	if len(repo.logs) != 1 || repo.logs[0] != "expired" {
		t.Fatalf("logs = %v, want [expired]", repo.logs)
	}
	waitEvent(t, pub, "order.expired")
}

// TestCancelOrderNotFound 仓储错误透传。
func TestCancelOrderNotFound(t *testing.T) {
	repo := &fakeOrderRepo{orderErr: errors.New("not found")}
	svc, _ := newCancelExpireSvc(repo)
	if err := svc.Cancel(9); err == nil || err.Error() != "not found" {
		t.Fatalf("cancel err = %v, want not found", err)
	}
}

func TestCancelWithGatewayFailureDoesNotCancelLocally(t *testing.T) {
	repo := &fakeOrderRepo{
		order:         models.Order{ID: 1, OrderNo: "O1", Status: models.OrderWaitingPayment, TradeID: "T1", PaymentGateway: "bepusdt"},
		cancelChanged: true,
	}
	gw := &cancelGatewayStub{err: errors.New("gateway cancel failed")}
	svc, _ := newCancelExpireSvc(repo)
	svc.payFn = func(string) PaymentGateway { return gw }

	if err := svc.CancelWithGateway(1); err == nil {
		t.Fatal("gateway cancellation failure must be returned")
	}
	if gw.calls != 1 {
		t.Fatalf("cancel calls = %d, want 1", gw.calls)
	}
	if len(repo.logs) != 0 {
		t.Fatalf("local cancellation must not be recorded: %v", repo.logs)
	}
}

func TestRedeliverRejectsManualDelivery(t *testing.T) {
	repo := &fakeOrderRepo{
		order: models.Order{
			ID: 1, OrderNo: "O1", Status: models.OrderDelivered,
			DeliveryType: productdomain.DeliveryTypeManual,
		},
	}
	svc, _ := newCancelExpireSvc(repo)
	if err := svc.Redeliver(1); err == nil {
		t.Fatal("manual delivery order must not enter card redelivery")
	}
}

func TestRedeliverDoesNotDowngradeCompletedOrderWithoutCards(t *testing.T) {
	repo := &fakeOrderRepo{
		order: models.Order{
			ID: 1, OrderNo: "O1", Status: models.OrderCompleted,
			ProductID: 1, Qty: 1, DeliveryType: productdomain.DeliveryTypeAuto,
		},
	}
	svc, _ := newCancelExpireSvc(repo)
	svc.inventory = &stubInventory{}
	if err := svc.Redeliver(1); err == nil {
		t.Fatal("completed order without cards must not be downgraded or restocked")
	}
}

// TestExpireStale 批量过期：只统计成功过期的订单。
func TestExpireStale(t *testing.T) {
	repo := &fakeOrderRepo{
		list: []models.Order{
			{ID: 1, OrderNo: "S1", Status: models.OrderCreated},
			{ID: 2, OrderNo: "S2", Status: models.OrderWaitingPayment},
		},
		orderNo:       "S",
		expireChanged: true,
	}
	svc, _ := newCancelExpireSvc(repo)
	n, err := svc.ExpireStale(60)
	if err != nil {
		t.Fatalf("expire stale: %v", err)
	}
	if n != 2 {
		t.Fatalf("expired = %d, want 2", n)
	}
}

func TestExpireStalePropagatesFailure(t *testing.T) {
	repo := &fakeOrderRepo{
		list: []models.Order{{ID: 1, OrderNo: "S1", Status: models.OrderWaitingPayment}},
		order: models.Order{ID: 1, OrderNo: "S1", Status: models.OrderWaitingPayment},
		orderNo: "S1",
		expireErr: errors.New("expire persistence failed"),
	}
	svc, _ := newCancelExpireSvc(repo)
	if _, err := svc.ExpireStale(60); err == nil || err.Error() != "expire persistence failed" {
		t.Fatalf("expire stale err = %v, want persistence failure", err)
	}
}
