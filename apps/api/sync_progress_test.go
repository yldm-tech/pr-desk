package main

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSyncProgressPersistsCountsAndIsolatesSessions(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "progress-a"})
	db.Create(&OAuthToken{SessionID: "progress-b"})
	tracker := &syncTracker{db: db, sid: "progress-a"}
	tracker.set("history", 100, 500)
	tracker.waiting(time.Now().Add(time.Minute))
	r := gin.New()
	s := &Server{db: db}
	r.GET("/progress", s.getSyncProgress)
	read := func(sid string) (int, syncProgress) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/progress", nil)
		if sid != "" {
			req.AddCookie(&http.Cookie{Name: "pr_session", Value: sid})
		}
		r.ServeHTTP(w, req)
		var p syncProgress
		json.Unmarshal(w.Body.Bytes(), &p)
		return w.Code, p
	}
	status, p := read("progress-a")
	if status != 200 || p.Phase != "waiting" || p.Completed != 100 || p.Total != 500 || p.RetryAt == 0 {
		t.Fatalf("invalid progress %#v", p)
	}
	_, other := read("progress-b")
	if other.Status != "idle" || other.Completed != 0 {
		t.Fatal("cross-session progress leak")
	}
	if code, _ := read(""); code != 401 {
		t.Fatal("anonymous progress exposed")
	}
	tracker.set("details", 0, 2)
	tracker.advance()
	tracker.advance()
	tracker.finish(true)
	_, p = read("progress-a")
	if p.Status != "complete" || p.Completed != 2 || p.RetryAt != 0 {
		t.Fatalf("invalid completion %#v", p)
	}
	tracker.set("history", 0, 0)
	tracker.finish(false)
	_, p = read("progress-a")
	if p.Status != "failed" {
		t.Fatal("failed sync remained running")
	}
}

func TestSyncFailureRetainsReasonAndRetryDeadline(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "failure-reason"})
	tracker := &syncTracker{db: db, sid: "failure-reason"}
	tracker.set("history", 0, 0)
	tracker.recordFailure(context.DeadlineExceeded)
	tracker.finishResult(false, syncResult{status: 502}, context.DeadlineExceeded)
	var token OAuthToken
	db.Where("session_id = ?", "failure-reason").First(&token)
	var progress syncProgress
	json.Unmarshal([]byte(token.SyncProgress), &progress)
	if progress.Status != "failed" || progress.ErrorCode != "timeout" {
		t.Fatalf("missing failure reason: %#v", progress)
	}
	tracker.set("history", 0, 0)
	delay := time.Hour
	tracker.recordFailure(&github.AbuseRateLimitError{RetryAfter: &delay})
	tracker.finish(false)
	db.Where("session_id = ?", "failure-reason").First(&token)
	json.Unmarshal([]byte(token.SyncProgress), &progress)
	if progress.ErrorCode != "rate_limited" || progress.RetryAt < time.Now().Add(59*time.Minute).Unix() {
		t.Fatal("failure discarded retry deadline")
	}
	if nextAutoSyncAt(token, time.Now()).Before(time.Now().Add(59 * time.Minute)) {
		t.Fatal("scheduler ignores GitHub retry deadline")
	}
}

func TestSyncPhasesPreserveEarlierCounts(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "stages"})
	tracker := &syncTracker{db: db, sid: "stages", mode: "incremental"}
	tracker.searchProgress(173, 173)
	tracker.beginOpenSearch(173)
	tracker.searchProgress(50, 50)
	tracker.summarize(173, 50)
	tracker.set("saving", 0, 180)
	tracker.set("details", 0, 50)
	tracker.advance()
	var token OAuthToken
	db.Where("session_id = ?", "stages").First(&token)
	var p syncProgress
	json.Unmarshal([]byte(token.SyncProgress), &p)
	if p.HistoryCount == nil || *p.HistoryCount != 173 || p.OpenCount == nil || *p.OpenCount != 50 || p.Phase != "details" || p.Completed != 1 {
		t.Fatalf("phase switch lost earlier counts: %#v", p)
	}
	tracker.waiting(time.Now().Add(time.Minute))
	if tracker.value.ResumePhase != "details" {
		t.Fatal("rate-limit wait lost active stage")
	}
}
