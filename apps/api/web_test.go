package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

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
