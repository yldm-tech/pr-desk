package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestSessionReadsRejectRevokedExpiredAndOtherSessions(t *testing.T) {
	db := integrationDB(t)
	for _, sid := range []string{"active", "other", "expired", "revoked"} {
		created := time.Now()
		if sid == "expired" {
			created = created.Add(-31 * 24 * time.Hour)
		}
		if err := db.Create(&OAuthToken{SessionID: sid, Token: "fixture", CreatedAt: created}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&PullRequest{SessionID: sid, State: "open", Title: sid, URL: "https://github.com/example/repo/pull/1"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{db: db}
	r := gin.New()
	r.GET("/prs", s.listPRs)
	r.POST("/logout", s.logout)
	logout := httptest.NewRequest("POST", "/logout", nil)
	logout.AddCookie(&http.Cookie{Name: "pr_session", Value: "revoked"})
	r.ServeHTTP(httptest.NewRecorder(), logout)
	for _, sid := range []string{"active", "revoked", "expired", "forged", ""} {
		t.Run(sid, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/prs", nil)
			req.AddCookie(&http.Cookie{Name: "pr_session", Value: sid})
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != 200 {
				t.Fatalf("unexpected status %d", rec.Code)
			}
			var result struct {
				Data  []PullRequest
				Total int
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			want := 0
			if sid == "active" {
				want = 1
			}
			if result.Total != want || len(result.Data) != want {
				t.Fatalf("session %s sees %d rows", sid, len(result.Data))
			}
			if want == 1 && result.Data[0].Title != "active" {
				t.Fatal("read another session's data")
			}
		})
	}
}
