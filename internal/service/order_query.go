package service

import "shop/internal/models"

// ---- 查询（handler 只经服务访问仓储） ----

func (s *OrderService) GetOrderByNo(orderNo string) (models.Order, error) {
	return s.repo.GetOrderByNo(orderNo)
}

func (s *OrderService) GetOrderByID(id int64) (models.Order, error) {
	return s.repo.GetOrderByID(id)
}

func (s *OrderService) GetOrderCards(id int64) ([]models.Card, error) {
	return s.repo.GetOrderCards(id)
}

func (s *OrderService) GetOrderStatus(id int64) (string, error) {
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

func (s *OrderService) AddLog(orderID int64, event, message, from, to string, adminID int64) error {
	return s.repo.AddLog(orderID, event, message, from, to, adminID)
}
