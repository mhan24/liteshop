package http

import (
	"net/http"

	"shop/internal/platform/httpserver"
)

// AdminAuditLogs 审计日志列表（admin 角色）。
func (h *Handlers) AdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := h.deps.AuditService.AuditLogs(200)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, l := range logs {
		out = append(out, map[string]any{
			"id": l.ID, "admin_id": l.AdminID, "username": l.Username,
			"action": l.Action, "target_type": l.TargetType, "target_id": l.TargetID,
			"before": l.Before, "after": l.After, "created_at": l.CreatedAt,
		})
	}
	httpserver.WriteJSON(w, 200, map[string]any{"logs": out})
}
