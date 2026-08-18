package application

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"shop/internal/modules/order/domain"
	"shop/internal/platform/logging"

	"go.uber.org/zap"
)

// ErrCallbackInvalid 回调验签失败（网关应重试投递其他渠道）。
var ErrCallbackInvalid = errors.New("payment callback invalid")

var (
	ErrPaymentAmountMismatch   = errors.New("payment amount mismatch")
	ErrPaymentCurrencyMismatch = errors.New("payment currency mismatch")
	ErrPaymentGatewayMismatch  = errors.New("payment gateway mismatch")
	ErrPaymentTradeIDMissing   = errors.New("payment trade id missing")
)

// HandlePaymentCallback 处理支付网关回调：验签 → 按状态流转订单。
// 网关适配器由组合根经 GatewayProvider 注入；本方法即"业务用例"，
// handler 只做 HTTP 适配，不接触支付 SDK。
func (s *OrderService) HandlePaymentCallback(gateway, requestID string, body []byte) error {
	gw := s.gatewayProvider(gateway)
	if gw == nil {
		return ErrGatewayNotConfigured
	}
	cb, err := gw.VerifyCallback(body)
	if err != nil {
		logging.Payment().Warn(gateway+" callback verify failed",
			zap.String("request_id", requestID),
			zap.Int("body_bytes", len(body)),
			zap.String("result", "verify_failed"),
			zap.Error(err),
		)
		return ErrCallbackInvalid
	}
	logging.Payment().Info(gateway+" callback",
		zap.String("request_id", requestID),
		zap.String("order_no", cb.OrderID),
		zap.String("trade_id", cb.TradeID),
		zap.String("trace_id", cb.TradeID),
		zap.String("block_transaction_id", cb.BlockTransactionID),
		zap.String("status", string(cb.Status)),
		zap.Time("callback_time", time.Now()),
	)
	// 只认归一化状态：适配器负责把 "2"/"paid"/"expired" 等原始值映射为内部枚举。
	switch cb.Status {
	case PaymentTxPaid:
		return s.applyPaidCallback(gateway, requestID, cb)
	case PaymentTxClosed:
		return s.HandleGatewayCancel(gateway, cb.OrderID)
	}
	return nil
}

// applyPaidCallback 支付成功：确认支付并发卡（幂等由 processed_events + 条件状态迁移兜底）。
func (s *OrderService) applyPaidCallback(gateway, requestID string, cb PaymentCallback) error {
	order, err := s.repo.GetOrderByNo(cb.OrderID)
	if err != nil {
		return err
	}
	if err := validatePaymentGateway(order, gateway); err != nil {
		return err
	}
	if strings.TrimSpace(cb.TradeID) == "" {
		return ErrPaymentTradeIDMissing
	}
	if err := validatePaymentCallback(order, cb); err != nil {
		logging.Payment().Warn("payment callback rejected",
			zap.String("request_id", requestID),
			zap.String("order_no", cb.OrderID),
			zap.String("result", "payment_mismatch"),
			zap.Error(err),
		)
		return err
	}
	order, _, changed, err := s.MarkPaidAndDeliver(cb.OrderID, gateway, cb.TradeID, cb.BlockTransactionID)
	if err != nil {
		logging.Payment().Error("payment callback error",
			zap.String("request_id", requestID),
			zap.String("order_no", cb.OrderID),
			zap.String("result", "error"),
			zap.Error(err),
		)
		if s.SystemError != nil {
			s.SystemError("支付回调处理异常 order=" + cb.OrderID + ": " + err.Error())
		}
		return err
	}
	logging.Payment().Info("payment delivered",
		zap.String("request_id", requestID),
		zap.String("order_no", order.OrderNo),
		zap.Int64("amount_cents", order.AmountCents),
		zap.String("trade_id", order.TradeID),
		zap.String("trace_id", order.TradeID),
		zap.String("result", map[bool]string{true: "ok", false: "noop"}[changed]),
	)
	return nil
}

func validatePaymentGateway(order domain.Order, gateway string) error {
	expected := strings.ToLower(strings.TrimSpace(order.PaymentGateway))
	if expected == "" {
		expected = "bepusdt"
	}
	if strings.ToLower(strings.TrimSpace(gateway)) != expected {
		return fmt.Errorf("%w: order=%s callback=%s", ErrPaymentGatewayMismatch, expected, gateway)
	}
	return nil
}

// validatePaymentCallback 防止已验签但金额/币种不匹配的回调完成订单。
func validatePaymentCallback(order domain.Order, cb PaymentCallback) error {
	amount := strings.TrimSpace(cb.Amount)
	if amount == "" {
		return fmt.Errorf("%w: amount is empty", ErrPaymentAmountMismatch)
	}
	value, err := strconv.ParseFloat(amount, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return fmt.Errorf("%w: invalid amount %q", ErrPaymentAmountMismatch, amount)
	}
	paidCents := int64(math.Round(value * 100))
	if paidCents != order.AmountCents {
		return fmt.Errorf("%w: paid=%d expected=%d", ErrPaymentAmountMismatch, paidCents, order.AmountCents)
	}
	if currency := strings.TrimSpace(cb.Currency); currency != "" &&
		!strings.EqualFold(currency, strings.TrimSpace(order.Fiat)) {
		return fmt.Errorf("%w: paid=%s expected=%s", ErrPaymentCurrencyMismatch, currency, order.Fiat)
	}
	return nil
}
