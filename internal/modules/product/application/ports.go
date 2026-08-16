package application

import "shop/internal/modules/product/domain"

// ProductRepository 商品数据访问端口。
type ProductRepository interface {
	ListViews(activeOnly bool) ([]domain.ProductView, error)
	GetByID(id int64) (domain.ProductView, error)
	GetBySlug(slug string) (domain.ProductView, error)
	GetActiveByID(id int64) (domain.ProductView, error)
	Count() (int, error)
	Create(p domain.Product) error
	Update(p domain.Product, id int64) error
	GetName(id int64) string
	AllCategories() ([]string, error)
}
