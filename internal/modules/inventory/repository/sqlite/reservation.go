package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"shop/internal/modules/inventory/domain"
	"shop/internal/shared/clock"
)

// ---- 事务内卡密操作（SQL 只归属 inventory 模块；订单仓储通过 tx 编排调用） ----

// ReserveCardsTx 事务内锁定可用卡密（单条条件 UPDATE，返回实际锁定数量）。
func ReserveCardsTx(tx *sql.Tx, orderID, productID int64, quantity int) (int64, error) {
	res, err := tx.Exec(`UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ?
		WHERE id IN (SELECT id FROM cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT ?)`,
		orderID, clock.Now(), productID, quantity)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ConfirmReservationTx 事务内把订单锁定卡密置为售出，返回售出数量。
func ConfirmReservationTx(tx *sql.Tx, orderID int64) (int64, error) {
	res, err := tx.Exec(`UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ?
		WHERE reserved_order = ? AND status = 'locked'`,
		orderID, clock.Now(), clock.Now(), orderID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ReleaseReservationTx 事务内释放订单锁定卡密，返回释放数量。
func ReleaseReservationTx(tx *sql.Tx, orderID int64) (int64, error) {
	res, err := tx.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ?
		WHERE reserved_order = ? AND status = 'locked'`,
		clock.Now(), orderID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// CardsByOrderTx 事务内读取订单已售卡密（Outbox 事件载荷等）。
func CardsByOrderTx(tx *sql.Tx, orderID int64) ([]domain.Card, error) {
	rows, err := tx.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE sold_order = ? ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Card
	for rows.Next() {
		var c domain.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.ReservedOrder, &c.SoldOrder, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ErrInsufficient 库存不足。
var ErrInsufficient = errors.New("insufficient card stock")

// InventoryRepository 实现 inventory/application.InventoryRepository（应用层端口，ctx 风格）。
type InventoryRepository struct {
	db *sql.DB
}

func NewInventoryRepository(db *sql.DB) *InventoryRepository {
	return &InventoryRepository{db: db}
}

func (r *InventoryRepository) ReserveCards(_ context.Context, orderID, productID int64, quantity int) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	n, err := ReserveCardsTx(tx, orderID, productID, quantity)
	if err != nil {
		return err
	}
	if n != int64(quantity) {
		return ErrInsufficient
	}
	return tx.Commit()
}

func (r *InventoryRepository) ReserveFromStock(_ context.Context, orderID, productID int64, quantity int) error {
	return r.ReserveCards(context.Background(), orderID, productID, quantity)
}

func (r *InventoryRepository) ConfirmReservation(_ context.Context, orderID int64) (int, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	n, err := ConfirmReservationTx(tx, orderID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return int(n), nil
}

func (r *InventoryRepository) ReleaseReservation(_ context.Context, orderID int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := ReleaseReservationTx(tx, orderID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *InventoryRepository) CardsForOrder(_ context.Context, orderID int64) ([]domain.Card, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	cards, err := CardsByOrderTx(tx, orderID)
	if err != nil {
		return nil, err
	}
	return cards, tx.Commit()
}

func (r *InventoryRepository) AvailableCount(_ context.Context, productID int64) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'available'`, productID).Scan(&n)
	return n, err
}

// StockCounts 商品库存数量统计（库存数据只归属 inventory 模块）。
func (r *InventoryRepository) StockCounts(_ context.Context, productID int64) (int, int, int, error) {
	var available, reserved, sold int
	if err := r.db.QueryRow(`SELECT
		COUNT(CASE WHEN status='available' THEN 1 END),
		COUNT(CASE WHEN status='locked' THEN 1 END),
		COUNT(CASE WHEN status='sold' THEN 1 END)
		FROM cards WHERE product_id = ?`, productID).Scan(&available, &reserved, &sold); err != nil {
		return 0, 0, 0, err
	}
	return available, reserved, sold, nil
}

// StockCountsBatch 批量库存统计（商品列表页一次填充）。
func (r *InventoryRepository) StockCountsBatch(_ context.Context, productIDs []int64) (map[int64]domain.StockCount, error) {
	out := make(map[int64]domain.StockCount, len(productIDs))
	for _, pid := range productIDs {
		a, rv, s, err := r.StockCounts(context.Background(), pid)
		if err != nil {
			return nil, err
		}
		out[pid] = domain.StockCount{Available: a, Reserved: rv, Sold: s}
	}
	return out, nil
}
