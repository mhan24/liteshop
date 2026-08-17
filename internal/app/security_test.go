package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shop/internal/platform/config"
	testutil "shop/tests/fixtures"
)

func newSecurityTestServer(t *testing.T) *Server {
	t.Helper()
	d := testutil.NewTestDB(t)
	handler, err := NewHandler(context.Background(), config.Config{PublicBaseURL: "https://shop.test"}, d)
	if err != nil {
		t.Fatalf("new handler: %v", err)
	}
	return handler.(*Server)
}

// TestSecurityHeaders 安全响应头回归：nosniff / X-Frame-Options / Referrer-Policy /
// Permissions-Policy / X-Request-ID / admin CSP，防止后续改动丢掉。
func TestSecurityHeaders(t *testing.T) {
	s := newSecurityTestServer(t)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/site", nil))
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := rec.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", got)
	}
	if got := rec.Header().Get("Referrer-Policy"); got == "" {
		t.Fatal("Referrer-Policy missing")
	}
	if got := rec.Header().Get("Permissions-Policy"); got == "" {
		t.Fatal("Permissions-Policy missing")
	}
	if got := rec.Header().Get("X-Request-ID"); got == "" {
		t.Fatal("X-Request-ID missing")
	}
	rec2 := httptest.NewRecorder()
	s.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/admin", nil))
	csp := rec2.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self' 'unsafe-eval'") {
		t.Fatalf("admin CSP missing script-src: %q", csp)
	}
	// 站点位于 Cloudflare 之后，边缘会注入 JS 检测内联脚本与 Web Analytics beacon，
	// 后台 CSP 与前台一致放行内联与 beacon 域名（含 test.go 同步断言）。
	if !strings.Contains(csp, "'unsafe-inline'") {
		t.Fatalf("admin CSP missing unsafe-inline for Cloudflare edge scripts: %q", csp)
	}
	if !strings.Contains(csp, "https://static.cloudflareinsights.com") {
		t.Fatalf("admin CSP missing Cloudflare Web Analytics beacon: %q", csp)
	}
}

// TestHSTSWhenHTTPS 仅 HTTPS 请求下发 HSTS。
func TestHSTSWhenHTTPS(t *testing.T) {
	s := newSecurityTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/site", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if got := rec.Header().Get("Strict-Transport-Security"); got == "" {
		t.Fatal("HSTS missing on HTTPS request")
	}
	rec2 := httptest.NewRecorder()
	s.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/v1/site", nil))
	if got := rec2.Header().Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("HSTS should not be set on plain HTTP, got %q", got)
	}
}

// TestSessionCookieSecure HTTPS 下会话 Cookie 必须带 Secure 与 __Host- 前缀。
func TestSessionCookieSecure(t *testing.T) {
	s := newSecurityTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/login", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, req, 1); err != nil {
		t.Fatalf("start session: %v", err)
	}
	setCookie := rec.Header().Get("Set-Cookie")
	if !strings.Contains(setCookie, "__Host-shop_session") || !strings.Contains(setCookie, "Secure") {
		t.Fatalf("session cookie must be __Host- + Secure on HTTPS: %q", setCookie)
	}
}

// TestClientIPTrustBoundary 仅对端为 Cloudflare 时才采信 CF-Connecting-IP，
// 直连客户端伪造该头不能绕过限流。
func TestClientIPTrustBoundary(t *testing.T) {
	// 直连（非 CF 对端）：伪造的 CF-Connecting-IP 必须被忽略
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "1.2.3.4:5555"
	r.Header.Set("CF-Connecting-IP", "9.9.9.9")
	r.Header.Set("X-Forwarded-For", "8.8.8.8, 1.2.3.4")
	if got := clientIP(r); got != "1.2.3.4" {
		t.Fatalf("direct peer: clientIP = %q, want 1.2.3.4 (forged CF header ignored)", got)
	}
	// 公网直连伪造 XFF 必须被忽略。
	r.Header.Set("X-Forwarded-For", "9.9.9.9")
	if got := clientIP(r); got != "1.2.3.4" {
		t.Fatalf("forged XFF: clientIP = %q, want 1.2.3.4", got)
	}
	// 本机 Caddy 可传递其追加的最右侧地址。
	local := httptest.NewRequest(http.MethodGet, "/", nil)
	local.RemoteAddr = "127.0.0.1:8443"
	local.Header.Set("X-Forwarded-For", "8.8.8.8, 10.0.0.2")
	if got := clientIP(local); got != "10.0.0.2" {
		t.Fatalf("local proxy: clientIP = %q, want 10.0.0.2", got)
	}
	// Cloudflare 经本机 Caddy 转发时，仍应恢复 CF 提供的真实访客地址。
	localCF := httptest.NewRequest(http.MethodGet, "/", nil)
	localCF.RemoteAddr = "127.0.0.1:8443"
	localCF.Header.Set("X-Forwarded-For", "203.0.113.9, 104.16.1.1")
	localCF.Header.Set("CF-Connecting-IP", "203.0.113.9")
	if got := clientIP(localCF); got != "203.0.113.9" {
		t.Fatalf("local Cloudflare proxy: clientIP = %q, want 203.0.113.9", got)
	}
	// 经 Cloudflare（对端为 CF 段）：采信 CF-Connecting-IP
	r2 := httptest.NewRequest(http.MethodGet, "/", nil)
	r2.RemoteAddr = "104.16.1.1:443"
	r2.Header.Set("CF-Connecting-IP", "9.9.9.9")
	if got := clientIP(r2); got != "9.9.9.9" {
		t.Fatalf("cf peer: clientIP = %q, want 9.9.9.9", got)
	}
}

// TestSameOrigin CSRF 同源校验：同源放行、跨源拒绝、无 Origin 的 API 客户端放行。
func TestSameOrigin(t *testing.T) {
	if !sameOrigin(httptest.NewRequest(http.MethodPost, "/", nil)) {
		t.Fatal("request without Origin should be allowed (API client)")
	}
	ok := httptest.NewRequest(http.MethodPost, "/", nil)
	ok.Host = "shop.3737.de"
	ok.Header.Set("Origin", "https://shop.3737.de")
	if !sameOrigin(ok) {
		t.Fatal("same-origin request should be allowed")
	}
	bad := httptest.NewRequest(http.MethodPost, "/", nil)
	bad.Host = "shop.3737.de"
	bad.Header.Set("Origin", "https://evil.example")
	if sameOrigin(bad) {
		t.Fatal("cross-origin request must be rejected")
	}
	scheme := httptest.NewRequest(http.MethodPost, "/", nil)
	scheme.Host = "shop.3737.de"
	scheme.Header.Set("Origin", "javascript://shop.3737.de")
	if sameOrigin(scheme) {
		t.Fatal("non-http origin must be rejected")
	}
	port := httptest.NewRequest(http.MethodPost, "/", nil)
	port.Host = "shop.3737.de:8080"
	port.Header.Set("Origin", "https://shop.3737.de")
	if !sameOrigin(port) {
		t.Fatal("same host with forwarded application port should be allowed")
	}
}
