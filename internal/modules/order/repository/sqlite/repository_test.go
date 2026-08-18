package sqlite

import (
	"database/sql"
	"sync"
	"testing"

	couponsqlite "shop/internal/modules/coupon/repository/sqlite"
	inventorydomain "shop/internal/modules/inventory/domain"
	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	"shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
	db "shop/internal/platform/database/sqlite"
	"shop/internal/shared/clock"
)

// openRepo 打开临时库并构造订单仓储。
func openRepo(t *testing.T) (*OrderRepository, *sql.DB) {
	t.Helper()
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	repo := NewOrderRepository(d)
	repo.SetCardTxOps(inventorysqlite.NewTxOps())
	repo.SetCouponTxOps(couponsqlite.NewTxOps())
	return repo, d
}

// seedProductCards 建商品并插入 n 张可用卡密。
func seedProductCards(t *testing.T, d *sql.DB, n int) int64 {
	t.Helper()
	now := clock.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('测试商品','',1000,'active',1,100,'[]','auto',?,?)`, now, now)
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	pid, _ := res.LastInsertId()
	for i := 0; i < n; i++ {
		if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,?, 'available',?,?)`,
			pid, "CARD-"+string(rune('A'+i)), now, now); err != nil {
			t.Fatalf("seed card: %v", err)
		}
	}
	return pid
}

// TestCreatePendingOrderReservesCards 建单锁定卡密（数据映射/条件更新）。
func TestCreatePendingOrderReservesCards(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 3)
	o := &domain.Order{OrderNo: "S1", ProductID: pid, ProductName: "测试商品", Qty: 2, AmountCents: 2000,
		Fiat: "CNY", TradeType: "usdt.trc20", BuyerContact: "a@b.com", ViewToken: "tok",
		DeliveryType: "auto", Status: domain.OrderCreated, CreatedAt: clock.Now(), UpdatedAt: clock.Now()}
	if err := repo.CreatePendingOrder(o); err != nil {
		t.Fatalf("create pending: %v", err)
	}
	if o.ID == 0 {
		t.Fatal("order id not set")
	}
	var locked int
	if err := d.QueryRow(`SELECT COUNT(1) FROM cards WHERE reserved_order = ? AND status = 'locked'`, o.ID).Scan(&locked); err != nil {
		t.Fatal(err)
	}
	if locked != 2 {
		t.Fatalf("locked = %d, want 2", locked)
	}
}

// TestCreatePendingOrderInsufficientRollsBack 库存不足时订单与锁定都不落库（事务）。
func TestCreatePendingOrderInsufficientRollsBack(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 1)
	o := &domain.Order{OrderNo: "S2", ProductID: pid, Qty: 5, AmountCents: 5000,
		Fiat: "CNY", TradeType: "usdt.trc20", DeliveryType: "auto", CreatedAt: clock.Now()}
	if err := repo.CreatePendingOrder(o); err == nil {
		t.Fatal("expected insufficient error")
	}
	var orders int
	_ = d.QueryRow(`SELECT COUNT(1) FROM orders WHERE order_no='S2'`).Scan(&orders)
	if orders != 0 {
		t.Fatal("order should be rolled back")
	}
}

// TestCancelReleasesReservation 取消订单释放锁定卡密（条件状态迁移）。
func TestCancelReleasesReservation(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 2)
	o := &domain.Order{OrderNo: "S3", ProductID: pid, Qty: 1, AmountCents: 1000,
		Fiat: "CNY", TradeType: "usdt.trc20", DeliveryType: "auto", CreatedAt: clock.Now()}
	if err := repo.CreatePendingOrder(o); err != nil {
		t.Fatal(err)
	}
	if _, changed, err := repo.CancelOrder(o.ID); err != nil || !changed {
		t.Fatalf("cancel: %v %v", changed, err)
	}
	var avail int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE status='available' AND product_id = ?`, pid).Scan(&avail)
	if avail != 2 {
		t.Fatalf("available = %d, want 2", avail)
	}
	// 已取消订单再次取消为 noop
	if _, changed, err := repo.CancelOrder(o.ID); err != nil || changed {
		t.Fatalf("second cancel should be noop: %v %v", changed, err)
	}
}

// TestMarkPaidAndDeliverSellsCards 支付确认并发卡：锁定卡密转售出。
func TestMarkPaidAndDeliverSellsCards(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 1)
	o := &domain.Order{OrderNo: "S4", ProductID: pid, Qty: 1, AmountCents: 1000,
		Fiat: "CNY", TradeType: "usdt.trc20", DeliveryType: "auto", CreatedAt: clock.Now()}
	if err := repo.CreatePendingOrder(o); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetOrderStatus(o.ID, domain.OrderWaitingPayment); err != nil {
		t.Fatalf("to waiting_payment: %v", err)
	}
	delivered, err := repo.MarkPaidAndDeliver(o.ID, "bepusdt", "T-1", "0x1", clock.Now())
	if err != nil {
		t.Fatalf("mark paid: %v", err)
	}
	if delivered != 1 {
		t.Fatalf("delivered = %d, want 1", delivered)
	}
	got, err := repo.GetOrderByID(o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.OrderPaid || got.PaymentStatus != domain.PaymentConfirmed || got.TradeID != "T-1" {
		t.Fatalf("paid order not updated: %+v", got)
	}
	var sold int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE sold_order = ? AND status='sold'`, o.ID).Scan(&sold)
	if sold != 1 {
		t.Fatalf("sold = %d, want 1", sold)
	}
}

func TestSetOrderStatusFromRequiresExpectedState(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 1)
	o := &domain.Order{OrderNo: "S5", ProductID: pid, ProductName: "测试商品", Qty: 1, AmountCents: 1000,
		Fiat: "CNY", TradeType: "usdt.trc20", DeliveryType: "auto", CreatedAt: clock.Now(), UpdatedAt: clock.Now()}
	if err := repo.CreatePendingOrder(o); err != nil {
		t.Fatalf("create pending: %v", err)
	}
	if err := repo.SetOrderStatusFrom(o.ID, domain.OrderWaitingPayment, domain.OrderCancelled); err != ErrNoRows {
		t.Fatalf("wrong expected state error = %v, want ErrNoRows", err)
	}
	if err := repo.SetOrderStatusFrom(o.ID, domain.OrderCreated, domain.OrderWaitingPayment); err != nil {
		t.Fatalf("matching expected state rejected: %v", err)
	}
}

func TestManualDeliveryEnqueuesDeliveredEventAtomically(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 0)
	repo.SetOutboxEncoder(func(o domain.Order, _ []inventorydomain.Card) ([]OutboxEvent, error) {
		return []OutboxEvent{{Type: "order.delivered", Payload: o.DeliveryContent}}, nil
	})
	now := clock.Now()
	o := &domain.Order{OrderNo: "S6", ProductID: pid, ProductName: "人工商品", Qty: 1, AmountCents: 1000,
		Fiat: "CNY", TradeType: "usdt.trc20", DeliveryType: productdomain.DeliveryTypeManual,
		Status: domain.OrderPendingDelivery, CreatedAt: now, UpdatedAt: now}
	if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, view_token, delivery_type, status, payment_status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, o.OrderNo, o.ProductID, o.ProductName, o.Qty, o.AmountCents, o.Fiat, o.TradeType, "buyer@test.com", "tok", o.DeliveryType, o.Status, domain.PaymentConfirmed, now, now); err != nil {
		t.Fatalf("insert order: %v", err)
	}
	var id int64
	_ = d.QueryRow(`SELECT id FROM orders WHERE order_no = ?`, o.OrderNo).Scan(&id)
	ok, err := repo.SetManualDelivery(id, "账号：demo")
	if err != nil || !ok {
		t.Fatalf("manual delivery: ok=%v err=%v", ok, err)
	}
	var payload string
	if err := d.QueryRow(`SELECT payload FROM outbox_events WHERE event_type = 'order.delivered'`).Scan(&payload); err != nil {
		t.Fatalf("delivered outbox missing: %v", err)
	}
	if payload != "账号：demo" {
		t.Fatalf("payload = %q, want delivery content", payload)
	}
}

// TestConcurrentReserveLastCard 并发抢最后一张卡：恰好一个成功（并发更新）。
func TestConcurrentReserveLastCard(t *testing.T) {
	repo, d := openRepo(t)
	pid := seedProductCards(t, d, 1)
	var wg sync.WaitGroup
	ok := make(chan int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			o := &domain.Order{OrderNo: "S" + string(rune('A'+n)), ProductID: pid, Qty: 1, AmountCents: 1000,
				Fiat: "CNY", TradeType: "usdt.trc20", DeliveryType: "auto", CreatedAt: clock.Now()}
			if err := repo.CreatePendingOrder(o); err == nil {
				ok <- 1
			}
		}(i)
	}
	wg.Wait()
	close(ok)
	total := 0
	for range ok {
		total++
	}
	if total != 1 {
		t.Fatalf("successful reservations = %d, want 1", total)
	}
}
