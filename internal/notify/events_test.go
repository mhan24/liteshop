package notify

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"shop/internal/config"
	"shop/internal/db"
)

func TestWebhookDelivery(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()

	// 启用事件 + 配置 webhook
	_ = db.SetSetting(d, "notify_events", "payment_success,system_error")
	var mu sync.Mutex
	received := []map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		received = append(received, body)
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer srv.Close()
	_ = db.SetSetting(d, "webhook_url", srv.URL)

	n := &Notifier{cfg: defaultCfg(), db: d}
	payload := map[string]string{"event": EventPaymentSuccess, "order_no": "S1", "title": "支付成功通知", "contact": "a@b.com"}
	n.Notify(EventPaymentSuccess, payload)

	// 等待 goroutine 完成
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		if len(received) > 0 {
			mu.Unlock()
			break
		}
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) == 0 {
		t.Fatalf("no webhook received")
	}
	if received[0]["event"] != EventPaymentSuccess {
		t.Fatalf("event = %v", received[0]["event"])
	}
	data, _ := received[0]["data"].(map[string]any)
	if data["order_no"] != "S1" {
		t.Fatalf("order_no = %v", data["order_no"])
	}
}

func TestEventDisabledSkip(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	_ = db.SetSetting(d, "notify_events", "system_error")
	var hit bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(200)
	}))
	defer srv.Close()
	_ = db.SetSetting(d, "webhook_url", srv.URL)
	n := &Notifier{cfg: defaultCfg(), db: d}
	n.Notify(EventPaymentSuccess, map[string]string{"event": EventPaymentSuccess})
	time.Sleep(300 * time.Millisecond)
	if hit {
		t.Fatalf("disabled event should not notify")
	}
}

func TestNotifyLowStock(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	_ = db.SetSetting(d, "notify_events", "low_stock")
	_ = db.SetSetting(d, "low_stock_threshold", "5")
	var mu sync.Mutex
	var count int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		count++
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer srv.Close()
	_ = db.SetSetting(d, "webhook_url", srv.URL)
	n := &Notifier{cfg: defaultCfg(), db: d}

	n.NotifyLowStock(1, "测试商品", 3, 5) // 低于阈值
	n.NotifyLowStock(1, "测试商品", 3, 5) // 30分钟内重复, 应被限频
	time.Sleep(500 * time.Millisecond)
	mu.Lock()
	if count != 1 {
		t.Fatalf("low stock notified %d times, want 1 (rate limited)", count)
	}
	mu.Unlock()
}

func defaultCfg() config.Config {
	return config.Config{}
}
