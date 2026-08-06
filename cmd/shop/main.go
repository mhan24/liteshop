package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/web"
)

func main() {
	cfg := config.Load()
	applyEnv(&cfg)
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		log.Fatal(err)
	}
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	if cfg.AdminPassword != "" {
		if _, err := db.SeedAdmin(database, cfg.AdminUsername, cfg.AdminPassword); err != nil {
			log.Fatal(err)
		}
	} else if !db.HasAdmin(database) {
		log.Printf("no admin configured; open /setup or /admin to initialize")
	}

	handler, err := web.NewHandler(cfg, database)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("shop listening on %s", cfg.ListenAddr)
	log.Printf("admin entry: %s/admin", cfg.PublicBaseURL)
	log.Printf("bepusdt notify url: %s", cfg.NotifyURL)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, handler))
}

// applyEnv 用环境变量覆盖默认配置（与 docker-compose / systemd 中声明的变量一致）。
func applyEnv(cfg *config.Config) {
	if v := strings.TrimSpace(os.Getenv("SHOP_LISTEN_ADDR")); v != "" {
		cfg.ListenAddr = v
	}
	if v := strings.TrimSpace(os.Getenv("SHOP_DATABASE_PATH")); v != "" {
		cfg.DatabasePath = v
	}
	if v := strings.TrimSpace(os.Getenv("SHOP_PUBLIC_BASE_URL")); v != "" {
		cfg.PublicBaseURL = strings.TrimRight(v, "/")
	}
	if v := strings.TrimSpace(os.Getenv("BEPUSDT_NOTIFY_URL")); v != "" {
		cfg.NotifyURL = v
	}
	// 可选初始化令牌：设置后 /setup 必须携带该令牌才能完成初始化，防止站点暴露期间被抢占。
	if v := strings.TrimSpace(os.Getenv("SHOP_SETUP_TOKEN")); v != "" {
		cfg.SetupToken = v
	}
}
