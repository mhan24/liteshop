package integration

import (
	"errors"
	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	orderapp "shop/internal/modules/order/application"
	settingsdomain "shop/internal/modules/settings/domain"
	fixtures "shop/tests/fixtures"
	"strings"
	"testing"
	"time"
)

// TestHashPayCancelRaceAlert HashPay 无商户取消接口：取消/过期时若查询到订单已支付
// （取消与付款竞态），必须记录订单日志并触发系统异常告警。
func TestHashPayCancelRaceAlert(t *testing.T) {
	d := fixtures.NewTestDB(t)
	orderRepo := fixtures.NewOrderRepository(d)
	keyRepo := inventorysqlite.NewKeyRepository(d)
	gw := fixtures.NewMockGateway()
	gw.CancelErr = orderapp.ErrHashPayAlreadyPaid
	alerts := make(chan string, 4)
	svc := orderapp.NewOrderService(orderRepo, func(string) orderapp.PaymentGateway { return gw }, func() settingsdomain.PaymentConfig {
		return settingsdomain.PaymentConfig{
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
	svc.SetInventory(inventorysqlite.NewInventoryRepository(d))
	svc.SystemError = func(msg string) { alerts <- msg }
	pid := fixtures.SeedProductWithCards(t, d, 2)
	orderNo, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "a@test.com", "", "hashpay", "")
	if err != nil {
		t.Fatalf("create hashpay order: %v", err)
	}
	o, err := svc.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if err := svc.CancelWithGateway(o.ID); !errors.Is(err, orderapp.ErrHashPayAlreadyPaid) {
		t.Fatalf("cancel order error = %v, want ErrHashPayAlreadyPaid", err)
	}
	select {
	case msg := <-alerts:
		if !strings.Contains(msg, "已支付") || !strings.Contains(msg, o.OrderNo) {
			t.Fatalf("alert message = %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("SystemError not triggered for cancel/pay race")
	}
	// 订单日志记录竞态。
	logs, err := svc.Logs(o.ID)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	found := false
	for _, e := range logs {
		if e.Event == "gateway_cancel_race" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("gateway_cancel_race log missing")
	}
	// 本地订单不能在网关确认已支付时取消，库存仍被订单锁定。
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 1 {
		t.Fatalf("available = %d, want 1", avail)
	}
}
