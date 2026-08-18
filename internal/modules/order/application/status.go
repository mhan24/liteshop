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
		return s.CancelWithGateway(orderID)
	case models.OrderExpired:
		return s.ExpireWithGateway(orderID)
	}
	switch to {
	case models.OrderPaid, models.OrderPendingDelivery, models.OrderDelivered, models.OrderPaymentFailed:
		// 支付确认、人工发货、补发和支付失败都必须经过专用流程，
		// 不能由通用状态接口绕过网关/库存/通知事务。
		if o.Status == models.OrderDeliveryFailed && to == models.OrderDelivered {
			return s.Redeliver(orderID)
		}
		return fmt.Errorf("状态 %s 必须通过专用业务流程修改", to)
	}
	// 发卡失败订单的"确认已发"应走补发流程（校验卡密）。
	if !models.IsValidOrderTransition(o.Status, to) {
		return fmt.Errorf("invalid order transition %s -> %s", o.Status, to)
	}
	if err := s.repo.SetOrderStatusFrom(orderID, o.Status, to); err != nil {
		return err
	}
	_ = s.repo.AddLog(orderID, "status_changed", message, o.Status, to, 0)
	return nil
}
