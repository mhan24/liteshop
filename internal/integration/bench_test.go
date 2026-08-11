package integration

import (
	"fmt"
	"testing"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/payment"
	"shop/internal/service"
	"shop/internal/testutil"
)

func benchService(b *testing.B, cards int) (*service.OrderService, *testutil.MockGateway, int64) {
	b.Helper()
	d := testutil.NewTestDB(b)
	orderRepo := repository.NewOrderRepository(d)
	keyRepo := repository.NewKeyRepository(d)
	gw := testutil.NewMockGateway()
	svc := service.NewOrderService(orderRepo, func(string) payment.Gateway { return gw }, func() service.PaymentConfig {
		return service.PaymentConfig{PublicBaseURL: "https://shop.test", NotifyURL: "https://shop.test/notify", TimeoutSec: 1200, Fiat: "CNY", TradeTypes: []string{"usdt.trc20"}}
	})
	svc.SetKeyRepository(keyRepo)
	pid := testutil.SeedProductWithCards(b, d, cards)
	return svc, gw, pid
}

// BenchmarkCreateOrder 下单链路：建单 + 锁卡 + 创建交易。
func BenchmarkCreateOrder(b *testing.B) {
	svc, _, pid := benchService(b, 100000)
	p := testProduct(pid)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, _, _, err := svc.CreateOrder(p, 1, "bench@test.com", "usdt.trc20", "bepusdt", ""); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkPaymentCallback 支付回调链路：确认支付 + 发卡（每次独立交易号）。
func BenchmarkPaymentCallback(b *testing.B) {
	svc, gw, pid := benchService(b, 100000)
	p := testProduct(pid)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		gw.TradeID = fmt.Sprintf("TRADE-%d", i)
		orderNo, _, _, _, err := svc.CreateOrder(p, 1, "bench@test.com", "usdt.trc20", "bepusdt", "")
		if err != nil {
			b.Fatal(err)
		}
		if _, _, _, err := svc.MarkPaidAndDeliver(orderNo, "bepusdt", gw.TradeID, "block"); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkRepositoryQuery 订单查询（GetOrderByNo）。
func BenchmarkRepositoryQuery(b *testing.B) {
	d := testutil.NewTestDB(b)
	repo := repository.NewOrderRepository(d)
	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, created_at, updated_at)
		VALUES('bench','',100,'active',1,10,'[]',?,?)`, now, now)
	if err != nil {
		b.Fatal(err)
	}
	pid, _ := res.LastInsertId()
	for i := 1; i <= 1000; i++ {
		no := fmt.Sprintf("BENCH-%04d", i)
		if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, view_token, status, payment_status, trade_id, created_at, updated_at)
			VALUES(?, ?, 'bench', 1, 100, 0, 'order_time', 'CNY', 'usdt.trc20', 'bench@test.com', 'tok', 'paid', 'confirmed', 'T1', ?, ?)`, no, pid, now, now); err != nil {
			b.Fatal(err)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := repo.GetOrderByNo("BENCH-0500"); err != nil {
			b.Fatal(err)
		}
	}
}
