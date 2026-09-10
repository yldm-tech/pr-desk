package main

import (
	"net/http"
	"net/url"
	"os"

	"github.com/gin-gonic/gin"
)

func webOrigin() string {
	if origin := os.Getenv("WEB_ORIGIN"); origin != "" {
		return origin
	}
	return "http://localhost:5173"
}

// CORS controls response access, not whether a browser sends a mutation. Require the configured UI origin before executing cookie-authenticated writes.
func requireMutationOrigin(c *gin.Context) {
	switch c.Request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		c.Next()
		return
	}
	if c.GetHeader("Origin") != webOrigin() {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Request origin is not allowed"})
		return
	}
	c.Next()
}

// The configured public origin remains HTTPS when TLS terminates at a proxy.
// Do not trust client-supplied forwarded headers to decide cookie security.
func secureCookies(c *gin.Context) bool {
	origin, err := url.Parse(webOrigin())
	return c.Request.TLS != nil || (err == nil && origin.Scheme == "https")
}
