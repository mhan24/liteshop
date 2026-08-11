package integration

import (
	"testing"

	"shop/internal/db/repository"
	"shop/internal/payment"
	"shop/internal/service"
	"shop/internal/testutil"
)

// TestCreateOrderGatewayChoice 双网关并存：订单记录用户选择的网关，
// 法币按网关区分（BEpusdt=CNY / HashPay=USD），回调地址各自独立。
func TestCreateOrderGatewayChoice(t *testing.T) {
	d := testutil.NewTestDB(t)
	orderRepo := repository.NewOrderRepository(d)
	keyRepo := repository.NewKeyRepository(d)
	gw := testutil.NewMockGateway()
	var requested []string
	svc := service.NewOrderService(orderRepo, func(gateway string) payment.Gateway {
		requested = append(requested, gateway)
		return gw
	}, func() service.PaymentConfig {
		return service.PaymentConfig{
			PublicBaseURL:    "https://shop.test",
			BepusdtNotifyURL: "https://shop.test/notify/bepusdt",
			HashPayNotifyURL: "https://shop.test/notify/hashpay",
			TimeoutSec:       1200,
			Fiat:             "CNY",
			HashPayCurrency:  "USD",
			TradeTypes:       []string{"usdt.trc20"},
			EnabledGateways:  []string{"bepusdt", "hashpay"},
			Gateway:          "bepusdt",
		}
	})
	svc.SetKeyRepository(keyRepo)
	pid := testutil.SeedProductWithCards(t, d, 4)

	// 选 BEpusdt：订单 CNY + usdt.trc20，通知走 bepusdt 回调。
	orderNo1, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "a@test.com", "usdt.trc20", "bepusdt", "")
	if err != nil {
		t.Fatalf("create bepusdt order: %v", err)
	}
	// 选 HashPay：订单 USD + 货币作为交易类型，通知走 hashpay 回调。
	orderNo2, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "a@test.com", "", "hashpay", "")
	if err != nil {
		t.Fatalf("create hashpay order: %v", err)
	}
	o1, err := svc.GetOrderByNo(orderNo1)
	if err != nil {
		t.Fatalf("get order1: %v", err)
	}
	if o1.PaymentGateway != "bepusdt" || o1.Fiat != "CNY" || o1.TradeType != "usdt.trc20" {
		t.Fatalf("bepusdt order = %+v", o1)
	}
	o2, err := svc.GetOrderByNo(orderNo2)
	if err != nil {
		t.Fatalf("get order2: %v", err)
	}
	if o2.PaymentGateway != "hashpay" || o2.Fiat != "USD" || o2.TradeType != "USD" {
		t.Fatalf("hashpay order = %+v", o2)
	}
	if len(requested) != 2 || requested[0] != "bepusdt" || requested[1] != "hashpay" {
		t.Fatalf("requested gateways = %v", requested)
	}
	// 网关侧回调：按订单网关取消交易（HashPay 为 no-op）。
	if err := svc.CancelWithGateway(o1.ID); err != nil {
		t.Fatalf("cancel bepusdt order: %v", err)
	}
	if err := svc.CancelWithGateway(o2.ID); err != nil {
		t.Fatalf("cancel hashpay order: %v", err)
	}
}
