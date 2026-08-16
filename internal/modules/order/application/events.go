package application

import (
	"encoding/json"
	"fmt"

	inventorydomain "shop/internal/modules/inventory/domain"
	"shop/internal/modules/order/domain"
	"shop/internal/platform/events"
)

// ---- 订单领域事件类型（业务事件归属订单模块，平台 outbox 只搬运载荷） ----

// OrderCreatedEvent 订单已创建。
type OrderCreatedEvent struct {
	Order domain.Order
}

func (OrderCreatedEvent) EventName() string { return "order.created" }

// OrderPaidEvent 订单支付成功（含卡密）。
type OrderPaidEvent struct {
	Order domain.Order
	Cards []inventorydomain.Card
}

func (OrderPaidEvent) EventName() string { return "order.paid" }

// OrderDeliveredEvent 卡密已发放。
type OrderDeliveredEvent struct {
	Order domain.Order
	Cards []inventorydomain.Card
}

func (OrderDeliveredEvent) EventName() string { return "order.delivered" }

// OrderExpiredEvent 订单超时过期。
type OrderExpiredEvent struct {
	OrderID int64
	OrderNo string
}

func (OrderExpiredEvent) EventName() string { return "order.expired" }

// OrderCancelledEvent 订单取消。
type OrderCancelledEvent struct {
	OrderID int64
	OrderNo string
}

func (OrderCancelledEvent) EventName() string { return "order.cancelled" }

// DeliveryFailedEvent 发卡失败（需管理员处理）。
type DeliveryFailedEvent struct {
	OrderID int64
	OrderNo string
	Reason  string
}

func (DeliveryFailedEvent) EventName() string { return "order.delivery_failed" }

// LowStockEvent 库存不足告警。
type LowStockEvent struct {
	ProductID   int64
	ProductName string
	Available   int
	Threshold   int
}

func (LowStockEvent) EventName() string { return "stock.low" }

// EventVersion 当前事件结构版本（结构变更时递增；解码兼容老版本）。
const EventVersion = 1

// EncodeEvent 把领域事件序列化为 outbox 载荷（{"type":...,"version":...,"data":...}）。
func EncodeEvent(e events.Event) (string, error) {
	raw, err := json.Marshal(struct {
		Type    string `json:"type"`
		Version int    `json:"version"`
		Data    any    `json:"data"`
	}{Type: e.EventName(), Version: EventVersion, Data: e})
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// DecodeEvent 从 outbox 载荷还原领域事件。
func DecodeEvent(payload string) (events.Event, error) {
	var env struct {
		Type    string          `json:"type"`
		Version int             `json:"version"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(payload), &env); err != nil {
		return nil, err
	}
	if env.Version == 0 {
		env.Version = 1
	}
	if env.Version > EventVersion {
		return nil, fmt.Errorf("events: unsupported event version %d (current %d)", env.Version, EventVersion)
	}
	switch env.Type {
	case OrderPaidEvent{}.EventName():
		var e OrderPaidEvent
		if err := json.Unmarshal(env.Data, &e); err != nil {
			return nil, err
		}
		return e, nil
	case OrderDeliveredEvent{}.EventName():
		var e OrderDeliveredEvent
		if err := json.Unmarshal(env.Data, &e); err != nil {
			return nil, err
		}
		return e, nil
	default:
		return nil, fmt.Errorf("events: unsupported outbox event type %q", env.Type)
	}
}
