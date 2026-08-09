package repository

import (
	"database/sql"

	"shop/internal/models"
)

// 领域错误收敛到 models（service 与 repository 共用）。
var (
	ErrCouponNotFound      = models.ErrCouponNotFound
	ErrCouponExpired       = models.ErrCouponExpired
	ErrCouponUsedUp        = models.ErrCouponUsedUp
	ErrCouponNotApplicable = models.ErrCouponNotApplicable
)

// GetCouponByCode 按券码查询优惠券（含有效期/启用检查）。
func (r *OrderRepository) GetCouponByCode(code string) (models.Coupon, error) {
	var c models.Coupon
	err := r.db.QueryRow(`SELECT id, code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at FROM coupons WHERE code = ?`, code).Scan(&c.ID, &c.Code, &c.Type, &c.ValueCents, &c.Percent, &c.MinAmountCents, &c.MaxUses, &c.UsedCount, &c.ProductID, &c.Active, &c.ExpiresAt, &c.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return c, ErrCouponNotFound
		}
		return c, err
	}
	if !c.Active {
		return c, ErrCouponNotFound
	}
	if c.ExpiresAt > 0 && models.Now() > c.ExpiresAt {
		return c, ErrCouponExpired
	}
	if c.MaxUses > 0 && c.UsedCount >= c.MaxUses {
		return c, ErrCouponUsedUp
	}
	return c, nil
}

// ApplyCoupon 校验并计算优惠券抵扣金额。
// amountCents 为订单原始金额（分），productID 为商品。
// 返回抵扣金额（分）与校验错误。
func (r *OrderRepository) ApplyCoupon(code string, amountCents int64, productID int64) (int64, error) {
	c, err := r.GetCouponByCode(code)
	if err != nil {
		return 0, err
	}
	if c.ProductID != 0 && c.ProductID != productID {
		return 0, ErrCouponNotApplicable
	}
	if amountCents < c.MinAmountCents {
		return 0, ErrCouponNotApplicable
	}
	var discount int64
	switch c.Type {
	case "percent":
		discount = amountCents * int64(c.Percent) / 100
	default: // fixed
		discount = c.ValueCents
	}
	if discount > amountCents {
		discount = amountCents
	}
	if discount <= 0 {
		return 0, ErrCouponNotApplicable
	}
	return discount, nil
}

// UseCoupon 记录一次优惠券使用（券用量 +1，写入使用记录）。
func (r *OrderRepository) UseCoupon(couponID int64, orderNo string, discountCents int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 原子校验 + 递增，防止并发超限
	res, err := tx.Exec(`UPDATE coupons SET used_count = used_count + 1, updated_at = ? WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)`, models.Now(), couponID)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return ErrCouponUsedUp
	}
	if _, err := tx.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, ?, ?, ?)`, couponID, orderNo, discountCents, models.Now()); err != nil {
		return err
	}
	return tx.Commit()
}

// RefundByOrderNo 按订单号回滚优惠券使用（支付失败/取消/过期时调用）。
// 返回是否有实际回滚（幂等：重复调用返回 false）。
func (r *OrderRepository) RefundByOrderNo(orderNo string) (bool, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	refunded, err := refundCouponTx(tx, orderNo)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return refunded, nil
}

// refundCouponTx 在既有事务内回滚优惠券用量并清理使用记录。
func refundCouponTx(tx *sql.Tx, orderNo string) (bool, error) {
	// 找到该订单使用的券
	rows, err := tx.Query(`SELECT coupon_id FROM coupon_usages WHERE order_no = ?`, orderNo)
	if err != nil {
		return false, err
	}
	couponIDs := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, err
		}
		couponIDs = append(couponIDs, id)
	}
	rows.Close()
	if len(couponIDs) == 0 {
		return false, nil // 无使用记录，幂等空操作
	}
	if _, err := tx.Exec(`DELETE FROM coupon_usages WHERE order_no = ?`, orderNo); err != nil {
		return false, err
	}
	for _, cid := range couponIDs {
		if _, err := tx.Exec(`UPDATE coupons SET used_count = used_count - 1 WHERE id = ? AND used_count > 0`, cid); err != nil {
			return false, err
		}
	}
	return true, nil
}

// GetCouponIDByCode 返回券 ID（验券后使用）。
func (r *OrderRepository) GetCouponIDByCode(code string) (int64, error) {
	var id int64
	err := r.db.QueryRow(`SELECT id FROM coupons WHERE code = ?`, code).Scan(&id)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, ErrCouponNotFound
		}
		return 0, err
	}
	return id, nil
}

// ListCoupons 返回全部优惠券。
func (r *OrderRepository) ListCoupons() ([]models.Coupon, error) {
	rows, err := r.db.Query(`SELECT id, code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at FROM coupons ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Coupon
	for rows.Next() {
		var c models.Coupon
		if err := rows.Scan(&c.ID, &c.Code, &c.Type, &c.ValueCents, &c.Percent, &c.MinAmountCents, &c.MaxUses, &c.UsedCount, &c.ProductID, &c.Active, &c.ExpiresAt, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateCoupon 新建优惠券。
func (r *OrderRepository) CreateCoupon(c models.Coupon) error {
	now := models.Now()
	_, err := r.db.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
		c.Code, c.Type, c.ValueCents, c.Percent, c.MinAmountCents, c.MaxUses, c.ProductID, boolInt(c.Active), c.ExpiresAt, now, now)
	return err
}

// UpdateCoupon 更新优惠券。
func (r *OrderRepository) UpdateCoupon(c models.Coupon) error {
	_, err := r.db.Exec(`UPDATE coupons SET type = ?, value_cents = ?, percent = ?, min_amount_cents = ?, max_uses = ?, product_id = ?, active = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
		c.Type, c.ValueCents, c.Percent, c.MinAmountCents, c.MaxUses, c.ProductID, boolInt(c.Active), c.ExpiresAt, models.Now(), c.ID)
	return err
}

// DeleteCoupon 删除优惠券。
func (r *OrderRepository) DeleteCoupon(id int64) error {
	_, err := r.db.Exec(`DELETE FROM coupons WHERE id = ?`, id)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
