package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
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
	lastSynced := time.Now().UTC().Truncate(time.Second)
	if err := db.Model(&OAuthToken{}).Where("session_id = ?", "progress-a").Update("history_synced_at", lastSynced).Error; err != nil {
		t.Fatal(err)
	}
	_, p = read("progress-a")
	if p.Status != "complete" || p.Completed != 2 || p.RetryAt != 0 {
		t.Fatalf("invalid completion %#v", p)
	}
	if p.LastSyncedAt == nil || !p.LastSyncedAt.Equal(lastSynced) {
		t.Fatal("progress did not expose the successful sync timestamp")
	}
	_, other = read("progress-b")
	if other.LastSyncedAt != nil {
		t.Fatal("successful sync timestamp leaked between sessions")
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

// A failed detail phase used to report completed == total, because the counter
// advanced whether the item saved or not. "details 3/3" beside status failed
// reads as though everything landed, which is the opposite of what happened.
func TestFailedDetailDoesNotCountAsCompleted(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	token := OAuthToken{SessionID: "detail-progress", Token: encrypted}
	if err := db.Create(&token).Error; err != nil {
		t.Fatal(err)
	}
	// Only the second pull request is open, so the details phase runs a single
	// item. The mixed case needs a connection pool and has its own test.
	items := make([]*github.Issue, 2)
	for i := range items {
		state := "closed"
		if i == 1 {
			state = "open"
		}
		items[i] = &github.Issue{
			Number: github.Ptr(i + 1), HTMLURL: github.Ptr(fmt.Sprintf("https://github.com/test/repo/pull/%d", i+1)),
			RepositoryURL: github.Ptr("https://api.github.com/repos/test/repo"), State: github.Ptr(state), Title: github.Ptr("a pull request"),
		}
	}
	search, _ := json.Marshal(map[string]any{"total_count": len(items), "items": items})
	old := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = old })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		respond := func(status int, body string) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
		}
		switch {
		case strings.HasPrefix(req.URL.Path, "/search/issues"):
			return respond(200, string(search))
		case req.URL.Path == "/repos/test/repo/pulls/2":
			return respond(500, `{"message":"server error"}`)
		}
		return respond(200, `[]`)
	})}
	if result := (&Server{db: db}).syncSession(context.Background(), token.SessionID, false, false); result.status == 200 {
		t.Fatal("a failed detail phase reported success")
	}
	var stored OAuthToken
	if err := db.First(&stored, token.ID).Error; err != nil {
		t.Fatal(err)
	}
	var progress syncProgress
	if err := json.Unmarshal([]byte(stored.SyncProgress), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.Status != "failed" {
		t.Fatalf("the run did not record a failure: %#v", progress)
	}
	if progress.Phase != "details" || progress.Total != 1 {
		t.Fatalf("the failure was attributed to the wrong phase: %#v", progress)
	}
	if progress.Completed != 0 {
		t.Fatalf("completed is %d, but the only item of the phase failed: %#v", progress.Completed, progress)
	}
}

// The counter has to survive the phase running four goroutines at once: what an
// operator reads is the shortfall, so two saved out of three has to report 2/3
// rather than collapsing to all-or-nothing.
func TestPartlyFailedDetailPhaseCountsOnlyWhatSaved(t *testing.T) {
	db := integrationPoolDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	token := OAuthToken{SessionID: "detail-partial", Token: encrypted}
	if err := db.Create(&token).Error; err != nil {
		t.Fatal(err)
	}
	items := make([]*github.Issue, 3)
	for i := range items {
		items[i] = &github.Issue{
			Number: github.Ptr(i + 1), HTMLURL: github.Ptr(fmt.Sprintf("https://github.com/test/repo/pull/%d", i+1)),
			RepositoryURL: github.Ptr("https://api.github.com/repos/test/repo"), State: github.Ptr("open"), Title: github.Ptr("an open pull request"),
		}
	}
	search, _ := json.Marshal(map[string]any{"total_count": len(items), "items": items})
	old := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = old })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		respond := func(status int, body string) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
		}
		switch {
		case strings.HasPrefix(req.URL.Path, "/search/issues"):
			return respond(200, string(search))
		// Exactly one of the three cannot be read. The other two have to save,
		// so the shortfall is one rather than everything.
		case req.URL.Path == "/repos/test/repo/pulls/2":
			return respond(500, `{"message":"server error"}`)
		case strings.HasSuffix(req.URL.Path, "/pulls/1"), strings.HasSuffix(req.URL.Path, "/pulls/3"):
			return respond(200, `{"state":"open","title":"an open pull request"}`)
		}
		return respond(200, `[]`)
	})}
	if result := (&Server{db: db}).syncSession(context.Background(), token.SessionID, false, false); result.status == 200 {
		t.Fatal("a partly failed details phase reported success")
	}
	var stored OAuthToken
	if err := db.First(&stored, token.ID).Error; err != nil {
		t.Fatal(err)
	}
	var progress syncProgress
	if err := json.Unmarshal([]byte(stored.SyncProgress), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.Status != "failed" || progress.Phase != "details" || progress.Total != 3 {
		t.Fatalf("the failure was attributed to the wrong phase: %#v", progress)
	}
	if progress.Completed != 2 {
		t.Fatalf("completed is %d, wanted the two that saved: %#v", progress.Completed, progress)
	}
	// The two that saved really did save: the shortfall is a count an operator
	// can trust, not an artefact of where the errgroup happened to stop.
	var saved int64
	db.Model(&PullRequest{}).Where("session_id = ? AND checks_status <> ''", token.SessionID).Count(&saved)
	if saved != 2 {
		t.Fatalf("%d pull requests carry detail state, wanted the two that succeeded", saved)
	}
}

// "storage" names the layer and nothing else. Stored that way it is a bounded
// code by design, but the server log withheld the cause too, which left an
// operator unable to tell a constraint violation from a dropped connection.
func TestStorageFailureLogsItsCause(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "storage-cause"})
	tracker := &syncTracker{db: db, sid: "storage-cause"}
	tracker.set("details", 7, 9)

	var captured strings.Builder
	previous := log.Writer()
	log.SetOutput(&captured)
	t.Cleanup(func() { log.SetOutput(previous) })
	tracker.recordFailure(errors.Join(errDetailStorage, errors.New("duplicate key value violates unique constraint")))

	logged := captured.String()
	if !strings.Contains(logged, "code=storage") || !strings.Contains(logged, "phase=details") {
		t.Fatalf("the failure line lost its bounded fields: %q", logged)
	}
	if !strings.Contains(logged, "duplicate key value violates unique constraint") {
		t.Fatalf("the cause is still unavailable to an operator: %q", logged)
	}
	// The stored code stays bounded: the detail belongs in the log, not in a
	// column an API client reads back.
	var stored OAuthToken
	db.Where("session_id = ?", "storage-cause").First(&stored)
	if strings.Contains(stored.SyncProgress, "duplicate key") {
		t.Fatalf("the cause leaked into stored progress: %s", stored.SyncProgress)
	}
}

// Upstream failures can quote a GitHub URL or response body back at us, so they
// stay summarized to the code even in the log.
func TestUpstreamFailureDoesNotLogItsCause(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "upstream-cause"})
	tracker := &syncTracker{db: db, sid: "upstream-cause"}
	tracker.set("history", 0, 0)

	var captured strings.Builder
	previous := log.Writer()
	log.SetOutput(&captured)
	t.Cleanup(func() { log.SetOutput(previous) })
	tracker.recordFailure(errors.New("https://api.github.com/repos/private/secret returned nonsense"))

	if logged := captured.String(); strings.Contains(logged, "api.github.com") {
		t.Fatalf("an upstream URL reached the log: %q", logged)
	}
}
