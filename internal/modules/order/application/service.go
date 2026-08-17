package application

import (
	coupondomain "shop/internal/modules/coupon/domain"
	inventoryapp "shop/internal/modules/inventory/application"
	models "shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"

	settingsdomain "shop/internal/modules/settings/domain"

	couponapp "shop/internal/modules/coupon/application"

	inventorydomain "shop/internal/modules/inventory/domain"

	"errors"
	"fmt"

	events "shop/internal/platform/events"
)

// OrderService 订单业务逻辑（按职责拆分到 order_*.go 小文件）。
type OrderService struct {
	repo            OrderRepository
	inventory       inventoryapp.InventoryRepository
	coupons         couponapp.CouponStore
	productReader   ProductReader
	payFn           func(gateway string) PaymentGateway
	gatewayProvider GatewayProvider
	cfgFn           func() settingsdomain.PaymentConfig

	// 领域事件发布器（装配层注入，service 不直接接触 jobs bus）。
	events events.Publisher

	// SendPaid 发卡邮件回调（管理员重发/补发路径使用；正常支付经 OrderPaidEvent）。
	SendPaid          func(order models.Order, cards []inventorydomain.Card)
	SendLinks         func(contact string, links []string) error
	LowStockThreshold func() int
	SystemError       func(message string) // 系统异常告警（取消/过期发现网关竞态等）
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
	case errors.Is(err, coupondomain.ErrCouponNotFound), errors.Is(err, coupondomain.ErrCouponExpired),
		errors.Is(err, coupondomain.ErrCouponUsedUp), errors.Is(err, coupondomain.ErrCouponNotApplicable):
		return newBusinessErrorf("%s", err.Error())
	}
	return err
}

func NewOrderService(repo OrderRepository, payFn func(gateway string) PaymentGateway, cfgFn func() settingsdomain.PaymentConfig) *OrderService {
	return &OrderService{repo: repo, payFn: payFn, cfgFn: cfgFn}
}

// Setinventoryapp.KeyRepository 注入卡密仓储（低库存检查用）。
func (s *OrderService) SetInventory(inventory inventoryapp.InventoryRepository) {
	s.inventory = inventory
}

// SetCouponStore 注入优惠券端口（订单创建/回滚使用）。
func (s *OrderService) SetCouponStore(coupons couponapp.CouponStore) {
	s.coupons = coupons
}

// SetProductReader 注入商品读取端口（下单用例使用）。
func (s *OrderService) SetProductReader(r ProductReader) {
	s.productReader = r
}

// SetGatewayProvider 注入支付网关适配器构造器（组合根装配）。
func (s *OrderService) SetGatewayProvider(p GatewayProvider) {
	s.gatewayProvider = p
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

func (s *OrderService) cfg() settingsdomain.PaymentConfig {
	if s.cfgFn != nil {
		return s.cfgFn()
	}
	return settingsdomain.PaymentConfig{}
}

// Repo 暴露给上层查询。
func (s *OrderService) Repo() OrderRepository { return s.repo }

// normalizeDeliveryType 收敛交付方式为 auto/manual（订单快照用）。
func normalizeDeliveryType(t string) string {
	if t == productdomain.DeliveryTypeManual {
		return productdomain.DeliveryTypeManual
	}
	return productdomain.DeliveryTypeAuto
}
