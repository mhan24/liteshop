package integration

import (
	"errors"
	"testing"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/service"
	"shop/internal/testutil"
)

// TestManualCardStatus 手动标记卡密状态：可用/锁定/已售出/停用。
func TestManualCardStatus(t *testing.T) {
	d := testutil.NewTestDB(t)
	keyRepo := repository.NewKeyRepository(d)
	psvc := service.NewProductService(repository.NewProductRepository(d), keyRepo)
	pid := testutil.SeedProductWithCards(t, d, 3)

	cards, err := keyRepo.ListByProduct(pid)
	if err != nil || len(cards) < 2 {
		t.Fatalf("seed cards: err=%v n=%d", err, len(cards))
	}
	card := cards[0]
	find := func() models.Card {
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
		return models.Card{}
	}

	// available -> locked
	if err := psvc.SetCardStatus(card.ID, models.CardLocked); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if got := find(); got.Status != models.CardLocked || got.SoldAt != 0 {
		t.Fatalf("after lock: status=%s sold_at=%d", got.Status, got.SoldAt)
	}

	// locked -> sold（记录售出时间）
	if err := psvc.SetCardStatus(card.ID, models.CardSold); err != nil {
		t.Fatalf("mark sold: %v", err)
	}
	if got := find(); got.Status != models.CardSold || got.SoldAt == 0 {
		t.Fatalf("after sold: status=%s sold_at=%d", got.Status, got.SoldAt)
	}

	// sold -> disabled -> available（售出时间清除）
	if err := psvc.SetCardStatus(card.ID, models.CardDisabled); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if err := psvc.SetCardStatus(card.ID, models.CardAvailable); err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	if got := find(); got.Status != models.CardAvailable || got.SoldAt != 0 {
		t.Fatalf("after re-enable: status=%s sold_at=%d", got.Status, got.SoldAt)
	}

	// 非法状态
	if err := psvc.SetCardStatus(card.ID, "weird"); err == nil {
		t.Fatal("invalid status should fail")
	}
}

// TestManualCardStatusRejectsOrderBound 已绑定订单的卡密不允许手动改状态。
func TestManualCardStatusRejectsOrderBound(t *testing.T) {
	svc, keyRepo, _, _, d, pid := newOrderService(t)
	psvc := service.NewProductService(repository.NewProductRepository(d), keyRepo)

	_, _, _, _, err := svc.CreateOrder(testProduct(pid), 1, "buyer@test.com", "usdt.trc20", "")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	cards, err := keyRepo.ListByProduct(pid)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var locked *models.Card
	for i := range cards {
		if cards[i].ReservedOrder > 0 {
			locked = &cards[i]
			break
		}
	}
	if locked == nil {
		t.Fatal("no reserved card found")
	}
	if err := psvc.SetCardStatus(locked.ID, models.CardAvailable); !errors.Is(err, models.ErrCardBusy) {
		t.Fatalf("order-bound card: err=%v, want ErrCardBusy", err)
	}
}
