package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicPageRejectsUnknownSlug(t *testing.T) {
	s, _ := newCallbackServer(t)

	for _, tc := range []struct {
		path string
		want int
	}{
		{path: "/api/v1/pages/privacy", want: http.StatusOK},
		{path: "/api/v1/pages/terms", want: http.StatusOK},
		{path: "/api/v1/pages/unknown", want: http.StatusNotFound},
	} {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != tc.want {
			t.Fatalf("%s status = %d, want %d", tc.path, rec.Code, tc.want)
		}
	}
}
