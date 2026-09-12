package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

// Reported to MCP clients during initialization, which is the only place a
// client learns which deployment it reached. Set by the release build; a binary
// built from a checkout answers "dev".
var appVersion = "dev"

// The SDK models destructiveHint and openWorldHint as pointers because the spec defaults both to true when they are absent, so a tool that leaves them nil publishes itself as destructive and as reaching an open world. Nothing here calls out to anything, hence the address of a false.
var falseHint = false

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
	State          string `json:"state,omitempty" jsonschema:"Only return follow-ups in this state: action, waiting, follow_up, draft or archived"`
	Role           string `json:"role,omitempty" jsonschema:"Only return follow-ups where you are the authored or reviewer party"`
	Repository     string `json:"repository,omitempty" jsonschema:"Only return follow-ups for this owner/name repository"`
	Reason         string `json:"reason,omitempty" jsonschema:"Only return follow-ups carrying this reason: human_feedback, review_requested, conflict, checks_failed, overdue or snooze_due. conflict and checks_failed are raised only on pull requests you authored, because a red branch on somebody else's pull request is not yours to fix; filter on checks or conflict instead to see those too"`
	Checks         string `json:"checks,omitempty" jsonschema:"Only return follow-ups whose checks are in this state: success, failure, pending, inconclusive or unknown. Unlike the checks_failed reason this applies whatever your role is"`
	Conflict       bool   `json:"conflict,omitempty" jsonschema:"Only return follow-ups whose branch conflicts with its base, whatever your role is"`
	Unread         bool   `json:"unread,omitempty" jsonschema:"Only return follow-ups with activity you have not marked read"`
	MinWaitingDays int    `json:"min_waiting_days,omitempty" jsonschema:"Only return follow-ups whose waiting clock has run at least this many days"`
	Sort           string `json:"sort,omitempty" jsonschema:"waiting to put the longest wait first, or activity for the most recently changed first (default)"`
	Limit          int    `json:"limit,omitempty" jsonschema:"Maximum number of follow-ups to return (default 30, maximum 200)"`
	Offset         int    `json:"offset,omitempty" jsonschema:"How many matching follow-ups to skip before the page starts (default 0). total counts every match and has_more says whether any are left, so pass offset plus the number returned to read past the limit"`
}

type followUpOutput struct {
	ID            uint              `json:"id" jsonschema:"Identifier to pass to the follow-up tools"`
	Version       uint64            `json:"version" jsonschema:"Pass this back when changing the follow-up; a mismatch means new activity arrived"`
	Repository    string            `json:"repository"`
	Number        int               `json:"number"`
	Title         string            `json:"title"`
	URL           string            `json:"url"`
	Author        string            `json:"author,omitempty"`
	Role          string            `json:"role"`
	State         string            `json:"state"`
	Reasons       []string          `json:"reasons"`
	Unread        bool              `json:"unread"`
	Draft         bool              `json:"draft"`
	Conflict      bool              `json:"conflict"`
	Checks        string            `json:"checks,omitempty" jsonschema:"success, failure, pending, inconclusive or unknown. inconclusive means every run that did not pass was cancelled or superseded, so nothing is known to be broken"`
	FailingChecks []checkRunSummary `json:"failing_checks,omitempty" jsonschema:"The named check runs behind a non-green summary, failures first"`
	ReviewState   string            `json:"review_state,omitempty"`
	Excerpt       string            `json:"excerpt,omitempty" jsonschema:"The most recent human comment that needs attention, truncated; get_follow_up returns the full thread"`
	WaitingFor    int               `json:"waiting_days" jsonschema:"Days since the last human progress on this pull request, not days since it was opened"`
	SnoozedUntil  string            `json:"snoozed_until,omitempty"`
	UpdatedAt     string            `json:"updated_at,omitempty" jsonschema:"GitHub activity time, not the time PR Desk last polled"`
}

type listFollowUpsOutput struct {
	FollowUps []followUpOutput `json:"follow_ups"`
	Total     int              `json:"total" jsonschema:"Number of follow-ups matching the filter before the limit was applied"`
	HasMore   bool             `json:"has_more" jsonschema:"True when matches remain after this page; call again with offset raised by the number returned"`
}

// waitingDays is the age of the waiting clock, which advanceFacts moves on human
// progress only. A zero means someone acted today, not that the row is new.
func waitingDays(row followUpView, now time.Time) int {
	if row.WaitingSince.IsZero() {
		return 0
	}
	if days := int(now.Sub(row.WaitingSince).Hours() / 24); days > 0 {
		return days
	}
	return 0
}

func describeFollowUp(row followUpView, now time.Time) followUpOutput {
	out := followUpOutput{
		ID: row.ID, Version: row.Version, Repository: row.PR.Repo, Number: row.PR.Number, Title: row.PR.Title,
		URL: row.PR.URL, Author: row.PR.Author, Role: row.Role, State: row.State, Reasons: row.Reasons,
		Unread: row.Unread, Draft: row.PR.Draft, Conflict: row.PR.HasConflicts, Checks: row.PR.ChecksStatus,
		FailingChecks: row.PR.checks(), ReviewState: row.PR.ReviewStatus, Excerpt: row.Excerpt,
		WaitingFor: waitingDays(row, now),
	}
	if row.SnoozedUntil != nil {
		out.SnoozedUntil = row.SnoozedUntil.UTC().Format(time.RFC3339)
	}
	if !row.PR.UpdatedAt.IsZero() {
		out.UpdatedAt = row.PR.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return out
}

func matchesReason(reasons []string, reason string) bool {
	for _, value := range reasons {
		if strings.EqualFold(value, reason) {
			return true
		}
	}
	return false
}

// The five states a caller can filter checks on. "error" is GitHub's wording for
// a red branch and reaches the column through rows written before checkSummary
// normalized it, so it is folded into failure rather than offered separately.
var checkStates = []string{"success", "failure", "pending", "inconclusive", "unknown"}

// A pull request no detail sync has reached yet stores nothing at all, which is
// the same thing as unknown and has to answer to that filter.
func normalizedChecks(stored string) string {
	switch stored {
	case "":
		return "unknown"
	case "error":
		return "failure"
	}
	return stored
}

// checksFilterSQL is the column-side counterpart of normalizedChecks, so the
// paginated query in list_pull_requests counts exactly what the in-memory filter
// in list_follow_ups would keep.
const checksFilterSQL = "CASE COALESCE(checks_status, '') WHEN '' THEN 'unknown' WHEN 'error' THEN 'failure' ELSE checks_status END"

func validChecksFilter(value string) bool {
	for _, state := range checkStates {
		if value == state {
			return true
		}
	}
	return false
}

func checksFilterError() error {
	return errors.New("checks has to be " + strings.Join(checkStates[:len(checkStates)-1], ", ") + " or " + checkStates[len(checkStates)-1])
}

// presentableReasons is every reason FollowUp.presentation can attach to a row.
// The schema on listFollowUpsInput.Reason quotes the same set; a name that is
// only ever an event reason would filter to nothing.
var presentableReasons = []string{"human_feedback", "review_requested", "conflict", "checks_failed", "overdue", "snooze_due"}

func presentableReason(name string) bool {
	for _, reason := range presentableReasons {
		if reason == name {
			return true
		}
	}
	return false
}

func (s *Server) mcpListFollowUps(ctx context.Context, _ *mcp.CallToolRequest, in listFollowUpsInput) (*mcp.CallToolResult, listFollowUpsOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, listFollowUpsOutput{}, err
	}
	if in.Sort != "" && in.Sort != "waiting" && in.Sort != "activity" {
		return nil, listFollowUpsOutput{}, errors.New("sort has to be waiting or activity")
	}
	if in.Checks != "" && !validChecksFilter(in.Checks) {
		return nil, listFollowUpsOutput{}, checksFilterError()
	}
	// A filter value nothing can match would return an empty list, which reads as
	// "no work" rather than "you asked for something that does not exist".
	switch in.State {
	case "", "action", "waiting", "follow_up", "draft", "archived":
	default:
		return nil, listFollowUpsOutput{}, errors.New("state has to be action, waiting, follow_up, draft or archived")
	}
	if in.Role != "" && in.Role != "authored" && in.Role != "reviewer" {
		return nil, listFollowUpsOutput{}, errors.New("role has to be authored or reviewer")
	}
	if in.Reason != "" && !presentableReason(in.Reason) {
		return nil, listFollowUpsOutput{}, errors.New("reason has to be " + strings.Join(presentableReasons, ", "))
	}
	if in.Offset < 0 {
		return nil, listFollowUpsOutput{}, errors.New("offset cannot be negative")
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
	matched := []followUpOutput{}
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
		if in.Reason != "" && !matchesReason(row.Reasons, in.Reason) {
			continue
		}
		if in.Checks != "" && normalizedChecks(row.PR.ChecksStatus) != in.Checks {
			continue
		}
		if in.Conflict && !row.PR.HasConflicts {
			continue
		}
		if in.Unread && !row.Unread {
			continue
		}
		if in.MinWaitingDays > 0 && waitingDays(row, now) < in.MinWaitingDays {
			continue
		}
		matched = append(matched, describeFollowUp(row, now))
	}
	// The default order is the state ranking collectFollowUps already applied;
	// sorting by wait is a stable reordering of that same list.
	if in.Sort == "waiting" {
		sort.SliceStable(matched, func(i, j int) bool { return matched[i].WaitingFor > matched[j].WaitingFor })
	}
	// An offset past the end is a page nobody filled, not a mistake: a caller walking to the end of the list arrives there by construction.
	out := listFollowUpsOutput{FollowUps: []followUpOutput{}, Total: len(matched)}
	if in.Offset < len(matched) {
		page := matched[in.Offset:]
		if len(page) > limit {
			page = page[:limit]
		}
		out.FollowUps = page
	}
	out.HasMore = in.Offset+len(out.FollowUps) < out.Total
	summary := fmt.Sprintf("%d follow-ups match; returning %d.", out.Total, len(out.FollowUps))
	if out.HasMore {
		summary += fmt.Sprintf(" Pass offset %d for the next page.", in.Offset+len(out.FollowUps))
	}
	return toolResult(summary), out, nil
}

type getFollowUpInput struct {
	ID       uint `json:"id" jsonschema:"The follow-up identifier returned by list_follow_ups"`
	Comments int  `json:"comments,omitempty" jsonschema:"How many of the most recent comments to include (default 20, maximum 100; pass a negative number for none)"`
}

type commentOutput struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	URL       string `json:"url,omitempty"`
	Kind      string `json:"kind" jsonschema:"review for an inline code comment, summary for the prose submitted with a review, conversation for a discussion comment"`
	CreatedAt string `json:"created_at"`
}

type getFollowUpOutput struct {
	FollowUp followUpOutput  `json:"follow_up"`
	Comments []commentOutput `json:"comments"`
	Total    int             `json:"total_comments"`
}

// The listing carries a 240 character excerpt of one comment, which is enough to
// decide whether to look and never enough to answer the question. This returns
// the stored thread so an agent does not have to reach for GitHub directly.
func (s *Server) mcpGetFollowUp(ctx context.Context, _ *mcp.CallToolRequest, in getFollowUpInput) (*mcp.CallToolResult, getFollowUpOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, getFollowUpOutput{}, err
	}
	rows, err := s.accountFollowUps(ctx, session.sessionID)
	if err != nil {
		return nil, getFollowUpOutput{}, errors.New("unable to load follow-ups")
	}
	var found *followUpView
	for i := range rows {
		if rows[i].ID == in.ID {
			found = &rows[i]
			break
		}
	}
	if found == nil {
		return nil, getFollowUpOutput{}, errors.New("no such follow-up for this account")
	}
	limit := in.Comments
	if limit == 0 {
		limit = 20
	}
	if limit < 0 {
		limit = 0
	}
	if limit > 100 {
		limit = 100
	}
	out := getFollowUpOutput{FollowUp: describeFollowUp(*found, time.Now()), Comments: []commentOutput{}}
	var total int64
	scope := s.db.WithContext(ctx).Model(&ReviewComment{}).Where("session_id = ? AND pull_request_id = ?", session.sessionID, found.PullRequestID)
	if err := scope.Count(&total).Error; err != nil {
		return nil, getFollowUpOutput{}, errors.New("unable to load comments")
	}
	out.Total = int(total)
	if limit > 0 {
		var comments []ReviewComment
		if err := scope.Order("created_at DESC, id DESC").Limit(limit).Find(&comments).Error; err != nil {
			return nil, getFollowUpOutput{}, errors.New("unable to load comments")
		}
		for _, comment := range comments {
			kind := comment.CommentType
			if kind == "" {
				kind = "conversation"
			}
			out.Comments = append(out.Comments, commentOutput{
				Author: comment.Author, Body: comment.Body, URL: comment.URL, Kind: kind,
				CreatedAt: comment.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
	}
	return toolResult(fmt.Sprintf("%s #%d: %s, %d comments stored.", found.PR.Repo, found.PR.Number, found.State, out.Total)), out, nil
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
	State      string `json:"state,omitempty" jsonschema:"Only return pull requests that are open, closed or merged"`
	Role       string `json:"role,omitempty" jsonschema:"Only return pull requests you authored or are a reviewer on"`
	Checks     string `json:"checks,omitempty" jsonschema:"Only return pull requests whose checks are in this state: success, failure, pending, inconclusive or unknown"`
	Conflict   bool   `json:"conflict,omitempty" jsonschema:"Only return pull requests whose branch conflicts with its base"`
	Limit      int    `json:"limit,omitempty" jsonschema:"Maximum number of pull requests to return (default 30, maximum 200)"`
	Offset     int    `json:"offset,omitempty" jsonschema:"How many matching pull requests to skip before the page starts (default 0). total counts every match and has_more says whether any are left, so pass offset plus the number returned to read past the limit"`
}

// There is deliberately no identifier here. The only id this surface accepts is a follow-up id, and a pull request primary key from the same account collides with it freely, so an agent passing one to get_follow_up would silently read an unrelated row instead of erroring. repository and number are the handle for a pull request.
type pullRequestOutput struct {
	Repository    string            `json:"repository"`
	Number        int               `json:"number"`
	Title         string            `json:"title"`
	URL           string            `json:"url"`
	Author        string            `json:"author,omitempty"`
	Role          string            `json:"role,omitempty"`
	State         string            `json:"state"`
	ReviewState   string            `json:"review_state,omitempty"`
	Checks        string            `json:"checks,omitempty" jsonschema:"success, failure, pending, inconclusive or unknown"`
	FailingChecks []checkRunSummary `json:"failing_checks,omitempty"`
	Draft         bool              `json:"draft"`
	Conflict      bool              `json:"conflict"`
	Merged        bool              `json:"merged"`
	UpdatedAt     string            `json:"updated_at" jsonschema:"GitHub activity time, not the time PR Desk last polled"`
}

type pullRequestListOutput struct {
	PullRequests []pullRequestOutput `json:"pull_requests"`
	Total        int                 `json:"total"`
	HasMore      bool                `json:"has_more" jsonschema:"True when matches remain after this page; call again with offset raised by the number returned"`
}

// A literal underscore or percent in a search term must not act as a wildcard.
var likeEscaper = strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")

func escapeLike(value string) string { return likeEscaper.Replace(value) }

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
	switch in.State {
	case "", "open", "closed", "merged":
	default:
		return nil, pullRequestListOutput{}, errors.New("state has to be open, closed or merged")
	}
	if in.Role != "" && in.Role != "authored" && in.Role != "reviewer" {
		return nil, pullRequestListOutput{}, errors.New("role has to be authored or reviewer")
	}
	if in.Checks != "" && !validChecksFilter(in.Checks) {
		return nil, pullRequestListOutput{}, checksFilterError()
	}
	if in.Offset < 0 {
		return nil, pullRequestListOutput{}, errors.New("offset cannot be negative")
	}
	query := s.db.WithContext(ctx).Model(&PullRequest{}).Where("session_id = ?", session.sessionID)
	if in.Repository != "" {
		query = query.Where("LOWER(repo) = LOWER(?)", in.Repository)
	}
	if in.Query != "" {
		query = query.Where("title ILIKE ? ESCAPE '\\'", "%"+escapeLike(in.Query)+"%")
	}
	if in.Role != "" {
		query = query.Where("role = ?", in.Role)
	}
	if in.Checks != "" {
		query = query.Where(checksFilterSQL+" = ?", in.Checks)
	}
	if in.Conflict {
		query = query.Where("has_conflicts = ?", true)
	}
	// GitHub reports a merged pull request as closed, so merged is a filter on
	// the merge timestamp rather than on the state column.
	switch in.State {
	case "open":
		query = query.Where("state = ? AND merged_at IS NULL", "open")
	case "closed":
		query = query.Where("state = ? AND merged_at IS NULL", "closed")
	case "merged":
		query = query.Where("merged_at IS NOT NULL")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, pullRequestListOutput{}, errors.New("unable to load pull requests")
	}
	var rows []PullRequest
	// updated_at ties are broken by id, so the order is total and paging by offset over it neither repeats nor skips a row unless a sync moves one.
	if err := query.Order("updated_at DESC, id DESC").Limit(limit).Offset(in.Offset).Find(&rows).Error; err != nil {
		return nil, pullRequestListOutput{}, errors.New("unable to load pull requests")
	}
	out := pullRequestListOutput{PullRequests: []pullRequestOutput{}, Total: int(total)}
	for _, row := range rows {
		out.PullRequests = append(out.PullRequests, pullRequestOutput{
			Repository: row.Repo, Number: row.Number, Title: row.Title, URL: row.URL,
			Author: row.Author, Role: row.Role, State: row.State, ReviewState: row.ReviewStatus,
			Checks: row.ChecksStatus, FailingChecks: row.checks(), Draft: row.Draft, Conflict: row.HasConflicts,
			Merged: row.MergedAt != nil, UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	out.HasMore = in.Offset+len(out.PullRequests) < out.Total
	summary := fmt.Sprintf("%d pull requests match; returning %d.", out.Total, len(out.PullRequests))
	if out.HasMore {
		summary += fmt.Sprintf(" Pass offset %d for the next page.", in.Offset+len(out.PullRequests))
	}
	return toolResult(summary), out, nil
}

type repositoryOutput struct {
	Repository string `json:"repository"`
	Open       int    `json:"open"`
	Attention  int    `json:"needs_attention"`
	Conflicts  int    `json:"conflicts"`
	// Counted whatever the role is, but only across the follow-up workspace like
	// every other count here, so it is not the number of red branches: one that
	// no follow-up tracks is absent, and so is a repository whose only such pull
	// request is untracked. list_pull_requests answers the unqualified question.
	ChecksFailing int `json:"checks_failing" jsonschema:"How many of this repository's tracked pull requests have failing checks, whatever your role. Scoped to the follow-up workspace like the other counts, so it undercounts red branches; filter list_pull_requests by checks for the complete answer"`
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
		if failedChecks(row.PR.ChecksStatus) {
			entry.ChecksFailing++
		}
	}
	out := repositoryListOutput{Repositories: []repositoryOutput{}}
	for _, repo := range order {
		out.Repositories = append(out.Repositories, *byRepo[repo])
	}
	return toolResult(fmt.Sprintf("%d repositories are tracked.", len(out.Repositories))), out, nil
}

type syncStatusOutput struct {
	Status         string `json:"status" jsonschema:"idle, running, complete, interrupted or failed"`
	Phase          string `json:"phase,omitempty"`
	Completed      int    `json:"completed"`
	Total          int    `json:"total"`
	ReportedAt     string `json:"reported_at,omitempty" jsonschema:"When this status was written. A failure survives a restart, so an old timestamp means the failure belongs to a run that is already over"`
	ReportedAgeMin int    `json:"reported_age_minutes" jsonschema:"Age of the status itself in minutes, which is not the age of the data"`
	LastSyncedAt   string `json:"last_synced_at,omitempty" jsonschema:"When the last full synchronization finished; absent until the first one completes"`
	StaleMinutes   int    `json:"stale_minutes" jsonschema:"Age of the data in minutes, so a caller can judge whether an empty result is conclusive. Only meaningful when last_synced_at is present: until the first synchronization finishes there is no data to age and this stays zero, which does not mean the data is fresh"`
	NextAutoSyncAt string `json:"next_auto_sync_at,omitempty"`
	Baseline       bool   `json:"baseline_complete" jsonschema:"False while the first inventory is still importing"`
	ErrorCode      string `json:"error_code,omitempty" jsonschema:"reconnect means the GitHub authorization lapsed and nothing can refresh until it is renewed"`
}

// Freshness is read-only on purpose: an agent should be able to say how old the
// answer is without being able to spend the account's GitHub rate limit. Nothing
// here exposes the stored credential.
func (s *Server) mcpSyncStatus(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, syncStatusOutput, error) {
	session, err := sessionFromContext(ctx)
	if err != nil {
		return nil, syncStatusOutput{}, err
	}
	var token OAuthToken
	if err := s.db.WithContext(ctx).Where("session_id = ?", session.sessionID).First(&token).Error; err != nil {
		return nil, syncStatusOutput{}, errors.New("this account is no longer connected to GitHub")
	}
	settings, err := loadFollowUpSettings(s.db, session.sessionID)
	if err != nil {
		return nil, syncStatusOutput{}, errors.New("unable to load preferences")
	}
	now := time.Now().UTC()
	progress := syncProgress{Status: "idle", Phase: "history"}
	if token.SyncProgress != "" {
		if json.Unmarshal([]byte(token.SyncProgress), &progress) != nil {
			return nil, syncStatusOutput{}, errors.New("unable to read sync progress")
		}
	}
	// A run that stopped reporting is not still running, however it was left.
	if progress.Status == "running" && now.Sub(progress.UpdatedAt) > 20*time.Minute {
		progress.Status = "interrupted"
	}
	out := syncStatusOutput{
		Status: progress.Status, Phase: progress.Phase, Completed: progress.Completed, Total: progress.Total,
		Baseline: settings.BaselineAt != nil, ErrorCode: progress.ErrorCode,
	}
	// The progress record outlives the process that wrote it, so a failure from a
	// run that ended before the last restart reads exactly like one happening
	// now. Without this timestamp the only way to tell them apart is the browser
	// API, which a bearer client cannot reach.
	if !progress.UpdatedAt.IsZero() {
		out.ReportedAt = progress.UpdatedAt.UTC().Format(time.RFC3339)
		if minutes := int(now.Sub(progress.UpdatedAt).Minutes()); minutes > 0 {
			out.ReportedAgeMin = minutes
		}
	}
	if token.HistorySyncedAt != nil {
		out.LastSyncedAt = token.HistorySyncedAt.UTC().Format(time.RFC3339)
		out.StaleMinutes = int(now.Sub(*token.HistorySyncedAt).Minutes())
	}
	if next := nextAutoSyncAt(token, now); !next.IsZero() {
		out.NextAutoSyncAt = next.UTC().Format(time.RFC3339)
	}
	if token.GitHubID > 0 && (token.AuthorizationError != "" || token.Token == "") {
		out.Status, out.ErrorCode = "failed", "reconnect"
	}
	if token.HistorySyncedAt == nil {
		return toolResult(fmt.Sprintf("Sync is %s; the first synchronization has not finished, so there is no data to age yet.", out.Status)), out, nil
	}
	return toolResult(fmt.Sprintf("Sync is %s; data is %d minutes old.", out.Status, out.StaleMinutes)), out, nil
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
	server := mcp.NewServer(&mcp.Implementation{Name: "pr-desk", Version: appVersion, Title: "PR Desk"}, nil)
	// No write tool below is destructive: none deletes a row, all four only move local handling flags, and applyFollowUpAction refuses a write whose version is stale, so nothing the caller has not seen can be overwritten.
	mcp.AddTool(server, &mcp.Tool{Name: "list_follow_ups", Description: "List pull requests that PR Desk is tracking for you, with the reason each one needs attention. Filter by state, role, repository, reason, check state, conflict, unread or minimum waiting days, and sort by longest wait. A page holds at most 200 rows; total reports every match and offset pages through the rest.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}}, s.mcpListFollowUps)
	mcp.AddTool(server, &mcp.Tool{Name: "get_follow_up", Description: "Read one follow-up in full, including the stored comment thread rather than the truncated excerpt the listing carries.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}}, s.mcpGetFollowUp)
	mcp.AddTool(server, &mcp.Tool{Name: "get_follow_up_summary", Description: "Count how many tracked pull requests need your action, are waiting on others, or are ready to follow up.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}}, s.mcpFollowUpSummary)
	mcp.AddTool(server, &mcp.Tool{Name: "get_sync_status", Description: "Report how fresh the synchronized data is and whether the first inventory finished, so an empty result can be judged.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}}, s.mcpSyncStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "list_pull_requests", Description: "Search the synchronized pull requests of this account by repository, title, state, role, check state or conflict. Unlike list_follow_ups this covers pull requests you only review, so it is the way to find every branch with failing checks rather than only your own. A page holds at most 200 rows; total reports every match and offset pages through the rest, so an account with thousands of pull requests still answers completely.", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}}, s.mcpListPullRequests)
	mcp.AddTool(server, &mcp.Tool{Name: "list_repositories", Description: "Summarize the follow-up workspace by repository: open, attention-needing, conflicting and check-failing counts. Every count is scoped to the pull requests a follow-up tracks, so a repository with no tracked pull request is absent entirely and the totals do not reconcile with list_pull_requests, which is what answers \"every branch that is red\".", Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &falseHint}}, s.mcpListRepositories)
	mcp.AddTool(server, &mcp.Tool{Name: "mark_follow_up_read", Description: "Mark a follow-up as read. This does not mark the work as handled and does not touch GitHub.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true, DestructiveHint: &falseHint, OpenWorldHint: &falseHint}}, s.followUpAction("read"))
	mcp.AddTool(server, &mcp.Tool{Name: "mark_follow_up_handled", Description: "Mark a follow-up as handled and restart its waiting clock. Nothing is posted to GitHub.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true, DestructiveHint: &falseHint, OpenWorldHint: &falseHint}}, s.followUpAction("handled"))
	mcp.AddTool(server, &mcp.Tool{Name: "snooze_follow_up", Description: "Stop reminding about a follow-up for a number of days. Technical failures and new human feedback can still surface it.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true, DestructiveHint: &falseHint, OpenWorldHint: &falseHint}}, s.followUpAction("snooze"))
	mcp.AddTool(server, &mcp.Tool{Name: "unsnooze_follow_up", Description: "Cancel a snooze and let the follow-up surface again. Read and handled state are left alone.", Annotations: &mcp.ToolAnnotations{IdempotentHint: true, DestructiveHint: &falseHint, OpenWorldHint: &falseHint}}, s.followUpAction("unsnooze"))
	return server
}

// mcpHandler wires the MCP endpoint behind the SDK's bearer middleware, which
// answers an unauthenticated request with the WWW-Authenticate header that
// points a client at the metadata document.
func (s *Server) mcpHandler() gin.HandlerFunc {
	server := s.newMCPServer()
	// Without a timeout a session is only reclaimed by an explicit DELETE, which a
	// client that crashes or loses its network never sends. The SDK pauses the
	// timer around POSTs, so this bounds idle sessions without cutting off a call
	// in progress.
	streamable := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{SessionTimeout: 30 * time.Minute})
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
