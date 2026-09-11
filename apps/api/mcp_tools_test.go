package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpFixture stands up one connected account with the follow-ups the tools are
// meant to tell apart, and returns a write-scoped session against the real
// endpoint.
func mcpFixture(t *testing.T, sid string) (*Server, *mcp.ClientSession, map[string]FollowUp) {
	t.Helper()
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: sid, Username: sid, Token: "encrypted"}, 9400, "browser-"+sid); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&FollowUpSettings{SessionID: sid, Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}", BaselineAt: &now}).Error; err != nil {
		t.Fatal(err)
	}
	checks, err := json.Marshal([]checkRunSummary{{Name: "Stale PR", Conclusion: "cancelled", URL: "https://github.com/fixture/tools/runs/7"}})
	if err != nil {
		t.Fatal(err)
	}
	fixtures := []struct {
		key      string
		number   int
		title    string
		waiting  time.Duration
		facts    string
		conflict bool
		checks   string
		detail   string
	}{
		{"conflict", 11, "Long wait with a conflict", 30 * 24 * time.Hour, `{"role":"authored","conflict":true}`, true, "success", "[]"},
		{"feedback", 12, "Fresh human feedback", 2 * time.Hour, `{"role":"authored","human_excerpt":"please rebase","human_at":"2026-09-12T00:00:00Z"}`, false, "inconclusive", string(checks)},
	}
	created := map[string]FollowUp{}
	for _, fixture := range fixtures {
		pr := PullRequest{SessionID: sid, Repo: "fixture/tools", Number: fixture.number, Title: fixture.title, State: "open", UpdatedAt: now, Role: "authored", HasConflicts: fixture.conflict, ChecksStatus: fixture.checks, ChecksJSON: fixture.detail, Author: "someone", URL: "https://github.com/fixture/tools/pull/1"}
		if err := db.Create(&pr).Error; err != nil {
			t.Fatal(err)
		}
		follow := FollowUp{SessionID: sid, PullRequestID: pr.ID, Version: 2, WaitingSince: now.Add(-fixture.waiting), LastActivityAt: now, FactsJSON: fixture.facts}
		if fixture.key == "feedback" {
			follow.NeedsConfirmation = true
		}
		if err := db.Create(&follow).Error; err != nil {
			t.Fatal(err)
		}
		created[fixture.key] = follow
		if fixture.key == "feedback" {
			for _, comment := range []ReviewComment{
				{SessionID: sid, PullRequestID: pr.ID, GitHubID: 1, Author: "reviewer", Body: "This needs a rebase before it can land.", URL: "https://github.com/c/1", CommentType: "", CreatedAt: now.Add(-time.Hour)},
				{SessionID: sid, PullRequestID: pr.ID, GitHubID: 2, Author: "reviewer", Body: "Also the migration is missing.", URL: "https://github.com/c/2", CommentType: "review", CreatedAt: now},
			} {
				if err := db.Create(&comment).Error; err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	server := mcpHarness(t, s)
	token, _, err := issueAPIToken(db, sid, cliClientID, "test", []string{scopeFollowUpsRead, scopeFollowUpsWrite}, now)
	if err != nil {
		t.Fatal(err)
	}
	return s, mcpConnect(t, server.URL+"/api/v1/mcp", token), created
}

func callStructured(t *testing.T, session *mcp.ClientSession, name string, arguments map[string]any, into any) {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatal(name+" failed", toolText(result))
	}
	raw, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatal(err)
	}
}

type followUpListPayload struct {
	FollowUps []struct {
		ID            uint     `json:"id"`
		Number        int      `json:"number"`
		Reasons       []string `json:"reasons"`
		WaitingDays   int      `json:"waiting_days"`
		Unread        bool     `json:"unread"`
		Conflict      bool     `json:"conflict"`
		Checks        string   `json:"checks"`
		Author        string   `json:"author"`
		FailingChecks []struct {
			Name       string `json:"name"`
			Conclusion string `json:"conclusion"`
		} `json:"failing_checks"`
	} `json:"follow_ups"`
	Total int `json:"total"`
}

// Triage is the whole point of the listing: narrowing 39 rows to the ones with a
// given reason had to happen client side before these filters existed.
func TestListFollowUpsFiltersByReasonUnreadAndWait(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-filters")

	var byReason followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"reason": "conflict"}, &byReason)
	if byReason.Total != 1 || byReason.FollowUps[0].Number != 11 {
		t.Fatalf("the conflict filter did not isolate one row: %+v", byReason)
	}

	var byWait followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"min_waiting_days": 7}, &byWait)
	if byWait.Total != 1 || byWait.FollowUps[0].Number != 11 {
		t.Fatalf("min_waiting_days did not exclude the fresh row: %+v", byWait)
	}

	var unread followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"unread": true}, &unread)
	if unread.Total != 2 {
		t.Fatalf("both rows are ahead of their read version, got %d", unread.Total)
	}

	// Total counts every match, so a limited page still reports the real size.
	var limited followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"limit": 1}, &limited)
	if limited.Total != 2 || len(limited.FollowUps) != 1 {
		t.Fatalf("a limited page misreported the total: total=%d returned=%d", limited.Total, len(limited.FollowUps))
	}
}

func TestListFollowUpsSortsByLongestWait(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-sort")
	var sorted followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"sort": "waiting"}, &sorted)
	if len(sorted.FollowUps) != 2 {
		t.Fatalf("expected both rows, got %d", len(sorted.FollowUps))
	}
	if sorted.FollowUps[0].WaitingDays < sorted.FollowUps[1].WaitingDays {
		t.Fatalf("the longest wait is not first: %+v", sorted.FollowUps)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_follow_ups", Arguments: map[string]any{"sort": "sideways"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("an unknown sort was accepted silently")
	}
}

// A caller could previously see that checks failed but never which check, which
// is the difference between a broken test and a superseded workflow run.
func TestListFollowUpsNamesTheChecksBehindTheState(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-checks")
	var listed followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"reason": "human_feedback"}, &listed)
	if len(listed.FollowUps) != 1 {
		t.Fatalf("expected the feedback row, got %+v", listed)
	}
	row := listed.FollowUps[0]
	if row.Checks != "inconclusive" {
		t.Fatalf("the checks state did not survive: %q", row.Checks)
	}
	if len(row.FailingChecks) != 1 || row.FailingChecks[0].Name != "Stale PR" || row.FailingChecks[0].Conclusion != "cancelled" {
		t.Fatalf("the check runs were not reported: %+v", row.FailingChecks)
	}
	if row.Author != "someone" {
		t.Fatalf("the author is missing, so a caller still needs a second lookup: %+v", row)
	}
}

// The listing truncates one comment to 240 characters. Reading the thread was
// only possible over the browser API, so an agent had to go to GitHub instead.
func TestGetFollowUpReturnsTheStoredThread(t *testing.T) {
	_, session, created := mcpFixture(t, "mcp-detail")
	var detail struct {
		FollowUp struct {
			ID     uint   `json:"id"`
			Number int    `json:"number"`
			State  string `json:"state"`
		} `json:"follow_up"`
		Comments []struct {
			Author string `json:"author"`
			Body   string `json:"body"`
			Kind   string `json:"kind"`
		} `json:"comments"`
		Total int `json:"total_comments"`
	}
	callStructured(t, session, "get_follow_up", map[string]any{"id": created["feedback"].ID}, &detail)
	if detail.FollowUp.Number != 12 {
		t.Fatalf("the wrong follow-up came back: %+v", detail.FollowUp)
	}
	if detail.Total != 2 || len(detail.Comments) != 2 {
		t.Fatalf("the comment thread is missing: total=%d returned=%d", detail.Total, len(detail.Comments))
	}
	// Newest first, and the full body rather than the excerpt.
	if !strings.Contains(detail.Comments[0].Body, "migration is missing") {
		t.Fatalf("comments are not newest first: %+v", detail.Comments)
	}
	if detail.Comments[0].Kind != "review" || detail.Comments[1].Kind != "conversation" {
		t.Fatalf("comment kinds were not labelled: %+v", detail.Comments)
	}

	var none struct {
		Comments []any `json:"comments"`
		Total    int   `json:"total_comments"`
	}
	callStructured(t, session, "get_follow_up", map[string]any{"id": created["feedback"].ID, "comments": -1}, &none)
	if len(none.Comments) != 0 || none.Total != 2 {
		t.Fatalf("asking for no comments still returned some: %+v", none)
	}
}

func TestGetFollowUpRefusesAnotherAccountsRow(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-isolation")
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "get_follow_up", Arguments: map[string]any{"id": 999999}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("a follow-up outside the account was returned")
	}
}

// Snoozing was one way: only marking the row handled cleared it, which also
// marked work away that may not have been done.
func TestUnsnoozeClearsTheReminderWithoutMarkingHandled(t *testing.T) {
	s, session, created := mcpFixture(t, "mcp-unsnooze")
	row := created["conflict"]
	var snoozed struct {
		Updated bool `json:"updated"`
	}
	callStructured(t, session, "snooze_follow_up", map[string]any{"id": row.ID, "version": row.Version, "days": 5}, &snoozed)
	var after FollowUp
	if s.db.Where("id = ?", row.ID).First(&after).Error != nil {
		t.Fatal("follow-up disappeared")
	}
	if after.SnoozedUntil == nil {
		t.Fatal("the snooze was not stored")
	}
	var cleared struct {
		Updated bool `json:"updated"`
	}
	callStructured(t, session, "unsnooze_follow_up", map[string]any{"id": row.ID, "version": row.Version}, &cleared)
	// A fresh struct: scanning into the populated one above leaves a pointer
	// field untouched when the column came back NULL.
	var reloaded FollowUp
	if s.db.Where("id = ?", row.ID).First(&reloaded).Error != nil {
		t.Fatal("follow-up disappeared")
	}
	if reloaded.SnoozedUntil != nil {
		t.Fatal("the snooze survived unsnooze")
	}
	if reloaded.HandledVersion != 0 {
		t.Fatal("unsnooze marked the work handled, which is not what was asked")
	}
}

// An empty list means nothing until you know whether the data is current.
func TestSyncStatusReportsFreshness(t *testing.T) {
	s, session, _ := mcpFixture(t, "mcp-sync")
	synced := time.Now().UTC().Add(-90 * time.Minute)
	if err := s.db.Model(&OAuthToken{}).Where("session_id = ?", "mcp-sync").Update("history_synced_at", synced).Error; err != nil {
		t.Fatal(err)
	}
	var status struct {
		Status       string `json:"status"`
		StaleMinutes int    `json:"stale_minutes"`
		LastSyncedAt string `json:"last_synced_at"`
		Baseline     bool   `json:"baseline_complete"`
	}
	callStructured(t, session, "get_sync_status", map[string]any{}, &status)
	if status.StaleMinutes < 85 || status.StaleMinutes > 95 {
		t.Fatalf("the reported age is wrong: %d minutes", status.StaleMinutes)
	}
	if status.LastSyncedAt == "" || !status.Baseline {
		t.Fatalf("the freshness report is incomplete: %+v", status)
	}
}

func TestListPullRequestsFiltersByStateAndRole(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-prs")
	var open struct {
		PullRequests []struct {
			Number int    `json:"number"`
			Checks string `json:"checks"`
		} `json:"pull_requests"`
		Total int `json:"total"`
	}
	callStructured(t, session, "list_pull_requests", map[string]any{"state": "open"}, &open)
	if open.Total != 2 {
		t.Fatalf("expected both open pull requests, got %d", open.Total)
	}
	var merged struct {
		Total int `json:"total"`
	}
	callStructured(t, session, "list_pull_requests", map[string]any{"state": "merged"}, &merged)
	if merged.Total != 0 {
		t.Fatalf("nothing is merged in the fixture, got %d", merged.Total)
	}
	var reviewer struct {
		Total int `json:"total"`
	}
	callStructured(t, session, "list_pull_requests", map[string]any{"role": "reviewer"}, &reviewer)
	if reviewer.Total != 0 {
		t.Fatalf("the fixture authors everything, got %d as reviewer", reviewer.Total)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_pull_requests", Arguments: map[string]any{"state": "abandoned"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("an unknown state was accepted silently")
	}
}
