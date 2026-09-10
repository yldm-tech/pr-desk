package main

import (
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIncrementalSyncPreservesHistoryAndCheckpointOnFailure(t *testing.T) {
	unthrottledHistory(t)
	tx := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	token, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	connection := OAuthToken{SessionID: "incremental", Token: token, HistorySyncedAt: &checkpoint, HistoryTotal: 1}
	if err := tx.Create(&connection).Error; err != nil {
		t.Fatal(err)
	}
	tx.Create(&PullRequest{SessionID: "incremental", Number: 1, URL: "https://github.com/test/repo/pull/1", Repo: "test/repo", State: "closed"})
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	fail := true
	queries := []string{}
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		q := r.URL.Query().Get("q")
		queries = append(queries, q)
		code, body := 200, `{"total_count":0,"items":[]}`
		if strings.Contains(q, "updated:>=") {
			body = `{"total_count":1,"items":[{"number":2,"html_url":"https://github.com/test/repo/pull/2","repository_url":"https://api.github.com/repos/test/repo","state":"closed","title":"new merge","pull_request":{"merged_at":"2026-09-09T00:00:00Z"}}]}`
		} else if !strings.Contains(q, "state:open") {
			t.Errorf("unexpected full scan: %s", q)
		}
		if fail && strings.Contains(q, "state:open") {
			code = 502
			body = `{"message":"unavailable"}`
		}
		return &http.Response{StatusCode: code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	router := gin.New()
	s := &Server{db: tx}
	router.POST("/sync", s.syncInlineForTest)
	run := func() int {
		req := httptest.NewRequest("POST", "/sync", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "incremental"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := run(); got != 502 {
		t.Fatalf("failure status %d", got)
	}
	var stored OAuthToken
	tx.First(&stored, connection.ID)
	if !stored.HistorySyncedAt.Equal(checkpoint) {
		t.Fatal("failure advanced checkpoint")
	}
	fail = false
	if got := run(); got != 200 {
		t.Fatalf("success status %d", got)
	}
	tx.First(&stored, connection.ID)
	if stored.HistoryTotal != 2 || !stored.HistorySyncedAt.After(checkpoint) {
		t.Fatalf("incorrect history metadata: count=%d", stored.HistoryTotal)
	}
	if !strings.Contains(queries[0], checkpoint.Add(-24*time.Hour).Format(time.RFC3339)) {
		t.Fatal("missing overlap window")
	}
	if got := run(); got != 200 {
		t.Fatalf("retry status %d", got)
	}
	tx.First(&stored, connection.ID)
	if stored.HistoryTotal != 2 {
		t.Fatal("duplicate history after retry")
	}
}

func TestFullSyncRequestPersistsAcrossFailure(t *testing.T) {
	unthrottledHistory(t)
	tx := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	token, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := time.Now().Add(-time.Hour)
	connection := OAuthToken{SessionID: "full-retry", Token: token, HistorySyncedAt: &checkpoint}
	tx.Create(&connection)
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	fail := true
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Query().Get("q"), "updated:") {
			t.Fatal("full retry unexpectedly incremental")
		}
		code, body := 200, `{"total_count":0,"items":[]}`
		if fail {
			code = 502
			body = `{"message":"unavailable"}`
		}
		return &http.Response{StatusCode: code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	router := gin.New()
	s := &Server{db: tx}
	router.POST("/sync", s.syncInlineForTest)
	run := func(path string) int {
		req := httptest.NewRequest("POST", path, nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "full-retry"})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	if run("/sync?full=1") != 502 {
		t.Fatal("expected upstream failure")
	}
	var stored OAuthToken
	tx.First(&stored, connection.ID)
	if !stored.FullSyncPending {
		t.Fatal("lost pending historical backfill")
	}
	fail = false
	if run("/sync") != 200 {
		t.Fatal("retry failed")
	}
	tx.First(&stored, connection.ID)
	if stored.FullSyncPending {
		t.Fatal("completed backfill still pending")
	}
}
