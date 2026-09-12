package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/go-github/v68/github"
)

// A full history walk of a large account is a hundred or more search requests
// over several minutes. Before the cursor, any interruption meant repeating all
// of them; the rows were already stored, so the second pass only spent quota.
func TestHistoryRecordsACursorForEachCompletedInterval(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"total_count":1,"incomplete_results":false,"items":[{"number":1,"html_url":"https://github.com/o/r/pull/1"}]}`
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	through := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	var marks []time.Time
	ctx := context.WithValue(context.Background(), historyCursorKey{}, historyCursor(func(completed time.Time) error {
		marks = append(marks, completed)
		return nil
	}))
	if _, err := fetchHistory(ctx, github.NewClient(githubHTTPClient), "author:fixture", from, through); err != nil {
		t.Fatal(err)
	}
	if len(marks) == 0 {
		t.Fatal("no interval was recorded, so an interrupted sync would start over")
	}
	if !marks[len(marks)-1].Equal(through) {
		t.Fatal("the final interval was not recorded", marks)
	}
}

// A resumed walk finishes reading records the interrupted run left behind, but
// everything before the cursor was read by that earlier run. Stamping the
// finished walk with the resuming run's clock means the incremental query and the
// still-open search that follow it never look at the interruption window again,
// so a pull request merged while the walk was down stays open in the dashboard
// forever.
func TestResumedWalkKeepsTheClockOfTheRunThatStartedIt(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("test-only-token")
	if err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":0,"incomplete_results":false,"items":[]}`)), Request: req}, nil
	})}
	s := &Server{db: db}
	walkStarted := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Second)
	cursor := walkStarted.Add(time.Hour)
	interrupted := OAuthToken{SessionID: "resumed-walk", Token: encrypted, HistoryCursor: &cursor, HistoryWalkStartedAt: &walkStarted}
	if err := db.Create(&interrupted).Error; err != nil {
		t.Fatal(err)
	}
	if result := s.syncSession(context.Background(), interrupted.SessionID, false, false); result.status != 200 {
		t.Fatal(result.body)
	}
	var stored OAuthToken
	if err := db.First(&stored, interrupted.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.HistoryWalkedAt == nil || !stored.HistoryWalkedAt.UTC().Equal(walkStarted) {
		t.Fatalf("the resumed walk claims to have read everything up to %v, not %v", stored.HistoryWalkedAt, walkStarted)
	}
	// The incremental query asks GitHub about everything changed since this one, so it has to move back with the walk.
	if stored.HistorySyncedAt == nil || !stored.HistorySyncedAt.UTC().Equal(walkStarted) {
		t.Fatalf("the next incremental run would start from %v, skipping the interruption window", stored.HistorySyncedAt)
	}
	if stored.HistoryCursor != nil || stored.HistoryWalkStartedAt != nil {
		t.Fatal("a finished walk left its resume state behind")
	}

	// An uninterrupted walk still stamps its own start, and records where it began so its own resume can use it.
	fresh := OAuthToken{SessionID: "fresh-walk", Token: encrypted}
	if err := db.Create(&fresh).Error; err != nil {
		t.Fatal(err)
	}
	started := time.Now().UTC()
	if result := s.syncSession(context.Background(), fresh.SessionID, false, false); result.status != 200 {
		t.Fatal(result.body)
	}
	var refreshed OAuthToken
	if err := db.First(&refreshed, fresh.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.HistoryWalkedAt == nil || refreshed.HistoryWalkedAt.UTC().Before(started) {
		t.Fatalf("a walk that resumed nothing did not stamp its own run: %v", refreshed.HistoryWalkedAt)
	}
}

// The cursor has to advance in creation-time order, otherwise resuming from it
// would skip records that were never fetched.
func TestHistoryCursorAdvancesInOrderAcrossSplitIntervals(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	requests := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		// The first answer is incomplete, which forces the interval to be split.
		// Its total is the count the walk then has to reach across both halves.
		if requests == 1 {
			body := `{"total_count":2,"incomplete_results":true,"items":[]}`
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
		}
		body := fmt.Sprintf(`{"total_count":1,"incomplete_results":false,"items":[{"number":%d,"html_url":"https://github.com/o/r/pull/%d"}]}`, requests, requests)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	through := time.Date(2026, 1, 1, 0, 0, 8, 0, time.UTC)
	var marks []time.Time
	ctx := context.WithValue(context.Background(), historyCursorKey{}, historyCursor(func(completed time.Time) error {
		marks = append(marks, completed)
		return nil
	}))
	if _, err := fetchHistory(ctx, github.NewClient(githubHTTPClient), "author:fixture", from, through); err != nil {
		t.Fatal(err)
	}
	if len(marks) < 2 {
		t.Fatal("the split did not record each half", marks)
	}
	for i := 1; i < len(marks); i++ {
		if !marks[i].After(marks[i-1]) {
			t.Fatal("the cursor moved backwards; resuming from it would skip records", marks)
		}
	}
	if !marks[len(marks)-1].Equal(through) {
		t.Fatal("the walk did not finish at the requested end", marks)
	}
}

// The point of the cursor: after an interruption the next walk starts where the
// last one stopped, instead of re-reading intervals whose rows are already
// stored. This asserts the queries themselves change, not just a stored value.
func TestResumedWalkDoesNotRefetchCompletedIntervals(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	through := time.Date(2026, 1, 1, 0, 0, 8, 0, time.UTC)

	var queries []string
	record := func(req *http.Request) { queries = append(queries, req.URL.Query().Get("q")) }

	// First walk: the second interval fails, so only the first is recorded.
	attempt := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		record(req)
		attempt++
		if attempt == 1 {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":2,"incomplete_results":true,"items":[]}`)), Request: req}, nil
		}
		if attempt == 2 {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":1,"incomplete_results":false,"items":[{"number":1,"html_url":"https://github.com/o/r/pull/1"}]}`)), Request: req}, nil
		}
		return &http.Response{StatusCode: 500, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"message":"upstream failure"}`)), Request: req}, nil
	})}
	var cursor *time.Time
	ctx := context.WithValue(context.Background(), historyCursorKey{}, historyCursor(func(completed time.Time) error {
		moment := completed
		cursor = &moment
		return nil
	}))
	if _, err := fetchHistory(ctx, github.NewClient(githubHTTPClient), "author:fixture", from, through); err == nil {
		t.Fatal("the interrupted walk reported success")
	}
	if cursor == nil {
		t.Fatal("nothing was recorded before the failure, so the work is lost")
	}
	if !cursor.Before(through) {
		t.Fatal("the cursor claims the walk finished", cursor)
	}

	// Second walk resumes after the cursor.
	queries = nil
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		record(req)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":1,"incomplete_results":false,"items":[{"number":9,"html_url":"https://github.com/o/r/pull/9"}]}`)), Request: req}, nil
	})}
	resumeFrom := cursor.Add(time.Second)
	if _, err := fetchHistory(context.Background(), github.NewClient(githubHTTPClient), "author:fixture", resumeFrom, through); err != nil {
		t.Fatal(err)
	}
	if len(queries) == 0 {
		t.Fatal("the resumed walk issued no query")
	}
	// No query may reach back before the cursor.
	for _, q := range queries {
		if strings.Contains(q, from.Format(time.RFC3339)) {
			t.Fatal("the resumed walk re-read an interval that was already stored:", q)
		}
	}
}
