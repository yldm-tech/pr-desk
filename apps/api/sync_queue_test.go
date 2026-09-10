package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
)

func TestQueuedSyncSurvivesRequestAndWorkerRestart(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	token := OAuthToken{SessionID: "queue-recovery", Token: encrypted, HistorySyncedAt: &now}
	if err := db.Create(&token).Error; err != nil {
		t.Fatal(err)
	}
	// A stopped process cannot start its worker; the next instance must recover it.
	stopped, stop := context.WithCancel(context.Background())
	stop()
	s := &Server{db: db, workerCtx: stopped}
	router := gin.New()
	router.POST("/sync", s.syncGitHub)
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("POST", "/sync?full=1", nil).WithContext(ctx)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: token.SessionID})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	cancel()
	if response.Code != 202 {
		t.Fatalf("expected quick acceptance, got %d", response.Code)
	}
	var stored OAuthToken
	if err := db.First(&stored, token.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.SyncRequestedAt == nil || !stored.FullSyncPending {
		t.Fatal("accepted work was not durable")
	}
	if time.Now().Before(nextAutoSyncAt(stored, time.Now())) {
		t.Fatal("manual request incorrectly delayed by automatic cooldown")
	}
	old := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = old })
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":0,"items":[]}`)), Request: req}, nil
	})}
	(&Server{db: db}).syncDueSessions(context.Background())
	stored = OAuthToken{}
	if err := db.First(&stored, token.ID).Error; err != nil {
		t.Fatal(err)
	}
	if calls != 1 || stored.SyncRequestedAt != nil || stored.FullSyncPending || stored.HistorySyncedAt == nil || !stored.HistorySyncedAt.After(now) {
		t.Fatal("new worker did not complete queued full sync")
	}
}

func TestFailedLaterPagePreservesHistoryAndVisibility(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	token := OAuthToken{SessionID: "partial-page", Token: encrypted}
	if err := db.Create(&token).Error; err != nil {
		t.Fatal(err)
	}
	private := true
	if err := db.Create(&PullRequest{SessionID: token.SessionID, Number: 1, URL: "https://github.com/test/repo/pull/1", Repo: "test/repo", RepoPrivate: &private}).Error; err != nil {
		t.Fatal(err)
	}
	items := make([]*github.Issue, 100)
	for i := range items {
		items[i] = &github.Issue{Number: github.Ptr(i + 1), HTMLURL: github.Ptr(fmt.Sprintf("https://github.com/test/repo/pull/%d", i+1)), RepositoryURL: github.Ptr("https://api.github.com/repos/test/repo"), State: github.Ptr("closed"), Title: github.Ptr("saved page")}
	}
	body, _ := json.Marshal(map[string]interface{}{"total_count": 101, "items": items})
	old := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = old })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		status, response := 200, string(body)
		if req.URL.Query().Get("page") == "2" {
			status, response = 403, `{"message":"forbidden"}`
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(response)), Request: req}, nil
	})}
	s := &Server{db: db}
	for range 2 {
		result := s.syncSession(context.Background(), token.SessionID, false, false)
		if result.status != 403 {
			t.Fatalf("expected upstream failure, got %d", result.status)
		}
		var count int64
		db.Model(&PullRequest{}).Where("session_id = ?", token.SessionID).Count(&count)
		if count != 100 {
			t.Fatalf("partial page lost or duplicated: %d rows", count)
		}
	}
	var stored OAuthToken
	db.First(&stored, token.ID)
	if stored.HistorySyncedAt != nil {
		t.Fatal("partial history advanced checkpoint")
	}
	var first PullRequest
	db.Where("session_id = ? AND number = 1", token.SessionID).First(&first)
	if first.RepoPrivate == nil || !*first.RepoPrivate || first.Title != "saved page" {
		t.Fatal("page save erased cached visibility or failed to update title")
	}
}
