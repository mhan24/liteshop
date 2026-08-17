package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	orderdomain "shop/internal/modules/order/domain"
	"sync/atomic"
	"testing"
	"time"

	bepusdt "shop/internal/integrations/payment/bepusdt"
	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"shop/internal/platform/config"
	"shop/internal/platform/security"
	fixtures "shop/tests/fixtures"
)

// newCallbackServer 用真实 HTTP 路由组装 Server（支付 Token 写入 secrets）。
func newCallbackServer(t *testing.T) (*Server, *sql.DB) {
	t.Helper()
	d := fixtures.NewTestDB(t)
	cfg := config.Config{PublicBaseURL: "https://shop.test", BepusdtTimeoutSec: 1200}
	handler, err := NewHandler(context.Background(), cfg, d)
	if err != nil {
		t.Fatalf("new handler: %v", err)
	}
	store := settingssqlite.NewStore(d)
	cipher := security.NewCipher(settingssqlite.EnsureSessionSecret(d))
	if err := store.SetSecret("bepusdt_api_token", "test-token", cipher); err != nil {
		t.Fatalf("set token: %v", err)
	}
	return handler.(*Server), d
}

// signedCallbackPayload 构造带合法签名的支付回调 body。
func signedCallbackPayload(t *testing.T, token string, params map[string]string) []byte {
	t.Helper()
	sigParams := map[string]string{}
	for k, v := range params {
		if v != "" {
			sigParams[k] = v
		}
	}
	params["signature"] = bepusdt.Sign(sigParams, token)
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func postCallback(t *testing.T, s *Server, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/notify/bepusdt", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

// TestPaymentCallbackHTTP 真实 HTTP 路由：支付成功回调发卡，重复回调幂等。
func TestPaymentCallbackHTTP(t *testing.T) {
	s, d := newCallbackServer(t)
	pid := fixtures.SeedProductWithCards(t, d, 2)
	orderNo := fixtures.SeedOrder(t, d, pid, orderdomain.OrderWaitingPayment, "T1")

	payload := signedCallbackPayload(t, "test-token", map[string]string{
		"order_id": orderNo, "trade_id": "T1", "block_transaction_id": "B1", "status": "2", "amount": "10.00", "fiat": "CNY",
	})
	if rec := postCallback(t, s, payload); rec.Code != http.StatusOK {
		t.Fatalf("callback status = %d, want 200", rec.Code)
	} else if rec.Header().Get("X-Request-ID") == "" {
		t.Fatal("X-Request-ID header missing (correlation id middleware)")
	}
	repo := fixtures.NewOrderRepository(d)
	o, err := repo.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != orderdomain.OrderDelivered {
		t.Fatalf("order status = %s, want delivered", o.Status)
	}
	cards, _ := inventorysqlite.NewInventoryRepository(d).CardsForOrder(context.Background(), o.ID)
	if len(cards) != 1 {
		t.Fatalf("cards = %d, want 1", len(cards))
	}

	// 重复回调：仍 200，不发卡
	if rec := postCallback(t, s, payload); rec.Code != http.StatusOK {
		t.Fatalf("duplicate callback status = %d, want 200", rec.Code)
	}
	o2, _ := repo.GetOrderByNo(orderNo)
	cards2, _ := inventorysqlite.NewInventoryRepository(d).CardsForOrder(context.Background(), o2.ID)
	if len(cards2) != 1 {
		t.Fatalf("duplicate callback changed cards: %d", len(cards2))
	}
}

// TestPaymentCallbackCancelHTTP 网关取消回调（status=3）：过期订单并调用网关 cancel-transaction。
func TestPaymentCallbackCancelHTTP(t *testing.T) {
	var cancelHits atomic.Int32
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cancelHits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status_code":200}`))
	}))
	defer gw.Close()

	s, d := newCallbackServer(t)
	store := settingssqlite.NewStore(d)
	if err := store.SetSetting("bepusdt_base_url", gw.URL); err != nil {
		t.Fatalf("set base url: %v", err)
	}
	pid := fixtures.SeedProductWithCards(t, d, 2)
	orderNo := fixtures.SeedOrder(t, d, pid, orderdomain.OrderWaitingPayment, "T2")

	payload := signedCallbackPayload(t, "test-token", map[string]string{
		"order_id": orderNo, "trade_id": "T2", "status": "3", "amount": "10.00", "fiat": "CNY",
	})
	if rec := postCallback(t, s, payload); rec.Code != http.StatusOK {
		t.Fatalf("cancel callback status = %d, want 200", rec.Code)
	}
	repo := fixtures.NewOrderRepository(d)
	o, err := repo.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != orderdomain.OrderExpired {
		t.Fatalf("order status = %s, want expired", o.Status)
	}
	keyRepo := inventorysqlite.NewKeyRepository(d)
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 2 {
		t.Fatalf("available after gateway cancel = %d, want 2", avail)
	}
	fixtures.WaitFor(t, 3*time.Second, func() bool { return cancelHits.Load() >= 1 }, "gateway cancel-transaction call")
}

// TestPaymentCallbackBadSignature 错误签名被拒绝。
func TestPaymentCallbackBadSignature(t *testing.T) {
	s, d := newCallbackServer(t)
	pid := fixtures.SeedProductWithCards(t, d, 1)
	orderNo := fixtures.SeedOrder(t, d, pid, orderdomain.OrderWaitingPayment, "T3")
	payload := []byte(`{"order_id":"` + orderNo + `","trade_id":"T3","status":"2","signature":"deadbeef"}`)
	if rec := postCallback(t, s, payload); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad signature status = %d, want 400", rec.Code)
	}
	repo := fixtures.NewOrderRepository(d)
	o, _ := repo.GetOrderByNo(orderNo)
	if o.Status != orderdomain.OrderWaitingPayment {
		t.Fatalf("order must remain waiting_payment, got %s", o.Status)
	}
}

// TestNotifyPathRuntimeChange 后台修改回调路径后，无需重启即可处理新路径回调；未知路径 404。
func TestNotifyPathRuntimeChange(t *testing.T) {
	s, d := newCallbackServer(t)
	store := settingssqlite.NewStore(d)
	if err := store.SetSetting("bepusdt_notify_path", "/cb/custom"); err != nil {
		t.Fatalf("set path: %v", err)
	}
	pid := fixtures.SeedProductWithCards(t, d, 1)
	orderNo := fixtures.SeedOrder(t, d, pid, orderdomain.OrderWaitingPayment, "TRC")
	payload := signedCallbackPayload(t, "test-token", map[string]string{
		"order_id": orderNo, "trade_id": "TRC", "status": "2", "amount": "10.00", "fiat": "CNY",
	})
	req := httptest.NewRequest(http.MethodPost, "/cb/custom", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("new path callback status = %d, want 200", rec.Code)
	}
	repo := fixtures.NewOrderRepository(d)
	o, err := repo.GetOrderByNo(orderNo)
	if err != nil || o.Status != orderdomain.OrderDelivered {
		t.Fatalf("order status = %v (%v), want delivered", o.Status, err)
	}
	// 未知路径必须 404（兜底路由只认当前配置的回调路径）
	rec2 := httptest.NewRecorder()
	s.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/nope/xyz", bytes.NewReader(payload)))
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("unknown path status = %d, want 404", rec2.Code)
	}
}
