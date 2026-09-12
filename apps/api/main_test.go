package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// database/sql is unbounded by default while a single sync pins one connection
// for its whole run and opens four more for details, so a burst of first logins
// could exhaust PostgreSQL and take every query with it, /health included.
func TestPoolLimitsStayWithinTheDatabaseAndAboveOneSync(t *testing.T) {
	open := func(t *testing.T) *sql.DB {
		t.Helper()
		// Nothing connects: SetMaxOpenConns is recorded on the pool itself.
		pool, err := sql.Open("pgx", "postgres://unused@127.0.0.1:1/unused")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Close() })
		return pool
	}
	pool := open(t)
	applyPoolLimits(pool)
	if got := pool.Stats().MaxOpenConnections; got != poolMaxOpenConns {
		t.Fatalf("the pool is capped at %d, want %d", got, poolMaxOpenConns)
	}
	t.Run("configured", func(t *testing.T) {
		t.Setenv("DATABASE_MAX_OPEN_CONNS", "12")
		pool := open(t)
		applyPoolLimits(pool)
		if got := pool.Stats().MaxOpenConnections; got != 12 {
			t.Fatalf("the configured ceiling was ignored: %d", got)
		}
	})
	// A ceiling below a single sync's own footprint deadlocks that sync against itself, so it is clamped rather than documented.
	t.Run("clamped", func(t *testing.T) {
		t.Setenv("DATABASE_MAX_OPEN_CONNS", "2")
		pool := open(t)
		applyPoolLimits(pool)
		if got := pool.Stats().MaxOpenConnections; got != poolMinOpenConns {
			t.Fatalf("a ceiling of 2 was accepted as %d; one sync cannot complete under it", got)
		}
	})
}

// The primary key belongs to the sequence. A body carrying its own id inserted
// around nextval, and the sync insert that later reached that value failed on a
// duplicate key; posting the same pull request twice left two rows that every
// count sees and only one of which detail refreshes ever reach.
func TestCreatePRIgnoresClientIDsAndDoesNotDuplicate(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&OAuthToken{SessionID: "create-session", Token: "stored"}).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{db: db}
	r := gin.New()
	r.POST("/pull-requests", s.createPR)
	post := func(body string) PullRequest {
		req := httptest.NewRequest("POST", "/pull-requests", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "create-session"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 201 {
			t.Fatalf("create failed: %d %s", w.Code, w.Body.String())
		}
		var stored PullRequest
		if err := json.Unmarshal(w.Body.Bytes(), &stored); err != nil {
			t.Fatal(err)
		}
		return stored
	}
	first := post(`{"id":900000,"url":"https://github.com/o/r/pull/1","number":1,"title":"first"}`)
	if first.ID == 0 || first.ID >= 900000 {
		t.Fatalf("the client's primary key was stored: %d", first.ID)
	}
	second := post(`{"id":900001,"url":"https://github.com/o/r/pull/1","number":1,"title":"second"}`)
	if second.ID != first.ID {
		t.Fatalf("the same pull request was stored twice: %d and %d", first.ID, second.ID)
	}
	var count int64
	db.Model(&PullRequest{}).Where("session_id = ? AND url = ?", "create-session", "https://github.com/o/r/pull/1").Count(&count)
	if count != 1 {
		t.Fatalf("%d rows for one pull request", count)
	}
	if second.Title != "second" {
		t.Fatalf("a repeated post did not refresh the row: %q", second.Title)
	}
	// The sequence has to be the only source of keys, or the next sync insert collides with the planted one.
	next := PullRequest{SessionID: "create-session", Number: 2, URL: "https://github.com/o/r/pull/2"}
	if err := db.Create(&next).Error; err != nil {
		t.Fatal("a later insert collided with a client-chosen id", err)
	}
	if next.ID >= 900000 {
		t.Fatalf("the sequence was dragged past the client's id: %d", next.ID)
	}
}

// A login or manual sync runs in a goroutine nobody holds, and on cancellation it
// still needs the round trips that store status "interrupted". Exiting before
// they land leaves the account reporting a run that stopped, which suppresses its
// automatic sync for twenty minutes and disables the manual one.
func TestShutdownWaitsForTheInterruptedSyncCheckpoint(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	account := OAuthToken{SessionID: "shutdown-session", Token: encrypted}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	started := make(chan struct{}, 1)
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-req.Context().Done()
		return nil, req.Context().Err()
	})}
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	s := &Server{db: db, workerCtx: workerCtx}
	done := s.startLoginSync(account.SessionID)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		stopWorkers()
		t.Fatal("the sync never reached GitHub")
	}
	stopWorkers()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s.waitForSyncWorkers(shutdown)
	var stored OAuthToken
	if err := db.First(&stored, account.ID).Error; err != nil {
		t.Fatal(err)
	}
	var progress syncProgress
	if err := json.Unmarshal([]byte(stored.SyncProgress), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.Status != "interrupted" || progress.ErrorCode != "interrupted" {
		t.Fatalf("the checkpoint the shutdown was supposed to wait for was lost: %s", stored.SyncProgress)
	}
	// A row still claiming to run costs the account twenty minutes of silence on the next process.
	if next := nextAutoSyncAt(stored, time.Now()); next.After(time.Now().Add(time.Minute)) {
		t.Fatalf("the restarted process would skip this account until %s", next)
	}
	<-done
}

func TestSafeRequestIDRejectsAnythingThatCouldForgeALogLine(t *testing.T) {
	for _, accepted := range []string{"abc123", "a.b_c-D9", strings.Repeat("x", 64)} {
		if safeRequestID(accepted) != accepted {
			t.Fatalf("a usable request id was rejected: %q", accepted)
		}
	}
	for _, rejected := range []string{"", "bad\r\nHTTP GET /admin 200", "with space", "quote\"", strings.Repeat("x", 65)} {
		if got := safeRequestID(rejected); got != "" {
			t.Fatalf("%q was accepted as %q", rejected, got)
		}
	}
}
