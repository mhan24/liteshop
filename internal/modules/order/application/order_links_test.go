package application

import (
	"errors"
	settingsdomain "shop/internal/modules/settings/domain"

	models "shop/internal/modules/order/domain"
	"strings"
	"testing"
)

// stubOrderRepo 只实现测试用到的订单查询方法，其余接口方法嵌入后留空
// （未被调用则不会触发 nil panic）。
type stubOrderRepo struct {
	OrderRepository
	byNo      func(orderNo string) (models.Order, error)
	byContact func(contact string, limit int) ([]models.Order, error)
}

func (s *stubOrderRepo) GetOrderByNo(orderNo string) (models.Order, error) {
	return s.byNo(orderNo)
}

func (s *stubOrderRepo) OrdersByContact(contact string, limit int) ([]models.Order, error) {
	return s.byContact(contact, limit)
}

func newLinkOrder(no, contact string, status models.Status) models.Order {
	return models.Order{
		OrderNo:      no,
		ProductName:  "测试商品",
		Qty:          1,
		BuyerContact: contact,
		ViewToken:    "tok-" + no,
		Status:       status,
	}
}

// TestSendViewLinkOwnership 单订单重发必须校验邮箱归属：匹配才发送，不匹配/不存在不发。
func TestSendViewLinkOwnership(t *testing.T) {
	svc := &OrderService{
		repo: &stubOrderRepo{
			byNo: func(no string) (models.Order, error) {
				if no != "S1" {
					return models.Order{}, errors.New("not found") // 任意错误代表不存在
				}
				return newLinkOrder("S1", "buyer@test.com", models.OrderPaid), nil
			},
		},
	}
	svc.cfgFn = func() settingsdomain.PaymentConfig {
		return settingsdomain.PaymentConfig{PublicBaseURL: "https://shop.test/"}
	}
	var sentTo string
	var sentLinks []string
	svc.SendLinks = func(to string, links []string) error {
		sentTo = to
		sentLinks = links
		return nil
	}

	// 归属邮箱一致（忽略大小写/首尾空格）→ 发送
	ok, err := svc.SendViewLink("  Buyer@Test.com ", "S1")
	if err != nil || !ok {
		t.Fatalf("matching contact: ok=%v err=%v, want ok", ok, err)
	}
	if sentTo != "  Buyer@Test.com " || len(sentLinks) != 1 {
		t.Fatalf("sent to %q links=%v", sentTo, sentLinks)
	}
	if !strings.Contains(sentLinks[0], "/order/S1?token=tok-S1") {
		t.Fatalf("link missing token: %q", sentLinks[0])
	}

	// 邮箱不匹配 → 不发送
	ok, err = svc.SendViewLink("other@test.com", "S1")
	if err != nil || ok {
		t.Fatalf("mismatch contact: ok=%v err=%v, want (false, nil)", ok, err)
	}

	// 订单不存在 → 不发送
	ok, err = svc.SendViewLink("buyer@test.com", "S999")
	if err != nil || ok {
		t.Fatalf("missing order: ok=%v err=%v, want (false, nil)", ok, err)
	}
}

// TestSendViewLinksFiltersTerminal 全部链接只发送有效订单，取消/过期/支付失败不发送。
func TestSendViewLinksFiltersTerminal(t *testing.T) {
	orders := []models.Order{
		newLinkOrder("S1", "buyer@test.com", models.OrderWaitingPayment),
		newLinkOrder("S2", "buyer@test.com", models.OrderDelivered),
		newLinkOrder("S3", "buyer@test.com", models.OrderCancelled),
		newLinkOrder("S4", "buyer@test.com", models.OrderExpired),
		newLinkOrder("S5", "buyer@test.com", models.OrderPaymentFailed),
	}
	svc := &OrderService{
		repo: &stubOrderRepo{
			byContact: func(contact string, limit int) ([]models.Order, error) { return orders, nil },
		},
	}
	svc.cfgFn = func() settingsdomain.PaymentConfig {
		return settingsdomain.PaymentConfig{PublicBaseURL: "https://shop.test/"}
	}
	svc.SendLinks = func(to string, links []string) error { return nil }

	n, err := svc.SendViewLinks("buyer@test.com")
	if err != nil {
		t.Fatalf("send links: %v", err)
	}
	if n != 2 {
		t.Fatalf("sent %d links, want 2 (S1+S2)", n)
	}
}

// TestSendViewLinkNoMailer 未配置邮件时单订单重发返回明确错误。
func TestSendViewLinkNoMailer(t *testing.T) {
	svc := &OrderService{
		repo: &stubOrderRepo{
			byNo: func(no string) (models.Order, error) {
				return newLinkOrder("S1", "buyer@test.com", models.OrderPaid), nil
			},
		},
	}
	svc.cfgFn = func() settingsdomain.PaymentConfig {
		return settingsdomain.PaymentConfig{PublicBaseURL: "https://shop.test/"}
	}
	svc.SendLinks = nil
	if _, err := svc.SendViewLink("buyer@test.com", "S1"); err == nil {
		t.Fatal("expected error when mailer is nil")
	}
}

// TestSendViewLinksForBatch 批量勾选：只发送"归属邮箱一致 + 有效状态"的订单，
// 他人订单/终态订单静默跳过，返回实际发送条数。
func TestSendViewLinksForBatch(t *testing.T) {
	byNo := map[string]models.Order{
		"S1": newLinkOrder("S1", "buyer@test.com", models.OrderWaitingPayment),
		"S2": newLinkOrder("S2", "buyer@test.com", models.OrderDelivered),
		"S3": newLinkOrder("S3", "buyer@test.com", models.OrderCancelled),
		"S4": newLinkOrder("S4", "other@test.com", models.OrderPaid),
		"S5": newLinkOrder("S5", "buyer@test.com", models.OrderExpired),
	}
	svc := &OrderService{
		repo: &stubOrderRepo{
			byNo: func(no string) (models.Order, error) {
				if o, ok := byNo[no]; ok {
					return o, nil
				}
				return models.Order{}, errors.New("not found")
			},
		},
	}
	svc.cfgFn = func() settingsdomain.PaymentConfig {
		return settingsdomain.PaymentConfig{PublicBaseURL: "https://shop.test/"}
	}
	var sentLinks []string
	svc.SendLinks = func(to string, links []string) error {
		sentLinks = links
		return nil
	}

	n, err := svc.SendViewLinksFor("buyer@test.com", []string{"S1", "S2", "S3", "S4", "S5", "S999"})
	if err != nil {
		t.Fatalf("batch send: %v", err)
	}
	if n != 2 {
		t.Fatalf("sent %d links, want 2 (S1+S2)", n)
	}
	if len(sentLinks) != 2 || !strings.Contains(sentLinks[0], "/order/S1?token=tok-S1") ||
		!strings.Contains(sentLinks[1], "/order/S2?token=tok-S2") {
		t.Fatalf("unexpected links: %v", sentLinks)
	}

	// 全部无效 → 0，且不调用邮件
	sentLinks = nil
	n, err = svc.SendViewLinksFor("buyer@test.com", []string{"S3", "S5"})
	if err != nil || n != 0 || sentLinks != nil {
		t.Fatalf("all-invalid: n=%d err=%v links=%v, want 0/nil", n, err, sentLinks)
	}
}
