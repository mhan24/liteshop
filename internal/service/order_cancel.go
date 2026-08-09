package service

import (
	"fmt"

	"shop/internal/models"
)

// ExpireStale 清理长时间停留 created / waiting_payment 的订单（释放卡密并回滚优惠券）。
// 用作进程崩溃/异常中断后的补偿清理。返回处理的订单数。
func (s *OrderService) ExpireStale(timeoutSec int) (int, error) {
	if timeoutSec <= 0 {
		timeoutSec = 3600
	}
	cutoff := models.Now() - int64(timeoutSec)
	orders, err := s.repo.ListOrders(
		`status IN ('created','waiting_payment') AND created_at < ?`,
		[]any{cutoff}, 100,
	)
	if err != nil {
		return 0, err
	}
	expired := 0
	for _, o := range orders {
		if err := s.Expire(o.ID); err != nil {
			continue
		}
		expired++
	}
	return expired, nil
}

// Cancel 取消订单（释放卡密）。
func (s *OrderService) Cancel(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil {
		return err
	}
	if _, changed, err := s.repo.CancelOrder(orderID); err != nil {
		return err
	} else if !changed {
		return fmt.Errorf("invalid order state for cancel: %s", o.Status)
	}
	_ = s.repo.AddLog(orderID, "cancelled", "订单已取消", o.Status, models.OrderCancelled, 0)
	return nil
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
	return nil
}

// CancelWithGateway 取消订单并同步关闭支付交易（失败不阻塞本地取消）。
func (s *OrderService) CancelWithGateway(orderID int64) error {
	s.cancelGatewayTx(orderID)
	return s.Cancel(orderID)
}

// ExpireWithGateway 过期订单并同步关闭支付交易。
func (s *OrderService) ExpireWithGateway(orderID int64) error {
	s.cancelGatewayTx(orderID)
	return s.Expire(orderID)
}

// HandleGatewayCancel 处理网关侧取消回调（BEpusdt status=3）。
func (s *OrderService) HandleGatewayCancel(orderNo string) {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return
	}
	s.cancelGatewayTx(o.ID)
	_ = s.Expire(o.ID)
}

func (s *OrderService) cancelGatewayTx(orderID int64) {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil || o.TradeID == "" {
		return
	}
	go func(tradeID string) {
		_ = s.payFn().CancelTransaction(tradeID)
	}(o.TradeID)
}
