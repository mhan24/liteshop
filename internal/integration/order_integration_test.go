package integration

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"shop/internal/db/repository"
	"shop/internal/events"
	"shop/internal/jobs"
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
	svc := service.NewOrderService(orderRepo, func(string) payment.Gateway { return gw }, func() service.PaymentConfig {
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
	svc, keyRepo, gw, rec, d, pid := newOrderService(t)

	orderNo, paymentURL, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
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
	_, cards, changed, err := svc.MarkPaidAndDeliver(orderNo, "bepusdt", gw.TradeID, "block-1")
	if err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if !changed || len(cards) != 1 {
		t.Fatalf("deliver result: changed=%v cards=%d", changed, len(cards))
	}
	// Outbox：支付成功/发货事件已与状态同事务写入，待发布 2 条。
	pending, err := repository.FetchOutboxEvents(d, 10)
	if err != nil {
		t.Fatalf("fetch outbox: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("pending outbox = %d, want 2 (paid + delivered)", len(pending))
	}
	// 模拟 outbox worker 发布事件。
	if err := jobs.OutboxPublishJob(d, events.Func(rec.Publish))(); err != nil {
		t.Fatalf("outbox publish: %v", err)
	}
	o2, err := svc.GetOrderByNo(orderNo)
	if err != nil || o2.Status != models.OrderDelivered {
		t.Fatalf("order status = %v (%v), want delivered", o2.Status, err)
	}
	if o2.PaymentStatus != models.PaymentConfirmed {
		t.Fatalf("payment status = %q, want confirmed", o2.PaymentStatus)
	}
	testutil.WaitFor(t, 2*time.Second, func() bool { return rec.PaidCount() == 1 }, "send paid notify")
	if rec.PaymentSuccessCount() != 1 || rec.DeliveredCount() != 1 {
		t.Fatalf("event notifies: success=%d delivered=%d", rec.PaymentSuccessCount(), rec.DeliveredCount())
	}
	pending, _ = repository.FetchOutboxEvents(d, 10)
	if len(pending) != 0 {
		t.Fatalf("pending outbox after publish = %d, want 0", len(pending))
	}
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 2 {
		t.Fatalf("available after sale = %d, want 2", avail)
	}
	if gw.CancelCount() != 0 {
		t.Fatalf("gateway should not be cancelled on success, got %d", gw.CancelCount())
	}

	// 重复回调：幂等，不重复发卡/通知
	_, cards2, changed2, err2 := svc.MarkPaidAndDeliver(orderNo, "bepusdt", gw.TradeID, "block-1")
	if err2 != nil || changed2 || len(cards2) != 1 {
		t.Fatalf("duplicate callback: err=%v changed=%v cards=%d", err2, changed2, len(cards2))
	}
	time.Sleep(100 * time.Millisecond)
	if rec.PaidCount() != 1 {
		t.Fatalf("duplicate callback sent notification again: %d", rec.PaidCount())
	}
	o3, _ := svc.GetOrderByNo(orderNo)
	if o3.PaymentStatus != models.PaymentConfirmed {
		t.Fatalf("payment status after duplicate = %q, want confirmed", o3.PaymentStatus)
	}
	// 重复回调后再次运行 outbox：无新增事件、通知不重复。
	_ = jobs.OutboxPublishJob(d, events.Func(rec.Publish))()
	time.Sleep(50 * time.Millisecond)
	if rec.PaidCount() != 1 {
		t.Fatalf("duplicate callback re-published events: paid=%d", rec.PaidCount())
	}
	// 幂等台账：同一网关交易号只登记一次
	var processed int
	_ = d.QueryRow(`SELECT COUNT(1) FROM processed_events WHERE event_key = ?`, "bepusdt:"+gw.TradeID).Scan(&processed)
	if processed != 1 {
		t.Fatalf("processed_events count = %d, want 1", processed)
	}
	avail, _ = keyRepo.AvailableCount(pid)
	if avail != 2 {
		t.Fatalf("available after duplicate = %d, want 2", avail)
	}
}

// TestCancelOrderReleasesCards 取消订单：释放卡密 + 同步关闭网关交易。
func TestCancelOrderReleasesCards(t *testing.T) {
	svc, keyRepo, gw, _, _, pid := newOrderService(t)

	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
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
	if o.PaymentStatus != models.PaymentCancelled {
		t.Fatalf("payment status = %q, want cancelled", o.PaymentStatus)
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

	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
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
	if o.PaymentStatus != models.PaymentCancelled {
		t.Fatalf("payment status = %q, want cancelled", o.PaymentStatus)
	}
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 3 {
		t.Fatalf("available after expire = %d, want 3 (all released)", avail)
	}
}

// TestPaymentCreateFailureReleasesCards 建单失败（网关错误）原子释放卡密，不泄漏库存。
func TestPaymentCreateFailureReleasesCards(t *testing.T) {
	svc, keyRepo, gw, _, _, pid := newOrderService(t)
	gw.CreateErr = errors.New("gateway down")

	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
	if err == nil {
		t.Fatal("create order should fail when gateway errors")
	}
	if orderNo == "" {
		t.Fatal("order number should still exist for audit trail")
	}
	o, err := svc.GetOrderByNo(orderNo)
	if err != nil || o.Status != models.OrderPaymentFailed {
		t.Fatalf("order status = %v (%v), want payment_failed", o.Status, err)
	}
	if o.PaymentStatus != models.PaymentFailed {
		t.Fatalf("payment status = %q, want failed", o.PaymentStatus)
	}
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 3 {
		t.Fatalf("available after failed create = %d, want 3 (locked cards must be released)", avail)
	}
}

// TestCallbackAfterCancelNoEffect 支付回调打在已取消订单上：不产生任何变更（事务条件更新拦截）。
func TestCallbackAfterCancelNoEffect(t *testing.T) {
	svc, keyRepo, gw, _, _, pid := newOrderService(t)

	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	o, _ := svc.GetOrderByNo(orderNo)
	if err := svc.CancelWithGateway(o.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	availAfterCancel, _ := keyRepo.AvailableCount(pid)

	_, cards, changed, err := svc.MarkPaidAndDeliver(orderNo, "bepusdt", gw.TradeID, "block-late")
	if err != nil {
		t.Fatalf("late callback: %v", err)
	}
	if changed || len(cards) != 0 {
		t.Fatalf("late callback changed=%v cards=%d, want no effect", changed, len(cards))
	}
	o2, _ := svc.GetOrderByNo(orderNo)
	if o2.Status != models.OrderCancelled {
		t.Fatalf("order status = %s, want cancelled", o2.Status)
	}
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != availAfterCancel {
		t.Fatalf("available after late callback = %d, want %d", avail, availAfterCancel)
	}
}

// TestConcurrentLastCardPurchase 并发抢最后一张卡（库存=1，两个买家同时下单）：
// 恰好一个成功，失败方得到库存不足业务错误，库存不超卖、卡密不重复锁定。
func TestConcurrentLastCardPurchase(t *testing.T) {
	for iter := 0; iter < 5; iter++ {
		d := testutil.NewTestDB(t)
		orderRepo := repository.NewOrderRepository(d)
		keyRepo := repository.NewKeyRepository(d)
		gw := testutil.NewMockGateway()
		svc := service.NewOrderService(orderRepo, func(string) payment.Gateway { return gw }, func() service.PaymentConfig {
			return service.PaymentConfig{PublicBaseURL: "https://shop.test", NotifyURL: "https://shop.test/notify", TimeoutSec: 1200, Fiat: "CNY", TradeTypes: []string{"usdt.trc20"}}
		})
		pid := testutil.SeedProductWithCards(t, d, 1) // 最后一张
		p := testProduct(pid)

		var wg sync.WaitGroup
		results := make([]error, 2)
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				_, _, _, _, err := svc.CreateOrder(p, 1, fmt.Sprintf("buyer%d@test.com", i), "usdt.trc20", "bepusdt", "")
				results[i] = err
			}(i)
		}
		wg.Wait()

		success := 0
		var loserErr error
		for _, err := range results {
			if err == nil {
				success++
			} else {
				loserErr = err
			}
		}
		if success != 1 {
			t.Fatalf("iter %d: success=%d, want exactly 1 (results=%v)", iter, success, results)
		}
		var biz *service.BusinessError
		if !errors.As(loserErr, &biz) {
			t.Fatalf("iter %d: loser error = %v, want business error (insufficient stock)", iter, loserErr)
		}
		avail, _ := keyRepo.AvailableCount(pid)
		if avail != 0 {
			t.Fatalf("iter %d: available = %d, want 0", iter, avail)
		}
		var locked int
		_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'locked'`, pid).Scan(&locked)
		if locked != 1 {
			t.Fatalf("iter %d: locked = %d, want exactly 1", iter, locked)
		}
	}
}

// TestConcurrentPressure100 压力测试：100 个 goroutine 同时抢最后 1 张卡，
// 恰好 1 成功、99 个库存不足业务错误，无系统错误/超卖/重复锁定。
func TestConcurrentPressure100(t *testing.T) {
	const users = 100
	for iter := 0; iter < 3; iter++ {
		d := testutil.NewTestDB(t)
		orderRepo := repository.NewOrderRepository(d)
		keyRepo := repository.NewKeyRepository(d)
		gw := testutil.NewMockGateway()
		svc := service.NewOrderService(orderRepo, func(string) payment.Gateway { return gw }, func() service.PaymentConfig {
			return service.PaymentConfig{PublicBaseURL: "https://shop.test", NotifyURL: "https://shop.test/notify", TimeoutSec: 1200, Fiat: "CNY", TradeTypes: []string{"usdt.trc20"}}
		})
		pid := testutil.SeedProductWithCards(t, d, 1)
		p := testProduct(pid)

		var wg sync.WaitGroup
		results := make([]error, users)
		for i := 0; i < users; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				_, _, _, _, err := svc.CreateOrder(p, 1, fmt.Sprintf("u%d@test.com", i), "usdt.trc20", "bepusdt", "")
				results[i] = err
			}(i)
		}
		wg.Wait()

		success := 0
		bizFails := 0
		sysFails := 0
		for _, err := range results {
			if err == nil {
				success++
				continue
			}
			var biz *service.BusinessError
			if errors.As(err, &biz) {
				bizFails++
			} else {
				sysFails++
			}
		}
		if success != 1 || bizFails != users-1 || sysFails != 0 {
			t.Fatalf("iter %d: success=%d biz=%d sys=%d, want 1/%d/0", iter, success, bizFails, sysFails, users-1)
		}
		avail, _ := keyRepo.AvailableCount(pid)
		var locked int
		_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'locked'`, pid).Scan(&locked)
		if avail != 0 || locked != 1 {
			t.Fatalf("iter %d: available=%d locked=%d, want 0/1", iter, avail, locked)
		}
	}
}
