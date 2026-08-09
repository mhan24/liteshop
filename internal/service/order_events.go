package service

import (
	"shop/internal/events"
	"shop/internal/models"
)

// fireOrderEvents 支付成功 + 发货事件。
func (s *OrderService) fireOrderEvents(order models.Order, cards []models.Card) {
	s.publish(events.OrderPaidEvent{Order: order, Cards: cards})
	s.publish(events.OrderDeliveredEvent{Order: order, Cards: cards})
}

// fireCreatedEvents 订单创建事件 + 低库存检查。
func (s *OrderService) fireCreatedEvents(order models.Order) {
	s.publish(events.OrderCreatedEvent{Order: order})
	if s.keys != nil {
		if remain, err := s.keys.AvailableCount(order.ProductID); err == nil {
			threshold := 10
			if s.LowStockThreshold != nil {
				threshold = s.LowStockThreshold()
			}
			s.publish(events.LowStockEvent{ProductID: order.ProductID, ProductName: order.ProductName, Available: remain, Threshold: threshold})
		}
	}
}

// fireDeliveryFailed 发卡失败事件。
func (s *OrderService) fireDeliveryFailed(order models.Order, reason string) {
	s.publish(events.DeliveryFailedEvent{OrderID: order.ID, OrderNo: order.OrderNo, Reason: reason})
}
