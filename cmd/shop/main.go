package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/web"
)

func main() {
	cfg := config.Load()
	set := applyEnv(&cfg)
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
	// 环境变量机制保留为首次启动/兜底；显式设置的值在启动时写入数据库（键为空时），
	// 使运行时配置统一以 settings 表为准。
	seedEnvSettings(database, set)

	handler, err := web.NewHandler(cfg, database)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("shop listening on %s", cfg.ListenAddr)
	log.Printf("admin entry: %s/admin", cfg.PublicBaseURL)
	log.Printf("bepusdt notify url: %s", cfg.NotifyURL)
	// 显式超时，防止慢速请求（slowloris 等）长期占用连接。
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

// applyEnv 用环境变量覆盖默认配置（与 docker-compose / systemd 中声明的变量一致）。
// 返回显式设置的环境变量键值（用于写入数据库）。
func applyEnv(cfg *config.Config) map[string]string {
	set := map[string]string{}
	if v := strings.TrimSpace(os.Getenv("SHOP_LISTEN_ADDR")); v != "" {
		cfg.ListenAddr = v
	}
	if v := strings.TrimSpace(os.Getenv("SHOP_DATABASE_PATH")); v != "" {
		cfg.DatabasePath = v
	}
	if v := strings.TrimSpace(os.Getenv("SHOP_PUBLIC_BASE_URL")); v != "" {
		cfg.PublicBaseURL = strings.TrimRight(v, "/")
		set["shop_public_base_url"] = cfg.PublicBaseURL
	}
	if v := strings.TrimSpace(os.Getenv("BEPUSDT_NOTIFY_URL")); v != "" {
		cfg.NotifyURL = v
		set["bepusdt_notify_url"] = v
	}
	// 可选初始化令牌：设置后 /setup 必须携带该令牌才能完成初始化，防止站点暴露期间被抢占。
	if v := strings.TrimSpace(os.Getenv("SHOP_SETUP_TOKEN")); v != "" {
		cfg.SetupToken = v
	}
	return set
}

// seedEnvSettings 将显式设置的环境变量写入 settings 表（对应键为空时）。
func seedEnvSettings(database *sql.DB, set map[string]string) {
	for k, v := range set {
		if cur, err := db.GetSetting(database, k); err == nil && strings.TrimSpace(cur) == "" {
			_ = db.SetSetting(database, k, v)
		}
	}
}
