package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	adminapp "shop/internal/modules/admin/application"
	admindomain "shop/internal/modules/admin/domain"
	"shop/internal/platform/httpserver"
	"shop/internal/platform/security"
	"strings"
)

func (h *Handlers) AdminAccount(w http.ResponseWriter, r *http.Request) {
	id := h.deps.CurrentAdminID(r)
	username, _ := h.deps.Admin.AdminUsername(id)
	httpserver.WriteJSON(w, 200, map[string]any{"username": username})
}

func (h *Handlers) AdminAccountSave(w http.ResponseWriter, r *http.Request) {
	id := h.deps.CurrentAdminID(r)
	var input struct {
		Username        string `json:"username"`
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	hash, err := h.deps.Admin.AdminPasswordHash(id)
	if err != nil {
		httpserver.WriteError(w, 500, "no admin")
		return
	}
	if !security.CheckPassword(input.CurrentPassword, hash) {
		httpserver.WriteError(w, 400, "current password wrong")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		httpserver.WriteError(w, 400, "username empty")
		return
	}
	oldUsername, _ := h.deps.Admin.AdminUsername(id)
	if input.NewPassword != "" {
		if err := security.ValidatePasswordStrength(input.NewPassword); err != nil {
			httpserver.WriteError(w, 400, err.Error())
			return
		}
		if input.NewPassword != input.ConfirmPassword {
			httpserver.WriteError(w, 400, "password mismatch")
			return
		}
		hash = security.HashPassword(input.NewPassword)
	}
	if len(username) > 64 {
		httpserver.WriteError(w, 400, "username too long")
		return
	}
	if err := h.deps.Admin.UpdateAccount(id, username, hash); err != nil {
		if errors.Is(err, admindomain.ErrUsernameTaken) {
			httpserver.WriteError(w, 400, "用户名已存在")
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "account_update", "admin", fmt.Sprintf("%d", id), oldUsername+" / "+(map[bool]string{true: "密码已修改", false: "密码未变"}[input.NewPassword != ""]), username+" / "+map[bool]string{true: "密码已修改", false: "密码未变"}[input.NewPassword != ""])
	if input.NewPassword != "" {
		if err := h.deps.Admin.DeleteSessionsByAdmin(id); err != nil {
			httpserver.WriteInternalError(w, err)
			return
		}
		if err := h.deps.StartSession(w, r, id); err != nil {
			httpserver.WriteInternalError(w, err)
			return
		}
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// ---------- TOTP 双因素 ----------

func (h *Handlers) AdminTotpStatus(w http.ResponseWriter, r *http.Request) {
	id := h.deps.CurrentAdminID(r)
	enabled, plainSecret, err := h.deps.Admin.TotpStatus(id)
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	resp := map[string]any{"enabled": enabled, "issuer": h.deps.Settings.SiteSettings().Title}
	if !enabled && plainSecret != "" {
		resp["secret"] = plainSecret // 仅绑定时返回，用于扫码
	}
	httpserver.WriteJSON(w, 200, resp)
}

// apiAdminTotpGenerate 生成新的 TOTP 密钥（未启用时）。

func (h *Handlers) AdminTotpGenerate(w http.ResponseWriter, r *http.Request) {
	id := h.deps.CurrentAdminID(r)
	secret, err := h.deps.Admin.GenerateTotp(id)
	if errors.Is(err, adminapp.ErrTotpAlreadyEnabled) {
		httpserver.WriteError(w, 400, "TOTP already enabled")
		return
	}
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"secret": secret, "issuer": h.deps.Settings.SiteSettings().Title})
}

func (h *Handlers) AdminTotpEnable(w http.ResponseWriter, r *http.Request) {
	id := h.deps.CurrentAdminID(r)
	var input struct {
		Secret string `json:"secret"`
		Otp    string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if err := h.deps.Admin.EnableTotp(id, input.Secret, input.Otp); err != nil {
		if errors.Is(err, adminapp.ErrInvalidOtp) {
			httpserver.WriteError(w, 403, "invalid otp")
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "totp_enable", "admin", fmt.Sprintf("%d", id), "", "TOTP enabled")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminTotpDisable(w http.ResponseWriter, r *http.Request) {
	id := h.deps.CurrentAdminID(r)
	var input struct {
		Otp string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	if err := h.deps.Admin.DisableTotp(id, input.Otp); err != nil {
		if errors.Is(err, adminapp.ErrInvalidOtp) {
			httpserver.WriteError(w, 403, "invalid otp")
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "totp_disable", "admin", fmt.Sprintf("%d", id), "", "TOTP disabled")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// ---------- 管理员管理 (仅 admin) ----------

func (h *Handlers) AdminListAdmins(w http.ResponseWriter, r *http.Request) {
	admins, err := h.deps.Admin.ListAdmins()
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, a := range admins {
		out = append(out, map[string]any{"id": a.ID, "username": a.Username, "role": a.Role, "created_at": a.CreatedAt})
	}
	httpserver.WriteJSON(w, 200, map[string]any{"admins": out})
}

func (h *Handlers) AdminCreateAdmin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		httpserver.WriteError(w, 400, "username required")
		return
	}
	if len(username) > 64 {
		httpserver.WriteError(w, 400, "username too long")
		return
	}
	if err := security.ValidatePasswordStrength(input.Password); err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}
	role := strings.TrimSpace(input.Role)
	if role != admindomain.RoleAdmin && role != admindomain.RoleOperator && role != admindomain.RoleViewer {
		role = admindomain.RoleOperator
	}
	if err := h.deps.Admin.CreateAdmin(username, input.Password, role); err != nil {
		httpserver.WriteError(w, 400, "create failed (username may exist)")
		return
	}
	h.deps.Audit(r, "admin_create", "admin", username, "", role)
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminSetRole(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	var input struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	role := strings.TrimSpace(input.Role)
	if role != admindomain.RoleAdmin && role != admindomain.RoleOperator && role != admindomain.RoleViewer {
		httpserver.WriteError(w, 400, "invalid role")
		return
	}
	before, _ := h.deps.Admin.AdminRole(id)
	if err := h.deps.Admin.SetRole(id, role); err != nil {
		if errors.Is(err, adminapp.ErrAdminNotFound) {
			httpserver.WriteError(w, 404, "admin not found")
			return
		}
		if errors.Is(err, adminapp.ErrLastAdmin) {
			httpserver.WriteError(w, 400, "cannot demote the last admin")
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "admin_role", "admin", fmt.Sprintf("%d", id), before, role)
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminDeleteAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := httpserver.PathID(r, "id")
	if err != nil {
		httpserver.WriteError(w, 404, "not found")
		return
	}
	if id == h.deps.CurrentAdminID(r) {
		httpserver.WriteError(w, 400, "cannot delete yourself")
		return
	}
	uname, _ := h.deps.Admin.AdminUsername(id)
	if err := h.deps.Admin.DeleteAdmin(id); err != nil {
		if errors.Is(err, adminapp.ErrLastAdmin) {
			httpserver.WriteError(w, 400, "cannot delete the last admin")
			return
		}
		httpserver.WriteInternalError(w, err)
		return
	}
	h.deps.Audit(r, "admin_delete", "admin", fmt.Sprintf("%d", id), uname, "deleted")
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

// ---------- 审计日志 (仅 admin) ----------

// ---------- 优惠券管理 ----------

// apiAdminJobs 返回后台任务执行记录（每个任务最近一次）+ 邮件队列积压数。

func (h *Handlers) AdminJobs(w http.ResponseWriter, r *http.Request) {
	runs, pending, dead, err := h.deps.Jobs.Runs()
	if err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	out := []map[string]any{}
	for _, run := range runs {
		out = append(out, map[string]any{
			"job_name":    run.JobName,
			"status":      run.Status,
			"started_at":  run.StartedAt,
			"finished_at": run.FinishedAt,
			"error":       run.Error,
		})
	}
	httpserver.WriteJSON(w, 200, map[string]any{"jobs": out, "mail_queue_pending": pending, "dead_events": dead})
}
