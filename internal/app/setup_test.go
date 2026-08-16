package app

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"shop/internal/platform/config"
	testutil "shop/tests/fixtures"
)

func TestSetupValidationDoesNotCreateAdmin(t *testing.T) {
	d := testutil.NewTestDB(t)
	handler, err := NewHandler(context.Background(), config.Config{PublicBaseURL: "https://shop.test"}, d)
	if err != nil {
		t.Fatalf("new handler: %v", err)
	}
	body := []byte(`{"username":"admin","password":"StrongPass123!","confirm":"StrongPass123!","public_base_url":"ftp://invalid"}`)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/setup", bytes.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var admins int
	if err := d.QueryRow(`SELECT COUNT(1) FROM admins`).Scan(&admins); err != nil {
		t.Fatalf("count admins: %v", err)
	}
	if admins != 0 {
		t.Fatalf("admins = %d, want 0 after validation failure", admins)
	}
}
