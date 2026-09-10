package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestRetryPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, method, retry string
		status, want        int
	}{{"transient", "GET", "0", 503, 3}, {"rate limited", "GET", "0", 429, 3}, {"long wait", "GET", "60", 429, 1}, {"permission", "GET", "", 403, 1}, {"mutation", "POST", "0", 503, 1}} {
		t.Run(tc.name, func(t *testing.T) {
			previous := githubHTTPClient
			defer func() { githubHTTPClient = previous }()
			calls := 0
			githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Retry-After": []string{tc.retry}}, Body: io.NopCloser(strings.NewReader("{}"))}, nil
			})}
			req, _ := http.NewRequest(tc.method, "https://api.github.com/test", nil)
			resp, err := githubDo(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if calls != tc.want {
				t.Fatalf("requests %d want %d", calls, tc.want)
			}
		})
	}
}

func TestRetryCancellationAndTransportErrors(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	calls := 0
	ctx, cancel := context.WithCancel(context.Background())
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		cancel()
		return nil, errors.New("connection failed")
	})}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/test", nil)
	_, err := githubDo(req)
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("cancellation: calls=%d error=%v", calls, err)
	}
	calls = 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) { calls++; return nil, errors.New("connection failed") })}
	req, _ = http.NewRequest("GET", "https://api.github.com/test", nil)
	_, err = githubDo(req)
	if err == nil || calls != 3 {
		t.Fatalf("transport retries: calls=%d error=%v", calls, err)
	}
}
