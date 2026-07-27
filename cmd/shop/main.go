package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/web"
)

func main() {
	cfg := config.Load()
	if cfg.AdminPassword == "admin123" {
		log.Println("warning: SHOP_ADMIN_PASSWORD is using the default value; please change it")
	}
	if cfg.SessionSecret == "change-me-session-secret" {
		log.Println("warning: SHOP_SESSION_SECRET is using the default value; please change it")
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		log.Fatal(err)
	}
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	if err := db.SeedAdmin(database, cfg.AdminUsername, cfg.AdminPassword); err != nil {
		log.Fatal(err)
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
