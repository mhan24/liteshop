// Package httpserver 提供 HTTP 响应与状态记录基础件。
package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"shop/internal/platform/logging"

	"go.uber.org/zap"
)

// WriteJSON 写 JSON 响应（no-store）。
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// WriteError 写 JSON 错误响应。
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]any{"error": msg})
}

// WriteInternalError 记录完整错误到日志，仅向客户端返回通用文案。
func WriteInternalError(w http.ResponseWriter, err error) {
	if err != nil {
		logging.App().Error("internal error", zap.Error(err))
	}
	WriteError(w, 500, "internal server error")
}

// StatusRecorder 记录响应状态码（供请求日志使用）。
type StatusRecorder struct {
	http.ResponseWriter
	status int
}

// NewStatusRecorder 创建状态记录器（默认 200）。
func NewStatusRecorder(w http.ResponseWriter) *StatusRecorder {
	return &StatusRecorder{ResponseWriter: w, status: http.StatusOK}
}

func (r *StatusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Status 返回已记录的状态码。
func (r *StatusRecorder) Status() int { return r.status }

// ValidEmail 简单邮箱格式校验。
func ValidEmail(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > 200 || strings.ContainsAny(v, " \t\r\n") {
		return false
	}
	at := strings.LastIndex(v, "@")
	if at <= 0 || at == len(v)-1 {
		return false
	}
	return strings.Contains(v[at+1:], ".")
}

// PathID 解析路径参数为 int64。
func PathID(r *http.Request, name string) (int64, error) {
	return strconv.ParseInt(r.PathValue(name), 10, 64)
}
