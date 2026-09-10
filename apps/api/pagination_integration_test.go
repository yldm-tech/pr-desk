package main

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPaginationAndAttention(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&OAuthToken{SessionID: "pages"}).Error; err != nil {
		t.Fatal(err)
	}
	stamp := time.Now()
	for i := 1; i <= 55; i++ {
		p := PullRequest{SessionID: "pages", Number: i, Title: fmt.Sprint(i), State: "open", UpdatedAt: stamp, HasConflicts: i == 55}
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	// A recently merged PR must not occupy a page slot or count toward totals,
	// even if its old review/conflict fields are still set.
	merged := time.Now()
	if err := db.Create(&PullRequest{SessionID: "pages", Number: 56, Repo: "merged-only", Title: "merged fixture", State: "closed", MergedAt: &merged, UpdatedAt: merged, HasConflicts: true, ReviewStatus: "approved"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&PullRequest{SessionID: "pages", Number: 57, Repo: "closed-only", Title: "closed fixture", State: "closed", UpdatedAt: stamp}).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{db: db}
	r := gin.New()
	r.GET("/prs", s.listPRs)
	r.GET("/repositories", s.repositories)
	for _, tc := range []struct {
		query               string
		total, count, first int
	}{{"?limit=50", 55, 50, 55}, {"?limit=50&offset=50", 55, 5, 5}, {"?attention=true", 1, 1, 55}, {"?merged=true", 0, 0, 0}, {"?search=55", 1, 1, 55}, {"?search=55&offset=1", 1, 0, 0}, {"?search=missing", 0, 0, 0}, {"?search=merged", 0, 0, 0}, {"?search=closed", 0, 0, 0}, {"?state=closed", 0, 0, 0}, {"?review_status=approved", 0, 0, 0}, {"?attention=true&search=54", 0, 0, 0}, {"?search=%25", 0, 0, 0}, {"?search=%5F", 0, 0, 0}} {
		req := httptest.NewRequest("GET", "/prs"+tc.query, nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "pages"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var result struct {
			Data  []PullRequest
			Total int
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || result.Total != tc.total || len(result.Data) != tc.count {
			t.Fatalf("%s: status %d total %d count %d", tc.query, w.Code, result.Total, len(result.Data))
		}
		if tc.count > 0 && result.Data[0].Number != tc.first {
			t.Fatal("unstable ordering")
		}
	}
}
