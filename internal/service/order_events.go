package service

import "shop/internal/models"

// fireOrderEvents 支付成功/发货事件通知（模板事件：payment_success / delivered）。
func (s *OrderService) fireOrderEvents(order models.Order, cards []models.Card) {
	if s.OnPaymentSuccess != nil {
		go s.OnPaymentSuccess(order, cards)
	}
	if s.OnDelivered != nil {
		go s.OnDelivered(order, cards)
	}
}

// fireCreatedEvents 订单创建事件 + 低库存检查。
func (s *OrderService) fireCreatedEvents(order models.Order) {
	if s.OnOrderCreated != nil {
		go s.OnOrderCreated(order)
	}
	if s.OnLowStock != nil && s.keys != nil {
		if remain, err := s.keys.AvailableCount(order.ProductID); err == nil {
			threshold := 10
			if s.LowStockThreshold != nil {
				threshold = s.LowStockThreshold()
			}
			go s.OnLowStock(order.ProductID, order.ProductName, remain, threshold)
		}
	}
}
