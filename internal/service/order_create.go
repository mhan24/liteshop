package service

import (
	"errors"
	"fmt"
	"strings"

	"shop/internal/models"
	"shop/internal/payment"
)

// CreateOrder 创建订单并生成支付交易。
// 支持批发价（阶梯折扣）与优惠券（couponCode 可空）。
// 返回订单号、支付地址、优惠券抵扣金额（分）、优惠券 ID（0=未用）、错误。
func (s *OrderService) CreateOrder(p models.Product, qty int, contact, tradeType, couponCode string) (string, string, int64, int64, error) {
	if qty <= 0 {
		qty = 1
	}
	// 批发价：按数量匹配最高档折扣
	baseCents := p.PriceCents
	if p.MinQty < 1 {
		p.MinQty = 1
	}
	if qty < p.MinQty {
		return "", "", 0, 0, newBusinessErrorf("最少购买 %d 件", p.MinQty)
	}
	if p.MaxQty > 0 && qty > p.MaxQty {
		return "", "", 0, 0, newBusinessErrorf("最多购买 %d 件", p.MaxQty)
	}
	amountCents := baseCents * int64(qty)
	bestMinQty := 0
	bestDiscount := 100 // 默认无折扣
	for _, tier := range p.Wholesale {
		if tier.MinQty < 1 || tier.Discount < 1 || tier.Discount > 100 {
			continue
		}
		if qty >= tier.MinQty && tier.MinQty > bestMinQty {
			bestMinQty = int(tier.MinQty)
			bestDiscount = int(tier.Discount)
		}
	}
	if bestDiscount != 100 {
		amountCents = baseCents * int64(qty) * int64(bestDiscount) / 100
	}
	// 优惠券
	// 券码统一大写（创建时已大写存储），避免大小写不匹配。
	couponCode = strings.ToUpper(strings.TrimSpace(couponCode))
	discount := int64(0)
	couponID := int64(0)
	if couponCode != "" {
		var cidErr error
		couponID, cidErr = s.repo.GetCouponIDByCode(couponCode)
		if cidErr != nil {
			return "", "", 0, 0, wrapCouponError(cidErr)
		}
		d, err := s.repo.ApplyCoupon(couponCode, amountCents, p.ID)
		if err != nil {
			return "", "", 0, 0, wrapCouponError(err)
		}
		discount = d
		amountCents -= discount
		// 100% 折扣券（或等额固定券）抵扣后金额为 0，走"零金额直接完成"路径。
		if amountCents < 0 {
			amountCents = 0
		}
	}
	now := models.Now()
	order := models.Order{
		OrderNo:            models.NewOrderNo(),
		ProductID:          p.ID,
		ProductName:        p.Name,
		Qty:                qty,
		AmountCents:        amountCents,
		CostCents:          p.CostCents,
		CostSnapshotSource: "order_time",
		Fiat:               s.cfg().Fiat,
		TradeType:          tradeType,
		BuyerContact:       contact,
		ViewToken:          models.RandomToken(24),
		Status:             models.OrderCreated,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := s.repo.CreatePendingOrder(&order); err != nil {
		var insufficient *models.InsufficientError
		if errors.As(err, &insufficient) {
			return "", "", 0, 0, newBusinessErrorf("库存不足，请刷新后重试")
		}
		return "", "", 0, 0, err
	}
	_ = s.repo.AddLog(order.ID, "order_created", "订单已创建", "", models.OrderCreated, 0)
	if discount > 0 {
		if err := s.repo.UseCoupon(couponID, order.OrderNo, discount); err != nil {
			// 原子：订单失败 + 释放卡密（单事务），不残留锁定库存。
			_ = s.repo.MarkPaymentFailed(order.ID)
			_ = s.repo.AddLog(order.ID, "coupon_failed", "优惠券占用失败: "+err.Error(), models.OrderCreated, models.OrderPaymentFailed, 0)
			return order.OrderNo, "", 0, 0, wrapCouponError(err)
		}
		_ = s.repo.AddLog(order.ID, "coupon_used", fmt.Sprintf("优惠券抵扣 %d 分", discount), "", models.OrderCreated, 0)
	}
	// 零金额订单：跳过支付，直接置为已支付并发卡。
	if order.AmountCents == 0 {
		return s.completeFreeOrder(order, discount, couponID)
	}
	cfg := s.cfg()
	// 订单页凭查看令牌访问（不再把买家邮箱放进跳转 URL）。
	redirectURL := cfg.PublicBaseURL + "/order/" + order.OrderNo + "?token=" + order.ViewToken
	paymentURL, tradeID, err := s.payFn().CreateTransaction(payment.CreateInput{
		OrderID:     order.OrderNo,
		Amount:      float64(order.AmountCents) / 100,
		Fiat:        cfg.Fiat,
		TradeType:   tradeType,
		Name:        p.Name,
		NotifyURL:   cfg.NotifyURL,
		RedirectURL: redirectURL,
		TimeoutSec:  cfg.TimeoutSec,
	})
	if err != nil {
		// 原子：订单失败 + 释放卡密（单事务），避免每次建单失败泄漏库存。
		_ = s.repo.MarkPaymentFailed(order.ID)
		_ = s.repo.AddLog(order.ID, "payment_failed", "创建支付交易失败: "+err.Error(), models.OrderCreated, models.OrderPaymentFailed, 0)
		// 回滚优惠券用量（支付失败，券不应被消耗）
		if discount > 0 {
			if refunded, err := s.repo.RefundByOrderNo(order.OrderNo); err != nil {
				_ = s.repo.AddLog(order.ID, "coupon_refund_failed", "优惠券回滚失败: "+err.Error(), models.OrderPaymentFailed, models.OrderPaymentFailed, 0)
			} else if !refunded {
				_ = s.repo.AddLog(order.ID, "coupon_refund_missing", "支付失败但未找到优惠券使用记录", models.OrderPaymentFailed, models.OrderPaymentFailed, 0)
			}
		}
		return order.OrderNo, "", discount, couponID, err
	}
	_ = s.repo.SetTradeInfo(order.ID, tradeID, paymentURL)
	_ = s.repo.SetOrderStatus(order.ID, models.OrderWaitingPayment)
	_ = s.repo.AddLog(order.ID, "transaction_created", "支付交易已创建", models.OrderCreated, models.OrderWaitingPayment, 0)
	s.fireCreatedEvents(order)
	return order.OrderNo, paymentURL, discount, couponID, nil
}

// completeFreeOrder 免费订单（100% 折扣）直接完成并发卡。
func (s *OrderService) completeFreeOrder(order models.Order, discount, couponID int64) (string, string, int64, int64, error) {
	now := models.Now()
	delivered, err := s.repo.CompleteFreeOrder(order.ID, now)
	if err != nil {
		return order.OrderNo, "", 0, 0, err
	}
	order.Status = models.OrderPaid
	order.PaidAt = now
	_ = s.repo.AddLog(order.ID, "payment_success", "免费订单（100% 折扣）直接完成", models.OrderCreated, models.OrderPaid, 0)
	cards, _ := s.repo.GetOrderCards(order.ID)
	if delivered == 0 || len(cards) == 0 {
		_ = s.repo.SetOrderStatus(order.ID, models.OrderDeliveryFailed)
		_ = s.repo.AddLog(order.ID, "delivery_failed", "发卡失败：无可用卡密", models.OrderPaid, models.OrderDeliveryFailed, 0)
		return order.OrderNo, "", discount, couponID, ErrNoCards
	}
	_ = s.repo.SetOrderStatus(order.ID, models.OrderDelivered)
	_ = s.repo.AddLog(order.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)
	if s.SendPaid != nil {
		go s.SendPaid(order, cards)
	}
	s.fireCreatedEvents(order)
	return order.OrderNo, "", discount, couponID, nil
}
