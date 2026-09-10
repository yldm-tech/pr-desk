package main

import (
	"context"
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
	User      struct {
		Login string `json:"login"`
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

func checkSummary(runs []checkRun, combined string) string {
	state := combined
	if state == "error" {
		state = "failure"
	}
	if state == "" {
		state = "unknown"
	}
	for _, r := range runs {
		if r.Status != "completed" {
			if state != "failure" {
				state = "pending"
			}
			continue
		}
		switch r.Conclusion {
		case "success", "neutral", "skipped":
			if state == "unknown" {
				state = "success"
			}
		case "failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale":
			state = "failure"
		default:
			if state != "failure" {
				state = "pending"
			}
		}
	}
	return state
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
	if s.db.Where("session_id = ? AND created_at > ?", requestSessionID(c), time.Now().Add(-30*24*time.Hour)).First(&stored).Error != nil {
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
