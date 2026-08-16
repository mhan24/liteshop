package http

import (
	"net/http"
	"sync"

	orderapp "shop/internal/modules/order/application"
	productapp "shop/internal/modules/product/application"
	settingsapp "shop/internal/modules/settings/application"
)

// Deps 订单模块 HTTP 处理器依赖（组合根注入的应用用例，不接触仓储/数据库/支付 SDK）。
type Deps struct {
	Orders   *orderapp.OrderService
	Products *productapp.ProductService
	Settings *settingsapp.SettingsService
	Notify   *settingsapp.NotifyService
	// Audit 记录管理员审计日志（组合根提供，含当前管理员上下文）。
	Audit func(r *http.Request, action, targetType, targetID, before, after string)
	// ClientIP 返回请求方 IP（组合根提供，含 Cloudflare 信任边界）。
	ClientIP func(r *http.Request) string
}

// Registrar 路由注册器（由组合根实现，携带鉴权/限流中间件）。
type Registrar interface {
	Public(method, path string, limit int, h http.HandlerFunc)
	Admin(method, path string, minRole string, h http.HandlerFunc)
}

// Handlers 订单模块 HTTP 处理器。
type Handlers struct {
	deps Deps

	linkMu   sync.Mutex
	linkSent map[string]int64
}

func NewHandlers(deps Deps) *Handlers {
	return &Handlers{deps: deps, linkSent: make(map[string]int64)}
}

// Register 注册订单模块路由。
func Register(reg Registrar, h *Handlers) {
	reg.Public("POST", "/api/v1/orders", 20, h.CreateOrder)
	reg.Public("GET", "/api/v1/orders", 20, h.OrdersByContact)
	reg.Public("GET", "/api/v1/orders/{orderNo}", 300, h.Order)
	reg.Public("POST", "/api/v1/orders/{orderNo}/cancel", 10, h.CancelOrder)
	reg.Public("POST", "/api/v1/orders/links", 10, h.SendOrderLinks)

	reg.Admin("GET", "/api/v1/admin/orders", "viewer", h.AdminOrders)
	reg.Admin("GET", "/api/v1/admin/orders/export", "viewer", h.AdminOrdersExport)
	reg.Admin("GET", "/api/v1/admin/orders/{id}", "viewer", h.AdminOrder)
	reg.Admin("POST", "/api/v1/admin/orders/{id}/expire", "operator", h.AdminOrderExpire)
	reg.Admin("POST", "/api/v1/admin/orders/{id}/cancel", "operator", h.AdminOrderCancel)
	reg.Admin("POST", "/api/v1/admin/orders/{id}/status", "operator", h.AdminOrderSetStatus)
	reg.Admin("POST", "/api/v1/admin/orders/{id}/resend", "operator", h.AdminOrderResend)
	reg.Admin("POST", "/api/v1/admin/orders/batch-resend", "operator", h.AdminOrdersBatchResend)
	reg.Admin("POST", "/api/v1/admin/orders/{id}/redeliver", "operator", h.AdminOrderRedeliver)
	reg.Admin("POST", "/api/v1/admin/orders/{id}/deliver", "operator", h.AdminOrderDeliver)
}
