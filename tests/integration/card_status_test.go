package integration

import (
	"errors"
	inventoryapp "shop/internal/modules/inventory/application"
	inventorydomain "shop/internal/modules/inventory/domain"
	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	fixtures "shop/tests/fixtures"
	"testing"
)

// TestManualCardStatus 手动标记卡密状态：可用/锁定/已售出/停用。
func TestManualCardStatus(t *testing.T) {
	d := fixtures.NewTestDB(t)
	keyRepo := inventorysqlite.NewKeyRepository(d)
	isvc := inventoryapp.NewInventoryService(keyRepo)
	pid := fixtures.SeedProductWithCards(t, d, 3)

	cards, err := keyRepo.ListByProduct(pid)
	if err != nil || len(cards) < 2 {
		t.Fatalf("seed cards: err=%v n=%d", err, len(cards))
	}
	card := cards[0]
	find := func() inventorydomain.Card {
		t.Helper()
		all, err := keyRepo.ListByProduct(pid)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, c := range all {
			if c.ID == card.ID {
				return c
			}
		}
		t.Fatalf("card %d not found", card.ID)
		return inventorydomain.Card{}
	}

	// available -> locked
	if err := isvc.SetCardStatus(card.ID, inventorydomain.CardLocked); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if got := find(); got.Status != inventorydomain.CardLocked || got.SoldAt != 0 {
		t.Fatalf("after lock: status=%s sold_at=%d", got.Status, got.SoldAt)
	}

	// locked -> sold（记录售出时间）
	if err := isvc.SetCardStatus(card.ID, inventorydomain.CardSold); err != nil {
		t.Fatalf("mark sold: %v", err)
	}
	if got := find(); got.Status != inventorydomain.CardSold || got.SoldAt == 0 {
		t.Fatalf("after sold: status=%s sold_at=%d", got.Status, got.SoldAt)
	}

	// sold -> disabled -> available（售出时间清除）
	if err := isvc.SetCardStatus(card.ID, inventorydomain.CardDisabled); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if err := isvc.SetCardStatus(card.ID, inventorydomain.CardAvailable); err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	if got := find(); got.Status != inventorydomain.CardAvailable || got.SoldAt != 0 {
		t.Fatalf("after re-enable: status=%s sold_at=%d", got.Status, got.SoldAt)
	}

	// 非法状态
	if err := isvc.SetCardStatus(card.ID, "weird"); err == nil {
		t.Fatal("invalid status should fail")
	}
}

// TestManualCardStatusRejectsOrderBound 已绑定订单的卡密不允许手动改状态。
func TestManualCardStatusRejectsOrderBound(t *testing.T) {
	svc, keyRepo, _, _, _, pid := newOrderService(t)
	isvc := inventoryapp.NewInventoryService(keyRepo)

	_, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "bepusdt", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	cards, err := keyRepo.ListByProduct(pid)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var locked *inventorydomain.Card
	for i := range cards {
		if cards[i].ReservedOrder > 0 {
			locked = &cards[i]
			break
		}
	}
	if locked == nil {
		t.Fatal("no reserved card found")
	}
	if err := isvc.SetCardStatus(locked.ID, inventorydomain.CardAvailable); !errors.Is(err, inventorydomain.ErrCardBusy) {
		t.Fatalf("order-bound card: err=%v, want ErrCardBusy", err)
	}
}
