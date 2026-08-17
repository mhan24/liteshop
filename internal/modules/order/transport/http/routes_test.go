package http

import (
	"net/http"
	"testing"
)

type orderRouteRecord struct {
	path string
	role string
}

type orderRouteRecorder struct {
	admin []orderRouteRecord
}

func (r *orderRouteRecorder) Public(string, string, int, http.HandlerFunc) {}
func (r *orderRouteRecorder) Admin(_ string, path, role string, _ http.HandlerFunc) {
	r.admin = append(r.admin, orderRouteRecord{path: path, role: role})
}

func TestOrderDetailRequiresOperator(t *testing.T) {
	rec := &orderRouteRecorder{}
	Register(rec, &Handlers{})
	for _, route := range rec.admin {
		if route.path == "/api/v1/admin/orders/{id}" && route.role != "operator" {
			t.Fatalf("%s requires %s, want operator", route.path, route.role)
		}
	}
}
