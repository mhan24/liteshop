package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/api"
)

func main() {
	cfg := config.Load()
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

	handler, err := api.NewHandler(cfg, database)
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
