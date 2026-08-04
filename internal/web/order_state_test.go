package web

import (
	"testing"

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

// TestRedeliverFreesAndRelocks 验证补发卡密（ReserveCardsFromStock 子查询）不触发
// UPDATE...LIMIT 语法错误，并正确从库存锁定卡密。
func TestRedeliverFreesAndRelocks(t *testing.T) {
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
