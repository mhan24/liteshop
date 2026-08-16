package integration

import (
	"context"
	"sync"
	"testing"

	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	"shop/internal/shared/clock"
	fixtures "shop/tests/fixtures"
)

// TestInventoryConcurrentReserveLastCard 并发锁定最后一张可用卡密：恰好一个成功。
func TestInventoryConcurrentReserveLastCard(t *testing.T) {
	d := fixtures.NewTestDB(t)
	now := clock.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('并发商品','',1000,'active',1,100,'[]','auto',?,?)`, now, now)
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	pid, _ := res.LastInsertId()
	if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'C1', 'available', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("seed card: %v", err)
	}
	inv := inventorysqlite.NewInventoryRepository(d)
	var wg sync.WaitGroup
	ok := make(chan int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int64) {
			defer wg.Done()
			if err := inv.ReserveCards(context.Background(), n, pid, 1); err == nil {
				ok <- 1
			}
		}(int64(1000 + i))
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

// TestInventoryReleaseAndConfirm 释放与确认（锁定→售出）语义。
func TestInventoryReleaseAndConfirm(t *testing.T) {
	d := fixtures.NewTestDB(t)
	now := clock.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('库存商品','',1000,'active',1,100,'[]','auto',?,?)`, now, now)
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}
	pid, _ := res.LastInsertId()
	if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'C1', 'available', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("seed card: %v", err)
	}
	inv := inventorysqlite.NewInventoryRepository(d)
	ctx := context.Background()
	if err := inv.ReserveCards(ctx, 1, pid, 1); err != nil {
		t.Fatalf("reserve: %v", err)
	}
	// 释放后卡密恢复可用
	if err := inv.ReleaseReservation(ctx, 1); err != nil {
		t.Fatalf("release: %v", err)
	}
	if n, _ := inv.AvailableCount(ctx, pid); n != 1 {
		t.Fatalf("available after release = %d, want 1", n)
	}
	// 重新锁定后确认售出
	if err := inv.ReserveCards(ctx, 2, pid, 1); err != nil {
		t.Fatalf("reserve again: %v", err)
	}
	if n, err := inv.ConfirmReservation(ctx, 2); err != nil || n != 1 {
		t.Fatalf("confirm = %d (%v), want 1", n, err)
	}
	cards, err := inv.CardsForOrder(ctx, 2)
	if err != nil || len(cards) != 1 || cards[0].Status != "sold" {
		t.Fatalf("cards for order = %d (%v)", len(cards), err)
	}
}
