package main

import (
	"log"
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
// Endpoints that non-browser clients call without an Origin. The MCP endpoint
// has to reach its own middleware even unauthenticated, because the 401 it
// returns is what tells a client where to obtain a token; answering 403 here
// would break discovery. Neither endpoint is reachable with ambient browser
// credentials: both require a bearer token or a PKCE code.
var originExemptPaths = map[string]bool{
	"/api/v1/mcp":            true,
	"/api/v1/oauth/token":    true,
	"/api/v1/oauth/register": true,
}

// sameOriginRequest compares the declared origin against the host the request
// was actually addressed to. A cross-site form post carries the attacker's
// origin and is refused; a form served by this server matches.
func sameOriginRequest(c *gin.Context) bool {
	origin := c.GetHeader("Origin")
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return parsed.Host != "" && parsed.Host == c.Request.Host
}

func requireMutationOrigin(c *gin.Context) {
	switch c.Request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		c.Next()
		return
	}
	if originExemptPaths[c.Request.URL.Path] {
		c.Next()
		return
	}
	// The consent form protects itself with a token held in both a Lax cookie
	// and a hidden field, which does not depend on the browser sending Origin —
	// something it does inconsistently for a same-origin form post, and the
	// reason authorization used to fail with 403 here. A declared origin is
	// still checked: if the browser sends one, it has to be this server.
	if c.Request.URL.Path == "/api/v1/oauth/authorize" {
		if c.GetHeader("Origin") == "" || sameOriginRequest(c) {
			c.Next()
			return
		}
	}
	if c.GetHeader("Origin") != webOrigin() {
		// The origin is not a secret and naming it is the difference between a
		// report of "403" and knowing which header was wrong.
		log.Printf("Refused %s %s: Origin %q does not match %q", c.Request.Method, c.Request.URL.Path, c.GetHeader("Origin"), webOrigin())
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
