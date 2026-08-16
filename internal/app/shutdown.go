package app

import (
	"context"
	"net/http"
	"time"

	"shop/internal/platform/logging"
)

// shutdown 优雅停机：停止接收 → 等待在途请求 → 关闭数据库。
func (a *App) shutdown(srv *http.Server) error {
	logging.App().Sugar().Info("shutdown signal received, draining...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logging.App().Sugar().Errorf("graceful shutdown: %v", err)
	}
	if err := a.db.Close(); err != nil {
		logging.App().Sugar().Errorf("close database: %v", err)
	}
	logging.App().Sugar().Info("server stopped gracefully")
	return nil
}
