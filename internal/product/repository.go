// Package product 提供商品领域的仓储与业务逻辑。
// 分层: web handler → product.Service → product.Repository → db
package product

import (
	"database/sql"
	"encoding/json"

	"shop/internal/models"
)

// View 商品视图（含库存统计）。
type View struct {
	Product   models.Product
	Available int
	Reserved  int
	Sold      int
}

// Repository 封装商品与卡密的数据访问。
type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// ListViews 返回商品视图（可选仅上架）。
func (r *Repository) ListViews(activeOnly bool) ([]View, error) {
	where := ""
	if activeOnly {
		where = "WHERE p.status = 'active'"
	}
	rows, err := r.db.Query(`SELECT p.id, p.name, p.description, p.image_url, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.faq, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available'),
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'locked'),
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'sold')
		FROM products p ` + where + ` ORDER BY p.is_pinned DESC, p.sort_order ASC, p.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []View
	for rows.Next() {
		var v View
		var faqRaw string
		if err := rows.Scan(&v.Product.ID, &v.Product.Name, &v.Product.Description, &v.Product.ImageURL, &v.Product.PriceCents, &v.Product.Status, &v.Product.Category, &v.Product.SortOrder, &v.Product.IsPinned, &faqRaw, &v.Product.CreatedAt, &v.Product.UpdatedAt, &v.Available, &v.Reserved, &v.Sold); err != nil {
			return nil, err
		}
		v.Product.FAQ = parseFAQ(faqRaw)
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetByID 按 ID 查商品视图。
func (r *Repository) GetByID(id int64) (View, error) {
	var v View
	var faqRaw string
	err := r.db.QueryRow(`SELECT p.id, p.name, p.description, p.image_url, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.faq, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available')
		FROM products p WHERE p.id = ?`, id).Scan(&v.Product.ID, &v.Product.Name, &v.Product.Description, &v.Product.ImageURL, &v.Product.PriceCents, &v.Product.Status, &v.Product.Category, &v.Product.SortOrder, &v.Product.IsPinned, &faqRaw, &v.Product.CreatedAt, &v.Product.UpdatedAt, &v.Available)
	if err != nil {
		return v, err
	}
	v.Product.FAQ = parseFAQ(faqRaw)
	return v, nil
}

// GetBySlug 按 slug 查上架商品。
func (r *Repository) GetBySlug(slug string) (View, error) {
	views, err := r.ListViews(true)
	if err != nil {
		return View{}, err
	}
	for _, v := range views {
		if models.Slugify(v.Product.Name) == slug {
			return v, nil
		}
	}
	return View{}, sql.ErrNoRows
}

// GetActiveByID 查上架商品（前台用）。
func (r *Repository) GetActiveByID(id int64) (View, error) {
	v, err := r.GetByID(id)
	if err != nil {
		return v, err
	}
	if v.Product.Status != "active" {
		return v, sql.ErrNoRows
	}
	return v, nil
}

// Create 创建商品。
func (r *Repository) Create(p models.Product) error {
	now := models.Now()
	_, err := r.db.Exec(`INSERT INTO products(name, description, image_url, price_cents, status, category, sort_order, is_pinned, faq, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Name, p.Description, p.ImageURL, p.PriceCents, p.Status, p.Category, p.SortOrder, p.IsPinned, faqJSON(p.FAQ), now, now)
	return err
}

// Update 更新商品。
func (r *Repository) Update(p models.Product, id int64) error {
	_, err := r.db.Exec(`UPDATE products SET name = ?, description = ?, image_url = ?, price_cents = ?, status = ?, category = ?, sort_order = ?, is_pinned = ?, faq = ?, updated_at = ? WHERE id = ?`,
		p.Name, p.Description, p.ImageURL, p.PriceCents, p.Status, p.Category, p.SortOrder, p.IsPinned, faqJSON(p.FAQ), models.Now(), id)
	return err
}

// GetName 返回商品名（审计用）。
func (r *Repository) GetName(id int64) string {
	var name string
	_ = r.db.QueryRow(`SELECT name FROM products WHERE id = ?`, id).Scan(&name)
	return name
}

// AvailableCount 返回商品可用卡密数。
func (r *Repository) AvailableCount(productID int64) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'available'`, productID).Scan(&n)
	return n, err
}

// AllCategories 返回上架商品分类（去重）。
func (r *Repository) AllCategories() ([]string, error) {
	views, err := r.ListViews(true)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := []string{}
	for _, v := range views {
		c := v.Product.Category
		if c == "" {
			c = "默认分类"
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out, nil
}

// CardStockStats 返回卡密库存统计（总可用/售出/锁定）。
func (r *Repository) CardStockStats() (products, available, sold, locked int, err error) {
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

// LowStock 返回库存不足的商品（可用 < threshold）。
func (r *Repository) LowStock(threshold int) ([]View, error) {
	if threshold <= 0 {
		threshold = 10
	}
	views, err := r.ListViews(true)
	if err != nil {
		return nil, err
	}
	out := []View{}
	for _, v := range views {
		if v.Available < threshold {
			out = append(out, v)
		}
	}
	return out, nil
}

func parseFAQ(raw string) []models.FAQItem {
	var out []models.FAQItem
	if raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

func faqJSON(faq []models.FAQItem) string {
	if len(faq) == 0 {
		return ""
	}
	raw, err := json.Marshal(faq)
	if err != nil {
		return ""
	}
	return string(raw)
}
