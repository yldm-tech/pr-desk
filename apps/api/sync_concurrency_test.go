package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestConcurrentSyncRejectedAndFailureReleasesSlot(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", strings.Repeat("t", 32))
	token, err := crypt("fixture-token")
	if err != nil {
		t.Fatal(err)
	}
	for _, sid := range []string{"sync-a", "sync-b"} {
		if err := db.Create(&OAuthToken{SessionID: sid, Token: token}).Error; err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{db: db}
	r := gin.New()
	r.POST("/sync", s.syncInlineForTest)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan int, 1)
	finished := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	previous := githubHTTPClient
	var calls atomic.Int32
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
			return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader(`{}`)), Header: make(http.Header)}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"items":[]}`)), Header: make(http.Header)}, nil
	})}
	defer func() { githubHTTPClient = previous }()
	request := func(sid string) int {
		req := httptest.NewRequest("POST", "/sync", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: sid})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	go func() { defer close(finished); done <- request("sync-a") }()
	// Always unblock and join the worker before restoring its HTTP client.
	defer func() {
		unblock()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("sync did not finish")
		}
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("sync never reached GitHub")
	}
	if code := request("sync-a"); code != 409 {
		t.Fatalf("duplicate returned %d", code)
	}
	if code := request("sync-b"); code != 200 {
		t.Fatalf("independent session returned %d", code)
	}
	// Release explicitly while keeping cleanup safe.
	unblock()
	select {
	case code := <-done:
		if code != 403 {
			t.Fatalf("failure returned %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("failure did not release")
	}
	if code := request("sync-a"); code != 200 {
		t.Fatalf("retry after failure returned %d", code)
	}
	if calls.Load() != 3 {
		t.Fatalf("unexpected GitHub request count %d", calls.Load())
	}
}
