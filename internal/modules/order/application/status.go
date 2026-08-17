package application

import (
	"fmt"
	"shop/internal/modules/order/domain"
	models "shop/internal/modules/order/domain"
)

// SetStatus 手动修改订单状态（必须在状态机合法迁移内）。
func (s *OrderService) SetStatus(orderID int64, to domain.Status, message string) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if o.Status == to {
		return nil
	}
	// 取消/过期必须走原子流程（释放卡密 + 回滚优惠券），不能直接改状态。
	switch to {
	case models.OrderCancelled:
		return s.Cancel(orderID)
	case models.OrderExpired:
		return s.Expire(orderID)
	}
	// 发卡失败订单的"确认已发"应走补发流程（校验卡密）。
	if o.Status == models.OrderDeliveryFailed && to == models.OrderDelivered {
		return s.Redeliver(orderID)
	}
	if !models.IsValidOrderTransition(o.Status, to) {
		return fmt.Errorf("invalid order transition %s -> %s", o.Status, to)
	}
	if err := s.repo.SetOrderStatus(orderID, to); err != nil {
		return err
	}
	_ = s.repo.AddLog(orderID, "status_changed", message, o.Status, to, 0)
	return nil
}
