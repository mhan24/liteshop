package service

import (
	"testing"

	"shop/internal/config"
	"shop/internal/security"
)

// stubSettingsStore 内存版 SettingsStore，验证 service 可脱离 SQLite 独立测试。
type stubSettingsStore struct {
	settings map[string]string
	secrets  map[string]string
	keys     []string
}

func newStubSettingsStore() *stubSettingsStore {
	return &stubSettingsStore{
		settings: map[string]string{},
		secrets:  map[string]string{},
		keys:     []string{"bepusdt_api_token", "smtp_password", "telegram_bot_token", "webhook_secret", "turnstile_secret", "maintenance_password"},
	}
}

func (s *stubSettingsStore) GetSetting(key string) (string, error)   { return s.settings[key], nil }
func (s *stubSettingsStore) SetSetting(key, value string) error      { s.settings[key] = value; return nil }
func (s *stubSettingsStore) AllSettings() (map[string]string, error) { return s.settings, nil }
func (s *stubSettingsStore) GetSecret(key string, _ *security.Cipher) (string, error) {
	return s.secrets[key], nil
}
func (s *stubSettingsStore) SetSecret(key, value string, _ *security.Cipher) error {
	s.secrets[key] = value
	return nil
}
func (s *stubSettingsStore) SecretKeys() []string  { return s.keys }
func (s *stubSettingsStore) ResetAllTables() error { return nil }
func (s *stubSettingsStore) SettingsVersion() int  { return 1 }

// TestSettingsServiceSavePaymentWithStub 用内存 stub 验证支付配置保存：
// 普通配置进 settings，敏感 Token 走 secrets，法币/收款类型规范化。
func TestSettingsServiceSavePaymentWithStub(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{
		"bepusdt_base_url":    "https://pay.example.com",
		"fiat":                "cny",
		"trade_types":         "usdt.trc20, usdt.erc20",
		"bepusdt_timeout_sec": "1200",
		"bepusdt_api_token":   "tok123",
	}); err != nil {
		t.Fatalf("save payment: %v", err)
	}
	if st.settings["bepusdt_base_url"] != "https://pay.example.com" {
		t.Fatalf("base url = %q", st.settings["bepusdt_base_url"])
	}
	if st.settings["bepusdt_fiat"] != "CNY" {
		t.Fatalf("fiat = %q", st.settings["bepusdt_fiat"])
	}
	if st.settings["bepusdt_trade_types"] != "usdt.trc20,usdt.erc20" {
		t.Fatalf("trade types = %q", st.settings["bepusdt_trade_types"])
	}
	if st.secrets["bepusdt_api_token"] != "tok123" {
		t.Fatalf("api token not stored in secrets: %q", st.secrets["bepusdt_api_token"])
	}
	if !svc.IsSecretKey("bepusdt_api_token") || svc.IsSecretKey("site_title") {
		t.Fatal("IsSecretKey classification broken")
	}
}

// TestSettingsServiceSavePaymentInvalid 非法法币/URL 应返回错误且不写入。
func TestSettingsServiceSavePaymentInvalid(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{"fiat": "not_a_fiat"}); err == nil {
		t.Fatal("invalid fiat should error")
	}
	if err := svc.SavePayment(map[string]any{"bepusdt_base_url": "ftp://x"}); err == nil {
		t.Fatal("invalid url should error")
	}
	if len(st.settings) != 0 {
		t.Fatalf("invalid input must not write anything: %v", st.settings)
	}
}

// TestSettingsServiceSaveNotifyWebhookURL 非法 webhook_url 应报错；合法 http(s) 可保存。
func TestSettingsServiceSaveNotifyWebhookURL(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SaveNotify(map[string]any{"webhook_url": "ftp://x"}); err == nil {
		t.Fatal("invalid webhook_url should error")
	}
	if err := svc.SaveNotify(map[string]any{"webhook_url": "https://hooks.example.com/abc"}); err != nil {
		t.Fatalf("valid webhook_url: %v", err)
	}
	if st.settings["webhook_url"] != "https://hooks.example.com/abc" {
		t.Fatalf("webhook_url = %q", st.settings["webhook_url"])
	}
	if err := svc.SaveNotify(map[string]any{"smtp_port": "abc"}); err == nil {
		t.Fatal("invalid smtp_port should error")
	}
	if err := svc.SaveNotify(map[string]any{"smtp_port": "587"}); err != nil {
		t.Fatalf("valid smtp_port: %v", err)
	}
	if st.settings["smtp_port"] != "587" {
		t.Fatalf("smtp_port = %q, want 587", st.settings["smtp_port"])
	}
}
