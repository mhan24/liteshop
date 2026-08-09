package service

import "shop/internal/models"

// ---- 优惠券 ----

func (s *OrderService) ListCoupons() ([]models.Coupon, error) {
	return s.repo.ListCoupons()
}

func (s *OrderService) CreateCoupon(c models.Coupon) error {
	return s.repo.CreateCoupon(c)
}

func (s *OrderService) UpdateCoupon(c models.Coupon) error {
	return s.repo.UpdateCoupon(c)
}

func (s *OrderService) DeleteCoupon(id int64) error {
	return s.repo.DeleteCoupon(id)
}
