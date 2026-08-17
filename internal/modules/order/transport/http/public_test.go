package http

import (
	"net/http/httptest"
	"testing"

	orderdomain "shop/internal/modules/order/domain"
)

func TestOrderOwnedTokenAndContactFallback(t *testing.T) {
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
	if !h.orderOwned(contactReq, order) {
		t.Fatal("matching contact fallback should own order")
	}
	otherContact := httptest.NewRequest("GET", "/order/S1?contact=other%40test.com", nil)
	if h.orderOwned(otherContact, order) {
		t.Fatal("non-matching contact must not own order")
	}
}
