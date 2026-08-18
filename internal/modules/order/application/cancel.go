package application

import (
	"errors"
	"fmt"
	models "shop/internal/modules/order/domain"
	"strings"
)

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
	s.publish(OrderCancelledEvent{OrderID: orderID, OrderNo: o.OrderNo})
	return nil
}

// CancelWithGateway 先确认网关侧已关闭/不可支付，再取消本地订单。
func (s *OrderService) CancelWithGateway(orderID int64) error {
	if err := s.cancelGatewayTx(orderID); err != nil {
		return err
	}
	return s.Cancel(orderID)
}

// HandleGatewayCancel 处理网关侧取消回调（BEpusdt status=3）。
func (s *OrderService) HandleGatewayCancel(orderNo string) error {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return nil
	}
	return s.Expire(o.ID)
}

func (s *OrderService) cancelGatewayTx(orderID int64) error {
	o, err := s.repo.GetOrderByID(orderID)
	if err != nil || o.TradeID == "" {
		return err
	}
	gateway := strings.ToLower(strings.TrimSpace(o.PaymentGateway))
	if gateway != "bepusdt" && gateway != "hashpay" {
		gateway = "bepusdt"
	}
	if s.payFn == nil {
		return ErrGatewayNotConfigured
	}
	err = s.payFn(gateway).CancelTransaction(o.TradeID)
	if gateway != "hashpay" {
		return err
	}
	// HashPay 无商户取消接口：主动查询订单状态，只有已过期/无效才允许本地关闭。
	switch {
	case err == nil:
		_ = s.repo.AddLog(orderID, "gateway_cancel", "HashPay 已确认订单不可支付", "", "", 0)
	case errors.Is(err, ErrHashPayAlreadyPaid):
		msg := "HashPay 订单在取消/过期时已支付，资金可能已到账（order=" + o.OrderNo + ", hashpay_order=" + o.TradeID + "），请人工核对"
		_ = s.repo.AddLog(orderID, "gateway_cancel_race", msg, "", "", 0)
		if s.SystemError != nil {
			s.SystemError(msg)
		}
	default:
		_ = s.repo.AddLog(orderID, "gateway_cancel_check_failed", "HashPay 取消确认失败: "+err.Error(), "", "", 0)
	}
	return err
}
