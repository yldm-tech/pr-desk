package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cenkalti/backoff/v5"
	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
)

func githubDo(req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodGet {
		return githubHTTPClient.Do(req)
	}
	attempt := 0
	return backoff.Retry(req.Context(), func() (*http.Response, error) {
		attempt++
		resp, err := githubHTTPClient.Do(req)
		if attempt == 3 {
			return resp, err
		}
		if err == nil && resp.StatusCode != 429 && (resp.StatusCode < 500 || resp.StatusCode > 599) {
			return resp, nil
		}
		wait := time.Duration(1<<(attempt-1)) * 250 * time.Millisecond
		if resp != nil {
			if raw := resp.Header.Get("Retry-After"); raw != "" {
				if seconds, e := strconv.Atoi(raw); e == nil && seconds >= 0 {
					if seconds > 10 {
						return resp, err
					}
					wait = time.Duration(seconds) * time.Second
				} else if date, e := http.ParseTime(raw); e == nil {
					wait = time.Until(date)
					if wait > 10*time.Second {
						return resp, err
					}
					if wait < 0 {
						wait = 0
					}
				} else {
					return resp, err
				}
			}
			resp.Body.Close()
		}
		return nil, &backoff.RetryAfterError{Duration: wait}
	}, backoff.WithMaxTries(3), backoff.WithMaxElapsedTime(0))
}

type activityComment struct {
	ID        uint64    `json:"id"`
	Body      string    `json:"body"`
	URL       string    `json:"html_url"`
	Path      string    `json:"path"`
	Line      *int      `json:"line"`
	ReplyTo   uint64    `json:"in_reply_to_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	User      struct {
		Login string `json:"login"`
		Type  string `json:"type"`
	} `json:"user"`
}
type reviewThread struct {
	ID         string `json:"id"`
	IsResolved bool   `json:"isResolved"`
	IsOutdated bool   `json:"isOutdated"`
	Path       string `json:"path"`
	Line       *int   `json:"line"`
	Comments   struct {
		Nodes []struct {
			DatabaseID uint64 `json:"databaseId"`
		} `json:"nodes"`
	} `json:"comments"`
}
type checkRun struct {
	ID         uint64 `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	URL        string `json:"html_url"`
}

// Adapt the tested retry policy to the SDK's HTTP transport.
type githubRetryTransport struct{}

func (githubRetryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return githubDo(req)
}
func githubClient(token string) *github.Client {
	return github.NewClient(&http.Client{Transport: githubRetryTransport{}, Timeout: githubHTTPClient.Timeout}).WithAuthToken(token)
}
func githubJSON(ctx context.Context, token, method, endpoint string, body any, target any) error {
	client := githubClient(token)
	req, err := client.NewRequest(method, strings.TrimPrefix(endpoint, "/"), body)
	if err != nil {
		return fmt.Errorf("invalid GitHub request")
	}
	_, err = client.Do(ctx, req, target)
	if err != nil {
		return &githubRequestError{cause: err}
	}
	return nil
}

// Retain typed rate-limit/status errors for retry classification without
// exposing upstream bodies, URLs or credentials in user-facing messages.
type githubRequestError struct{ cause error }

func (e *githubRequestError) Error() string { return "GitHub request unavailable" }
func (e *githubRequestError) Unwrap() error { return e.cause }

func fetchPages[T any](ctx context.Context, token, endpoint string) ([]T, error) {
	all := []T{}
	for page := 1; page <= 50; page++ {
		var items []T
		if err := githubJSON(ctx, token, "GET", fmt.Sprintf("%s?per_page=100&page=%d", endpoint, page), nil, &items); err != nil {
			return nil, err
		}
		all = append(all, items...)
		if len(items) < 100 {
			return all, nil
		}
	}
	return nil, fmt.Errorf("too many results; open GitHub for full activity")
}

func fetchThreads(ctx context.Context, token, owner, repo string, number int) ([]reviewThread, error) {
	const query = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated path line comments(first:1){nodes{databaseId}}} pageInfo{hasNextPage endCursor}}}}}`
	threads := []reviewThread{}
	var cursor *string
	for page := 0; page < 50; page++ {
		var result struct {
			Errors []struct{ Message string } `json:"errors"`
			Data   struct {
				Repository *struct {
					PullRequest *struct {
						ReviewThreads struct {
							Nodes    []reviewThread
							PageInfo struct {
								HasNextPage bool
								EndCursor   string
							}
						}
					}
				}
			}
		}
		err := githubJSON(ctx, token, "POST", "/graphql", map[string]any{"query": query, "variables": map[string]any{"owner": owner, "repo": repo, "number": number, "cursor": cursor}}, &result)
		if err != nil {
			return nil, err
		}
		if len(result.Errors) > 0 || result.Data.Repository == nil || result.Data.Repository.PullRequest == nil {
			return nil, fmt.Errorf("review thread status unavailable; check GitHub App permissions")
		}
		conn := result.Data.Repository.PullRequest.ReviewThreads
		threads = append(threads, conn.Nodes...)
		if !conn.PageInfo.HasNextPage {
			return threads, nil
		}
		if conn.PageInfo.EndCursor == "" || (cursor != nil && *cursor == conn.PageInfo.EndCursor) {
			return nil, fmt.Errorf("invalid GitHub pagination")
		}
		next := conn.PageInfo.EndCursor
		cursor = &next
	}
	return nil, fmt.Errorf("too many review threads")
}

func fetchChecks(ctx context.Context, token, base, sha string) ([]checkRun, error) {
	runs := []checkRun{}
	for page := 1; page <= 50; page++ {
		var result struct {
			TotalCount int        `json:"total_count"`
			Runs       []checkRun `json:"check_runs"`
		}
		if err := githubJSON(ctx, token, "GET", fmt.Sprintf("%s/commits/%s/check-runs?filter=latest&per_page=100&page=%d", base, sha, page), nil, &result); err != nil {
			return nil, err
		}
		runs = append(runs, result.Runs...)
		if len(runs) >= result.TotalCount || len(result.Runs) < 100 {
			return runs, nil
		}
	}
	return nil, fmt.Errorf("too many check runs")
}

// A run that a newer push superseded, that a concurrency group stopped, or that
// GitHub marked stale did not decide anything about the code. Reporting those
// as a failure is what makes a green branch look broken, so they get their own
// state: visible, named, but not the same alarm as a red test.
func inconclusiveCheck(conclusion string) bool {
	return conclusion == "cancelled" || conclusion == "stale"
}

func failingCheck(conclusion string) bool {
	switch conclusion {
	case "failure", "timed_out", "action_required", "startup_failure":
		return true
	}
	return false
}

// Precedence is failure, pending, inconclusive, success. A single red check
// outranks everything; an inconclusive one only shows through when nothing is
// actually failing or still running.
func checkSummary(runs []checkRun, combined string) string {
	state := combined
	if state == "error" {
		state = "failure"
	}
	if state == "" {
		state = "unknown"
	}
	inconclusive := false
	for _, r := range runs {
		if r.Status != "completed" {
			if state != "failure" {
				state = "pending"
			}
			continue
		}
		switch {
		case r.Conclusion == "success" || r.Conclusion == "neutral" || r.Conclusion == "skipped":
			if state == "unknown" {
				state = "success"
			}
		case inconclusiveCheck(r.Conclusion):
			inconclusive = true
		case failingCheck(r.Conclusion):
			state = "failure"
		default:
			if state != "failure" {
				state = "pending"
			}
		}
	}
	if inconclusive && state != "failure" && state != "pending" {
		return "inconclusive"
	}
	return state
}

// The maximum number of check runs recorded alongside a pull request. A branch
// with more unhealthy checks than this has a problem the list already conveys.
const maxRecordedChecks = 20

// checks reads back what the last successful detail sync recorded. A row stored
// before this column existed simply has nothing to report.
func (pr PullRequest) checks() []checkRunSummary {
	if pr.ChecksJSON == "" {
		return nil
	}
	var runs []checkRunSummary
	if json.Unmarshal([]byte(pr.ChecksJSON), &runs) != nil {
		return nil
	}
	return runs
}

type checkRunSummary struct {
	Name       string `json:"name"`
	Conclusion string `json:"conclusion" jsonschema:"failure, error, cancelled, stale, timed_out, action_required, or pending while still running"`
	URL        string `json:"url,omitempty"`
}

// A commit status is the older reporting API, still what Vercel, Netlify and
// most non-Actions integrations use. It carries no conclusion, only a state.
type commitStatus struct {
	Context string
	State   string
	URL     string
}

// unhealthyChecks names whatever is behind a non-green summary, failures first,
// so a caller can tell a broken test from a superseded run without asking
// GitHub again. Passing and skipped entries are left out: they are not why
// anyone looked.
//
// Both reporting APIs have to be read. A repository whose only failure is a
// commit status — a Vercel preview deployment, typically — summarises as
// "failure" through the combined state while contributing no check run at all,
// so walking runs alone leaves the caller with a red mark and no name.
func unhealthyChecks(runs []checkRun, statuses []commitStatus) []checkRunSummary {
	failures, others := []checkRunSummary{}, []checkRunSummary{}
	for _, r := range runs {
		summary := checkRunSummary{Name: r.Name, Conclusion: r.Conclusion, URL: r.URL}
		switch {
		case r.Status != "completed":
			summary.Conclusion = "pending"
			others = append(others, summary)
		case failingCheck(r.Conclusion):
			failures = append(failures, summary)
		case inconclusiveCheck(r.Conclusion):
			others = append(others, summary)
		}
	}
	for _, status := range statuses {
		summary := checkRunSummary{Name: status.Context, Conclusion: status.State, URL: status.URL}
		switch status.State {
		case "failure", "error":
			failures = append(failures, summary)
		case "pending":
			others = append(others, summary)
		}
	}
	combined := append(failures, others...)
	if len(combined) > maxRecordedChecks {
		combined = combined[:maxRecordedChecks]
	}
	return combined
}

func (s *Server) activity(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	var pr PullRequest
	if sessionPRQuery(c, s.db).First(&pr, id).Error != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	var stored OAuthToken
	if connectionQuery(s.db).Where("session_id = ?", requestSessionID(c)).First(&stored).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	token, err := decrypt(stored.Token)
	if err != nil {
		c.JSON(401, gin.H{"error": "reconnect GitHub"})
		return
	}
	repo := strings.TrimPrefix(pr.Repo, "https://api.github.com/repos/")
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		c.JSON(400, gin.H{"error": "invalid repository"})
		return
	}
	base := "/repos/" + repo
	warnings := []string{}
	issues, e := fetchPages[activityComment](c.Request.Context(), token, fmt.Sprintf("%s/issues/%d/comments", base, pr.Number))
	if e != nil {
		warnings = append(warnings, "Conversation: "+e.Error())
	}
	inline, e := fetchPages[activityComment](c.Request.Context(), token, fmt.Sprintf("%s/pulls/%d/comments", base, pr.Number))
	if e != nil {
		warnings = append(warnings, "Review comments: "+e.Error())
	}
	threads, e := fetchThreads(c.Request.Context(), token, parts[0], parts[1], pr.Number)
	if e != nil {
		warnings = append(warnings, "Review status: "+e.Error())
	}
	var detail struct{ Head struct{ SHA string } }
	runs := []checkRun{}
	if e := githubJSON(c.Request.Context(), token, "GET", fmt.Sprintf("%s/pulls/%d", base, pr.Number), nil, &detail); e != nil {
		warnings = append(warnings, "Checks: "+e.Error())
	} else if detail.Head.SHA != "" {
		runs, e = fetchChecks(c.Request.Context(), token, base, detail.Head.SHA)
		if e != nil {
			warnings = append(warnings, "Checks: "+e.Error())
		}
	}
	c.JSON(200, gin.H{"conversation": issues, "review_comments": inline, "threads": threads, "checks": runs, "warnings": warnings})
}
