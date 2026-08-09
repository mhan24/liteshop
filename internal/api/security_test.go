package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shop/internal/config"
	"shop/internal/testutil"
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
}

// TestHSTSWhenHTTPS 仅 HTTPS 请求下发 HSTS。
func TestHSTSWhenHTTPS(t *testing.T) {
	s := newSecurityTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/site", nil)
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
