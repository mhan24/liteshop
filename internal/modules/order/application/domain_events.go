package application

import (
	"context"
	models "shop/internal/modules/order/domain"
	productdomain "shop/internal/modules/product/domain"
)

// fireCreatedEvents 订单创建事件 + 低库存检查。
func (s *OrderService) fireCreatedEvents(order models.Order) {
	s.publish(OrderCreatedEvent{Order: order})
	// 人工交付商品无卡密库存，不做低库存检查。
	if order.DeliveryType == productdomain.DeliveryTypeManual {
		return
	}
	if s.inventory != nil {
		if remain, err := s.inventory.AvailableCount(context.Background(), order.ProductID); err == nil {
			threshold := 10
			if s.LowStockThreshold != nil {
				threshold = s.LowStockThreshold()
			}
			s.publish(LowStockEvent{ProductID: order.ProductID, ProductName: order.ProductName, Available: remain, Threshold: threshold})
		}
	}
}

// fireDeliveryFailed 发卡失败事件。
func (s *OrderService) fireDeliveryFailed(order models.Order, reason string) {
	s.publish(DeliveryFailedEvent{OrderID: order.ID, OrderNo: order.OrderNo, Reason: reason})
}
