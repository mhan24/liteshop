package application

import (
	"errors"
	"strings"

	"shop/internal/modules/inventory/domain"
	"shop/internal/shared/clock"
)

// InventoryService 卡密库存业务逻辑。
type InventoryService struct {
	keys KeyRepository
}

func NewInventoryService(keys KeyRepository) *InventoryService {
	return &InventoryService{keys: keys}
}

func (s *InventoryService) Cards(productID int64) ([]domain.Card, error) {
	return s.keys.ListByProduct(productID)
}

func (s *InventoryService) ImportCards(productID int64, contents []string, dedupe bool) (added, skipped int, err error) {
	return s.keys.Add(productID, contents, dedupe)
}

func (s *InventoryService) DeleteCard(cardID int64) error {
	return s.keys.DeleteAvailable(cardID)
}

// SetCardStatus 手动设置卡密状态（可用/锁定/已售出/停用）。
func (s *InventoryService) SetCardStatus(cardID int64, status string) error {
	status = strings.TrimSpace(status)
	var soldAt int64
	switch status {
	case domain.CardAvailable, domain.CardLocked, domain.CardDisabled:
	case domain.CardSold:
		soldAt = clock.Now()
	default:
		return errors.New("invalid card status: " + status)
	}
	ok, err := s.keys.SetManualStatus(cardID, status, soldAt)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrCardBusy
	}
	return nil
}

func (s *InventoryService) AvailableCount(productID int64) (int, error) {
	return s.keys.AvailableCount(productID)
}

func (s *InventoryService) SoldCountSince(ts int64) (int, error) {
	return s.keys.SoldCountSince(ts)
}

func (s *InventoryService) StockStats() (available, sold, locked int, err error) {
	return s.keys.StockStats()
}
