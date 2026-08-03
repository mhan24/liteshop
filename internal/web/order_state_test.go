package web

import (
	"testing"

	"shop/internal/db"
	"shop/internal/models"
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

	order := models.Order{
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
	s := &Server{db: d}
	if err := s.createPendingOrder(&order); err != nil {
		t.Fatalf("create order: %v", err)
	}
	if err := db.AddOrderLog(d, order.ID, "order_created", "订单已创建", "", models.OrderCreated, 0, ""); err != nil {
		t.Fatalf("log create: %v", err)
	}
	if err := s.setOrderStatusWithLog(order.ID, models.OrderWaitingPayment, "transaction_created", "BEpusdt 交易已创建", 0); err != nil {
		t.Fatalf("transition to waiting: %v", err)
	}

	o, err := s.getOrderByID(order.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != models.OrderWaitingPayment {
		t.Fatalf("status = %s, want %s", o.Status, models.OrderWaitingPayment)
	}

	// 模拟支付回调
	paid, changed, err := s.markPaid(map[string]string{
		"order_id":             o.OrderNo,
		"trade_id":             "T1",
		"block_transaction_id": "B1",
	})
	if err != nil || !changed {
		t.Fatalf("markPaid err=%v changed=%v", err, changed)
	}
	if paid.Status != models.OrderPaid {
		t.Fatalf("paid status = %s", paid.Status)
	}

	// 发卡
	cards, delivered, err := s.deliverOrder(paid)
	if err != nil || !delivered {
		t.Fatalf("deliver err=%v delivered=%v", err, delivered)
	}
	if len(cards) != 2 {
		t.Fatalf("delivered %d cards, want 2", len(cards))
	}

	// 验证卡密状态
	var soldCount int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE sold_order = ? AND status = 'sold'`, order.ID).Scan(&soldCount)
	if soldCount != 2 {
		t.Fatalf("sold cards = %d, want 2", soldCount)
	}

	// 验证日志
	logs, _ := db.OrderLogs(d, order.ID)
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
	o2, _ := s.getOrderByID(order.ID)
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

	order := models.Order{OrderNo: models.NewOrderNo(), ProductID: productID, ProductName: "t", Qty: 1, AmountCents: 100, Fiat: "CNY", TradeType: "usdt-trc20", BuyerContact: "a@b.com", Status: models.OrderCreated, CreatedAt: now, UpdatedAt: now}
	s := &Server{db: d}
	if err := s.createPendingOrder(&order); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.cancelOrder(order.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	o, _ := s.getOrderByID(order.ID)
	if o.Status != models.OrderCancelled {
		t.Fatalf("status = %s", o.Status)
	}
	var avail int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='available' AND reserved_order=0`).Scan(&avail)
	if avail != 1 {
		t.Fatalf("cards freed = %d, want 1", avail)
	}
	logs, _ := db.OrderLogs(d, order.ID)
	if len(logs) == 0 {
		t.Fatalf("no cancel log")
	}
}
