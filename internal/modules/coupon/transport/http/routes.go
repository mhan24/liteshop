package http

import (
	"net/http"

	couponapp "shop/internal/modules/coupon/application"
	"shop/internal/shared/value"
)

// Deps 优惠券模块 HTTP 处理器依赖。
type Deps struct {
	Coupons *couponapp.CouponService
	Audit   func(r *http.Request, action, targetType, targetID, before, after string)
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
	reg.Admin("GET", "/api/v1/admin/coupons", "operator", h.AdminCoupons)
	reg.Admin("POST", "/api/v1/admin/coupons", "operator", h.AdminCouponCreate)
	reg.Admin("POST", "/api/v1/admin/coupons/{id}/edit", "operator", h.AdminCouponUpdate)
	reg.Admin("POST", "/api/v1/admin/coupons/{id}/delete", "operator", h.AdminCouponDelete)
}
