package application

import (
	"context"
	"errors"
	"strings"
	"testing"

	inventoryapp "shop/internal/modules/inventory/application"
	inventorydomain "shop/internal/modules/inventory/domain"
	"shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
)

type stubProductReader struct {
	view productdomain.ProductView
	err  error
}

func (s *stubProductReader) GetActiveView(id int64) (productdomain.ProductView, error) {
	if s.err != nil {
		return productdomain.ProductView{}, s.err
	}
	return s.view, nil
}

type stubInventory struct {
	available int
	err       error
}

func (s *stubInventory) ReserveCards(context.Context, int64, int64, int) error { return nil }
func (s *stubInventory) ReserveFromStock(context.Context, int64, int64, int) error {
	return nil
}
func (s *stubInventory) ConfirmReservation(context.Context, int64) (int, error) { return 0, nil }
func (s *stubInventory) ReleaseReservation(context.Context, int64) error        { return nil }
func (s *stubInventory) CardsForOrder(context.Context, int64) ([]inventorydomain.Card, error) {
	return nil, nil
}
func (s *stubInventory) AvailableCount(context.Context, int64) (int, error) {
	return s.available, s.err
}
func (s *stubInventory) StockCounts(context.Context, int64) (int, int, int, error) {
	return s.available, 0, 0, s.err
}
func (s *stubInventory) StockCountsBatch(context.Context, []int64) (map[int64]inventoryapp.StockCount, error) {
	return nil, nil
}

// createStubRepo 下单用例所需的仓储桩。
type createStubRepo struct {
	OrderRepository
	order                *domain.Order
	markPaymentFailedErr error
	setTradeInfoErr      error
	setOrderStatusErr    error
	paymentFailedCalls   int
}

func (r *createStubRepo) CreatePendingOrder(o *domain.Order) error {
	o.ID = 1
	r.order = o
	return nil
}
func (r *createStubRepo) AddLog(int64, string, string, domain.Status, domain.Status, int64) error {
	return nil
}
func (r *createStubRepo) SetTradeInfo(int64, string, string) error { return r.setTradeInfoErr }
func (r *createStubRepo) SetOrderStatus(int64, domain.Status) error {
	if r.setOrderStatusErr != nil {
		return r.setOrderStatusErr
	}
	if r.order != nil {
		r.order.Status = domain.OrderWaitingPayment
	}
	return nil
}
func (r *createStubRepo) MarkPaymentFailed(int64) error {
	r.paymentFailedCalls++
	return r.markPaymentFailedErr
}
func (r *createStubRepo) GetOrderByNo(no string) (domain.Order, error) {
	if r.order != nil && r.order.OrderNo == no {
		return *r.order, nil
	}
	return domain.Order{}, errors.New("not found")
}

type stubGateway struct{}

func (g *stubGateway) CreateTransaction(in CreateInput) (string, string, error) {
	return "https://pay.test/checkout", "TRADE-1", nil
}
func (g *stubGateway) CancelTransaction(string) error { return nil }
func (g *stubGateway) VerifyCallback([]byte) (PaymentCallback, error) {
	return PaymentCallback{}, nil
}

type failingGateway struct{}

func (g *failingGateway) CreateTransaction(CreateInput) (string, string, error) {
	return "", "", errors.New("gateway unavailable")
}
func (g *failingGateway) CancelTransaction(string) error { return nil }
func (g *failingGateway) VerifyCallback([]byte) (PaymentCallback, error) {
	return PaymentCallback{}, nil
}

type trackingGateway struct {
	cancelCalls int
}

func (g *trackingGateway) CreateTransaction(CreateInput) (string, string, error) {
	return "https://pay.test/checkout", "TRADE-TRACKED", nil
}
func (g *trackingGateway) CancelTransaction(string) error {
	g.cancelCalls++
	return nil
}
func (g *trackingGateway) VerifyCallback([]byte) (PaymentCallback, error) {
	return PaymentCallback{}, nil
}

// TestCreateUseCaseProductNotFound 商品不存在返回业务错误。
func TestCreateUseCaseProductNotFound(t *testing.T) {
	svc := &OrderService{productReader: &stubProductReader{err: errors.New("missing")}}
	_, err := svc.Create(CreateCommand{ProductID: 1, Qty: 1, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"})
	var biz *BusinessError
	if !errors.As(err, &biz) {
		t.Fatalf("expected BusinessError, got %v", err)
	}
}

// TestCreateUseCaseStockInsufficient 自动发货库存不足返回业务错误。
func TestCreateUseCaseStockInsufficient(t *testing.T) {
	svc := &OrderService{
		productReader: &stubProductReader{view: productdomain.ProductView{
			Product: productdomain.Product{ID: 1, PriceCents: 1000, MinQty: 1, MaxQty: 10, DeliveryType: productdomain.DeliveryTypeAuto},
		}},
		inventory: &stubInventory{available: 0},
	}
	_, err := svc.Create(CreateCommand{ProductID: 1, Qty: 5, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"})
	var biz *BusinessError
	if !errors.As(err, &biz) {
		t.Fatalf("expected BusinessError, got %v", err)
	}
}

// TestCreateUseCaseManualSkipsStock 人工交付商品跳过库存校验并正常下单。
func TestCreateUseCaseManualSkipsStock(t *testing.T) {
	repo := &createStubRepo{}
	svc := &OrderService{
		productReader: &stubProductReader{view: productdomain.ProductView{
			Product: productdomain.Product{ID: 1, PriceCents: 1000, MinQty: 1, MaxQty: 100, DeliveryType: productdomain.DeliveryTypeManual},
		}},
		inventory: &stubInventory{available: 0},
		repo:      repo,
	}
	svc.payFn = func(gateway string) PaymentGateway { return &stubGateway{} }
	res, err := svc.Create(CreateCommand{ProductID: 1, Qty: 50, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"})
	if err != nil {
		t.Fatalf("manual create: %v", err)
	}
	if res.OrderNo == "" {
		t.Fatal("order_no missing")
	}
}

// TestCreateUseCaseAutoChecksStock 自动发货按库存端口校验数量。
func TestCreateUseCaseAutoChecksStock(t *testing.T) {
	repo := &createStubRepo{}
	svc := &OrderService{
		productReader: &stubProductReader{view: productdomain.ProductView{
			Product: productdomain.Product{ID: 1, PriceCents: 1000, MinQty: 1, MaxQty: 10, DeliveryType: productdomain.DeliveryTypeAuto},
		}},
		inventory: &stubInventory{available: 3},
		repo:      repo,
	}
	svc.payFn = func(gateway string) PaymentGateway { return &stubGateway{} }
	if _, err := svc.Create(CreateCommand{ProductID: 1, Qty: 5, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"}); err == nil {
		t.Fatal("qty > available should fail")
	}
	if _, err := svc.Create(CreateCommand{ProductID: 1, Qty: 2, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"}); err != nil {
		t.Fatalf("qty <= available should pass: %v", err)
	}
}

// TestCreatePaymentFailurePropagatesCleanupError 支付创建失败时，释放锁定库存失败不能被静默吞掉。
func TestCreatePaymentFailurePropagatesCleanupError(t *testing.T) {
	repo := &createStubRepo{markPaymentFailedErr: errors.New("cleanup failed")}
	svc := &OrderService{
		productReader: &stubProductReader{view: productdomain.ProductView{
			Product: productdomain.Product{ID: 1, PriceCents: 1000, MinQty: 1, MaxQty: 10, DeliveryType: productdomain.DeliveryTypeManual},
		}},
		inventory: &stubInventory{available: 1},
		repo:      repo,
	}
	svc.payFn = func(string) PaymentGateway { return &failingGateway{} }
	_, err := svc.Create(CreateCommand{ProductID: 1, Qty: 1, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"})
	if err == nil || !strings.Contains(err.Error(), "cleanup failed") {
		t.Fatalf("error = %v, want cleanup failure", err)
	}
	if repo.paymentFailedCalls != 1 {
		t.Fatalf("MarkPaymentFailed calls = %d, want 1", repo.paymentFailedCalls)
	}
}

func TestCreatePersistenceFailureCancelsRemoteTrade(t *testing.T) {
	repo := &createStubRepo{setTradeInfoErr: errors.New("save trade failed")}
	gw := &trackingGateway{}
	svc := &OrderService{
		productReader: &stubProductReader{view: productdomain.ProductView{
			Product: productdomain.Product{ID: 1, PriceCents: 1000, MinQty: 1, MaxQty: 10, DeliveryType: productdomain.DeliveryTypeManual},
		}},
		inventory: &stubInventory{available: 1},
		repo:      repo,
		payFn:     func(string) PaymentGateway { return gw },
	}
	_, err := svc.Create(CreateCommand{ProductID: 1, Qty: 1, Contact: "a@b.com", TradeType: "usdt.trc20", Gateway: "bepusdt"})
	if err == nil || !strings.Contains(err.Error(), "save trade failed") {
		t.Fatalf("error = %v, want persistence failure", err)
	}
	if gw.cancelCalls != 1 {
		t.Fatalf("remote cancel calls = %d, want 1", gw.cancelCalls)
	}
}
