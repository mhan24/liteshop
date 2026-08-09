// Package events 定义类型化领域事件与发布规范。
//
// service 层通过 events.Publisher 发布类型化事件，不直接接触 jobs bus；
// 装配层把事件分发到通知/任务系统，后续事件增多也不会在业务代码里散落 Publish。
package events

import (
	"encoding/json"
	"fmt"

	"shop/internal/models"
)

// Event 领域事件统一接口。
type Event interface {
	EventName() string
}

// Publisher 领域事件发布器（由装配层注入实现，如转发到 jobs bus / notifier）。
type Publisher interface {
	Publish(e Event)
}

// Func 把普通函数适配为 Publisher。
type Func func(e Event)

func (f Func) Publish(e Event) { f(e) }

// OrderCreatedEvent 订单已创建。
type OrderCreatedEvent struct {
	Order models.Order
}

func (OrderCreatedEvent) EventName() string { return "order.created" }

// OrderPaidEvent 订单支付成功（含卡密）。
type OrderPaidEvent struct {
	Order models.Order
	Cards []models.Card
}

func (OrderPaidEvent) EventName() string { return "order.paid" }

// OrderDeliveredEvent 卡密已发放。
type OrderDeliveredEvent struct {
	Order models.Order
	Cards []models.Card
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

// Encode 把领域事件序列化为 outbox 载荷（{"type":...,"version":...,"data":...}）。
func Encode(e Event) (string, error) {
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

// Decode 从 outbox 载荷还原领域事件。
func Decode(payload string) (Event, error) {
	var env struct {
		Type    string          `json:"type"`
		Version int             `json:"version"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(payload), &env); err != nil {
		return nil, err
	}
	// version 缺失视为 v1（老事件）；高于当前版本拒绝处理，避免错读未来结构。
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
