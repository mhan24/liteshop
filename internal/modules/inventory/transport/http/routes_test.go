package http

import (
	"net/http"
	"testing"
)

type routeRecord struct {
	method string
	path   string
	role   string
}

type routeRecorder struct {
	admin []routeRecord
}

func (r *routeRecorder) Public(string, string, int, http.HandlerFunc) {}
func (r *routeRecorder) Admin(method, path, role string, _ http.HandlerFunc) {
	r.admin = append(r.admin, routeRecord{method: method, path: path, role: role})
}

func TestSensitiveCardRoutesRequireOperator(t *testing.T) {
	rec := &routeRecorder{}
	Register(rec, &Handlers{})
	for _, route := range rec.admin {
		if route.path == "/api/v1/admin/products/{id}/cards" || route.path == "/api/v1/admin/products/{id}/cards/export" {
			if route.role != "operator" {
				t.Fatalf("%s %s requires %s, want operator", route.method, route.path, route.role)
			}
		}
	}
}
