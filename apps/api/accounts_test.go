package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestAccountReconnectAndBrowserIsolation(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	first, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "durable-a", Username: "fixture", Token: "encrypted-a"}, 1234, "browser-a")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&PullRequest{SessionID: first.SessionID, State: "open", Title: "persisted", Number: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&first).Updates(map[string]any{"created_at": time.Now().Add(-60 * 24 * time.Hour), "authorization_error": "reconnect"}).Error; err != nil {
		t.Fatal(err)
	}
	second, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "unused-new-partition", Username: "renamed", Token: "encrypted-b"}, 1234, "browser-b")
	if err != nil || second.ID != first.ID || second.SessionID != first.SessionID {
		t.Fatalf("reconnect did not preserve identity: %v", err)
	}
	other, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "durable-other", Username: "other", Token: "encrypted-c"}, 5678, "browser-other")
	if err != nil || other.ID == first.ID {
		t.Fatal("account isolation failed", err)
	}
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.GET("/prs", s.listPRs)
	r.GET("/settings", s.getFollowUpSettings)
	r.POST("/logout", s.logout)
	visible := func(cookie string) int {
		req := httptest.NewRequest("GET", "/prs", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var response struct{ Total int }
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Total
	}
	settingsStatus := func(cookie string) int {
		req := httptest.NewRequest("GET", "/settings", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	for _, cookie := range []string{"browser-a", "browser-b", "browser-other", "durable-a", "forged", ""} {
		req := httptest.NewRequest("GET", "/prs", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var response struct{ Total int }
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		want := 0
		if cookie == "browser-a" || cookie == "browser-b" {
			want = 1
		}
		if response.Total != want {
			t.Fatalf("cookie %s sees %d, want %d", cookie, response.Total, want)
		}
	}
	logout := httptest.NewRequest("POST", "/logout", nil)
	logout.AddCookie(&http.Cookie{Name: "pr_session", Value: "browser-a"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, logout)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var persisted OAuthToken
	if err := db.First(&persisted, first.ID).Error; err != nil {
		t.Fatal("logout deleted account", err)
	}
	if persisted.Token != "" || persisted.AuthorizationError != "disconnected" {
		t.Fatal("disconnect must pause account credentials")
	}
	var count int64
	db.Model(&PullRequest{}).Where("session_id = ?", first.SessionID).Count(&count)
	if count != 1 {
		t.Fatal("logout deleted history")
	}
	// Disconnect is the only sign-out control and it pauses the account everywhere, so the browser on the machine that was signed out of must lose it too.
	var sessions int64
	db.Model(&BrowserSession{}).Where("account_id = ?", first.ID).Count(&sessions)
	if sessions != 0 {
		t.Fatalf("disconnect left %d browser sessions holding the account", sessions)
	}
	if total := visible("browser-b"); total != 0 {
		t.Fatalf("a browser that was not the one signing out still reads %d pull requests", total)
	}
	if status := settingsStatus("browser-b"); status != 401 {
		t.Fatalf("a browser that was not the one signing out still reaches account settings: %d", status)
	}
	// Reconnecting must not revive it either: the old row is gone, and only the browser that reconnected holds the account.
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "unused-reconnect", Username: "fixture", Token: "encrypted-d"}, 1234, "browser-c"); err != nil {
		t.Fatal(err)
	}
	if total := visible("browser-b"); total != 0 {
		t.Fatalf("reconnecting revived an abandoned browser session: %d pull requests", total)
	}
	if total := visible("browser-c"); total != 1 {
		t.Fatalf("the reconnected browser cannot read its own account: %d pull requests", total)
	}
}

// Every sign-in mints a fresh partition, so the cache donor search can only ever
// matter for a first login. For a returning user it decrypted the account's own
// stored token and asked GitHub to confirm an identity the caller already knew,
// then threw the answer away — a GitHub round trip inside the sign-in request.
func TestReturningLoginDoesNotAskGitHubForACacheDonor(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{db: db}
	first, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "donor-storage", Username: "fixture", Token: encrypted}, 1234, "donor-browser")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&PullRequest{SessionID: first.SessionID, State: "open", Title: "cached", Number: 1}).Error; err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":1234,"login":"fixture"}`)), Request: r}, nil
	})}
	// The same login name as the stored account: a renamed one matches no candidate and would not exercise the donor search at all.
	second, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "unused-partition", Username: "fixture", Token: encrypted}, 1234, "donor-browser-2")
	if err != nil || second.ID != first.ID || second.SessionID != first.SessionID {
		t.Fatalf("reconnect did not preserve identity: %v", err)
	}
	if calls != 0 {
		t.Fatalf("a returning sign-in made %d GitHub requests to resolve a cache donor it then discarded", calls)
	}
}

func TestAccountPausedDataAndExpiredBrowser(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	account, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "paused-storage", Username: "fixture", Token: "x"}, 9876, "paused-browser")
	if err != nil {
		t.Fatal(err)
	}
	db.Model(&account).Updates(map[string]any{"authorization_error": "reconnect", "created_at": time.Now().Add(-60 * 24 * time.Hour)})
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.GET("/auth", s.authStatus)
	check := func(want bool) {
		req := httptest.NewRequest("GET", "/auth", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "paused-browser"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var response struct {
			Connected bool
			Paused    bool `json:"sync_paused"`
		}
		json.Unmarshal(w.Body.Bytes(), &response)
		if response.Connected != want || (want && !response.Paused) {
			t.Fatalf("wrong authorization status: %s", w.Body.String())
		}
	}
	check(true)
	db.Model(&BrowserSession{}).Where("id = ?", "paused-browser").Update("expires_at", time.Now().Add(-time.Hour))
	check(false)
}
