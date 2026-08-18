package http

import (
	"net/http/httptest"
	"testing"

	orderdomain "shop/internal/modules/order/domain"
)

func TestOrderOwnedRequiresToken(t *testing.T) {
	h := &Handlers{}
	order := orderdomain.Order{OrderNo: "S1", BuyerContact: "buyer@test.com", ViewToken: "secret-token"}

	tokenReq := httptest.NewRequest("GET", "/order/S1?token=secret-token", nil)
	if !h.orderOwned(tokenReq, order) {
		t.Fatal("valid token should own order")
	}
	wrongToken := httptest.NewRequest("GET", "/order/S1?token=wrong", nil)
	if h.orderOwned(wrongToken, order) {
		t.Fatal("wrong token must not own order")
	}
	contactReq := httptest.NewRequest("GET", "/order/S1?contact=Buyer%40Test.com", nil)
	if h.orderOwned(contactReq, order) {
		t.Fatal("contact must not be accepted as an order credential")
	}
	otherContact := httptest.NewRequest("GET", "/order/S1?contact=other%40test.com", nil)
	if h.orderOwned(otherContact, order) {
		t.Fatal("contact must never own an order")
	}
}

func TestPublicOrderResponseClearsSensitiveFields(t *testing.T) {
	got := (orderResponse{
		BuyerContact:       "buyer@test.com",
		PaymentURL:         "https://pay.example",
		TradeID:            "trade-1",
		BlockTransactionID: "tx-1",
		DeliveryContent:    "secret",
	}).Public()
	if got.BuyerContact != "" || got.PaymentURL != "" || got.TradeID != "" ||
		got.BlockTransactionID != "" || got.DeliveryContent != "" {
		t.Fatal("public order response must clear all sensitive fields")
	}
}
