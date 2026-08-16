package application

import "shop/internal/modules/coupon/domain"

// CouponService 优惠券业务逻辑。
type CouponService struct {
	store CouponStore
}

func NewCouponService(store CouponStore) *CouponService {
	return &CouponService{store: store}
}

func (s *CouponService) ListCoupons() ([]domain.Coupon, error) {
	return s.store.ListCoupons()
}

func (s *CouponService) CreateCoupon(c domain.Coupon) error {
	return s.store.CreateCoupon(c)
}

func (s *CouponService) UpdateCoupon(c domain.Coupon) error {
	return s.store.UpdateCoupon(c)
}

func (s *CouponService) DeleteCoupon(id int64) error {
	return s.store.DeleteCoupon(id)
}
