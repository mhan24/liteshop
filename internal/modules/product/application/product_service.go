package application

import (
	"context"
	models "shop/internal/modules/product/domain"
	"strings"

	inventoryapp "shop/internal/modules/inventory/application"
)

// View 商品视图（仓库层类型别名，保持对外类型不变）。
type View = models.ProductView

// CategoryView 分类分组视图（前台首页/搜索用）。
type CategoryView struct {
	Name       string
	DefaultKey string
	Products   []View
}

// ProductService 商品业务逻辑。
type ProductService struct {
	repo      ProductRepository
	inventory inventoryapp.InventoryRepository
}

func NewProductService(repo ProductRepository) *ProductService {
	return &ProductService{repo: repo}
}

// SetInventory 注入库存端口（库存数量由 inventory 模块提供，商品模块不读 cards）。
func (s *ProductService) SetInventory(inventory inventoryapp.InventoryRepository) {
	s.inventory = inventory
}

// fillCounts 用库存端口填充商品视图的库存数量（人工交付商品统一 -1）。
func (s *ProductService) fillCounts(views []View) error {
	if s.inventory == nil {
		return nil
	}
	ids := make([]int64, 0, len(views))
	for _, v := range views {
		ids = append(ids, v.Product.ID)
	}
	counts, err := s.inventory.StockCountsBatch(context.Background(), ids)
	if err != nil {
		return err
	}
	for i := range views {
		c := counts[views[i].Product.ID]
		views[i].Available = c.Available
		views[i].Reserved = c.Reserved
		views[i].Sold = c.Sold
		if views[i].Product.DeliveryType == models.DeliveryTypeManual {
			views[i].Available = -1
		}
	}
	return nil
}

// fillCount 填充单个商品视图库存。
func (s *ProductService) fillCount(v *View) error {
	if s.inventory == nil {
		return nil
	}
	a, r, sold, err := s.inventory.StockCounts(context.Background(), v.Product.ID)
	if err != nil {
		return err
	}
	v.Available, v.Reserved, v.Sold = a, r, sold
	if v.Product.DeliveryType == models.DeliveryTypeManual {
		v.Available = -1
	}
	return nil
}

// ListCategories 返回按分类分组的商品（可选筛选）。
// q: 关键词（名称/描述）; category: 分类; minPrice/maxPrice: 价格范围（元）。
func (s *ProductService) ListCategories(activeOnly bool, q, category string, minPrice, maxPrice float64) ([]CategoryView, error) {
	views, err := s.repo.ListViews(activeOnly)
	if err != nil {
		return nil, err
	}
	filtered := make([]View, 0, len(views))
	for _, v := range views {
		if q != "" {
			hay := strings.ToLower(v.Product.Name + " " + v.Product.Description)
			if !strings.Contains(hay, strings.ToLower(q)) {
				continue
			}
		}
		if category != "" && category != "all" && v.Product.Category != category {
			continue
		}
		if minPrice > 0 && float64(v.Product.PriceCents)/100 < minPrice {
			continue
		}
		if maxPrice > 0 && float64(v.Product.PriceCents)/100 > maxPrice {
			continue
		}
		filtered = append(filtered, v)
	}
	if err := s.fillCounts(filtered); err != nil {
		return nil, err
	}
	return Group(filtered), nil
}

// Group 将商品按置顶/分类分组。
func Group(views []View) []CategoryView {
	var pinned []View
	categoryOrder := []string{}
	categoryMap := map[string]int{}
	for _, v := range views {
		if v.Product.IsPinned {
			pinned = append(pinned, v)
			continue
		}
		name := v.Product.Category
		if strings.TrimSpace(name) == "" {
			name = "默认分类"
		}
		if _, ok := categoryMap[name]; !ok {
			categoryMap[name] = len(categoryOrder)
			categoryOrder = append(categoryOrder, name)
		}
	}
	var out []CategoryView
	if len(pinned) > 0 {
		out = append(out, CategoryView{Name: "置顶", DefaultKey: "pinned", Products: pinned})
	}
	for _, name := range categoryOrder {
		var items []View
		for _, v := range views {
			if v.Product.IsPinned {
				continue
			}
			cat := v.Product.Category
			if cat == "" {
				cat = "默认分类"
			}
			if cat == name {
				items = append(items, v)
			}
		}
		out = append(out, CategoryView{Name: name, DefaultKey: name, Products: items})
	}
	return out
}

// Create 创建商品。
func (s *ProductService) Create(p models.Product) error {
	return s.repo.Create(p)
}

// Update 更新商品。
func (s *ProductService) Update(p models.Product, id int64) error {
	return s.repo.Update(p, id)
}

// GetView 按 ID 查商品视图（含库存）。
func (s *ProductService) GetView(id int64) (View, error) {
	v, err := s.repo.GetByID(id)
	if err != nil {
		return v, err
	}
	return v, s.fillCount(&v)
}

// GetActiveView 按 ID 查上架商品视图。
func (s *ProductService) GetActiveView(id int64) (View, error) {
	v, err := s.repo.GetActiveByID(id)
	if err != nil {
		return v, err
	}
	return v, s.fillCount(&v)
}

// Count 返回商品总数（跨模块统计由商品模块提供，其他模块不读 products 表）。
func (s *ProductService) Count() (int, error) {
	return s.repo.Count()
}

// GetBySlug 按 slug 查上架商品。
func (s *ProductService) GetBySlug(slug string) (View, error) {
	v, err := s.repo.GetBySlug(slug)
	if err != nil {
		return v, err
	}
	return v, s.fillCount(&v)
}

// AllCategories 返回上架商品分类。
func (s *ProductService) AllCategories() ([]string, error) {
	return s.repo.AllCategories()
}

// List 返回商品视图（activeOnly=true 仅上架）。
func (s *ProductService) List(activeOnly bool) ([]View, error) {
	views, err := s.repo.ListViews(activeOnly)
	if err != nil {
		return nil, err
	}
	return views, s.fillCounts(views)
}

// LowStock 返回低于阈值的商品。
func (s *ProductService) LowStock(threshold int) ([]View, error) {
	views, err := s.repo.ListViews(true)
	if err != nil {
		return nil, err
	}
	if err := s.fillCounts(views); err != nil {
		return nil, err
	}
	out := []View{}
	for _, v := range views {
		if v.Available >= 0 && v.Available < threshold {
			out = append(out, v)
		}
	}
	return out, nil
}

// GetName 返回商品名（不存在返回空串）。
func (s *ProductService) GetName(id int64) string {
	return s.repo.GetName(id)
}

// Repo 暴露仓储给上层查询。
func (s *ProductService) Repo() ProductRepository { return s.repo }
