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
