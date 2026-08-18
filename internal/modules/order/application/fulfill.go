package application

import (
	"context"
	"shop/internal/modules/order/domain"
	models "shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
	"shop/internal/shared/clock"

	"errors"
	"fmt"
	inventorydomain "shop/internal/modules/inventory/domain"
	"strings"
)

// MarkPaidAndDeliver 处理支付成功回调：置为 paid 并发卡。
// gateway 由回调路径决定（bepusdt / hashpay），用于幂等台账前缀。
// 返回订单、卡密、是否发生变更。
func (s *OrderService) MarkPaidAndDeliver(orderNo, gateway, tradeID, blockTx string) (models.Order, []inventorydomain.Card, bool, error) {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return models.Order{}, nil, false, err
	}
	switch o.Status {
	case models.OrderPaid, models.OrderProcessing, models.OrderPendingDelivery, models.OrderDelivered, models.OrderCompleted:
		if s.inventory == nil {
			return o, nil, false, fmt.Errorf("库存服务未注入")
		}
		cards, err := s.inventory.CardsForOrder(context.Background(), o.ID)
		return o, cards, false, err
	case models.OrderWaitingPayment:
		// 继续
	default:
		return o, nil, false, nil
	}
	now := clock.Now()
	// 人工手动交付：支付成功只确认支付，进入"待发货"，由管理员手动发货。
	if o.DeliveryType == productdomain.DeliveryTypeManual {
		if err := s.repo.MarkPaidPendingDelivery(o.ID, gateway, tradeID, blockTx, now); err != nil {
			if errors.Is(err, models.ErrAlreadyProcessed) {
				return o, nil, false, nil
			}
			return o, nil, false, err
		}
		o.Status = models.OrderPendingDelivery
		o.TradeID = tradeID
		o.BlockTransactionID = blockTx
		o.PaidAt = now
		_ = s.repo.AddLog(o.ID, "payment_success", "支付成功，等待人工发货", models.OrderWaitingPayment, models.OrderPendingDelivery, 0)
		return o, nil, true, nil
	}
	delivered, err := s.repo.MarkPaidAndDeliver(o.ID, gateway, tradeID, blockTx, now)
	if errors.Is(err, models.ErrAlreadyProcessed) {
		// 幂等：该网关交易已处理过，直接返回 noop。
		return o, nil, false, nil
	}
	if err != nil {
		return o, nil, false, err
	}
	o.Status = models.OrderPaid
	o.TradeID = tradeID
	o.BlockTransactionID = blockTx
	o.PaidAt = now
	_ = s.repo.AddLog(o.ID, "payment_success", "支付成功", models.OrderWaitingPayment, models.OrderPaid, 0)
	if s.inventory == nil {
		return o, nil, false, fmt.Errorf("库存服务未注入")
	}
	cards, err := s.inventory.CardsForOrder(context.Background(), o.ID)
	if err != nil {
		return o, nil, false, err
	}
	if delivered == 0 || len(cards) == 0 {
		if err := s.repo.SetOrderStatusFrom(o.ID, models.OrderPaid, models.OrderDeliveryFailed); err != nil {
			// 状态落库失败需要让调用方感知，避免"已扣款但状态未知"。
			return o, nil, false, err
		}
		_ = s.repo.AddLog(o.ID, "delivery_failed", "发卡失败：无可用卡密", models.OrderPaid, models.OrderDeliveryFailed, 0)
		s.fireDeliveryFailed(o, "无可用卡密")
		return o, nil, false, models.ErrNoCards
	}
	if err := s.repo.SetOrderStatusFrom(o.ID, models.OrderPaid, models.OrderDelivered); err != nil {
		return o, cards, false, err
	}
	if err := s.repo.EnqueueDeliveredEvent(o.ID); err != nil {
		return o, cards, false, err
	}
	_ = s.repo.AddLog(o.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)
	// OrderPaid/OrderDelivered 事件已由支付事务写入 outbox，由 outbox worker 发布。
	return o, cards, true, nil
}

// ManualDeliver 管理员人工发货：填写发货内容并置为已发货，通知买家。
func (s *OrderService) ManualDeliver(orderID int64, content string) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if o.Status != models.OrderPendingDelivery {
		return fmt.Errorf("订单状态 %s 不允许人工发货", o.Status)
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return fmt.Errorf("发货内容不能为空")
	}
	ok, err := s.repo.SetManualDelivery(orderID, content)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("订单状态已变化，请刷新后重试")
	}
	o.Status = models.OrderDelivered
	o.DeliveryContent = content
	_ = s.repo.AddLog(orderID, "delivered", "管理员人工发货", models.OrderPendingDelivery, models.OrderDelivered, 0)
	return nil
}

func resendableStatus(status domain.Status) bool {
	switch status {
	case models.OrderPaid, models.OrderProcessing, models.OrderPendingDelivery, models.OrderDelivered, models.OrderCompleted, models.OrderDeliveryFailed:
		return true
	}
	return false
}

// Resend 重发单个订单的发卡通知。
func (s *OrderService) Resend(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if !resendableStatus(o.Status) {
		return nil
	}
	// 人工手动交付：重发人工填写的发货内容。
	if o.DeliveryType == productdomain.DeliveryTypeManual {
		if o.DeliveryContent == "" {
			return nil
		}
		if s.SendPaid != nil {
			go s.SendPaid(o, nil)
		}
		_ = s.repo.AddLog(o.ID, "resend", "管理员重新发送人工发货内容", o.Status, o.Status, 0)
		return nil
	}
	if s.inventory == nil {
		return fmt.Errorf("库存服务未注入")
	}
	cards, err := s.inventory.CardsForOrder(context.Background(), o.ID)
	if err != nil {
		return err
	}
	if len(cards) == 0 {
		return nil
	}
	if s.SendPaid != nil {
		go s.SendPaid(o, cards)
	}
	_ = s.repo.AddLog(o.ID, "resend", "管理员重新发送卡密", o.Status, o.Status, 0)
	return nil
}

// BatchResend 批量重发（已支付且有卡密的订单）。
func (s *OrderService) BatchResend(ids []int64) (int, error) {
	sent := 0
	if s.inventory == nil {
		return 0, fmt.Errorf("库存服务未注入")
	}
	for _, id := range ids {
		o, err := s.repo.GetOrderByID(id)
		if err != nil {
			continue
		}
		if !resendableStatus(o.Status) {
			continue
		}
		if o.DeliveryType == productdomain.DeliveryTypeManual {
			if o.DeliveryContent == "" {
				continue
			}
			if s.SendPaid != nil {
				go s.SendPaid(o, nil)
			}
			_ = s.repo.AddLog(o.ID, "resend", "批量重发人工发货内容", o.Status, o.Status, 0)
			sent++
			continue
		}
		cards, err := s.inventory.CardsForOrder(context.Background(), o.ID)
		if err != nil {
			return sent, err
		}
		if len(cards) == 0 {
			continue
		}
		if s.SendPaid != nil {
			go s.SendPaid(o, cards)
		}
		_ = s.repo.AddLog(o.ID, "resend", "批量重发卡密", o.Status, o.Status, 0)
		sent++
	}
	return sent, nil
}

// Redeliver 补发卡密（发卡失败订单）。
func (s *OrderService) Redeliver(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	switch o.Status {
	case models.OrderPaid, models.OrderProcessing, models.OrderDeliveryFailed,
		models.OrderDelivered, models.OrderCompleted:
		// 允许补发/确认
	default:
		return fmt.Errorf("订单状态 %s 不允许补发卡密", o.Status)
	}
	if o.DeliveryType == productdomain.DeliveryTypeManual {
		return fmt.Errorf("人工交付订单不能补发卡密")
	}
	if s.inventory == nil {
		return fmt.Errorf("库存服务未注入")
	}
	cards, err := s.inventory.CardsForOrder(context.Background(), o.ID)
	if err != nil {
		return err
	}
	if len(cards) > 0 {
		if o.Status != models.OrderDelivered && o.Status != models.OrderCompleted {
			if err := s.repo.SetOrderStatusFrom(o.ID, o.Status, models.OrderDelivered); err != nil {
				return err
			}
			if err := s.repo.EnqueueDeliveredEvent(o.ID); err != nil {
				return err
			}
			_ = s.repo.AddLog(o.ID, "delivered", "管理员手动确认发卡", o.Status, models.OrderDelivered, 0)
		}
		if s.SendPaid != nil {
			go s.SendPaid(o, cards)
		}
		return nil
	}
	// 无预留卡密：从同商品库存补扣
	if s.inventory == nil {
		return fmt.Errorf("库存服务未注入")
	}
	if o.ProductID <= 0 {
		return fmt.Errorf("订单缺少商品信息")
	}
	// 幂等释放旧锁定，避免残留 reserved_order 造成库存超扣/孤儿锁定
	if err := s.inventory.ReleaseReservation(context.Background(), o.ID); err != nil {
		return err
	}
	err = s.inventory.ReserveFromStock(context.Background(), o.ID, o.ProductID, o.Qty)
	if err != nil {
		return err
	}
	if _, err := s.inventory.ConfirmReservation(context.Background(), o.ID); err != nil {
		return err
	}

	cards, err = s.inventory.CardsForOrder(context.Background(), o.ID)
	if err != nil {
		return err
	}
	if err := s.repo.SetOrderStatusFrom(o.ID, o.Status, models.OrderDelivered); err != nil {
		return err
	}
	if err := s.repo.EnqueueDeliveredEvent(o.ID); err != nil {
		return err
	}
	_ = s.repo.AddLog(o.ID, "delivered", "管理员补发卡密", o.Status, models.OrderDelivered, 0)
	if s.SendPaid != nil {
		go s.SendPaid(o, cards)
	}
	return nil
}
