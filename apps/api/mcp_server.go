package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

// Reported to MCP clients during initialization.
const mcpServerVersion = "1"

// The MCP surface is deliberately narrower than the HTTP API: it reads the
// follow-up workspace and changes local handling state, and it never touches
// settings, notification destinations or the GitHub account itself. An agent
// that misbehaves can mark something read; it cannot reroute notifications or
// disconnect the account.

type mcpSession struct {
	sessionID string
	scopes    []string
}

func sessionFromContext(ctx context.Context) (mcpSession, error) {
	info := auth.TokenInfoFromContext(ctx)
	if info == nil || info.UserID == "" {
		return mcpSession{}, errors.New("this tool requires an authorized session")
	}
	return mcpSession{sessionID: info.UserID, scopes: info.Scopes}, nil
}

func (m mcpSession) requireWrite() error {
	for _, scope := range m.scopes {
		if scope == scopeFollowUpsWrite {
			return nil
		}
	}
	return errors.New("this token was issued for reading only; reauthorize with the " + scopeFollowUpsWrite + " scope")
}

// Tool results carry structured output; the text block repeats the essentials
// so a client that only renders text still shows something useful.
func toolResult(summary string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: summary}}}
}

type listFollowUpsInput struct {
	State      string `json:"state,omitempty" jsonschema:"Only return follow-ups in this state: action, waiting, follow_up, draft or archived"`
	Role       string `json:"role,omitempty" jsonschema:"Only return follow-ups where you are the authored or reviewer party"`
	Repository string `json:"repository,omitempty" jsonschema:"Only return follow-ups for this owner/name repository"`
	Limit      int    `json:"limit,omitempty" jsonschema:"Maximum number of follow-ups to return (default 30, maximum 200)"`
}

type followUpOutput struct {
	ID         uint     `json:"id" jsonschema:"Identifier to pass to the follow-up tools"`
	Version    uint64   `json:"version" jsonschema:"Pass this back when changing the follow-up; a mismatch means new activity arrived"`
	Repository string   `json:"repository"`
	Number     int      `json:"number"`
	Title      string   `json:"title"`
	URL        string   `json:"url"`
	Role       string   `json:"role"`
	State      string   `json:"state"`
	Reasons    []string `json:"reasons"`
	Unread     bool     `json:"unread"`
	Excerpt    string   `json:"excerpt,omitempty" jsonschema:"The most recent human comment that needs attention"`
	WaitingFor int      `json:"waiting_days"`
}

type listFollowUpsOutput struct {
	FollowUps []followUpOutput `json:"follow_ups"`
	Total     int              `json:"total" jsonschema:"Number of follow-ups matching the filter before the limit was applied"`
}

func (s *Server) mcpListFollowUps(ctx context.Context, _ *mcp.CallToolRequest, in listFollowUpsInput) (*mcp.CallToolResult, listFollowUpsOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, listFollowUpsOutput{}, err
	}
	rows, err := s.accountFollowUps(ctx, session.sessionID)
	if err != nil {
		return nil, listFollowUpsOutput{}, errors.New("unable to load follow-ups")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}
	now := time.Now()
	out := listFollowUpsOutput{FollowUps: []followUpOutput{}}
	for _, row := range rows {
		if in.State != "" && row.State != in.State {
			continue
		}
		if in.Role != "" && row.Role != in.Role {
			continue
		}
		if in.Repository != "" && !strings.EqualFold(row.PR.Repo, in.Repository) {
			continue
		}
		out.Total++
		if len(out.FollowUps) >= limit {
			continue
		}
		waiting := 0
		if !row.WaitingSince.IsZero() {
			if days := int(now.Sub(row.WaitingSince).Hours() / 24); days > 0 {
				waiting = days
			}
		}
		out.FollowUps = append(out.FollowUps, followUpOutput{
			ID: row.ID, Version: row.Version, Repository: row.PR.Repo, Number: row.PR.Number, Title: row.PR.Title,
			URL: row.PR.URL, Role: row.Role, State: row.State, Reasons: row.Reasons, Unread: row.Unread,
			Excerpt: row.Excerpt, WaitingFor: waiting,
		})
	}
	return toolResult(fmt.Sprintf("%d follow-ups match; returning %d.", out.Total, len(out.FollowUps))), out, nil
}

type summaryOutput struct {
	NeedsAction   int  `json:"needs_action"`
	AwaitingOther int  `json:"awaiting_others"`
	TimeToFollow  int  `json:"time_to_follow_up"`
	Drafts        int  `json:"drafts"`
	Unread        int  `json:"unread"`
	Baseline      bool `json:"baseline_complete" jsonschema:"False while the first inventory is still syncing, meaning an empty list is not conclusive"`
}

func (s *Server) mcpFollowUpSummary(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, summaryOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, summaryOutput{}, err
	}
	rows, err := s.accountFollowUps(ctx, session.sessionID)
	if err != nil {
		return nil, summaryOutput{}, errors.New("unable to load follow-ups")
	}
	settings, err := loadFollowUpSettings(s.db, session.sessionID)
	if err != nil {
		return nil, summaryOutput{}, errors.New("unable to load preferences")
	}
	out := summaryOutput{Baseline: settings.BaselineAt != nil}
	for _, row := range rows {
		switch row.State {
		case "action":
			out.NeedsAction++
		case "waiting":
			out.AwaitingOther++
		case "follow_up":
			out.TimeToFollow++
		case "draft":
			out.Drafts++
		}
		if row.Unread {
			out.Unread++
		}
	}
	return toolResult(fmt.Sprintf("%d need action, %d waiting on others, %d ready to follow up.", out.NeedsAction, out.AwaitingOther, out.TimeToFollow)), out, nil
}

type pullRequestInput struct {
	Repository string `json:"repository,omitempty" jsonschema:"Only return pull requests in this owner/name repository"`
	Query      string `json:"query,omitempty" jsonschema:"Case-insensitive match against the title"`
	Limit      int    `json:"limit,omitempty" jsonschema:"Maximum number of pull requests to return (default 30, maximum 200)"`
}

type pullRequestOutput struct {
	ID          uint   `json:"id"`
	Repository  string `json:"repository"`
	Number      int    `json:"number"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	State       string `json:"state"`
	ReviewState string `json:"review_state,omitempty"`
	Checks      string `json:"checks,omitempty"`
	Draft       bool   `json:"draft"`
	Conflict    bool   `json:"conflict"`
	UpdatedAt   string `json:"updated_at" jsonschema:"GitHub activity time, not the time PR Desk last polled"`
}

type pullRequestListOutput struct {
	PullRequests []pullRequestOutput `json:"pull_requests"`
	Total        int                 `json:"total"`
}

func (s *Server) mcpListPullRequests(ctx context.Context, _ *mcp.CallToolRequest, in pullRequestInput) (*mcp.CallToolResult, pullRequestListOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, pullRequestListOutput{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}
	query := s.db.WithContext(ctx).Model(&PullRequest{}).Where("session_id = ?", session.sessionID)
	if in.Repository != "" {
		query = query.Where("repo = ?", in.Repository)
	}
	if in.Query != "" {
		query = query.Where("title ILIKE ?", "%"+in.Query+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, pullRequestListOutput{}, errors.New("unable to load pull requests")
	}
	var rows []PullRequest
	if err := query.Order("updated_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, pullRequestListOutput{}, errors.New("unable to load pull requests")
	}
	out := pullRequestListOutput{PullRequests: []pullRequestOutput{}, Total: int(total)}
	for _, row := range rows {
		out.PullRequests = append(out.PullRequests, pullRequestOutput{
			ID: row.ID, Repository: row.Repo, Number: row.Number, Title: row.Title, URL: row.URL,
			State: row.State, ReviewState: row.ReviewStatus, Checks: row.ChecksStatus, Draft: row.Draft, Conflict: row.HasConflicts, UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return toolResult(fmt.Sprintf("%d pull requests match; returning %d.", out.Total, len(out.PullRequests))), out, nil
}

type repositoryOutput struct {
	Repository string `json:"repository"`
	Open       int    `json:"open"`
	Attention  int    `json:"needs_attention"`
	Conflicts  int    `json:"conflicts"`
}

type repositoryListOutput struct {
	Repositories []repositoryOutput `json:"repositories"`
}

func (s *Server) mcpListRepositories(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, repositoryListOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, repositoryListOutput{}, err
	}
	rows, err := s.accountFollowUps(ctx, session.sessionID)
	if err != nil {
		return nil, repositoryListOutput{}, errors.New("unable to load repositories")
	}
	byRepo := map[string]*repositoryOutput{}
	order := []string{}
	for _, row := range rows {
		entry, ok := byRepo[row.PR.Repo]
		if !ok {
			entry = &repositoryOutput{Repository: row.PR.Repo}
			byRepo[row.PR.Repo] = entry
			order = append(order, row.PR.Repo)
		}
		if row.State != "archived" {
			entry.Open++
		}
		if row.State == "action" || row.State == "follow_up" {
			entry.Attention++
		}
		if row.PR.HasConflicts {
			entry.Conflicts++
		}
	}
	out := repositoryListOutput{Repositories: []repositoryOutput{}}
	for _, repo := range order {
		out.Repositories = append(out.Repositories, *byRepo[repo])
	}
	return toolResult(fmt.Sprintf("%d repositories are tracked.", len(out.Repositories))), out, nil
}

type followUpActionInput struct {
	ID      uint   `json:"id" jsonschema:"The follow-up identifier returned by list_follow_ups"`
	Version uint64 `json:"version" jsonschema:"The version returned alongside the follow-up; the call is refused if newer activity arrived"`
	Days    int    `json:"days,omitempty" jsonschema:"For snooze only: how many days to wait before reminding again (1 to 365)"`
}

type actionOutput struct {
	Updated bool   `json:"updated"`
	State   string `json:"state,omitempty" jsonschema:"The follow-up state after the change"`
}

func (s *Server) followUpAction(action string) mcp.ToolHandlerFor[followUpActionInput, actionOutput] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in followUpActionInput) (*mcp.CallToolResult, actionOutput, error) {
		session, err := sessionFromContext(ctx)
		if err != nil {
			return nil, actionOutput{}, err
		}
		if err := session.requireWrite(); err != nil {
			return nil, actionOutput{}, err
		}
		now := time.Now().UTC()
		var until *time.Time
		if action == "snooze" {
			days := in.Days
			if days <= 0 || days > 365 {
				return nil, actionOutput{}, errors.New("choose between 1 and 365 days")
			}
			moment := now.AddDate(0, 0, days)
			until = &moment
		}
		sid := session.sessionID
		status, err := s.applyFollowUpAction(fmt.Sprint(in.ID), action, in.Version, until, now, func(tx *gorm.DB) *gorm.DB { return tx.Where("session_id = ?", sid) })
		if err != nil {
			switch status {
			case 404:
				return nil, actionOutput{}, errors.New("no such follow-up for this account")
			case 409:
				return nil, actionOutput{}, errors.New("new activity arrived after you read this follow-up; list it again and retry with the new version")
			}
			return nil, actionOutput{}, errors.New("unable to update the follow-up")
		}
		return toolResult("Updated."), actionOutput{Updated: true}, nil
	}
}

func (s *Server) newMCPServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "pr-desk", Version: mcpServerVersion, Title: "PR Desk"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "list_follow_ups", Description: "List pull requests that PR Desk is tracking for you, with the reason each one needs attention.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, s.mcpListFollowUps)
	mcp.AddTool(server, &mcp.Tool{Name: "get_follow_up_summary", Description: "Count how many tracked pull requests need your action, are waiting on others, or are ready to follow up.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, s.mcpFollowUpSummary)
	mcp.AddTool(server, &mcp.Tool{Name: "list_pull_requests", Description: "Search the synchronized pull requests of this account by repository or title.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, s.mcpListPullRequests)
	mcp.AddTool(server, &mcp.Tool{Name: "list_repositories", Description: "Summarize tracked repositories with their open, attention-needing and conflicting pull request counts.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, s.mcpListRepositories)
	mcp.AddTool(server, &mcp.Tool{Name: "mark_follow_up_read", Description: "Mark a follow-up as read. This does not mark the work as handled and does not touch GitHub.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true}}, s.followUpAction("read"))
	mcp.AddTool(server, &mcp.Tool{Name: "mark_follow_up_handled", Description: "Mark a follow-up as handled and restart its waiting clock. Nothing is posted to GitHub.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true}}, s.followUpAction("handled"))
	mcp.AddTool(server, &mcp.Tool{Name: "snooze_follow_up", Description: "Stop reminding about a follow-up for a number of days. Technical failures and new human feedback can still surface it.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true}}, s.followUpAction("snooze"))
	return server
}

// mcpHandler wires the MCP endpoint behind the SDK's bearer middleware, which
// answers an unauthenticated request with the WWW-Authenticate header that
// points a client at the metadata document.
func (s *Server) mcpHandler() gin.HandlerFunc {
	server := s.newMCPServer()
	streamable := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	guarded := auth.RequireBearerToken(s.verifyMCPToken, &auth.RequireBearerTokenOptions{
		Scopes:              []string{scopeFollowUpsRead},
		ResourceMetadataURL: issuerURL() + "/.well-known/oauth-protected-resource",
	})(streamable)
	return func(c *gin.Context) { guarded.ServeHTTP(c.Writer, c.Request) }
}

func (s *Server) verifyMCPToken(ctx context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
	record, err := lookupAPIToken(ctx, s.db, token, time.Now().UTC())
	if err != nil {
		return nil, auth.ErrInvalidToken
	}
	touchAPIToken(s.db, record.ID, time.Now().UTC())
	return &auth.TokenInfo{Scopes: record.scopeList(), Expiration: record.ExpiresAt, UserID: record.SessionID}, nil
}
