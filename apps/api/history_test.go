package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	github "github.com/google/go-github/v68/github"
	"golang.org/x/time/rate"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestHistorySplitsSearchCapWithoutGaps(t *testing.T) {
	unthrottledHistory(t)
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		q := req.URL.Query().Get("q")
		total, base := 0, 0
		switch {
		case strings.Contains(q, "created:2020-01-01T00:00:00Z..2020-01-01T00:00:03Z"):
			total = 1001
		case strings.Contains(q, "created:2020-01-01T00:00:00Z..2020-01-01T00:00:01Z"):
			total = 600
		case strings.Contains(q, "created:2020-01-01T00:00:02Z..2020-01-01T00:00:03Z"):
			total = 401
			base = 600
		default:
			t.Errorf("unexpected date partition %s", q)
		}
		page, _ := strconv.Atoi(req.URL.Query().Get("page"))
		items := []map[string]any{}
		if total <= 1000 {
			for i := (page - 1) * 100; i < page*100 && i < total; i++ {
				items = append(items, map[string]any{"number": base + i + 1, "html_url": fmt.Sprintf("https://github.com/test/repo/pull/%d", base+i+1)})
			}
		}
		body, _ := json.Marshal(map[string]any{"total_count": total, "items": items, "incomplete_results": false})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body))), Request: req}, nil
	})}
	start := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	rows, err := fetchHistory(context.Background(), githubClient("fixture"), "author:fixture type:pr", start, start.Add(3*time.Second))
	if err != nil || len(rows) != 1001 || calls != 12 {
		t.Fatalf("rows=%d calls=%d error=%v", len(rows), calls, err)
	}
	seen := map[int]bool{}
	for _, row := range rows {
		seen[row.GetNumber()] = true
	}
	if len(seen) != 1001 {
		t.Fatal("duplicate or missing history")
	}
}
func TestHistoryRejectsTruncatedPage(t *testing.T) {
	unthrottledHistory(t)
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":10,"items":[]}`)), Request: req}, nil
	})}
	_, err := fetchHistory(context.Background(), githubClient("fixture"), "author:fixture type:pr", time.Now().Add(-time.Hour), time.Now())
	if err == nil {
		t.Fatal("silently accepted missing records")
	}
}

func TestHistorySecondaryLimitRetriesSamePage(t *testing.T) {
	unthrottledHistory(t)
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	for _, tc := range []struct {
		name         string
		status, want int
		message      string
	}{
		{"secondary recovers", 403, 2, "You have exceeded a secondary rate limit."},
		{"permission is not retried", 403, 1, "Resource not accessible by integration"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.URL.Query().Get("page") != "2" {
					t.Error("retried wrong page")
				}
				status, body := 200, `{"total_count":0,"items":[]}`
				if calls == 1 {
					status = tc.status
					b, _ := json.Marshal(map[string]string{"message": tc.message, "documentation_url": func() string {
						if tc.want == 2 {
							return "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#secondary-rate-limits"
						}
						return ""
					}()})
					body = string(b)
				}
				return &http.Response{StatusCode: status, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
			})}
			_, err := searchHistoryPage(context.Background(), githubClient("fixture"), "type:pr", &github.SearchOptions{ListOptions: github.ListOptions{Page: 2}})
			if calls != tc.want || (err == nil) != (tc.want == 2) {
				t.Fatalf("calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestHistorySecondaryLimitWaitHonorsCancellation(t *testing.T) {
	unthrottledHistory(t)
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 403, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"message":"You have exceeded a secondary rate limit.","documentation_url":"https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#secondary-rate-limits"}`)), Request: req}, nil
	})}
	_, err := searchHistoryPage(ctx, githubClient("fixture"), "type:pr", &github.SearchOptions{})
	if !errors.Is(err, context.DeadlineExceeded) || calls != 1 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func TestHistorySecondaryLimitStopsAfterThreeAttempts(t *testing.T) {
	unthrottledHistory(t)
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 403, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(`{"message":"secondary rate limit","documentation_url":"https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#secondary-rate-limits"}`)), Request: req}, nil
	})}
	_, err := searchHistoryPage(context.Background(), githubClient("fixture"), "type:pr", &github.SearchOptions{})
	var limited *github.AbuseRateLimitError
	if calls != 3 || !errors.As(err, &limited) {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func unthrottledHistory(t *testing.T) {
	t.Helper()
	previous := historySearchLimiter
	historySearchLimiter = rate.NewLimiter(rate.Inf, 1)
	t.Cleanup(func() { historySearchLimiter = previous })
}

func TestHistoryPacingPreventsRequestAfterCancellation(t *testing.T) {
	previous := historySearchLimiter
	defer func() { historySearchLimiter = previous }()
	historySearchLimiter = rate.NewLimiter(rate.Every(time.Minute), 1)
	historySearchLimiter.Allow()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := searchHistoryPage(ctx, githubClient("fixture"), "type:pr", &github.SearchOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation before network, got %v", err)
	}
}
