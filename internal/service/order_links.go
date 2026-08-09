package service

import (
	"errors"
	"strconv"
	"strings"
)

// SendViewLinks 将订单查看链接发送到登记邮箱。返回发送条数（0=无订单）。
func (s *OrderService) SendViewLinks(contact string) (int, error) {
	orders, err := s.repo.OrdersByContact(contact, 10)
	if err != nil {
		return 0, err
	}
	base := strings.TrimRight(s.cfg().PublicBaseURL, "/")
	links := []string{}
	for _, o := range orders {
		link := base + "/order/" + o.OrderNo + "?token=" + o.ViewToken
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
