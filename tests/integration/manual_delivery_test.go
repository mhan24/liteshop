package integration

import (
	"database/sql"
	couponsqlite "shop/internal/modules/coupon/repository/sqlite"
	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	orderapp "shop/internal/modules/order/application"
	orderdomain "shop/internal/modules/order/domain"
	productapp "shop/internal/modules/product/application"
	productdomain "shop/internal/modules/product/domain"
	productsqlite "shop/internal/modules/product/repository/sqlite"
	settingsdomain "shop/internal/modules/settings/domain"
	fixtures "shop/tests/fixtures"
	"strings"
	"testing"
	"time"

	"shop/internal/models"
)

// manualOrderEnv 组装人工手动交付商品 + 完整订单服务（真实 SQLite + mock 网关）。
func manualOrderEnv(t *testing.T) (*orderapp.OrderService, *fixtures.MockGateway, *fixtures.NotifyRecorder, *sql.DB, int64) {
	t.Helper()
	d := fixtures.NewTestDB(t)
	orderRepo := fixtures.NewOrderRepository(d)
	gw := fixtures.NewMockGateway()
	rec := &fixtures.NotifyRecorder{}
	svc := orderapp.NewOrderService(orderRepo, func(string) orderapp.PaymentGateway { return gw }, func() settingsdomain.PaymentConfig {
		return settingsdomain.PaymentConfig{
			PublicBaseURL: "https://shop.test",
			NotifyURL:     "https://shop.test/notify",
			TimeoutSec:    1200,
			Fiat:          "CNY",
			TradeTypes:    []string{"usdt.trc20"},
		}
	})
	rec.Wire(svc)
	svc.SetInventory(inventorysqlite.NewInventoryRepository(d))
	svc.SetCouponStore(couponsqlite.NewCouponRepository(d))
	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('人工交付商品','',1000,'active',1,10,'[]','manual',?,?)`, now, now)
	if err != nil {
		t.Fatalf("insert manual product: %v", err)
	}
	pid, _ := res.LastInsertId()
	return svc, gw, rec, d, pid
}

func manualProduct(pid int64) productdomain.Product {
	return productdomain.Product{ID: pid, Name: "人工交付商品", PriceCents: 1000, MinQty: 1, MaxQty: 10, Status: "active", DeliveryType: productdomain.DeliveryTypeManual}
}

// TestManualDeliveryFlow 人工手动交付完整流程：下单不锁卡 → 支付成功待发货 → 管理员发货。
func TestManualDeliveryFlow(t *testing.T) {
	svc, gw, rec, _, pid := manualOrderEnv(t)

	orderNo, paymentURL, _, _, err := svc.CreateOrder(manualProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if paymentURL == "" {
		t.Fatal("payment url empty")
	}
	o, err := svc.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != orderdomain.OrderWaitingPayment {
		t.Fatalf("order status = %s, want waiting_payment", o.Status)
	}
	// 人工交付订单不锁卡密（该商品无卡密也不影响下单）
	cards, _ := svc.GetOrderCards(o.ID)
	if len(cards) != 0 {
		t.Fatalf("manual order should have no cards, got %d", len(cards))
	}

	// 支付回调 → 待发货
	o2, cards2, changed, err := svc.MarkPaidAndDeliver(orderNo, "bepusdt", gw.TradeID, "block-1")
	if err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if !changed {
		t.Fatal("payment callback should change order")
	}
	if o2.Status != orderdomain.OrderPendingDelivery {
		t.Fatalf("order status = %s, want pending_delivery", o2.Status)
	}
	if len(cards2) != 0 {
		t.Fatalf("manual order should have no delivered cards, got %d", len(cards2))
	}

	// 空内容发货 → 报错
	if err := svc.ManualDeliver(o2.ID, "  "); err == nil {
		t.Fatal("empty delivery content should fail")
	}

	// 人工发货
	content := "人工发货内容：\n请凭订单号联系客服领取"
	if err := svc.ManualDeliver(o2.ID, content); err != nil {
		t.Fatalf("manual deliver: %v", err)
	}
	o3, err := svc.GetOrderByID(o2.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o3.Status != orderdomain.OrderDelivered {
		t.Fatalf("order status = %s, want delivered", o3.Status)
	}
	if strings.TrimSpace(o3.DeliveryContent) != content {
		t.Fatalf("delivery content = %q, want %q", o3.DeliveryContent, content)
	}
	// 买家通知已触发（SendPaid 收到带发货内容的订单；异步发送，轮询等待）
	fixtures.WaitFor(t, 2*time.Second, func() bool { return rec.PaidCount() > 0 }, "SendPaid should be triggered on manual deliver")
	last := rec.Paid[len(rec.Paid)-1]
	if last.DeliveryContent != content {
		t.Fatalf("SendPaid order delivery_content = %q", last.DeliveryContent)
	}
	// 管理员侧 delivered 事件已发布（异步发布，轮询等待）
	deadline := time.Now().Add(2 * time.Second)
	for rec.DeliveredCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if rec.DeliveredCount() == 0 {
		t.Fatal("delivered event should be published")
	}

	// 已发货订单不允许再次发货
	if err := svc.ManualDeliver(o2.ID, "again"); err == nil {
		t.Fatal("delivering a delivered order should fail")
	}
}

// TestManualDeliveryFreeOrder 人工交付 + 100% 折扣券：零金额订单直接进入待发货。
func TestManualDeliveryFreeOrder(t *testing.T) {
	svc, _, _, d, pid := manualOrderEnv(t)
	now := models.Now()
	if _, err := d.Exec(`INSERT INTO coupons(code, type, percent, min_amount_cents, product_id, active, created_at, updated_at)
		VALUES('FREE100', 'percent', 100, 0, ?, 1, ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("insert coupon: %v", err)
	}
	orderNo, _, _, _, err := svc.CreateOrder(manualProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "free100")
	if err != nil {
		t.Fatalf("create free order: %v", err)
	}
	o, err := svc.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.AmountCents != 0 {
		t.Fatalf("free order amount = %d, want 0", o.AmountCents)
	}
	if o.Status != orderdomain.OrderPendingDelivery {
		t.Fatalf("free manual order status = %s, want pending_delivery", o.Status)
	}
}

// TestManualProductStockUnlimited 人工交付商品库存显示 -1（无库存概念）。
func TestManualProductStockUnlimited(t *testing.T) {
	_, _, _, d, pid := manualOrderEnv(t)
	productSvc := productapp.NewProductService(productsqlite.NewProductRepository(d))
	productSvc.SetInventory(inventorysqlite.NewInventoryRepository(d))
	view, err := productSvc.GetView(pid)
	if err != nil {
		t.Fatalf("get view: %v", err)
	}
	if view.Available != -1 {
		t.Fatalf("manual product GetByID available = %d, want -1", view.Available)
	}
}
