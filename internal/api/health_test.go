package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/db/repository"
	"shop/internal/security"
	"shop/internal/service"
)

func TestHealthEndpoint(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	cipher := security.NewCipher("test-secret-0123456789abcdef")
	s := &Server{
		db:        d,
		cfg:       config.Config{},
		settings:  service.NewSettingsService(repository.NewStore(d), cipher, config.Config{}),
		stats:     service.NewStatsService(nil, nil, nil, repository.NewStore(d)),
		startTime: time.Now(),
	}
	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest("GET", "/health", nil))
	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != true {
		t.Fatalf("unexpected health body: %v", body)
	}
	dbInfo, ok := body["database"].(map[string]any)
	if !ok || dbInfo["status"] != "ok" {
		t.Fatalf("database status missing: %v", body["database"])
	}
	if dbInfo["migration_version"] == nil || dbInfo["integrity"] != "ok" {
		t.Fatalf("database metrics missing: %v", dbInfo)
	}
	if _, ok := body["jobs"].(map[string]any); !ok {
		t.Fatalf("jobs metrics missing: %v", body)
	}
	if body["payment"] != "not_configured" {
		t.Fatalf("payment status = %v, want not_configured", body["payment"])
	}
	if body["version"] == "" || body["app"] != "LiteShop" {
		t.Fatalf("version/app missing: %v", body)
	}
}
