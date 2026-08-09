package service

import (
	"errors"
	"fmt"

	"shop/internal/models"
)

// MarkPaidAndDeliver 处理支付成功回调：置为 paid 并发卡。
// 返回订单、卡密、是否发生变更。
func (s *OrderService) MarkPaidAndDeliver(orderNo, tradeID, blockTx string) (models.Order, []models.Card, bool, error) {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return models.Order{}, nil, false, err
	}
	switch o.Status {
	case models.OrderPaid, models.OrderProcessing, models.OrderDelivered, models.OrderCompleted:
		cards, _ := s.repo.GetOrderCards(o.ID)
		return o, cards, false, nil
	case models.OrderWaitingPayment:
		// 继续
	default:
		return o, nil, false, nil
	}
	now := models.Now()
	delivered, err := s.repo.MarkPaidAndDeliver(o.ID, tradeID, blockTx, now)
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
	cards, _ := s.repo.GetOrderCards(o.ID)
	if delivered == 0 || len(cards) == 0 {
		_ = s.repo.SetOrderStatus(o.ID, models.OrderDeliveryFailed)
		_ = s.repo.AddLog(o.ID, "delivery_failed", "发卡失败：无可用卡密", models.OrderPaid, models.OrderDeliveryFailed, 0)
		s.fireDeliveryFailed(o, "无可用卡密")
		return o, nil, false, ErrNoCards
	}
	_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
	_ = s.repo.AddLog(o.ID, "delivered", "卡密已发放", models.OrderPaid, models.OrderDelivered, 0)
	// 发卡邮件统一由 OrderPaidEvent 处理器发送（事件消费异步，不阻塞回调）。
	s.fireOrderEvents(o, cards)
	return o, cards, true, nil
}

func resendableStatus(status string) bool {
	switch status {
	case models.OrderPaid, models.OrderProcessing, models.OrderDelivered, models.OrderCompleted, models.OrderDeliveryFailed:
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
	cards, _ := s.repo.GetOrderCards(o.ID)
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
	for _, id := range ids {
		o, err := s.repo.GetOrderByID(id)
		if err != nil || !resendableStatus(o.Status) {
			continue
		}
		cards, _ := s.repo.GetOrderCards(o.ID)
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
	cards, _ := s.repo.GetOrderCards(o.ID)
	if len(cards) > 0 {
		if o.Status != models.OrderDelivered && o.Status != models.OrderCompleted {
			_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
			_ = s.repo.AddLog(o.ID, "delivered", "管理员手动确认发卡", o.Status, models.OrderDelivered, 0)
		}
		if s.SendPaid != nil {
			go s.SendPaid(o, cards)
		}
		return nil
	}
	// 无预留卡密：从同商品库存补扣
	if o.ProductID <= 0 {
		return fmt.Errorf("订单缺少商品信息")
	}
	// 幂等释放旧锁定，避免残留 reserved_order 造成库存超扣/孤儿锁定
	_ = s.repo.ReleaseLockedCards(o.ID)
	affected, err := s.repo.ReserveCardsFromStock(o.ProductID, o.Qty, o.ID)
	if err != nil {
		return err
	}
	if affected != o.Qty {
		return fmt.Errorf("可用卡密不足，无法补发")
	}
	// 将新锁定的卡密真正售出
	if err := s.repo.DeliverCards(o.ID); err != nil {
		return err
	}
	cards, _ = s.repo.GetOrderCards(o.ID)
	_ = s.repo.SetOrderStatus(o.ID, models.OrderDelivered)
	_ = s.repo.AddLog(o.ID, "delivered", "管理员补发卡密", o.Status, models.OrderDelivered, 0)
	if s.SendPaid != nil {
		go s.SendPaid(o, cards)
	}
	return nil
}
