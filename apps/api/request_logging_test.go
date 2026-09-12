package main

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestLogsExcludeCredentialsAndUserInput(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	r := gin.New()
	r.Use(safeRequestLogger())
	r.GET("/callback/:id", func(c *gin.Context) { c.Status(204) })
	req := httptest.NewRequest("GET", "/callback/private-id?code=private-code&state=private-state", nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "private-cookie"})
	r.ServeHTTP(httptest.NewRecorder(), req)
	got := output.String()
	if !strings.Contains(got, "GET /callback/:id 204") {
		t.Fatal("missing safe route log")
	}
	for _, secret := range []string{"private-id", "private-code", "private-state", "private-cookie"} {
		if strings.Contains(got, secret) {
			t.Fatal("request log exposed user input")
		}
	}
}

// The id is minted, echoed and stored so that a person who quotes it from a
// failed request gives an operator something to search for. Until it reached the
// log it matched nothing, and a client-supplied one could forge log lines.
func TestRequestLogsCarryTheCorrelationIdTheResponseReturns(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	r := gin.New()
	r.Use(safeRequestLogger(), gin.CustomRecoveryWithWriter(io.Discard, recoverRequest), requestIDMiddleware())
	r.GET("/callback/:id", func(c *gin.Context) { c.Status(204) })
	r.GET("/panic", func(c *gin.Context) { panic("fixture failure") })
	call := func(path, supplied string) (string, string) {
		output.Reset()
		req := httptest.NewRequest("GET", path, nil)
		if supplied != "" {
			req.Header.Set("X-Request-ID", supplied)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Header().Get("X-Request-ID"), output.String()
	}
	returned, logged := call("/callback/private-id", "abc123")
	if returned != "abc123" || !strings.Contains(logged, "GET /callback/:id 204 id=abc123") {
		t.Fatalf("the log does not carry the id the response returned: header=%q log=%q", returned, logged)
	}
	// A header is client input: a forged one would otherwise write whole log lines of its own.
	for _, forged := range []string{"bad\r\nHTTP GET /admin 200", strings.Repeat("x", 65), "id with spaces"} {
		returned, logged := call("/callback/private-id", forged)
		if returned == forged || !strings.Contains(logged, "id="+returned) {
			t.Fatalf("a rejected id was still used: header=%q log=%q", returned, logged)
		}
		if strings.Contains(logged, "/admin") || strings.Contains(logged, forged) {
			t.Fatalf("forged request id reached the log: %q", logged)
		}
	}
	// The anonymous panic line is the one an operator most needs to tie to a report.
	returned, logged = call("/panic", "panic123")
	if returned != "panic123" || !strings.Contains(logged, "Request panic recovered; sensitive request details omitted id=panic123") {
		t.Fatalf("the panic line cannot be tied to a request: header=%q log=%q", returned, logged)
	}
}

func TestPRDetailsRejectSQLExpressionsBeforeDatabaseAccess(t *testing.T) {
	r := gin.New()
	s := &Server{} // Invalid IDs must never reach the database.
	r.GET("/prs/:id", s.getPR)
	// The comments route answers the same id as the detail route, so a mistyped one has to reach the same 404 rather than a bigint cast failure reported as a server fault.
	r.GET("/prs/:id/comments", s.comments)
	for _, id := range []string{"0", "-1", "1%20OR%201=1", "abc", "18446744073709551616"} {
		for _, path := range []string{"/prs/" + id, "/prs/" + id + "/comments"} {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			if w.Code != http.StatusNotFound {
				t.Fatalf("invalid ID accepted: %s", path)
			}
		}
	}
}
