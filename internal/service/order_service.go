package service

import (
	"errors"
	"fmt"

	"shop/internal/events"
	"shop/internal/models"
	"shop/internal/payment"
)

// PaymentConfig 提供支付所需配置（由 web 层实现，避免循环依赖）。
type PaymentConfig struct {
	PublicBaseURL string
	NotifyURL     string
	TimeoutSec    int
	Fiat          string
	TradeTypes    []string
	Gateway       string // bepusdt / hashpay（幂等台账前缀）
}

// OrderService 订单业务逻辑（按职责拆分到 order_*.go 小文件）。
type OrderService struct {
	repo  OrderRepository
	keys  KeyRepository
	payFn func() payment.Gateway
	cfgFn func() PaymentConfig

	// 领域事件发布器（装配层注入，service 不直接接触 jobs bus）。
	events events.Publisher

	// SendPaid 发卡邮件回调（管理员重发/补发路径使用；正常支付经 OrderPaidEvent）。
	SendPaid          func(order models.Order, cards []models.Card)
	SendLinks         func(contact string, links []string) error
	LowStockThreshold func() int
}

// BusinessError 表示可安全展示给买家的业务错误（如券码无效、库存不足）。
// 其余错误视为系统错误，由上层统一脱敏。
type BusinessError struct{ msg string }

func (e *BusinessError) Error() string { return e.msg }

func newBusinessErrorf(format string, args ...any) error {
	return &BusinessError{msg: fmt.Sprintf(format, args...)}
}

// wrapCouponError 仅将已知优惠券业务错误转为可回显的业务错误；
// 数据库等系统错误透传，由上层统一脱敏。
func wrapCouponError(err error) error {
	switch {
	case errors.Is(err, models.ErrCouponNotFound), errors.Is(err, models.ErrCouponExpired),
		errors.Is(err, models.ErrCouponUsedUp), errors.Is(err, models.ErrCouponNotApplicable):
		return newBusinessErrorf("%s", err.Error())
	}
	return err
}

// ErrNoCards 表示订单已支付但发卡数量为 0（需管理员处理）。
var ErrNoCards = errors.New("order paid but no cards delivered")

func NewOrderService(repo OrderRepository, payFn func() payment.Gateway, cfgFn func() PaymentConfig) *OrderService {
	return &OrderService{repo: repo, payFn: payFn, cfgFn: cfgFn}
}

// SetKeyRepository 注入卡密仓储（低库存检查用）。
func (s *OrderService) SetKeyRepository(keys KeyRepository) {
	s.keys = keys
}

// SetEvents 注入领域事件发布器（装配层统一分发到通知/任务系统）。
func (s *OrderService) SetEvents(pub events.Publisher) {
	s.events = pub
}

// publish 发布领域事件（异步消费，不阻塞业务事务）。
func (s *OrderService) publish(e events.Event) {
	if s.events != nil {
		go s.events.Publish(e)
	}
}

func (s *OrderService) cfg() PaymentConfig {
	if s.cfgFn != nil {
		return s.cfgFn()
	}
	return PaymentConfig{}
}

// Repo 暴露给上层查询。
func (s *OrderService) Repo() OrderRepository { return s.repo }

// normalizeDeliveryType 收敛交付方式为 auto/manual（订单快照用）。
func normalizeDeliveryType(t string) string {
	if t == models.DeliveryTypeManual {
		return models.DeliveryTypeManual
	}
	return models.DeliveryTypeAuto
}
