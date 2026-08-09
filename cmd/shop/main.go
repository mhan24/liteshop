package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"shop/internal/api"
	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/db/repository"
	"shop/internal/logging"
)

func main() {
	cfg := config.Load()
	if err := logging.Init(cfg.LogDir); err != nil {
		log.Fatalf("init logging: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		log.Fatal(err)
	}
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	if cfg.AdminPassword != "" {
		if _, err := repository.SeedAdmin(database, cfg.AdminUsername, cfg.AdminPassword); err != nil {
			log.Fatal(err)
		}
	} else if !repository.HasAdmin(database) {
		log.Printf("no admin configured; open /setup or /admin to initialize")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	handler, err := api.NewHandler(ctx, cfg, database)
	if err != nil {
		log.Fatal(err)
	}
	// 显式超时，防止慢速请求（slowloris 等）长期占用连接。
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	// Graceful Shutdown：SIGTERM/SIGINT → 停止接收请求 → 等待在途请求 → worker 退出 → 关闭数据库。
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	select {
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case <-ctx.Done():
		logging.App().Sugar().Info("shutdown signal received, draining...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logging.App().Sugar().Errorf("graceful shutdown: %v", err)
		}
		// ctx 取消后 bus/scheduler worker 已退出；database.Close 由 defer 执行。
		logging.App().Sugar().Info("server stopped gracefully")
	}
}
