// Package domain 优惠券领域模型。
package domain

import "errors"

// Coupon 优惠券。
type Coupon struct {
	ID             int64
	Code           string
	Type           string
	ValueCents     int64
	Percent        int
	MinAmountCents int64
	MaxUses        int
	UsedCount      int
	ProductID      int64
	Active         bool
	ExpiresAt      int64
	CreatedAt      int64
}

var (
	ErrCouponNotFound      = errors.New("优惠券不存在或已停用")
	ErrCouponExpired       = errors.New("优惠券已过期")
	ErrCouponUsedUp        = errors.New("优惠券使用次数已用完")
	ErrCouponNotApplicable = errors.New("优惠券不适用于该商品或金额不足")
	ErrCouponExists        = errors.New("coupon code already exists")
)
