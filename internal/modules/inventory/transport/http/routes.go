package http

import (
	"net/http"

	inventoryapp "shop/internal/modules/inventory/application"
	productapp "shop/internal/modules/product/application"
	"shop/internal/shared/value"
)

// Deps 卡密库存模块 HTTP 处理器依赖。
type Deps struct {
	Inventory *inventoryapp.InventoryService
	Products  *productapp.ProductService
	Audit     func(r *http.Request, action, targetType, targetID, before, after string)
}

type Registrar interface {
	Admin(method, path string, minRole string, h http.HandlerFunc)
}

type Handlers struct{ deps Deps }

func NewHandlers(deps Deps) *Handlers { return &Handlers{deps: deps} }

var (
	str           = value.Str
	errString     = value.ErrString
	firstNonEmpty = value.FirstNonEmpty
)

func Register(reg Registrar, h *Handlers) {
	reg.Admin("GET", "/api/v1/admin/products/{id}/cards", "operator", h.AdminCards)
	reg.Admin("GET", "/api/v1/admin/products/{id}/cards/export", "operator", h.AdminCardsExport)
	reg.Admin("POST", "/api/v1/admin/products/{id}/cards", "operator", h.AdminCardsImport)
	reg.Admin("POST", "/api/v1/admin/cards/{id}/delete", "operator", h.AdminCardDelete)
	reg.Admin("POST", "/api/v1/admin/cards/{id}/status", "operator", h.AdminCardStatus)
}
