package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMutationOriginGate(t *testing.T) {
	t.Setenv("WEB_ORIGIN", "http://localhost:5174")
	for _, tc := range []struct {
		name, origin, method string
		allowed              bool
	}{
		{"UI sync", "http://localhost:5174", "POST", true},
		{"foreign site", "https://attacker.test", "POST", false},
		{"same host different port", "http://localhost:5175", "POST", false},
		{"opaque origin", "null", "POST", false},
		{"missing origin", "", "POST", false},
		{"prefix spoof", "http://localhost:5174.attacker.test", "POST", false},
		{"callback GET", "", "GET", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			invoked := false
			r := gin.New()
			r.Use(requireMutationOrigin)
			r.Handle(tc.method, "/endpoint", func(c *gin.Context) { invoked = true; c.Status(204) })
			req := httptest.NewRequest(tc.method, "/endpoint", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			req.AddCookie(&http.Cookie{Name: "pr_session", Value: "fixture-session"})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if invoked != tc.allowed {
				t.Fatalf("handler invoked=%v, want %v", invoked, tc.allowed)
			}
			expected := 403
			if tc.allowed {
				expected = 204
			}
			if w.Code != expected {
				t.Fatalf("status=%d, want %d", w.Code, expected)
			}
		})
	}
}
