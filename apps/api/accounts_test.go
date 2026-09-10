package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	r.POST("/logout", s.logout)
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
