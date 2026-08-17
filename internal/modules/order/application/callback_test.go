package application

import (
	"errors"
	"testing"

	"shop/internal/modules/order/domain"
)

func TestValidatePaymentCallback(t *testing.T) {
	order := domain.Order{AmountCents: 1000, Fiat: "CNY"}

	if err := validatePaymentCallback(order, PaymentCallback{Amount: "10.00", Currency: "CNY"}); err != nil {
		t.Fatalf("matching callback rejected: %v", err)
	}
	if err := validatePaymentCallback(order, PaymentCallback{Amount: "9.99", Currency: "CNY"}); !errors.Is(err, ErrPaymentAmountMismatch) {
		t.Fatalf("amount mismatch = %v, want ErrPaymentAmountMismatch", err)
	}
	if err := validatePaymentCallback(order, PaymentCallback{Amount: "10.00", Currency: "USD"}); !errors.Is(err, ErrPaymentCurrencyMismatch) {
		t.Fatalf("currency mismatch = %v, want ErrPaymentCurrencyMismatch", err)
	}
	if err := validatePaymentCallback(order, PaymentCallback{Amount: "NaN", Currency: "CNY"}); !errors.Is(err, ErrPaymentAmountMismatch) {
		t.Fatalf("invalid amount = %v, want ErrPaymentAmountMismatch", err)
	}
}
