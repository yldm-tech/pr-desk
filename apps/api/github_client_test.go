package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestGitHubSDKTransport(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Fatal("missing SDK authentication")
		}
		code, body := 200, `{"login":"fixture-user"}`
		if calls == 1 {
			code, body = 503, `{}`
		}
		return &http.Response{StatusCode: code, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	user, _, err := githubClient("fixture").Users.Get(context.Background(), "")
	if err != nil || user.GetLogin() != "fixture-user" || calls != 2 {
		t.Fatalf("SDK retry/decode failed: calls=%d err=%v", calls, err)
	}
}

func TestGitHubSDKRejectsBadPayloadAndStatus(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	for _, status := range []int{200, 403} {
		githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("not JSON")), Request: r}, nil
		})}
		var target map[string]any
		if githubJSON(context.Background(), "fixture", "GET", "/user", nil, &target) == nil {
			t.Fatalf("accepted invalid response %d", status)
		}
	}
}
