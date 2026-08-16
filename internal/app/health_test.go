package app

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	adminapp "shop/internal/modules/admin/application"
	adminsqlite "shop/internal/modules/admin/repository/sqlite"
	settingsapp "shop/internal/modules/settings/application"
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"shop/internal/platform/config"
	db "shop/internal/platform/database/sqlite"
	"shop/internal/platform/security"
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
		settings:  settingsapp.NewSettingsService(settingssqlite.NewStore(d), cipher, config.Config{}),
		stats:     adminapp.NewStatsService(nil, nil, nil, adminsqlite.NewStore(d)),
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
