package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSchedulerRunsWithoutBrowserAndHonorsCheckpoint(t *testing.T) {
	unthrottledHistory(t)
	tx := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	active := OAuthToken{SessionID: "background-active", Token: encrypted, HistorySyncedAt: &old}
	if err := tx.Create(&active).Error; err != nil {
		t.Fatal(err)
	}
	tx.Create(&OAuthToken{SessionID: "expired", Token: encrypted, CreatedAt: time.Now().Add(-31 * 24 * time.Hour)})
	tx.Create(&OAuthToken{SessionID: "disconnected", Token: ""})
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	var calls atomic.Int32
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":0,"items":[]}`)), Request: req}, nil
	})}
	s := &Server{db: tx}
	ctx, cancel := context.WithCancel(context.Background())
	scheduler, err := s.startSyncScheduler(ctx, "@every 1s")
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() { cancel(); <-scheduler.Stop().Done() })
	deadline := time.Now().Add(5 * time.Second)
	// Do not issue concurrent queries on the fixture's transaction connection.
	for time.Now().Before(deadline) && calls.Load() < 2 {
		time.Sleep(20 * time.Millisecond)
	}
	<-scheduler.Stop().Done()
	var stored OAuthToken
	tx.First(&stored, active.ID)
	if stored.HistorySyncedAt == nil || !stored.HistorySyncedAt.After(old) {
		t.Fatal("scheduler never synchronized without an HTTP request")
	}
	// A second instance's scan must skip the just-completed session.
	(&Server{db: tx}).syncDueSessions(ctx)
	if calls.Load() != 2 {
		t.Fatalf("unexpected repeated or ineligible sync: %d searches", calls.Load())
	}
	cancel()
	<-scheduler.Stop().Done()
	before := calls.Load()
	s.syncDueSessions(ctx)
	if calls.Load() != before {
		t.Fatal("cancelled worker started network work")
	}
}
