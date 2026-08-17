package application

import (
	"errors"
	models "shop/internal/modules/order/domain"
	"strconv"
	"strings"
)

// 可发送查看链接的订单状态（取消/过期/支付失败等终态无发送价值）。
func linkableOrderStatus(o models.Order) bool {
	switch o.Status {
	case models.OrderCreated, models.OrderWaitingPayment, models.OrderPaid,
		models.OrderProcessing, models.OrderPendingDelivery, models.OrderDelivered,
		models.OrderCompleted, models.OrderDeliveryFailed:
		return true
	}
	return false
}

// orderViewLink 构造单个订单的查看链接（含查看令牌）。
func orderViewLink(base string, o models.Order) string {
	return strings.TrimRight(base, "/") + "/order/" + o.OrderNo + "?token=" + o.ViewToken
}

// SendViewLinks 将登记邮箱下全部"有效订单"的查看链接发送到该邮箱。
// 返回发送条数（0=没有可发送的订单）。取消/过期/支付失败等终态订单不发送。
func (s *OrderService) SendViewLinks(contact string) (int, error) {
	orders, err := s.repo.OrdersByContact(contact, 10)
	if err != nil {
		return 0, err
	}
	base := strings.TrimRight(s.cfg().PublicBaseURL, "/")
	links := []string{}
	for _, o := range orders {
		if !linkableOrderStatus(o) {
			continue
		}
		link := orderViewLink(base, o)
		links = append(links, o.ProductName+" x"+strconv.Itoa(o.Qty)+": "+link)
	}
	if len(links) == 0 {
		return 0, nil
	}
	if s.SendLinks == nil {
		return 0, errors.New("邮件发送未配置")
	}
	if err := s.SendLinks(contact, links); err != nil {
		return 0, err
	}
	return len(links), nil
}

// SendViewLink 重发"单个订单"的查看链接到登记邮箱。
// 仅当订单号存在且归属邮箱与请求邮箱一致时发送，防止把他人订单的令牌发到错误邮箱。
// 返回 (false, nil) 表示订单不存在或邮箱不匹配（对外统一模糊响应）。
func (s *OrderService) SendViewLink(contact, orderNo string) (bool, error) {
	o, err := s.repo.GetOrderByNo(orderNo)
	if err != nil {
		return false, nil
	}
	if !strings.EqualFold(strings.TrimSpace(o.BuyerContact), strings.TrimSpace(contact)) {
		return false, nil
	}
	if s.SendLinks == nil {
		return false, errors.New("邮件发送未配置")
	}
	base := strings.TrimRight(s.cfg().PublicBaseURL, "/")
	link := o.ProductName + " x" + strconv.Itoa(o.Qty) + ": " + orderViewLink(base, o)
	if err := s.SendLinks(contact, []string{link}); err != nil {
		return false, err
	}
	return true, nil
}

// SendViewLinksFor 按选中订单号批量重发查看链接（邮箱归属校验 + 有效状态过滤）。
// 不匹配或已终态的订单静默跳过（不泄露他人订单信息），返回实际发送条数。
func (s *OrderService) SendViewLinksFor(contact string, orderNos []string) (int, error) {
	base := strings.TrimRight(s.cfg().PublicBaseURL, "/")
	links := []string{}
	for _, no := range orderNos {
		o, err := s.repo.GetOrderByNo(strings.TrimSpace(no))
		if err != nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(o.BuyerContact), strings.TrimSpace(contact)) {
			continue
		}
		if !linkableOrderStatus(o) {
			continue
		}
		links = append(links, o.ProductName+" x"+strconv.Itoa(o.Qty)+": "+orderViewLink(base, o))
	}
	if len(links) == 0 {
		return 0, nil
	}
	if s.SendLinks == nil {
		return 0, errors.New("邮件发送未配置")
	}
	if err := s.SendLinks(contact, links); err != nil {
		return 0, err
	}
	return len(links), nil
}
