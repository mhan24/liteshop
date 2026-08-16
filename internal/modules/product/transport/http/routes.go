package http

import (
	"net/http"

	productapp "shop/internal/modules/product/application"
	settingsapp "shop/internal/modules/settings/application"
	"shop/internal/shared/value"
)

// Deps 商品模块 HTTP 处理器依赖（组合根注入的应用用例）。
type Deps struct {
	Products *productapp.ProductService
	Settings *settingsapp.SettingsService
	Audit    func(r *http.Request, action, targetType, targetID, before, after string)
}

// Registrar 路由注册器（组合根实现，携带鉴权/限流中间件）。
type Registrar interface {
	Public(method, path string, limit int, h http.HandlerFunc)
	Admin(method, path string, minRole string, h http.HandlerFunc)
}

type Handlers struct{ deps Deps }

func NewHandlers(deps Deps) *Handlers { return &Handlers{deps: deps} }

// 值工具别名（转换期兼容，避免每处改写）。
var (
	str           = value.Str
	errString     = value.ErrString
	firstNonEmpty = value.FirstNonEmpty
)

func Register(reg Registrar, h *Handlers) {
	reg.Public("GET", "/api/v1/products", 60, h.Products)
	reg.Public("GET", "/api/v1/products/{id}", 120, h.Product)
	reg.Admin("GET", "/api/v1/admin/products", "viewer", h.AdminProducts)
	reg.Admin("GET", "/api/v1/admin/products/{id}", "viewer", h.AdminProduct)
	reg.Admin("POST", "/api/v1/admin/products", "operator", h.AdminProductCreate)
	reg.Admin("POST", "/api/v1/admin/products/{id}/edit", "operator", h.AdminProductUpdate)
}
