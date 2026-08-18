package application

import (
	"fmt"
	models "shop/internal/modules/order/domain"
	"shop/internal/shared/clock"
)

// ExpireStale 清理长时间停留 created / waiting_payment 的订单（释放卡密并回滚优惠券）。
// 用作进程崩溃/异常中断后的补偿清理。返回处理的订单数。
func (s *OrderService) ExpireStale(timeoutSec int) (int, error) {
	if timeoutSec <= 0 {
		timeoutSec = 3600
	}
	cutoff := clock.Now() - int64(timeoutSec)
	orders, err := s.repo.ListOrders(
		`status IN ('created','waiting_payment') AND created_at < ?`,
		[]any{cutoff}, 100,
	)
	if err != nil {
		return 0, err
	}
	expired := 0
	var firstErr error
	for _, o := range orders {
		if err := s.ExpireWithGateway(o.ID); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		expired++
	}
	return expired, firstErr
}

// Expire 过期订单（释放卡密）。
func (s *OrderService) Expire(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if _, changed, err := s.repo.ExpireOrder(orderID); err != nil {
		return err
	} else if !changed {
		return fmt.Errorf("invalid order state for expire: %s", o.Status)
	}
	_ = s.repo.AddLog(orderID, "expired", "订单已过期", o.Status, models.OrderExpired, 0)
	s.publish(OrderExpiredEvent{OrderID: orderID, OrderNo: o.OrderNo})
	return nil
}

// ExpireWithGateway 过期订单并同步关闭支付交易。
func (s *OrderService) ExpireWithGateway(orderID int64) error {
	if err := s.cancelGatewayTx(orderID); err != nil {
		return err
	}
	return s.Expire(orderID)
}
