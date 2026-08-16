package application

import (
	"context"

	"shop/internal/modules/inventory/domain"
)

// KeyRepository 卡密库存数据访问端口。
type KeyRepository interface {
	ListByProduct(productID int64) ([]domain.Card, error)
	Add(productID int64, contents []string, dedupe bool) (added, skipped int, err error)
	DeleteAvailable(cardID int64) error
	SetManualStatus(cardID int64, status string, soldAt int64) (bool, error)
	AvailableCount(productID int64) (int, error)
	SoldCountSince(ts int64) (int, error)
	StockStats() (available, sold, locked int, err error)
}

// InventoryRepository 库存/卡密端口：订单应用层只通过这些能力操作库存，
// 禁止订单模块直接读写 cards 表。
type InventoryRepository interface {
	ReserveCards(ctx context.Context, orderID, productID int64, quantity int) error
	ReserveFromStock(ctx context.Context, orderID, productID int64, quantity int) error
	ConfirmReservation(ctx context.Context, orderID int64) (int, error)
	ReleaseReservation(ctx context.Context, orderID int64) error
	CardsForOrder(ctx context.Context, orderID int64) ([]domain.Card, error)
	AvailableCount(ctx context.Context, productID int64) (int, error)
	StockCounts(ctx context.Context, productID int64) (available, reserved, sold int, err error)
	StockCountsBatch(ctx context.Context, productIDs []int64) (map[int64]StockCount, error)
}

// StockCount 别名：库存数量类型定义在 domain 层，仓储不依赖应用层。
type StockCount = domain.StockCount
