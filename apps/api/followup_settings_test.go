package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestSettingsValidateIsolateAndSurviveReconnect(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC().Truncate(time.Second)
	account, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "settings-owner", Username: "fixture", Token: "encrypted"}, 1001, "settings-browser")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "settings-other", Username: "another", Token: "encrypted"}, 1002, "other-browser"); err != nil {
		t.Fatal(err)
	}
	settings := FollowUpSettings{SessionID: account.SessionID, Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, TeamsJSON: "[]", RepositoryDaysJSON: "{}", BaselineAt: &now, InventoryAt: &now, LastDigestDate: "2026-09-10", LastDigestAt: &now}
	if err := db.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	follow := FollowUp{SessionID: account.SessionID, PullRequestID: 1, Version: 3, ReadVersion: 2, HandledVersion: 1, NeedsConfirmation: true, WaitingSince: now}
	if err := db.Create(&follow).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.GET("/settings", s.getFollowUpSettings)
	r.POST("/settings", s.saveFollowUpSettings)
	request := func(method, cookie, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	valid := `{"timezone":"Asia/Tokyo","digest_time":"09:00","wait_days":7,"teams":["fixture/reviewers"],"repository_days":{"fixture/slow":14}}`
	for _, cookie := range []string{"", "forged", account.SessionID} {
		if w := request("POST", cookie, valid); w.Code != 401 {
			t.Fatalf("invalid session %q accepted: %d", cookie, w.Code)
		}
	}
	for _, body := range []string{strings.Replace(valid, "Asia/Tokyo", "Local", 1), strings.Replace(valid, "09:00", "25:00", 1), strings.Replace(valid, `"wait_days":7`, `"wait_days":0`, 1), strings.Replace(valid, `"fixture/slow":14`, `"fixture/slow":366`, 1), strings.Replace(valid, "fixture/reviewers", "fixture team", 1)} {
		if w := request("POST", "settings-browser", body); w.Code != 400 {
			t.Fatalf("invalid preferences accepted: %d", w.Code)
		}
	}
	if w := request("POST", "settings-browser", valid); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	stored, err := loadFollowUpSettings(db, account.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.BaselineAt == nil || !stored.BaselineAt.Equal(now) || stored.LastDigestDate != "2026-09-10" || stored.InventoryAt == nil {
		t.Fatal("saving preferences reset notification/inventory checkpoints")
	}
	if stored.waitDays("fixture/slow") != 14 || stored.waitDays("fixture/normal") != 7 {
		t.Fatal("repository overrides not applied")
	}
	reconnected, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "unused", Username: "renamed", Token: "new-encrypted"}, 1001, "reconnected-browser")
	if err != nil || reconnected.ID != account.ID {
		t.Fatal("reconnect lost account", err)
	}
	var response settingsInput
	w := request("GET", "reconnected-browser", "")
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Timezone != "Asia/Tokyo" || response.RepositoryDays["fixture/slow"] != 14 || len(response.Teams) != 1 {
		t.Fatal("reconnect lost preferences", w.Body.String())
	}
	var preserved FollowUp
	if err := db.First(&preserved, follow.ID).Error; err != nil {
		t.Fatal(err)
	}
	if preserved.SessionID != reconnected.SessionID || preserved.Version != 3 || preserved.ReadVersion != 2 || preserved.HandledVersion != 1 || !preserved.NeedsConfirmation {
		t.Fatal("reconnect lost workflow")
	}
	w = request("GET", "other-browser", "")
	response = settingsInput{}
	json.Unmarshal(w.Body.Bytes(), &response)
	if response.Timezone != "UTC" || len(response.Teams) != 0 || len(response.RepositoryDays) != 0 {
		t.Fatal("read another account's preferences")
	}
}
