package main

import (
	"bytes"
	"github.com/gin-gonic/gin"
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

func TestPRDetailsRejectSQLExpressionsBeforeDatabaseAccess(t *testing.T) {
	r := gin.New()
	s := &Server{} // Invalid IDs must never reach the database.
	r.GET("/prs/:id", s.getPR)
	for _, id := range []string{"0", "-1", "1%20OR%201=1", "abc", "18446744073709551616"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/prs/"+id, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("invalid ID accepted: %s", id)
		}
	}
}
