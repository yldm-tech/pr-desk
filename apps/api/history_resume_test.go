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
