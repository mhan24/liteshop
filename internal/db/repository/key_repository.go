package repository

import (
	"database/sql"

	"shop/internal/models"
)

// KeyRepository 卡密（卡密库存）数据访问。
type KeyRepository struct {
	db *sql.DB
}

func NewKeyRepository(db *sql.DB) *KeyRepository {
	return &KeyRepository{db: db}
}

// ListByProduct 返回商品卡密列表。
func (r *KeyRepository) ListByProduct(productID int64) ([]models.Card, error) {
	rows, err := r.db.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE product_id = ? ORDER BY id DESC LIMIT 500`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Card
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.ReservedOrder, &c.SoldOrder, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Add 批量导入可用卡密。dedupe=true 时跳过该商品下已存在的卡密内容。
// 返回新增数与跳过的重复数。
func (r *KeyRepository) Add(productID int64, contents []string, dedupe bool) (added, skipped int, err error) {
	existing := map[string]bool{}
	if dedupe {
		rows, err := r.db.Query(`SELECT content FROM cards WHERE product_id = ?`, productID)
		if err != nil {
			return 0, 0, err
		}
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				rows.Close()
				return 0, 0, err
			}
			existing[c] = true
		}
		rows.Close()
	}
	tx, err := r.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	now := models.Now()
	for _, content := range contents {
		if dedupe && existing[content] {
			skipped++
			continue
		}
		if _, err := tx.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, ?, 'available', ?, ?)`, productID, content, now, now); err != nil {
			return 0, 0, err
		}
		added++
	}
	return added, skipped, tx.Commit()
}

// DeleteAvailable 删除可用卡密。
func (r *KeyRepository) DeleteAvailable(cardID int64) error {
	_, err := r.db.Exec(`DELETE FROM cards WHERE id = ? AND status = 'available'`, cardID)
	return err
}

// SetManualStatus 手动设置卡密状态（available/locked/sold/disabled）。
// 仅允许未被订单锁定（reserved_order=0）且未通过订单售出（sold_order=0）的卡密，
// 避免人工操作破坏订单/库存一致性。soldAt 传 0 清除售出时间。
// 返回是否更新成功（false 表示卡密不存在或已绑定订单）。
func (r *KeyRepository) SetManualStatus(cardID int64, status string, soldAt int64) (bool, error) {
	res, err := r.db.Exec(
		`UPDATE cards SET status = ?, sold_at = ?, updated_at = ? WHERE id = ? AND reserved_order = 0 AND sold_order = 0`,
		status, soldAt, models.Now(), cardID,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// AvailableCount 返回商品可用卡密数。
func (r *KeyRepository) AvailableCount(productID int64) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'available'`, productID).Scan(&n)
	return n, err
}

// SoldCountSince 返回指定时间之后的售出卡密数。
func (r *KeyRepository) SoldCountSince(ts int64) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'sold' AND sold_at >= ?`, ts).Scan(&n)
	return n, err
}

// StockStats 返回卡密库存统计（商品数/可用/售出/锁定）。
func (r *KeyRepository) StockStats() (products, available, sold, locked int, err error) {
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM products`).Scan(&products); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'available'`).Scan(&available); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'sold'`).Scan(&sold); err != nil {
		return
	}
	if err = r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'locked'`).Scan(&locked); err != nil {
		return
	}
	return
}
