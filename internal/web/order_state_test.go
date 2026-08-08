package web

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"shop/internal/bepusdt"
	"shop/internal/db"
	"shop/internal/models"
	"shop/internal/order"
)

// TestOrderStateMachineFlow 用临时 DB 验证完整状态机流程。
func TestOrderStateMachineFlow(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()

	now := models.Now()
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, created_at, updated_at) VALUES('test', '', 100, 'active', ?, ?)`, now, now); err != nil {
		t.Fatalf("insert product: %v", err)
	}
	var productID int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&productID)
	for i := 0; i < 3; i++ {
		if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, ?, 'available', ?, ?)`, productID, "CARD-"+string(rune('0'+i)), now, now); err != nil {
			t.Fatalf("insert card: %v", err)
		}
	}

	repo := order.NewRepository(d)

	orderRec := models.Order{
		OrderNo:      models.NewOrderNo(),
		ProductID:    productID,
		ProductName:  "test",
		Qty:          2,
		AmountCents:  200,
		Fiat:         "CNY",
		TradeType:    "usdt-trc20",
		BuyerContact: "a@b.com",
		Status:       models.OrderCreated,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := repo.CreatePendingOrder(&orderRec); err != nil {
		t.Fatalf("create order: %v", err)
	}
	if err := repo.AddLog(orderRec.ID, "order_created", "订单已创建", "", models.OrderCreated, 0); err != nil {
		t.Fatalf("log create: %v", err)
	}
	if err := repo.SetOrderStatusFrom(orderRec.ID, models.OrderCreated, models.OrderWaitingPayment); err != nil {
		t.Fatalf("transition to waiting: %v", err)
	}
	_ = repo.AddLog(orderRec.ID, "transaction_created", "BEpusdt 交易已创建", models.OrderCreated, models.OrderWaitingPayment, 0)

	o, err := repo.GetOrderByID(orderRec.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != models.OrderWaitingPayment {
		t.Fatalf("status = %s, want %s", o.Status, models.OrderWaitingPayment)
	}

	// 模拟支付回调 + 发卡（绕过真实支付 client）
	if err := repo.MarkPaid(o.ID, "T1", "B1", models.Now()); err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if err := repo.DeliverCards(o.ID); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	_ = repo.SetOrderStatus(o.ID, models.OrderDelivered)
	_ = repo.AddLog(o.ID, "payment_success", "支付成功", models.OrderWaitingPayment, models.OrderPaid, 0)
	_ = repo.AddLog(o.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)

	cards, _ := repo.GetOrderCards(o.ID)
	if len(cards) != 2 {
		t.Fatalf("delivered %d cards, want 2", len(cards))
	}

	// 验证卡密状态
	var soldCount int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE sold_order = ? AND status = 'sold'`, orderRec.ID).Scan(&soldCount)
	if soldCount != 2 {
		t.Fatalf("sold cards = %d, want 2", soldCount)
	}

	// 验证日志
	logs, _ := repo.Logs(orderRec.ID)
	events := map[string]bool{}
	for _, l := range logs {
		events[l.Event] = true
	}
	for _, want := range []string{"order_created", "transaction_created", "payment_success", "delivered"} {
		if !events[want] {
			t.Errorf("missing log event %s (got %v)", want, events)
		}
	}

	// 状态应已 delivered
	o2, _ := repo.GetOrderByID(orderRec.ID)
	if o2.Status != models.OrderDelivered {
		t.Fatalf("final status = %s, want delivered", o2.Status)
	}
}

// TestOrderCancelFreesCards 验证取消订单释放卡密并记录日志。
func TestOrderCancelFreesCards(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	now := models.Now()
	_, _ = d.Exec(`INSERT INTO products(name, description, price_cents, status, created_at, updated_at) VALUES('t','',100,'active',?,?)`, now, now)
	var productID int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&productID)
	_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,'C1','available',?,?)`, productID, now, now)

	repo := order.NewRepository(d)
	svc := order.NewService(repo, func() *bepusdt.Client { return nil }, nil)

	orderRec := models.Order{OrderNo: models.NewOrderNo(), ProductID: productID, ProductName: "t", Qty: 1, AmountCents: 100, Fiat: "CNY", TradeType: "usdt-trc20", BuyerContact: "a@b.com", Status: models.OrderCreated, CreatedAt: now, UpdatedAt: now}
	if err := repo.CreatePendingOrder(&orderRec); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.Cancel(orderRec.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	o, _ := repo.GetOrderByID(orderRec.ID)
	if o.Status != models.OrderCancelled {
		t.Fatalf("status = %s", o.Status)
	}
	var avail int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='available' AND reserved_order=0`).Scan(&avail)
	if avail != 1 {
		t.Fatalf("cards freed = %d, want 1", avail)
	}
	logs, _ := repo.Logs(orderRec.ID)
	if len(logs) == 0 {
		t.Fatalf("no cancel log")
	}
}

// TestFreeOrderWith100PercentCoupon 验证 100% 折扣券订单跳过支付、直接完成并发卡。
func TestFreeOrderWith100PercentCoupon(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	now := models.Now()
	_, _ = d.Exec(`INSERT INTO products(name, description, price_cents, status, created_at, updated_at) VALUES('t','',100,'active',?,?)`, now, now)
	var productID int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&productID)
	_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,'C1','available',?,?)`, productID, now, now)

	repo := order.NewRepository(d)
	svc := order.NewService(repo, func() *bepusdt.Client {
		t.Fatal("payFn must not be called for a free order")
		return nil
	}, nil)
	if err := repo.CreateCoupon(models.Coupon{Code: "FREE100", Type: "percent", Percent: 100, Active: true}); err != nil {
		t.Fatalf("create coupon: %v", err)
	}
	p := models.Product{ID: productID, Name: "t", PriceCents: 100, MinQty: 1, MaxQty: 10, Status: "active"}
	orderNo, paymentURL, _, _, err := svc.CreateOrder(p, 1, "a@b.com", "usdt.trc20", "FREE100")
	if err != nil {
		t.Fatalf("create free order: %v", err)
	}
	if paymentURL != "" {
		t.Fatalf("free order should not have a payment url")
	}
	o, err := repo.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != models.OrderDelivered {
		t.Fatalf("status = %s, want delivered", o.Status)
	}
	var sold int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='sold' AND sold_order=?`, o.ID).Scan(&sold)
	if sold != 1 {
		t.Fatalf("sold = %d, want 1", sold)
	}
	var used int
	_ = d.QueryRow(`SELECT used_count FROM coupons WHERE code='FREE100'`).Scan(&used)
	if used != 1 {
		t.Fatalf("coupon used_count = %d, want 1", used)
	}
}

// TestRedeliverFromStock 验证补发卡密：从库存补扣、幂等释放旧锁定，
// 并正确将新卡密标记为售出（不触发 UPDATE...LIMIT 语法错误）。
func TestRedeliverFromStock(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	now := models.Now()
	_, _ = d.Exec(`INSERT INTO products(name, description, price_cents, status, created_at, updated_at) VALUES('t','',100,'active',?,?)`, now, now)
	var productID int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&productID)
	// 3 张可用卡密
	for i := 0; i < 3; i++ {
		_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,?, 'available', ?, ?)`, productID, "C"+string(rune('0'+i)), now, now)
	}

	repo := order.NewRepository(d)
	svc := order.NewService(repo, func() *bepusdt.Client { return nil }, nil)

	// 创建订单占用 1 张（模拟：直接建订单 + 锁定一张）
	orderRec := models.Order{OrderNo: models.NewOrderNo(), ProductID: productID, ProductName: "t", Qty: 1, AmountCents: 100, Fiat: "CNY", TradeType: "usdt-trc20", BuyerContact: "a@b.com", Status: models.OrderCreated, CreatedAt: now, UpdatedAt: now}
	if err := repo.CreatePendingOrder(&orderRec); err != nil {
		t.Fatalf("create: %v", err)
	}
	// 模拟支付后发卡失败：订单 delivery_failed 且无已售卡密（释放占用）
	_ = repo.ReleaseLockedCards(orderRec.ID)
	_ = repo.SetOrderStatus(orderRec.ID, models.OrderDeliveryFailed)

	// 执行补发：应从剩余 2 张可用中锁定 1 张
	if err := svc.Redeliver(orderRec.ID); err != nil {
		t.Fatalf("redeliver: %v", err)
	}
	// 验证订单已 delivered
	o, _ := repo.GetOrderByID(orderRec.ID)
	if o.Status != models.OrderDelivered {
		t.Fatalf("status = %s, want delivered", o.Status)
	}
	// 验证恰好 1 张 sold 绑定到该订单
	var sold int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE sold_order = ? AND status = 'sold'`, orderRec.ID).Scan(&sold)
	if sold != 1 {
		t.Fatalf("sold = %d, want 1", sold)
	}
	// 剩余可用 = 2
	var avail int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='available'`).Scan(&avail)
	if avail != 2 {
		t.Fatalf("available = %d, want 2", avail)
	}
}

// TestRedeliverIdempotent 验证重复补发不超扣库存（幂等释放旧锁定）。
func TestRedeliverIdempotent(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	now := models.Now()
	_, _ = d.Exec(`INSERT INTO products(name, description, price_cents, status, created_at, updated_at) VALUES('t','',100,'active',?,?)`, now, now)
	var productID int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&productID)
	for i := 0; i < 3; i++ {
		_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,?, 'available', ?, ?)`, productID, "C"+string(rune('0'+i)), now, now)
	}
	repo := order.NewRepository(d)
	svc := order.NewService(repo, func() *bepusdt.Client { return nil }, nil)
	orderRec := models.Order{OrderNo: models.NewOrderNo(), ProductID: productID, ProductName: "t", Qty: 1, AmountCents: 100, Fiat: "CNY", TradeType: "usdt-trc20", BuyerContact: "a@b.com", Status: models.OrderCreated, CreatedAt: now, UpdatedAt: now}
	if err := repo.CreatePendingOrder(&orderRec); err != nil {
		t.Fatalf("create: %v", err)
	}
	// 合法前置状态：支付后发卡失败（与 TestRedeliverFromStock 一致）
	_ = repo.ReleaseLockedCards(orderRec.ID)
	_ = repo.SetOrderStatus(orderRec.ID, models.OrderDeliveryFailed)
	// 连续补发两次：第二次应在已 delivered 且卡密已售时无副作用
	if err := svc.Redeliver(orderRec.ID); err != nil {
		t.Fatalf("redeliver 1: %v", err)
	}
	if err := svc.Redeliver(orderRec.ID); err != nil {
		t.Fatalf("redeliver 2: %v", err)
	}
	var sold int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE sold_order = ? AND status = 'sold'`, orderRec.ID).Scan(&sold)
	if sold != 1 {
		t.Fatalf("sold = %d, want 1 (no over-consume)", sold)
	}
	var avail int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='available'`).Scan(&avail)
	if avail != 2 {
		t.Fatalf("available = %d, want 2", avail)
	}
}

// TestOrderCountsWithTimezone 验证非北京时区自然日统计。
func TestOrderCountsWithTimezone(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	// 用 UTC 时区仓库
	repo := order.NewRepositoryWithTZ(d, time.UTC)
	// 插入一笔"今天"的订单（UTC 当天）
	now := time.Now().In(time.UTC)
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, created_at, updated_at) VALUES('t','',100,'active',?,?)`, now.Unix(), now.Unix()); err != nil {
		t.Fatalf("product: %v", err)
	}
	var pid int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&pid)
	if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, created_at, updated_at, paid_at) VALUES(?,?,?,?,?,?,?,?,'paid',?,?,?)`, models.NewOrderNo(), pid, "t", 1, 100, "CNY", "usdt-trc20", "a@b.com", now.Unix(), now.Unix(), now.Unix()); err != nil {
		t.Fatalf("order: %v", err)
	}
	today, sales, _, _, _, _, err := repo.OrderCounts()
	if err != nil {
		t.Fatalf("counts: %v", err)
	}
	if today != 1 || sales != 1 {
		t.Fatalf("today=%d sales=%d, want 1/1 (UTC natural day)", today, sales)
	}
}

// TestCouponFixedDiscount 验证固定金额优惠券 + 批发价 + 限购。
func TestCouponAndWholesale(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	now := models.Now()
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, created_at, updated_at) VALUES('t','',100,'active',2,10,'[{"min_qty":2,"discount":90}]',?,?)`, now, now); err != nil {
		t.Fatalf("insert product: %v", err)
	}
	var pid int64
	if err := d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&pid); err != nil {
		t.Fatalf("scan pid: %v", err)
	}
	for i := 0; i < 5; i++ {
		_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,?, 'available', ?, ?)`, pid, "C"+string(rune('0'+i)), now, now)
	}
	repo := order.NewRepository(d)
	svc := order.NewService(repo, func() *bepusdt.Client { return &bepusdt.Client{} }, func() order.PaymentConfig { return order.PaymentConfig{} })

	// 固定券：满 1 元减 10 元（用于 1.8 元订单，可抵扣到 0 为止）
	if err := repo.CreateCoupon(models.Coupon{Code: "TEST10", Type: "fixed", ValueCents: 1000, MinAmountCents: 100, MaxUses: 0, ProductID: 0, Active: true}); err != nil {
		t.Fatalf("create coupon: %v", err)
	}
	// 限购：少于 min_qty 应报错
	_, _, _, _, err = svc.CreateOrder(models.Product{ID: pid, Name: "t", PriceCents: 100, MinQty: 2, MaxQty: 10}, 1, "a@b.com", "usdt-trc20", "")
	if err == nil {
		t.Fatalf("qty below min should fail")
	}
	// 批发价：买 2 件单价 9 折 = 100*2*90/100 = 180
	// 固定券满 100 减 1000，抵扣后 180-1000 → 0 元订单直接完成（跳过支付）
	orderNo, _, discount, couponID, err := svc.CreateOrder(models.Product{ID: pid, Name: "t", PriceCents: 100, MinQty: 2, MaxQty: 10, Wholesale: []models.WholesaleTier{{MinQty: 2, Discount: 90}}}, 2, "a@b.com", "usdt-trc20", "TEST10")
	if err != nil {
		t.Fatalf("0-amount order should complete directly: %v", err)
	}
	if orderNo == "" {
		t.Fatalf("orderNo should be non-empty for free order")
	}
	if discount == 0 || couponID == 0 {
		t.Fatalf("discount/couponID should be applied, got %d/%d", discount, couponID)
	}
	// 免费订单应已交付、卡密售出、券用量 +1
	c, _ := repo.GetCouponByCode("TEST10")
	if c.UsedCount != 1 {
		t.Fatalf("coupon used = %d, want 1", c.UsedCount)
	}
	fo, _ := repo.GetOrderByNo(orderNo)
	if fo.Status != models.OrderDelivered {
		t.Fatalf("free order status = %s, want delivered", fo.Status)
	}
	var sold int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='sold' AND sold_order=?`, fo.ID).Scan(&sold)
	if sold != 2 {
		t.Fatalf("free order sold = %d, want 2", sold)
	}

	// 用更小面额券避免 0 元：满 100 减 10 → 180-10=170，然后 payFn nil 支付失败
	if err := repo.CreateCoupon(models.Coupon{Code: "TEST10B", Type: "fixed", ValueCents: 10, MinAmountCents: 100, MaxUses: 0, ProductID: 0, Active: true}); err != nil {
		t.Fatalf("create coupon B: %v", err)
	}
	orderNo2, _, _, couponID2, err := svc.CreateOrder(models.Product{ID: pid, Name: "t", PriceCents: 100, MinQty: 2, MaxQty: 10, Wholesale: []models.WholesaleTier{{MinQty: 2, Discount: 90}}}, 2, "a@b.com", "usdt-trc20", "TEST10B")
	if err == nil {
		t.Fatalf("expected pay failure with nil client")
	}
	if orderNo2 == "" {
		t.Fatalf("orderNo should be set before pay attempt")
	}
	if couponID2 == 0 {
		t.Fatalf("couponID should be set")
	}
	// 支付失败后优惠券用量回滚
	c2, _ := repo.GetCouponByCode("TEST10B")
	if c2.UsedCount != 0 {
		t.Fatalf("coupon used after pay failure = %d, want 0", c2.UsedCount)
	}
}

func TestCouponConcurrentMaxUses(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	repo := order.NewRepository(d)
	if err := repo.CreateCoupon(models.Coupon{Code: "RACE", Type: "fixed", ValueCents: 50, MinAmountCents: 0, MaxUses: 1, ProductID: 0, Active: true}); err != nil {
		t.Fatalf("create coupon: %v", err)
	}
	c, _ := repo.GetCouponByCode("RACE")
	if c.UsedCount != 0 {
		t.Fatalf("coupon used initial = %d, want 0", c.UsedCount)
	}
	var wg sync.WaitGroup
	success := make(chan int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := repo.UseCoupon(c.ID, "ON"+fmt.Sprintf("%d", time.Now().UnixNano()), 50); err == nil {
				success <- 1
			}
		}()
	}
	wg.Wait()
	close(success)
	got := 0
	for range success {
		got++
	}
	c2, _ := repo.GetCouponByCode("RACE")
	if c2.UsedCount != 1 {
		t.Fatalf("coupon used = %d, want 1", c2.UsedCount)
	}
	if got != 1 {
		t.Fatalf("successful uses = %d, want 1", got)
	}
}

func TestOrderCostSnapshot(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	now := models.Now()
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, cost_cents, status, min_qty, max_qty, wholesale, created_at, updated_at) VALUES('t','',100,40,'active',1,100,'[]',?,?)`, now, now); err != nil {
		t.Fatalf("insert product: %v", err)
	}
	var pid int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&pid)
	for i := 0; i < 5; i++ {
		_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'C', 'available', ?, ?)`, pid, now, now)
	}
	repo := order.NewRepository(d)
	now = models.Now()
	if err := repo.CreatePendingOrder(&models.Order{
		OrderNo: "SNAP1", ProductID: pid, ProductName: "t", Qty: 2, AmountCents: 200, CostCents: 40,
		Fiat: "CNY", TradeType: "usdt-trc20", BuyerContact: "a@b.com",
		Status: models.OrderCreated, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create pending order: %v", err)
	}
	o, _ := repo.GetOrderByNo("SNAP1")
	if o.CostCents != 40 {
		t.Fatalf("order cost snapshot = %d, want 40", o.CostCents)
	}
}

func TestCouponRefundIdempotent(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	repo := order.NewRepository(d)
	if err := repo.CreateCoupon(models.Coupon{Code: "REF", Type: "fixed", ValueCents: 50, MinAmountCents: 0, MaxUses: 0, ProductID: 0, Active: true}); err != nil {
		t.Fatalf("create coupon: %v", err)
	}
	c, _ := repo.GetCouponByCode("REF")
	if err := repo.UseCoupon(c.ID, "REFORD", 50); err != nil {
		t.Fatalf("use coupon: %v", err)
	}
	c2, _ := repo.GetCouponByCode("REF")
	if c2.UsedCount != 1 {
		t.Fatalf("used = %d, want 1", c2.UsedCount)
	}
	// 首次回滚：发生实际变化
	refunded, err := repo.RefundByOrderNo("REFORD")
	if err != nil || !refunded {
		t.Fatalf("first refund should be real: %v %v", refunded, err)
	}
	c3, _ := repo.GetCouponByCode("REF")
	if c3.UsedCount != 0 {
		t.Fatalf("used after refund = %d, want 0", c3.UsedCount)
	}
	// 再次回滚：幂等空操作
	refunded2, err := repo.RefundByOrderNo("REFORD")
	if err != nil || refunded2 {
		t.Fatalf("second refund should be no-op: %v %v", refunded2, err)
	}
}
