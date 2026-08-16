package http

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	adminapp "shop/internal/modules/admin/application"
	"shop/internal/platform/httpserver"
	"shop/internal/platform/logging"
	"strings"

	"go.uber.org/zap"
)

func (h *Handlers) AdminSession(w http.ResponseWriter, r *http.Request) {
	id, role, ok := h.deps.CurrentSession(r)
	if !ok {
		httpserver.WriteError(w, 401, "unauthorized")
		return
	}
	username, _ := h.deps.Admin.AdminUsername(id)
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "id": id, "username": username, "role": role})
}

func (h *Handlers) AdminLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Otp      string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	username := strings.TrimSpace(input.Username)
	ip := h.deps.ClientIP(r)
	adminID, totpEnabled, err := h.deps.Admin.Login(username, input.Password, ip)
	if err != nil {
		reason := "internal"
		msg := ""
		switch {
		case errors.Is(err, adminapp.ErrLoginLocked):
			reason = "locked"
			msg = "尝试次数过多，账号已锁定，请 10 分钟后再试"
		case errors.Is(err, adminapp.ErrBadCredentials):
			reason = "bad_credentials"
			msg = "invalid credentials"
		default:
			httpserver.WriteInternalError(w, err)
			return
		}
		logging.Security().Warn("admin login failed", zap.String("username", username), zap.String("ip", ip), zap.String("reason", reason))
		httpserver.WriteError(w, 403, msg)
		return
	}
	logging.Security().Info("admin login ok", zap.String("username", username), zap.String("ip", ip))
	if totpEnabled {
		if strings.TrimSpace(input.Otp) == "" {
			// 未提供 OTP，返回待验证状态
			logging.Security().Info("admin totp required", zap.String("username", username), zap.String("ip", ip))
			token := h.deps.Admin.BeginTotpPending(adminID)
			httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "totp_required": true, "token": token})
			return
		}
		if err := h.deps.Admin.VerifyLoginTotp(adminID, strings.TrimSpace(input.Otp)); err != nil {
			if !errors.Is(err, adminapp.ErrInvalidOtp) {
				httpserver.WriteInternalError(w, err)
				return
			}
			logging.Security().Warn("admin totp failed", zap.String("username", username), zap.String("ip", ip))
			httpserver.WriteError(w, 403, "invalid otp")
			return
		}
		logging.Security().Info("admin totp ok", zap.String("username", username), zap.String("ip", ip))
	}
	if err := h.deps.StartSession(w, r, adminID); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true, "totp_required": false})
}

func (h *Handlers) AdminLoginVerify(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token string `json:"token"`
		Otp   string `json:"otp"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		httpserver.WriteError(w, 400, "bad json")
		return
	}
	adminID, ok := h.deps.Admin.TakeTotpPending(input.Token)
	if !ok {
		httpserver.WriteError(w, 401, "invalid or expired token")
		return
	}
	if err := h.deps.Admin.VerifyLoginTotp(adminID, input.Otp); err != nil {
		if !errors.Is(err, adminapp.ErrInvalidOtp) {
			httpserver.WriteInternalError(w, err)
			return
		}
		httpserver.WriteError(w, 403, "invalid otp")
		return
	}
	if err := h.deps.StartSession(w, r, adminID); err != nil {
		httpserver.WriteInternalError(w, err)
		return
	}
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handlers) AdminLogout(w http.ResponseWriter, r *http.Request) {
	if id, ok := h.deps.SessionID(r); ok {
		_ = h.deps.Admin.DeleteSession(id)
	}
	// 同时清除两种名称（HTTPS 的 __Host- 与纯 HTTP 的普通名）。
	http.SetCookie(w, &http.Cookie{Name: "__Host-shop_session", Value: "", Path: "/", MaxAge: -1, Secure: true})
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: "", Path: "/", MaxAge: -1})
	httpserver.WriteJSON(w, 200, map[string]any{"ok": true})
}
