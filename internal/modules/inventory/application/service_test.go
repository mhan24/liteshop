package application

import (
	"testing"

	"shop/internal/modules/inventory/domain"
)

// fakeKeyRepository 实现 KeyRepository 端口，记录调用并模拟忙态。
type fakeKeyRepository struct {
	lastStatus string
	lastSoldAt int64
	busy       bool
}

func (f *fakeKeyRepository) ListByProduct(productID int64) ([]domain.Card, error) { return nil, nil }
func (f *fakeKeyRepository) Add(productID int64, contents []string, dedupe bool) (int, int, error) {
	return 0, 0, nil
}
func (f *fakeKeyRepository) DeleteAvailable(cardID int64) error { return nil }
func (f *fakeKeyRepository) SetManualStatus(cardID int64, status string, soldAt int64) (bool, error) {
	if f.busy {
		return false, nil
	}
	f.lastStatus, f.lastSoldAt = status, soldAt
	return true, nil
}
func (f *fakeKeyRepository) AvailableCount(productID int64) (int, error) { return 0, nil }
func (f *fakeKeyRepository) SoldCountSince(ts int64) (int, error)        { return 0, nil }
func (f *fakeKeyRepository) StockStats() (int, int, int, error)          { return 0, 0, 0, nil }

// TestSetCardStatusRules 手动改卡密状态的核心规则：合法状态、售出时间戳、忙态拒绝。
func TestSetCardStatusRules(t *testing.T) {
	store := &fakeKeyRepository{}
	svc := NewInventoryService(store)

	for _, status := range []string{domain.CardAvailable, domain.CardLocked, domain.CardDisabled} {
		store.lastSoldAt = -1
		if err := svc.SetCardStatus(1, status); err != nil {
			t.Fatalf("status %s: %v", status, err)
		}
		if store.lastStatus != status || store.lastSoldAt != 0 {
			t.Fatalf("status %s: store got (%s, soldAt=%d), want soldAt=0", status, store.lastStatus, store.lastSoldAt)
		}
	}

	if err := svc.SetCardStatus(1, domain.CardSold); err != nil {
		t.Fatalf("sold: %v", err)
	}
	if store.lastStatus != domain.CardSold || store.lastSoldAt <= 0 {
		t.Fatalf("sold: store got (%s, soldAt=%d), want soldAt>0", store.lastStatus, store.lastSoldAt)
	}

	if err := svc.SetCardStatus(1, "invalid-status"); err == nil {
		t.Fatal("invalid status should be rejected")
	}

	store.busy = true
	if err := svc.SetCardStatus(1, domain.CardAvailable); err != domain.ErrCardBusy {
		t.Fatalf("busy card: err = %v, want ErrCardBusy", err)
	}
}
