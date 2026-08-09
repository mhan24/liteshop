package integration

import (
	"database/sql"
	"testing"
	"time"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/payment"
	"shop/internal/service"
	"shop/internal/testutil"
)

// newOrderService 组装真实 SQLite + MockGateway + NotifyRecorder 的订单服务。
func newOrderService(t *testing.T) (*service.OrderService, *repository.KeyRepository, *testutil.MockGateway, *testutil.NotifyRecorder, *sql.DB, int64) {
	t.Helper()
	d := testutil.NewTestDB(t)
	orderRepo := repository.NewOrderRepository(d)
	keyRepo := repository.NewKeyRepository(d)
	gw := testutil.NewMockGateway()
	rec := &testutil.NotifyRecorder{}
	svc := service.NewOrderService(orderRepo, func() payment.Gateway { return gw }, func() service.PaymentConfig {
		return service.PaymentConfig{
			PublicBaseURL: "https://shop.test",
			NotifyURL:     "https://shop.test/notify",
			TimeoutSec:    1200,
			Fiat:          "CNY",
			TradeTypes:    []string{"usdt.trc20"},
		}
	})
	rec.Wire(svc)
	svc.SetKeyRepository(keyRepo)
	pid := testutil.SeedProductWithCards(t, d, 3)
	return svc, keyRepo, gw, rec, d, pid
}

func testProduct(pid int64) models.Product {
	return models.Product{ID: pid, Name: "集成测试商品", PriceCents: 1000, MinQty: 1, MaxQty: 10, Status: "active"}
}

// TestPaymentCallbackAndDuplicate 支付回调 + 重复回调幂等。
func TestPaymentCallbackAndDuplicate(t *testing.T) {
	svc, keyRepo, gw, rec, _, pid := newOrderService(t)

	orderNo, paymentURL, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if paymentURL == "" {
		t.Fatal("payment url empty")
	}
	o, err := svc.GetOrderByNo(orderNo)
	if err != nil || o.Status != models.OrderWaitingPayment {
		t.Fatalf("order status = %v (%v), want waiting_payment", o.Status, err)
	}
	// 创建事件通知（异步）
	testutil.WaitFor(t, 2*time.Second, func() bool { return rec.CreatedCount() == 1 }, "order_created notify")

	// 支付回调
	_, cards, changed, err := svc.MarkPaidAndDeliver(orderNo, gw.TradeID, "block-1")
	if err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if !changed || len(cards) != 1 {
		t.Fatalf("deliver result: changed=%v cards=%d", changed, len(cards))
	}
	o2, err := svc.GetOrderByNo(orderNo)
	if err != nil || o2.Status != models.OrderDelivered {
		t.Fatalf("order status = %v (%v), want delivered", o2.Status, err)
	}
	testutil.WaitFor(t, 2*time.Second, func() bool { return rec.PaidCount() == 1 }, "send paid notify")
	if rec.PaymentSuccessCount() != 1 || rec.DeliveredCount() != 1 {
		t.Fatalf("event notifies: success=%d delivered=%d", rec.PaymentSuccessCount(), rec.DeliveredCount())
	}
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 2 {
		t.Fatalf("available after sale = %d, want 2", avail)
	}
	if gw.CancelCount() != 0 {
		t.Fatalf("gateway should not be cancelled on success, got %d", gw.CancelCount())
	}

	// 重复回调：幂等，不重复发卡/通知
	_, cards2, changed2, err2 := svc.MarkPaidAndDeliver(orderNo, gw.TradeID, "block-1")
	if err2 != nil || changed2 || len(cards2) != 1 {
		t.Fatalf("duplicate callback: err=%v changed=%v cards=%d", err2, changed2, len(cards2))
	}
	time.Sleep(100 * time.Millisecond)
	if rec.PaidCount() != 1 {
		t.Fatalf("duplicate callback sent notification again: %d", rec.PaidCount())
	}
	avail, _ = keyRepo.AvailableCount(pid)
	if avail != 2 {
		t.Fatalf("available after duplicate = %d, want 2", avail)
	}
}

// TestCancelOrderReleasesCards 取消订单：释放卡密 + 同步关闭网关交易。
func TestCancelOrderReleasesCards(t *testing.T) {
	svc, keyRepo, gw, _, _, pid := newOrderService(t)

	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	o, _ := svc.GetOrderByNo(orderNo)
	availBefore, _ := keyRepo.AvailableCount(pid)

	if err := svc.CancelWithGateway(o.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	o, err = svc.GetOrderByNo(orderNo)
	if err != nil || o.Status != models.OrderCancelled {
		t.Fatalf("order status = %v (%v), want cancelled", o.Status, err)
	}
	availAfter, _ := keyRepo.AvailableCount(pid)
	if availAfter != availBefore+1 {
		t.Fatalf("available after cancel = %d, want %d", availAfter, availBefore+1)
	}
	testutil.WaitFor(t, 2*time.Second, func() bool { return gw.CancelCount() == 1 }, "gateway cancel call")
}

// TestExpireStaleClosesTimeoutOrders 超时订单：后台任务释放卡密并关闭订单。
func TestExpireStaleClosesTimeoutOrders(t *testing.T) {
	svc, keyRepo, _, _, d, pid := newOrderService(t)

	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	// 把订单创建时间拨回 2 小时前，模拟超时未支付
	if _, err := d.Exec(`UPDATE orders SET created_at = ? WHERE order_no = ?`, models.Now()-7200, orderNo); err != nil {
		t.Fatalf("backdate order: %v", err)
	}
	n, err := svc.ExpireStale(1200)
	if err != nil {
		t.Fatalf("expire stale: %v", err)
	}
	if n != 1 {
		t.Fatalf("expired = %d, want 1", n)
	}
	o, err := svc.GetOrderByNo(orderNo)
	if err != nil || o.Status != models.OrderExpired {
		t.Fatalf("order status = %v (%v), want expired", o.Status, err)
	}
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 3 {
		t.Fatalf("available after expire = %d, want 3 (all released)", avail)
	}
}
