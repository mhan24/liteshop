package sqlite

import (
	"database/sql"
	"testing"

	coupondomain "shop/internal/modules/coupon/domain"
	db "shop/internal/platform/database/sqlite"
	"shop/internal/shared/clock"
)

func openCouponRepo(t *testing.T) (*CouponRepository, *sql.DB) {
	t.Helper()
	d, err := db.Open(t.TempDir() + "/coupon.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return NewCouponRepository(d), d
}

func seedCoupon(t *testing.T, repo *CouponRepository, c coupondomain.Coupon) int64 {
	t.Helper()
	if err := repo.CreateCoupon(c); err != nil {
		t.Fatalf("create coupon %s: %v", c.Code, err)
	}
	id, err := repo.GetCouponIDByCode(c.Code)
	if err != nil {
		t.Fatalf("get coupon id: %v", err)
	}
	return id
}

// TestApplyCouponPercentAndCap 百分比抵扣：按订单金额计算，且不超订单金额。
func TestApplyCouponPercentAndCap(t *testing.T) {
	repo, _ := openCouponRepo(t)
	seedCoupon(t, repo, coupondomain.Coupon{Code: "P50", Type: "percent", Percent: 50, Active: true})
	seedCoupon(t, repo, coupondomain.Coupon{Code: "P100", Type: "percent", Percent: 100, Active: true})

	if got, err := repo.ApplyCoupon("P50", 10000, 0); err != nil || got != 5000 {
		t.Fatalf("P50 discount = %d (%v), want 5000", got, err)
	}
	if got, err := repo.ApplyCoupon("P100", 100, 0); err != nil || got != 100 {
		t.Fatalf("P100 discount = %d (%v), want 100 (cap)", got, err)
	}
}

// TestApplyCouponRules 固定金额/最低金额/商品限制/无效抵扣。
func TestApplyCouponRules(t *testing.T) {
	repo, _ := openCouponRepo(t)
	seedCoupon(t, repo, coupondomain.Coupon{Code: "FIX", Type: "fixed", ValueCents: 300, MinAmountCents: 500, ProductID: 7, Active: true})

	if got, err := repo.ApplyCoupon("FIX", 1000, 7); err != nil || got != 300 {
		t.Fatalf("fixed discount = %d (%v), want 300", got, err)
	}
	if _, err := repo.ApplyCoupon("FIX", 300, 7); err != coupondomain.ErrCouponNotApplicable {
		t.Fatalf("min amount: err = %v, want ErrCouponNotApplicable", err)
	}
	if _, err := repo.ApplyCoupon("FIX", 1000, 8); err != coupondomain.ErrCouponNotApplicable {
		t.Fatalf("product mismatch: err = %v, want ErrCouponNotApplicable", err)
	}
}

// TestCouponLifecycleStatus 停用/过期/用量用尽分别映射业务错误。
func TestCouponLifecycleStatus(t *testing.T) {
	repo, _ := openCouponRepo(t)
	now := clock.Now()
	seedCoupon(t, repo, coupondomain.Coupon{Code: "OFF", Type: "fixed", ValueCents: 100, Active: false})
	seedCoupon(t, repo, coupondomain.Coupon{Code: "EXP", Type: "fixed", ValueCents: 100, Active: true, ExpiresAt: 1})
	seedCoupon(t, repo, coupondomain.Coupon{Code: "USED", Type: "fixed", ValueCents: 100, MaxUses: 1, Active: true})
	seedCoupon(t, repo, coupondomain.Coupon{Code: "OK", Type: "fixed", ValueCents: 100, Active: true, ExpiresAt: now + 3600})

	if _, err := repo.ApplyCoupon("OFF", 1000, 0); err != coupondomain.ErrCouponNotFound {
		t.Fatalf("inactive: err = %v, want ErrCouponNotFound", err)
	}
	if _, err := repo.ApplyCoupon("EXP", 1000, 0); err != coupondomain.ErrCouponExpired {
		t.Fatalf("expired: err = %v, want ErrCouponExpired", err)
	}
	if _, err := repo.ApplyCoupon("OK", 1000, 0); err != nil {
		t.Fatalf("active coupon should apply: %v", err)
	}
	if _, err := repo.ApplyCoupon("USED", 1000, 0); err != nil {
		t.Fatalf("coupon with remaining uses should apply: %v", err)
	}
}

// TestUseAndRefundCoupon 用量递增、上限拦截、退款回滚且幂等。
func TestUseAndRefundCoupon(t *testing.T) {
	repo, _ := openCouponRepo(t)
	id := seedCoupon(t, repo, coupondomain.Coupon{Code: "LIMIT", Type: "fixed", ValueCents: 100, MaxUses: 1, Active: true})

	if err := repo.UseCoupon(id, "ORDER-1", 100); err != nil {
		t.Fatalf("first use: %v", err)
	}
	if err := repo.UseCoupon(id, "ORDER-2", 100); err != coupondomain.ErrCouponUsedUp {
		t.Fatalf("over limit: err = %v, want ErrCouponUsedUp", err)
	}
	refunded, err := repo.RefundByOrderNo("ORDER-1")
	if err != nil || !refunded {
		t.Fatalf("refund = %v (%v), want true", refunded, err)
	}
	if again, _ := repo.RefundByOrderNo("ORDER-1"); again {
		t.Fatal("second refund should be idempotent noop")
	}
	var used int
	_ = repo.db.QueryRow(`SELECT used_count FROM coupons WHERE id = ?`, id).Scan(&used)
	if used != 0 {
		t.Fatalf("used_count after refund = %d, want 0", used)
	}
	// 退款后可再次使用
	if err := repo.UseCoupon(id, "ORDER-3", 100); err != nil {
		t.Fatalf("use after refund: %v", err)
	}
}

// TestCreateCouponDuplicateCode 重复券码被数据库唯一约束拒绝。
func TestCreateCouponDuplicateCode(t *testing.T) {
	repo, _ := openCouponRepo(t)
	seedCoupon(t, repo, coupondomain.Coupon{Code: "DUP", Type: "fixed", ValueCents: 100, Active: true})
	if err := repo.CreateCoupon(coupondomain.Coupon{Code: "DUP", Type: "fixed", ValueCents: 200, Active: true}); err == nil {
		t.Fatal("duplicate coupon code should fail")
	}
}
