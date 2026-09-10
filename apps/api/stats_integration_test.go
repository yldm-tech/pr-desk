package main

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStatsMonthAndOpenState(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&OAuthToken{SessionID: "stats"}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	before := start.Add(-time.Second)
	next := start.AddDate(0, 1, 0)
	rows := []PullRequest{{SessionID: "stats", State: "closed", MergedAt: &before}, {SessionID: "stats", State: "closed", MergedAt: &start}, {SessionID: "stats", State: "closed", MergedAt: &next}, {SessionID: "stats", State: "open", HasConflicts: true, ReviewStatus: "changes_requested"}, {SessionID: "stats", State: "closed", HasConflicts: true, ReviewStatus: "changes_requested"}, {SessionID: "other", State: "closed", MergedAt: &start}}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{db: db}
	r := gin.New()
	r.GET("/stats", s.stats)
	req := httptest.NewRequest("GET", "/stats", nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "stats"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var v map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]int{"total": 5, "open": 1, "merged": 1, "conflicts": 1, "attention": 1, "needs_review": 1} {
		if v[key] != want {
			t.Fatalf("%s=%d want %d", key, v[key], want)
		}
	}
}
