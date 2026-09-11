package main

import (
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func webOrigin() string {
	if origin := os.Getenv("WEB_ORIGIN"); origin != "" {
		return origin
	}
	return "http://localhost:5173"
}

// corsPolicy has to list every method the routes expose. A preflight for a
// missing method is refused by the browser before the request is sent, which
// silently disables the affected controls when the UI runs on its own origin.
// Credentials are only shared with the configured origin, never a wildcard.
func corsPolicy() cors.Config {
	return cors.Config{
		AllowOrigins:     []string{webOrigin()},
		AllowCredentials: true,
		AllowHeaders:     []string{"Content-Type", "Authorization"},
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions},
		MaxAge:           12 * time.Hour,
	}
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
