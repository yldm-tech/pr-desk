package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

// API answers are authenticated by a cookie and carry one person's pull
// requests, so a shared cache in front of a multi-user deployment must never be
// free to store them; the document and its hashed assets keep the caching rules
// web.go sets for them.
func TestSecurityHeadersCoverAPIResponsesAndTheDocument(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(securityHeaders)
	registerWeb(r, fstest.MapFS{
		"index.html":        {Data: []byte("<!doctype html><title>PR Desk</title>")},
		"assets/app-123.js": {Data: []byte("console.log('app')")},
	})
	r.GET("/api/v1/auth/status", func(c *gin.Context) { c.JSON(200, gin.H{"connected": false}) })
	for _, tc := range []struct {
		url, cacheControl string
		policy            bool
	}{
		{"/api/v1/auth/status", "no-store", false},
		{"/", "no-cache", true},
		{"/assets/app-123.js", "public, max-age=31536000, immutable", true},
	} {
		t.Run(tc.url, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", tc.url, nil))
			if got := w.Header().Get("Cache-Control"); got != tc.cacheControl {
				t.Fatalf("Cache-Control is %q, want %q", got, tc.cacheControl)
			}
			if w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Referrer-Policy") != "no-referrer" {
				t.Fatal("the existing headers were dropped")
			}
			policy := w.Header().Get("Content-Security-Policy")
			// The API serves the OAuth consent page, whose own inline script submits it, so the policy stops at the documents this server renders itself.
			if !tc.policy {
				if policy != "" {
					t.Fatalf("the API carries a policy written for the SPA: %q", policy)
				}
				return
			}
			if !strings.Contains(policy, "default-src 'self'") || !strings.Contains(policy, "object-src 'none'") {
				t.Fatalf("no content security policy: %q", policy)
			}
			// The avatar is loaded from github.com, which redirects to the avatar host, and a redirected image is matched against the policy again.
			if !strings.Contains(policy, "https://github.com") || !strings.Contains(policy, "https://avatars.githubusercontent.com") {
				t.Fatalf("the policy blocks account avatars: %q", policy)
			}
		})
	}
}

// The UI asks for its definition relative to /swagger/, and nothing in this
// module registers a swag spec, so the default doc.json answered 500 on every
// deployment. The spec is embedded because a relative file path resolves against
// whatever directory the binary was started from.
func TestSwaggerUIPointsAtTheSpecTheServerServes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerSwagger(r)
	spec := httptest.NewRecorder()
	r.ServeHTTP(spec, httptest.NewRequest("GET", "/swagger.json", nil))
	if spec.Code != 200 || !strings.Contains(spec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("the spec is not served: %d %q", spec.Code, spec.Header().Get("Content-Type"))
	}
	var document struct {
		OpenAPI string `json:"openapi"`
	}
	if err := json.Unmarshal(spec.Body.Bytes(), &document); err != nil || document.OpenAPI == "" {
		t.Fatalf("the served spec is not an OpenAPI document: %v", err)
	}
	for _, page := range []string{"/swagger/index.html", "/swagger/swagger-initializer.js"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", page, nil))
		if w.Code != 200 {
			t.Fatalf("%s answered %d", page, w.Code)
		}
	}
	initializer := httptest.NewRecorder()
	r.ServeHTTP(initializer, httptest.NewRequest("GET", "/swagger/swagger-initializer.js", nil))
	if !strings.Contains(initializer.Body.String(), `url: "/swagger.json"`) {
		t.Fatalf("the UI still asks for a definition nobody serves: %s", initializer.Body.String())
	}
}

func TestWebRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerWeb(r, fstest.MapFS{
		"index.html":        {Data: []byte("<!doctype html><title>PR Desk</title>")},
		"assets/app-123.js": {Data: []byte("console.log('app')")},
		"favicon.svg":       {Data: []byte("<svg/>")},
	})
	r.GET("/api/v1/auth/status", func(c *gin.Context) { c.JSON(200, gin.H{"connected": false}) })
	for _, tc := range []struct {
		method, url string
		status      int
		html        bool
	}{
		{"GET", "/", 200, true},
		{"GET", "/pull-requests?q=test", 200, true},
		{"GET", "/assets/app-123.js", 200, false},
		{"HEAD", "/assets/app-123.js", 200, false},
		{"HEAD", "/", 200, false},
		{"GET", "/assets/missing.js", 404, false},
		{"GET", "/assets/missing", 404, false},
		{"GET", "/assets/", 404, false},
		{"GET", "/api/v1/missing", 404, false},
		{"GET", "/api", 404, false},
		{"GET", "/swagger/missing", 404, false},
		{"GET", "/api/v1/auth/status", 200, false},
		{"POST", "/pull-requests", 404, false},
	} {
		t.Run(tc.method+" "+tc.url, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.url, nil))
			if w.Code != tc.status || strings.Contains(w.Body.String(), "<!doctype") != tc.html {
				t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
			}
			if tc.method == "HEAD" && w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
			if tc.url == "/assets/app-123.js" {
				if !strings.Contains(w.Header().Get("Content-Type"), "javascript") || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
					t.Fatal("asset headers missing")
				}
			}
			if tc.html && w.Header().Get("Cache-Control") != "no-cache" {
				t.Fatal("HTML must revalidate")
			}
		})
	}
}
