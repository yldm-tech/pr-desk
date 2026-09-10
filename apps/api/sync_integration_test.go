package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Every table and fixture lives in a transaction-local schema and is rolled back. This test never updates application tables or real OAuth connections.
func TestSyncFailedDetailsPreserveStoredState(t *testing.T) {
	tx := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	token, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Create(&OAuthToken{SessionID: "test-session", Token: token}).Error; err != nil {
		t.Fatal(err)
	}
	merged := time.Now().UTC().Truncate(time.Second)
	pr := PullRequest{SessionID: "test-session", Number: 7, URL: "https://github.com/test/repo/pull/7", Repo: "test/repo", State: "closed", HasConflicts: true, MergedAt: &merged, ReviewStatus: "approved", CommentsCount: 9}
	if err := tx.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		code, body := http.StatusForbidden, `{"message":"rate limited"}`
		if r.URL.Path == "/search/issues" {
			code = 200
			body = `{"items":[{"number":7,"html_url":"https://github.com/test/repo/pull/7","repository_url":"https://api.github.com/repos/test/repo","title":"updated","state":"open"}]}`
		}
		return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	router := gin.New()
	s := &Server{db: tx}
	router.POST("/sync", s.syncGitHub)
	req := httptest.NewRequest("POST", "/sync", nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "test-session"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 502 {
		t.Fatalf("got %d, want 502", rec.Code)
	}
	var stored PullRequest
	if err := tx.First(&stored, pr.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.MergedAt == nil || !stored.MergedAt.Equal(merged) || !stored.HasConflicts || stored.ReviewStatus != "approved" || stored.CommentsCount != 9 {
		t.Fatal("failed request overwrote stored detail state")
	}
}

func integrationDB(t *testing.T) *gorm.DB {
	unthrottledHistory(t)
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to exercise PostgreSQL integration")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	schema := fmt.Sprintf("prdesk_test_%d", time.Now().UnixNano())
	if err := tx.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec("SET LOCAL search_path TO " + schema).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.AutoMigrate(&PullRequest{}, &OAuthToken{}, &ReviewComment{}); err != nil {
		t.Fatal(err)
	}

	return tx
}
