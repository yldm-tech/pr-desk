package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestReviewTrackingSurvivesDisappearingSearchAndArchives(t *testing.T) {
	unthrottledHistory(t)
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	account := OAuthToken{SessionID: "review-owner", GitHubID: 42, Username: "me", Token: "fixture"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	stage := 0
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := "[]"
		switch req.URL.Path {
		case "/search/issues":
			body = `{"total_count":0,"items":[]}`
			if stage == 0 && strings.Contains(req.URL.Query().Get("q"), "review-requested:me") {
				body = `{"total_count":1,"items":[{"number":7,"title":"Review this","state":"open","html_url":"https://github.com/fixture/repo/pull/7","repository_url":"https://api.github.com/repos/fixture/repo","created_at":"2026-09-01T00:00:00Z","user":{"login":"author"}}]}`
			}
		case "/repos/fixture/repo/pulls/7":
			state, requests, sha := "open", `[]`, "a"
			if stage == 0 {
				requests = `[{"login":"me"}]`
			}
			if stage >= 2 {
				sha = "b"
			}
			if stage == 3 {
				state = "closed"
			}
			body = fmt.Sprintf(`{"title":"Review this","state":%q,"requested_reviewers":%s,"user":{"login":"author"},"head":{"sha":%q},"created_at":"2026-09-01T00:00:00Z"}`, state, requests, sha)
		case "/repos/fixture/repo/pulls/7/reviews":
			if stage > 0 {
				body = `[{"id":1,"state":"CHANGES_REQUESTED","submitted_at":"2026-09-09T00:00:00Z","user":{"login":"me"}}]`
			}
		case "/repos/fixture/repo/issues/7/timeline":
			body = `[{"event":"review_requested","created_at":"2026-09-08T00:00:00Z","requested_reviewer":{"login":"me"}}]`
		case "/repos/fixture/repo/commits/a/status", "/repos/fixture/repo/commits/b/status":
			body = `{"state":"success","total_count":1}`
		case "/repos/fixture/repo/commits/a/check-runs", "/repos/fixture/repo/commits/b/check-runs":
			body = `{"total_count":0,"check_runs":[]}`
		case "/repos/fixture/repo/commits/a", "/repos/fixture/repo/commits/b":
			body = `{"commit":{"committer":{"date":"2026-09-10T00:00:00Z"}}}`
		case "/repos/fixture/repo/pulls/7/comments", "/repos/fixture/repo/issues/7/comments":
		default:
			t.Errorf("unexpected GitHub call: %s", req.URL.Path)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	for stage = 0; stage < 4; stage++ {
		if err := s.syncReviewRequests(context.Background(), account, "fixture", now.AddDate(-1, 0, 0), now); err != nil {
			t.Fatalf("stage %d: %v", stage, err)
		}
		var follow FollowUp
		if err := db.Where("session_id = ?", account.SessionID).First(&follow).Error; err != nil {
			t.Fatal(err)
		}
		want := []bool{true, false, true, false}[stage]
		if follow.NeedsConfirmation != want {
			t.Fatalf("stage %d pending=%v facts=%s", stage, follow.NeedsConfirmation, follow.FactsJSON)
		}
		if stage == 3 && follow.ArchivedAt == nil {
			t.Fatal("closed reviewed PR never archived")
		}
	}
}
