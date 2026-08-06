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
	// 可选初始化令牌：设置后 /setup 需要携带该令牌才能完成初始化，防止站点暴露期间被抢占。
	cfg.SetupToken = strings.TrimSpace(os.Getenv("SHOP_SETUP_TOKEN"))
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		log.Fatal(err)
	}
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	if cfg.AdminPassword != "" {
		if err := db.SeedAdmin(database, cfg.AdminUsername, cfg.AdminPassword); err != nil {
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
