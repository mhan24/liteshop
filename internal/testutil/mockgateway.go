package testutil

import (
	"sync"

	"shop/internal/payment"
)

// MockGateway 内存版支付网关（记录创建/取消调用，可注入错误）。
type MockGateway struct {
	mu sync.Mutex

	CreateCalls []payment.CreateInput
	CancelCalls []string

	PaymentURL string
	TradeID    string
	CreateErr  error
	CancelErr  error
}

func NewMockGateway() *MockGateway {
	return &MockGateway{
		PaymentURL: "https://pay.test/checkout",
		TradeID:    "TRADE-1",
	}
}

func (m *MockGateway) CreateTransaction(in payment.CreateInput) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CreateCalls = append(m.CreateCalls, in)
	if m.CreateErr != nil {
		return "", "", m.CreateErr
	}
	if m.TradeID == "" {
		m.TradeID = "TRADE-" + in.OrderID
	}
	return m.PaymentURL, m.TradeID, nil
}

func (m *MockGateway) CancelTransaction(tradeID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CancelCalls = append(m.CancelCalls, tradeID)
	return m.CancelErr
}

func (m *MockGateway) VerifyCallback(body []byte) (payment.CallbackParams, error) {
	return payment.ParseAndVerifyCallback(body, "test-token")
}

// CancelCount 返回取消调用次数。
func (m *MockGateway) CancelCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.CancelCalls)
}
