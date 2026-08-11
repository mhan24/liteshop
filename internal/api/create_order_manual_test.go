package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/security"
	"shop/internal/testutil"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

// mockTurnstileOK 让 Turnstile siteverify 恒返回成功。
func mockTurnstileOK(t *testing.T) func() {
	t.Helper()
	old := turnstileHTTP
	turnstileHTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"success":true}`)),
		}, nil
	})}
	return func() { turnstileHTTP = old }
}

// TestCreateOrderManualSkipsStockCheck 人工交付商品下单不做库存校验（回归：available=-1 曾误报 out of stock）。
func TestCreateOrderManualSkipsStockCheck(t *testing.T) {
	restore := mockTurnstileOK(t)
	defer restore()

	s, d := newCallbackServer(t)
	store := repository.NewStore(d)
	cipher := security.NewCipher(store.EnsureSessionSecret())
	if err := store.SetSecret("turnstile_secret", "test-secret", cipher); err != nil {
		t.Fatalf("set turnstile secret: %v", err)
	}
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status_code":200,"data":{"trade_id":"T1","payment_url":"https://pay.test/1"}}`))
	}))
	defer gw.Close()
	if err := store.SetSetting("bepusdt_base_url", gw.URL); err != nil {
		t.Fatalf("set gateway url: %v", err)
	}
	if err := store.SetSetting("bepusdt_trade_types", "usdt.trc20"); err != nil {
		t.Fatalf("set trade types: %v", err)
	}

	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('人工交付商品','',1000,'active',1,100,'[]','manual',?,?)`, now, now)
	if err != nil {
		t.Fatalf("insert manual product: %v", err)
	}
	pid, _ := res.LastInsertId()

	post := func(body map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(raw)))
		return rec
	}

	// 人工交付：库存 -1，购买任意数量都不应报 out of stock
	if rec := post(map[string]any{
		"product_id": pid, "qty": 50, "contact": "buyer@test.com",
		"trade_type": "usdt.trc20", "cf-turnstile-response": "tok",
	}); rec.Code != http.StatusOK {
		t.Fatalf("manual order status=%d body=%s, want 200", rec.Code, rec.Body.String())
	}

	// 自动发货：库存不足仍应拦截
	autoPID := testutil.SeedProductWithCards(t, d, 1)
	if rec := post(map[string]any{
		"product_id": autoPID, "qty": 5, "contact": "buyer@test.com",
		"trade_type": "usdt.trc20", "cf-turnstile-response": "tok",
	}); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "out of stock") {
		t.Fatalf("auto out-of-stock status=%d body=%s, want 400 out of stock", rec.Code, rec.Body.String())
	}
}

// TestCreateOrderGatewayDisabled 未启用的支付网关下单被拒绝（双网关并存下用户选择校验）。
func TestCreateOrderGatewayDisabled(t *testing.T) {
	restore := mockTurnstileOK(t)
	defer restore()

	s, d := newCallbackServer(t)
	store := repository.NewStore(d)
	cipher := security.NewCipher(store.EnsureSessionSecret())
	if err := store.SetSecret("turnstile_secret", "test-secret", cipher); err != nil {
		t.Fatalf("set turnstile secret: %v", err)
	}
	// 仅启用 BEpusdt（默认）；HashPay 未配置也未启用。
	pid := testutil.SeedProductWithCards(t, d, 1)

	post := func(body map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(raw)))
		return rec
	}

	// 显式选 HashPay → 400（未启用）
	if rec := post(map[string]any{
		"product_id": pid, "qty": 1, "contact": "buyer@test.com",
		"trade_type": "usdt.trc20", "gateway": "hashpay", "cf-turnstile-response": "tok",
	}); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid payment gateway") {
		t.Fatalf("disabled gateway status=%d body=%s, want 400 invalid payment gateway", rec.Code, rec.Body.String())
	}

	// 启用双网关但 HashPay 未配置 → 400（网关未配置）
	if err := store.SetSetting("payment_gateway", "bepusdt,hashpay"); err != nil {
		t.Fatalf("set gateways: %v", err)
	}
	if rec := post(map[string]any{
		"product_id": pid, "qty": 1, "contact": "buyer@test.com",
		"trade_type": "usdt.trc20", "gateway": "hashpay", "cf-turnstile-response": "tok",
	}); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "not configured") {
		t.Fatalf("unconfigured gateway status=%d body=%s, want 400 not configured", rec.Code, rec.Body.String())
	}
}
