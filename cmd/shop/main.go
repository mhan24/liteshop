package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/models"
	"shop/internal/web"
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

	adminPassword := cfg.AdminPassword
	if adminPassword == "" && !db.HasAdmin(database) {
		adminPassword = models.RandomToken(8)
		log.Printf("generated one-time admin password (change it in backend): %s", adminPassword)
	}
	if err := db.SeedAdmin(database, cfg.AdminUsername, adminPassword); err != nil {
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
