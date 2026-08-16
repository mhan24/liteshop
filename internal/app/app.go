package app

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	adminsqlite "shop/internal/modules/admin/repository/sqlite"
	"shop/internal/platform/config"
	db "shop/internal/platform/database/sqlite"
	"shop/internal/platform/database/sqlite/schema"
	"shop/internal/platform/logging"
)

// App 应用装配根与生命周期：New 组装，Run 启动并优雅退出。
// 只负责组装与生命周期，不包含业务规则。
type App struct {
	cfg     config.Config
	db      *sql.DB
	handler http.Handler
}

// New 加载配置、初始化日志与数据库、装配全部依赖，返回可运行的应用。
func New(ctx context.Context) (*App, error) {
	cfg := config.Load()
	// 迁移目录：默认按 CWD/向上查找；生产可用环境变量显式指定绝对路径。
	if d := os.Getenv("LITESHOP_MIGRATIONS_DIR"); d != "" {
		schema.MigrationsDir = d
	}
	if err := logging.Init(cfg.LogDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		return nil, err
	}
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	if cfg.AdminPassword != "" {
		if _, err := adminsqlite.SeedAdmin(database, cfg.AdminUsername, cfg.AdminPassword); err != nil {
			database.Close()
			return nil, err
		}
	} else if !adminsqlite.HasAdmin(database) {
		log.Printf("no admin configured; open /setup or /admin to initialize")
	}
	handler, err := NewHandler(ctx, cfg, database)
	if err != nil {
		database.Close()
		return nil, err
	}
	return &App{cfg: cfg, db: database, handler: handler}, nil
}

// Run 启动 HTTP 服务并等待退出信号，做优雅停机后关闭数据库。
func (a *App) Run(ctx context.Context) error {
	srv := &http.Server{
		Addr:              a.cfg.ListenAddr,
		Handler:           a.handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	select {
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	case <-ctx.Done():
		return a.shutdown(srv)
	}
}
