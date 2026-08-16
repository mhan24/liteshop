package http

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"shop/internal/platform/httpserver"
	"shop/internal/platform/version"
	"strings"
)

func (h *Handlers) AdminSystemBackup(w http.ResponseWriter, r *http.Request) {
	settings, err := h.deps.Settings.BackupSettings()
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=liteshop-settings.json")
	httpserver.WriteJSON(w, 200, map[string]any{"app": "liteshop", "settings": settings})
}

func (h *Handlers) AdminSystemRestore(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpserver.WriteError(w, 400, "bad upload")
		return
	}
	file, _, err := r.FormFile("backup_file")
	if err != nil {
		httpserver.WriteError(w, 400, "no file")
		return
	}
	defer file.Close()
	var payload struct {
		Settings map[string]string `json:"settings"`
	}
	if err := json.NewDecoder(io.LimitReader(file, 8<<20)).Decode(&payload); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	count, err := h.deps.Settings.RestoreSettings(payload.Settings)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Admin.ClearPendingTotps()
	_ = h.deps.Admin.DeleteAllSessions()
	// 配置恢复后清空限流器，避免旧 IP 限制残留影响管理员操作
	h.deps.ResetLimiters()
	h.deps.Audit(r, "system_restore", "settings", "system", "", fmt.Sprintf("restored %d settings", count))
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "count": count})
}

func (h *Handlers) AdminSystemReset(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Confirm string `json:"confirm"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input)
	if strings.TrimSpace(input.Confirm) != "DELETE" {
		httpserver.WriteError(w, 400, "confirm required")
		return
	}
	if err := h.deps.Settings.ResetAll(); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Admin.ClearPendingTotps()
	_ = h.deps.Admin.DeleteAllSessions()
	h.deps.Audit(r, "system_reset", "system", "all", "all data", "reset")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminVersion(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteJSON(w, 200, map[string]any{
		"version":        version.Version,
		"build":          version.String(),
		"commit":         version.Commit,
		"date":           version.Date,
		"config_version": h.deps.Settings.ConfigVersion(),
		"repo":           "mhan24/liteshop",
	})
}
