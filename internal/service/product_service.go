package service

import (
	"strings"

	"shop/internal/repository"
	"shop/internal/models"
)

// View 商品视图（仓库层类型别名，保持对外类型不变）。
type View = repository.View

// CategoryView 分类分组视图（前台首页/搜索用）。
type CategoryView struct {
	Name       string
	DefaultKey string
	Products   []View
}

// Service 商品业务逻辑。
type ProductService struct {
	repo *repository.ProductRepository
}

func NewProductService(repo *repository.ProductRepository) *ProductService {
	return &ProductService{repo: repo}
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
	return s.repo.GetByID(id)
}

// GetActiveView 按 ID 查上架商品视图。
func (s *ProductService) GetActiveView(id int64) (View, error) {
	return s.repo.GetActiveByID(id)
}

// GetBySlug 按 slug 查上架商品。
func (s *ProductService) GetBySlug(slug string) (View, error) {
	return s.repo.GetBySlug(slug)
}

// AllCategories 返回上架商品分类。
func (s *ProductService) AllCategories() ([]string, error) {
	return s.repo.AllCategories()
}

// Repo 暴露仓储给上层查询。
func (s *ProductService) Repo() *repository.ProductRepository { return s.repo }
