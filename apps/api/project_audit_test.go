package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
)

func TestDetailsIncludeActionsAndRefreshCommentNamespaces(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	activityTime := time.Now().UTC().Add(-24 * time.Hour).Truncate(time.Second)
	pr := PullRequest{SessionID: "details", Number: 1, Repo: "o/r", URL: "https://github.com/o/r/pull/1", State: "open", HasConflicts: true, UpdatedAt: activityTime}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	var issue github.Issue
	if err := json.Unmarshal([]byte(`{"number":1,"state":"open","html_url":"https://github.com/o/r/pull/1","repository_url":"https://api.github.com/repos/o/r"}`), &issue); err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	conclusion, body := "failure", "first"
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		payload := "[]"
		switch r.URL.Path {
		case "/repos/o/r/pulls/1":
			payload = `{"mergeable":null,"comments":1,"review_comments":1,"requested_reviewers":[{"login":"reviewer"}],"head":{"sha":"abc"}}`
		case "/repos/o/r/commits/abc/status":
			payload = `{"state":"pending","total_count":0,"statuses":[]}`
		case "/repos/o/r/commits/abc/check-runs":
			payload = `{"total_count":1,"check_runs":[{"id":1,"status":"completed","conclusion":"` + conclusion + `"}]}`
		case "/repos/o/r/pulls/1/comments", "/repos/o/r/issues/1/comments":
			payload = `[{"id":7,"body":"` + body + `","html_url":"https://github.com/o/r/pull/1","user":{"login":"reviewer"}}]`
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(payload)), Request: r}, nil
	})}
	if err := s.syncPRDetails(context.Background(), "fixture", pr.SessionID, &issue); err != nil {
		t.Fatal(err)
	}
	var stored PullRequest
	db.First(&stored, pr.ID)
	if stored.ChecksStatus != "failure" || stored.ReviewStatus != "review_requested" || !stored.HasConflicts {
		t.Fatalf("incorrect detail state: %+v", stored)
	}
	if !stored.UpdatedAt.Equal(activityTime) {
		t.Fatal("poll time replaced GitHub activity time")
	}
	var comments []ReviewComment
	db.Where("session_id = ?", pr.SessionID).Find(&comments)
	if len(comments) != 2 || comments[0].CommentType == comments[1].CommentType {
		t.Fatal("comment ID namespaces collided")
	}
	conclusion, body = "success", "edited"
	if err := s.syncPRDetails(context.Background(), "fixture", pr.SessionID, &issue); err != nil {
		t.Fatal(err)
	}
	db.First(&stored, pr.ID)
	db.Where("session_id = ?", pr.SessionID).Find(&comments)
	if stored.ChecksStatus != "success" {
		t.Fatal("empty legacy statuses hid successful Actions")
	}
	for _, c := range comments {
		if c.Body != "edited" {
			t.Fatal("edited comment was not refreshed")
		}
	}
	if err := db.Exec("ALTER TABLE review_comments ADD CONSTRAINT reject_fixture CHECK (body <> 'reject')").Error; err != nil {
		t.Fatal(err)
	}
	conclusion, body = "failure", "reject"
	if err := s.syncPRDetails(context.Background(), "fixture", pr.SessionID, &issue); !errors.Is(err, errDetailStorage) {
		t.Fatalf("storage failure lost: %v", err)
	}
	db.First(&stored, pr.ID)
	if stored.ChecksStatus != "success" {
		t.Fatal("failed comment transaction overwrote cached check state")
	}
}

// The excerpt a follow-up shows is most often the prose somebody submitted with a review, and get_follow_up answered "here is the full thread" with nothing at all until those bodies were stored beside the comments.
func TestReviewProseIsStoredAsItsOwnComment(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	pr := PullRequest{SessionID: "reviews", Number: 2, Repo: "o/r", URL: "https://github.com/o/r/pull/2", State: "open"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	var issue github.Issue
	if err := json.Unmarshal([]byte(`{"number":2,"state":"open","html_url":"https://github.com/o/r/pull/2","repository_url":"https://api.github.com/repos/o/r"}`), &issue); err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	body := "Please cover the timezone boundary."
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		payload := "[]"
		switch r.URL.Path {
		case "/repos/o/r/pulls/2":
			payload = `{"mergeable":true,"head":{"sha":"abc"}}`
		case "/repos/o/r/commits/abc/status":
			payload = `{"state":"success","total_count":1,"statuses":[{"context":"ci","state":"success"}]}`
		case "/repos/o/r/commits/abc/check-runs":
			payload = `{"total_count":0,"check_runs":[]}`
		case "/repos/o/r/pulls/2/reviews":
			// An unsubmitted draft is visible to nobody but its author, and a review with no prose is only the envelope around inline comments that are stored separately.
			payload = `[{"id":31,"state":"CHANGES_REQUESTED","body":"` + body + `","html_url":"https://github.com/o/r/pull/2#pullrequestreview-31","submitted_at":"2026-09-01T00:00:00Z","user":{"login":"reviewer"}},
				{"id":32,"state":"COMMENTED","body":"","submitted_at":"2026-09-02T00:00:00Z","user":{"login":"reviewer"}},
				{"id":33,"state":"PENDING","body":"still writing","submitted_at":"2026-09-03T00:00:00Z","user":{"login":"reviewer"}}]`
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(payload)), Request: r}, nil
	})}
	if err := s.syncPRDetails(context.Background(), "fixture", pr.SessionID, &issue); err != nil {
		t.Fatal(err)
	}
	var stored []ReviewComment
	db.Where("session_id = ?", pr.SessionID).Find(&stored)
	if len(stored) != 1 {
		t.Fatalf("expected only the submitted review body: %+v", stored)
	}
	if stored[0].CommentType != "summary" || stored[0].Body != body || stored[0].Author != "reviewer" || stored[0].URL == "" {
		t.Fatalf("review prose stored incorrectly: %+v", stored[0])
	}
	body = "Edited after a rethink."
	if err := s.syncPRDetails(context.Background(), "fixture", pr.SessionID, &issue); err != nil {
		t.Fatal(err)
	}
	db.Where("session_id = ?", pr.SessionID).Find(&stored)
	if len(stored) != 1 || stored[0].Body != body {
		t.Fatalf("edited review prose was not refreshed: %+v", stored)
	}
}

// Both timestamps come from the same submission, and the review key sorts above the comment key, so the empty envelope used to win the tie and leave the excerpt blank.
func TestEmptyReviewKeepsTheExcerptOfItsInlineComment(t *testing.T) {
	at := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	inline := activityComment{ID: 7, Body: "This misses the leap second.", URL: "https://github.com/o/r/pull/2#discussion_r7", CreatedAt: at}
	inline.User.Login = "reviewer"
	review := githubReview{ID: 31, State: "COMMENTED", SubmittedAt: at}
	review.User.Login = "reviewer"
	var facts FollowUpFacts
	snapshotHumanFacts(&facts, "author", []activityComment{inline}, []githubReview{review})
	if facts.HumanExcerpt != inline.Body {
		t.Fatalf("empty review body replaced the excerpt: %q", facts.HumanExcerpt)
	}
}

// Most approvals are a button press and nothing else. Dropping a review that carries no prose would leave the author with no notification, no unread mark and a waiting clock still running.
func TestAnApprovalWithNoProseIsStillHumanActivity(t *testing.T) {
	at := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	for _, state := range []string{"APPROVED", "DISMISSED"} {
		review := githubReview{ID: 31, State: state, SubmittedAt: at}
		review.User.Login = "reviewer"
		var facts FollowUpFacts
		snapshotHumanFacts(&facts, "author", nil, []githubReview{review})
		if !facts.HumanAt.Equal(at) || facts.HumanVersion == "" {
			t.Fatalf("a bare %s review registered no activity: %+v", state, facts)
		}
	}
}

func TestGitHubJSONPreservesTypedErrorsWithoutDisclosingBody(t *testing.T) {
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 403, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"message":"private-upstream-detail"}`)), Request: r}, nil
	})}
	var result any
	err := githubJSON(context.Background(), "fixture", "GET", "/repos/o/r", nil, &result)
	var upstream *github.ErrorResponse
	if !errors.As(err, &upstream) || upstream.Response.StatusCode != 403 {
		t.Fatalf("lost upstream status: %v", err)
	}
	if strings.Contains(err.Error(), "private-upstream-detail") {
		t.Fatal("exposed upstream response body")
	}
}

func TestBothPRLookupsRejectSQLExpressions(t *testing.T) {
	s := &Server{}
	r := gin.New()
	r.GET("/prs/:id", s.getPR)
	r.GET("/prs/:id/activity", s.activity)
	for _, path := range []string{"/prs/1%20OR%201=1", "/prs/1%20OR%201=1/activity", "/prs/0/activity", "/prs/18446744073709551616/activity"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatalf("unsafe ID accepted: %s", path)
		}
	}
}

func TestAllOverviewDoesNotRequireUpstreamVisibility(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "cached"})
	db.Create(&PullRequest{SessionID: "cached", Repo: "deleted/repository", State: "open"})
	s := &Server{db: db}
	r := gin.New()
	r.GET("/overview", s.overview)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/overview?visibility=all", nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "cached"})
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("cached all view required GitHub visibility: %s", w.Body.String())
	}
}

func TestLogoutFailureDoesNotReportSuccessfulDisconnect(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "disconnect"})
	s := &Server{db: db}
	r := gin.New()
	r.POST("/logout", s.logout)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest("POST", "/logout", nil).WithContext(ctx)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "disconnect"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 503 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("failed disconnect was acknowledged: %d", w.Code)
	}
	var count int64
	db.Model(&OAuthToken{}).Where("session_id = ?", "disconnect").Count(&count)
	if count != 1 {
		t.Fatal("unexpected connection loss")
	}
}
