package integration

import (
	"sync"
	"testing"
	"time"

	coupondomain "shop/internal/modules/coupon/domain"
	couponsqlite "shop/internal/modules/coupon/repository/sqlite"
	fixtures "shop/tests/fixtures"
)

// TestCouponConcurrentUsageLimit 并发使用限次优惠券：恰好 maxUses 次成功。
func TestCouponConcurrentUsageLimit(t *testing.T) {
	d := fixtures.NewTestDB(t)
	repo := couponsqlite.NewCouponRepository(d)
	if err := repo.CreateCoupon(coupondomain.Coupon{
		Code: "LIMIT1", Type: "fixed", ValueCents: 100, MinAmountCents: 0, MaxUses: 3, Active: true,
	}); err != nil {
		t.Fatalf("create coupon: %v", err)
	}
	c, err := repo.GetCouponByCode("LIMIT1")
	if err != nil {
		t.Fatalf("get coupon: %v", err)
	}
	var wg sync.WaitGroup
	ok := make(chan int, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := repo.UseCoupon(c.ID, "ON"+time.Now().Format("150405.000000000"), 100); err == nil {
				ok <- 1
			}
		}()
	}
	wg.Wait()
	close(ok)
	total := 0
	for range ok {
		total++
	}
	if total != 3 {
		t.Fatalf("successful uses = %d, want 3", total)
	}
}

// TestCouponRefundIdempotent 回滚幂等：首次真实回滚，再次为 noop。
func TestCouponRefundIdempotent(t *testing.T) {
	d := fixtures.NewTestDB(t)
	repo := couponsqlite.NewCouponRepository(d)
	if err := repo.CreateCoupon(coupondomain.Coupon{
		Code: "REFUND", Type: "fixed", ValueCents: 100, MinAmountCents: 0, MaxUses: 0, Active: true,
	}); err != nil {
		t.Fatalf("create coupon: %v", err)
	}
	c, _ := repo.GetCouponByCode("REFUND")
	if err := repo.UseCoupon(c.ID, "ORD-R", 100); err != nil {
		t.Fatalf("use: %v", err)
	}
	if refunded, err := repo.RefundByOrderNo("ORD-R"); err != nil || !refunded {
		t.Fatalf("first refund: %v %v", refunded, err)
	}
	if refunded, err := repo.RefundByOrderNo("ORD-R"); err != nil || refunded {
		t.Fatalf("second refund should be noop: %v %v", refunded, err)
	}
	c2, _ := repo.GetCouponByCode("REFUND")
	if c2.UsedCount != 0 {
		t.Fatalf("used after refund = %d, want 0", c2.UsedCount)
	}
}
