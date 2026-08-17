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

// CancelWithGateway 取消订单并同步关闭支付交易（失败不阻塞本地取消）。
func (s *OrderService) CancelWithGateway(orderID int64) error {
	s.cancelGatewayTx(orderID)
	return s.Cancel(orderID)
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
	gateway := strings.ToLower(strings.TrimSpace(o.PaymentGateway))
	if gateway != "bepusdt" && gateway != "hashpay" {
		gateway = "bepusdt"
	}
	go func(gw, tradeID string) {
		err := s.payFn(gw).CancelTransaction(tradeID)
		if gw != "hashpay" {
			return
		}
		// HashPay 无商户取消接口：取消/过期时主动查询订单状态，
		// 检测"取消与付款竞态"并记录，其余状态等待 HashPay 到期回调兜底。
		switch {
		case err == nil:
			_ = s.repo.AddLog(orderID, "gateway_cancel", "HashPay 无取消接口：已确认未支付，等待 HashPay 到期回调", "", "", 0)
		case errors.Is(err, ErrHashPayAlreadyPaid):
			msg := "HashPay 订单在取消/过期时已支付，资金可能已到账（order=" + o.OrderNo + ", hashpay_order=" + tradeID + "），请人工核对"
			_ = s.repo.AddLog(orderID, "gateway_cancel_race", msg, "", "", 0)
			if s.SystemError != nil {
				s.SystemError(msg)
			}
		default:
			_ = s.repo.AddLog(orderID, "gateway_cancel_check_failed", "HashPay 取消确认失败: "+err.Error(), "", "", 0)
		}
	}(gateway, o.TradeID)
}
