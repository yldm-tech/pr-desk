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
	router.POST("/sync", s.syncInlineForTest)
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

// TEST_DATABASE_URL is a URL in CI and a keyword string on a developer machine,
// and the two take an extra parameter differently. Appending the keyword form
// to a URL swallows it into the preceding value, which reads as an invalid
// sslmode rather than as a malformed parameter.
func withSearchPath(dsn, schema string) string {
	if !strings.Contains(dsn, "://") {
		return dsn + " search_path=" + schema
	}
	if strings.Contains(dsn, "?") {
		return dsn + "&search_path=" + schema
	}
	return dsn + "?search_path=" + schema
}

// integrationDB hands back a transaction, which is one connection. Anything
// that runs concurrent database work — the details phase starts four goroutines
// — deadlocks or errors on that single connection, so those tests need a real
// pool instead. Isolation moves from the rolled-back transaction to a schema
// dropped on cleanup; search_path reaches every pooled connection because pgx
// turns an unrecognized parameter of either form into a startup runtime
// parameter.
func integrationPoolDB(t *testing.T) *gorm.DB {
	unthrottledHistory(t)
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to exercise PostgreSQL integration")
	}
	silent := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), silent)
	if err != nil {
		t.Fatal(err)
	}
	adminDB, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("prdesk_pool_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(withSearchPath(dsn, schema)), silent)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		sqlDB.Close()
		admin.Exec("DROP SCHEMA IF EXISTS " + schema + " CASCADE")
		adminDB.Close()
	})
	if err := migrateDatabase(db); err != nil {
		t.Fatal(err)
	}
	return db
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
	if err := migrateDatabase(tx); err != nil {
		t.Fatal(err)
	}

	return tx
}

// The fixture built its connection string by concatenation and only ever saw
// the keyword form locally, so the URL form CI passes went unnoticed until it
// failed there.
func TestWithSearchPathHandlesBothDSNForms(t *testing.T) {
	for _, tc := range []struct{ name, dsn, want string }{
		{"keyword", "host=127.0.0.1 user=x sslmode=disable", "host=127.0.0.1 user=x sslmode=disable search_path=s"},
		{"url with query", "postgres://x@127.0.0.1:5432/db?sslmode=disable", "postgres://x@127.0.0.1:5432/db?sslmode=disable&search_path=s"},
		{"url without query", "postgres://x@127.0.0.1:5432/db", "postgres://x@127.0.0.1:5432/db?search_path=s"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := withSearchPath(tc.dsn, "s"); got != tc.want {
				t.Fatalf("got %q, wanted %q", got, tc.want)
			}
		})
	}
}
