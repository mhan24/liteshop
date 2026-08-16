package application

import "shop/internal/modules/coupon/domain"

// CouponStore 优惠券数据访问端口。
type CouponStore interface {
	GetCouponByCode(code string) (domain.Coupon, error)
	GetCouponIDByCode(code string) (int64, error)
	ApplyCoupon(code string, amountCents int64, productID int64) (int64, error)
	UseCoupon(couponID int64, orderNo string, discountCents int64) error
	RefundByOrderNo(orderNo string) (bool, error)
	ListCoupons() ([]domain.Coupon, error)
	CreateCoupon(c domain.Coupon) error
	UpdateCoupon(c domain.Coupon) error
	DeleteCoupon(id int64) error
}
