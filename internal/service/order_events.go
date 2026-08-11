package service

import (
	"shop/internal/events"
	"shop/internal/models"
)

// fireCreatedEvents 订单创建事件 + 低库存检查。
func (s *OrderService) fireCreatedEvents(order models.Order) {
	s.publish(events.OrderCreatedEvent{Order: order})
	// 人工交付商品无卡密库存，不做低库存检查。
	if order.DeliveryType == models.DeliveryTypeManual {
		return
	}
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
