package application

import (
	"context"
	inventorydomain "shop/internal/modules/inventory/domain"
	"shop/internal/modules/order/domain"
	models "shop/internal/modules/order/domain"
)

// ---- 查询（handler 只经服务访问仓储） ----

func (s *OrderService) GetOrderByNo(orderNo string) (models.Order, error) {
	return s.repo.GetOrderByNo(orderNo)
}

func (s *OrderService) GetOrderByID(id int64) (models.Order, error) {
	return s.repo.GetOrderByID(id)
}

func (s *OrderService) GetOrderCards(id int64) ([]inventorydomain.Card, error) {
	if s.inventory == nil {
		return nil, nil
	}
	return s.inventory.CardsForOrder(context.Background(), id)
}

func (s *OrderService) GetOrderStatus(id int64) (domain.Status, error) {
	return s.repo.GetOrderStatus(id)
}

func (s *OrderService) OrdersByContact(contact string, limit int) ([]models.Order, error) {
	return s.repo.OrdersByContact(contact, limit)
}

func (s *OrderService) ListOrders(where string, args []any, limit int) ([]models.Order, error) {
	return s.repo.ListOrders(where, args, limit)
}

func (s *OrderService) Logs(orderID int64) ([]models.OrderEvent, error) {
	return s.repo.Logs(orderID)
}

func (s *OrderService) AddLog(orderID int64, event, message string, from, to domain.Status, adminID int64) error {
	return s.repo.AddLog(orderID, event, message, from, to, adminID)
}
