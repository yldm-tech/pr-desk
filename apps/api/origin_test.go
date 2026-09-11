package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/cors"
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

func TestOAuthCookieSecurityBehindProxy(t *testing.T) {
	for _, tc := range []struct {
		name, origin, target string
		secure               bool
	}{
		{"TLS proxy", "https://prdesk.yldm.ai", "http://internal/api/v1/auth/github", true},
		{"local development", "http://localhost:5174", "http://localhost/api/v1/auth/github", false},
		{"direct TLS", "http://localhost:5174", "https://localhost/api/v1/auth/github", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WEB_ORIGIN", tc.origin)
			r := gin.New()
			r.GET("/api/v1/auth/github", githubAuth)
			req := httptest.NewRequest("GET", tc.target, nil)
			req.Header.Set("X-Forwarded-Proto", "https")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusFound {
				t.Fatalf("status=%d", w.Code)
			}
			cookies := w.Result().Cookies()
			if len(cookies) != 1 || cookies[0].Name != "oauth_state" || cookies[0].Secure != tc.secure || !cookies[0].HttpOnly {
				t.Fatalf("unexpected OAuth cookie flags: %v", cookies)
			}
		})
	}
}

// The destination controls call PUT and DELETE. A preflight that omits them
// disables enabling, disabling and removing a destination from any origin that
// is not the API's own.
func TestCORSPreflightCoversEveryRoutedMethod(t *testing.T) {
	t.Setenv("WEB_ORIGIN", "https://desk.example.com")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(cors.New(corsPolicy()))
	preflight := func(origin, method string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodOptions, "/api/v1/notification-destinations/1", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("Access-Control-Request-Method", method)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		return w
	}
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
		w := preflight("https://desk.example.com", method)
		allowed := w.Header().Get("Access-Control-Allow-Methods")
		if !strings.Contains(allowed, method) {
			t.Fatalf("%s refused by preflight, allowed: %q", method, allowed)
		}
		if w.Header().Get("Access-Control-Allow-Credentials") != "true" {
			t.Fatalf("%s preflight does not carry credentials", method)
		}
	}
	if w := preflight("https://attacker.example.com", http.MethodPut); w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("a foreign origin was granted access", w.Header())
	}
}
