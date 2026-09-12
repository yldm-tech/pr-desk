package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	// The reviewing row is the case the reason filters cannot express: its checks
	// are red, but a branch somebody else owns is not this account's action item.
	fixtures := []struct {
		key      string
		number   int
		title    string
		waiting  time.Duration
		role     string
		facts    string
		conflict bool
		checks   string
		detail   string
	}{
		{"conflict", 11, "Long wait with a conflict", 30 * 24 * time.Hour, "authored", `{"role":"authored","conflict":true}`, true, "success", "[]"},
		{"feedback", 12, "Fresh human feedback", 2 * time.Hour, "authored", `{"role":"authored","human_excerpt":"please rebase","human_at":"2026-09-12T00:00:00Z"}`, false, "inconclusive", string(checks)},
		{"reviewing", 13, "Somebody else's red branch", time.Hour, "reviewer", `{"role":"reviewer","direct_request":true}`, false, "failure", "[]"},
		// Requested through a team this account has not selected, so the inclusion
		// rules drop it from the workspace while it stays in the pull request
		// table. This is why the two surfaces cannot be added up together.
		{"untracked", 14, "Red, and nobody asked this account", time.Hour, "reviewer", `{"role":"reviewer","review_teams":["fixture/maintainers"]}`, false, "failure", "[]"},
	}
	created := map[string]FollowUp{}
	for _, fixture := range fixtures {
		pr := PullRequest{SessionID: sid, Repo: "fixture/tools", Number: fixture.number, Title: fixture.title, State: "open", UpdatedAt: now, Role: fixture.role, HasConflicts: fixture.conflict, ChecksStatus: fixture.checks, ChecksJSON: fixture.detail, Author: "someone", URL: fmt.Sprintf("https://github.com/fixture/tools/pull/%d", fixture.number)}
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
	Total   int  `json:"total"`
	HasMore bool `json:"has_more"`
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
	if unread.Total != 3 {
		t.Fatalf("every row is ahead of its read version, got %d", unread.Total)
	}

	// Total counts every match, so a limited page still reports the real size.
	var limited followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"limit": 1}, &limited)
	if limited.Total != 3 || len(limited.FollowUps) != 1 {
		t.Fatalf("a limited page misreported the total: total=%d returned=%d", limited.Total, len(limited.FollowUps))
	}
}

func TestListFollowUpsSortsByLongestWait(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-sort")
	var sorted followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"sort": "waiting"}, &sorted)
	if len(sorted.FollowUps) != 3 {
		t.Fatalf("expected every row, got %d", len(sorted.FollowUps))
	}
	for i := 1; i < len(sorted.FollowUps); i++ {
		if sorted.FollowUps[i-1].WaitingDays < sorted.FollowUps[i].WaitingDays {
			t.Fatalf("the longest wait is not first: %+v", sorted.FollowUps)
		}
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

// The progress record outlives the process that wrote it, so a failure keeps
// being reported after the run that caused it is gone. Without the timestamp a
// caller cannot tell that from a failure happening right now, and the only
// other source is the browser API a bearer client cannot reach.
func TestSyncStatusDatesTheVerdictSeparatelyFromTheData(t *testing.T) {
	s, session, _ := mcpFixture(t, "mcp-reported")
	// Data synced an hour ago; the failure verdict written three hours ago, so
	// it predates the successful sync and belongs to a run that is over.
	synced := time.Now().UTC().Add(-60 * time.Minute)
	reported := time.Now().UTC().Add(-180 * time.Minute)
	progress, err := json.Marshal(syncProgress{Status: "failed", Phase: "details", Completed: 56, Total: 56, ErrorCode: "storage", UpdatedAt: reported})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(&OAuthToken{}).Where("session_id = ?", "mcp-reported").Updates(map[string]any{"history_synced_at": synced, "sync_progress": string(progress)}).Error; err != nil {
		t.Fatal(err)
	}
	var status struct {
		Status         string `json:"status"`
		ErrorCode      string `json:"error_code"`
		ReportedAt     string `json:"reported_at"`
		ReportedAgeMin int    `json:"reported_age_minutes"`
		StaleMinutes   int    `json:"stale_minutes"`
	}
	callStructured(t, session, "get_sync_status", map[string]any{}, &status)
	if status.Status != "failed" || status.ErrorCode != "storage" {
		t.Fatalf("the stored verdict was not reported: %+v", status)
	}
	if status.ReportedAt == "" {
		t.Fatal("the verdict has no timestamp, so a stale failure reads as a current one")
	}
	if status.ReportedAgeMin < 175 || status.ReportedAgeMin > 185 {
		t.Fatalf("the verdict age is wrong: %d minutes", status.ReportedAgeMin)
	}
	// The two clocks answer different questions and must not collapse into one.
	if status.StaleMinutes < 55 || status.StaleMinutes > 65 {
		t.Fatalf("the data age is wrong: %d minutes", status.StaleMinutes)
	}
	if status.ReportedAgeMin <= status.StaleMinutes {
		t.Fatal("the verdict is reported as newer than the data it supposedly describes")
	}
}

// A lapsed GitHub authorization used to fail the token lookup itself, so the endpoint answered 401 before any tool ran and the one status that explains the cause could never be returned. A client reads a 401 as "get a new token" and re-authorizes in a loop; the CLI reports it as an unreachable host.
func TestLapsedAuthorizationStillServesStoredDataAndSaysWhy(t *testing.T) {
	s, _, _ := mcpFixture(t, "mcp-lapsed")
	if err := s.db.Model(&OAuthToken{}).Where("session_id = ?", "mcp-lapsed").Update("authorization_error", "reconnect").Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	token, _, err := issueAPIToken(s.db, "mcp-lapsed", cliClientID, "lapsed", []string{scopeFollowUpsRead}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lookupAPIToken(context.Background(), s.db, token, now); err != nil {
		t.Fatal("a lapsed authorization rejected the token, so nothing can report the cause", err)
	}
	// A fresh connection, so the initialize POST goes through the bearer middleware with the account already lapsed.
	session := mcpConnect(t, mcpHarness(t, s).URL+"/api/v1/mcp", token)
	var status struct {
		Status    string `json:"status"`
		ErrorCode string `json:"error_code"`
	}
	callStructured(t, session, "get_sync_status", map[string]any{}, &status)
	if status.Status != "failed" || status.ErrorCode != "reconnect" {
		t.Fatalf("the lapsed authorization was not reported: %+v", status)
	}
	var listed followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{}, &listed)
	if listed.Total != 3 {
		t.Fatalf("the data already synchronized became unreadable: %+v", listed)
	}

	// Logging out blanks the credential, and that does still end the token.
	if err := s.db.Model(&OAuthToken{}).Where("session_id = ?", "mcp-lapsed").Update("token", "").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := lookupAPIToken(context.Background(), s.db, token, now); err == nil {
		t.Fatal("a token outlived the account it belongs to")
	}
}

// A run still reporting is not stale, and its verdict is current.
func TestSyncStatusReportsARunningSyncAsCurrent(t *testing.T) {
	s, session, _ := mcpFixture(t, "mcp-running")
	progress, err := json.Marshal(syncProgress{Status: "running", Phase: "details", Completed: 4, Total: 10, UpdatedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(&OAuthToken{}).Where("session_id = ?", "mcp-running").Update("sync_progress", string(progress)).Error; err != nil {
		t.Fatal(err)
	}
	var status struct {
		Status         string `json:"status"`
		ReportedAgeMin int    `json:"reported_age_minutes"`
	}
	callStructured(t, session, "get_sync_status", map[string]any{}, &status)
	if status.Status != "running" {
		t.Fatalf("a live run was not reported as running: %+v", status)
	}
	if status.ReportedAgeMin != 0 {
		t.Fatalf("a verdict written now is not current: %d minutes", status.ReportedAgeMin)
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
	if open.Total != 4 {
		t.Fatalf("expected every open pull request, got %d", open.Total)
	}
	var merged struct {
		Total int `json:"total"`
	}
	callStructured(t, session, "list_pull_requests", map[string]any{"state": "merged"}, &merged)
	if merged.Total != 0 {
		t.Fatalf("nothing is merged in the fixture, got %d", merged.Total)
	}
	var reviewer struct {
		PullRequests []struct {
			Number int `json:"number"`
		} `json:"pull_requests"`
		Total int `json:"total"`
	}
	// Both reviewing rows, including the one no follow-up tracks: this listing is
	// the pull request table and does not apply the workspace inclusion rules.
	callStructured(t, session, "list_pull_requests", map[string]any{"role": "reviewer"}, &reviewer)
	if reviewer.Total != 2 {
		t.Fatalf("the role filter did not isolate the reviewing rows: %+v", reviewer)
	}
	for _, row := range reviewer.PullRequests {
		if row.Number != 13 && row.Number != 14 {
			t.Fatalf("an authored row answered the reviewer filter: %+v", reviewer)
		}
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_pull_requests", Arguments: map[string]any{"state": "abandoned"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("an unknown state was accepted silently")
	}
}

type numberedPullRequests struct {
	PullRequests []struct {
		Number int    `json:"number"`
		Checks string `json:"checks"`
	} `json:"pull_requests"`
	Total   int  `json:"total"`
	HasMore bool `json:"has_more"`
}

// A page is capped at 200 rows whatever the limit says, so before offset existed an account with more pull requests than that had no argument that could reach the rest: list_pull_requests reported the real total and then withheld it.
func TestListPullRequestsPagesPastTheServerCap(t *testing.T) {
	s, session, _ := mcpFixture(t, "mcp-paging")
	now := time.Now().UTC()
	bulk := make([]PullRequest, 0, 205)
	for i := 0; i < 205; i++ {
		bulk = append(bulk, PullRequest{SessionID: "mcp-paging", Repo: "fixture/bulk", Number: 1000 + i, Title: fmt.Sprintf("Bulk %d", i), State: "open", UpdatedAt: now.Add(-time.Duration(i) * time.Minute), Role: "authored", Author: "someone", URL: fmt.Sprintf("https://github.com/fixture/bulk/pull/%d", 1000+i)})
	}
	if err := s.db.CreateInBatches(&bulk, 100).Error; err != nil {
		t.Fatal(err)
	}

	var first numberedPullRequests
	callStructured(t, session, "list_pull_requests", map[string]any{"repository": "fixture/bulk", "limit": 1000}, &first)
	if first.Total != 205 || len(first.PullRequests) != 200 {
		t.Fatalf("the cap moved: total=%d returned=%d", first.Total, len(first.PullRequests))
	}
	if !first.HasMore {
		t.Fatal("a page that withheld five rows reported itself as complete")
	}

	var second numberedPullRequests
	callStructured(t, session, "list_pull_requests", map[string]any{"repository": "fixture/bulk", "limit": 1000, "offset": 200}, &second)
	if second.Total != 205 || len(second.PullRequests) != 5 {
		t.Fatalf("the second page is wrong: total=%d returned=%d", second.Total, len(second.PullRequests))
	}
	if second.HasMore {
		t.Fatal("the last page claims there is another")
	}
	seen := map[int]bool{}
	for _, row := range first.PullRequests {
		seen[row.Number] = true
	}
	for _, row := range second.PullRequests {
		if seen[row.Number] {
			t.Fatalf("pull request %d came back on both pages", row.Number)
		}
		seen[row.Number] = true
	}
	if len(seen) != 205 {
		t.Fatalf("paging reached %d of 205 rows", len(seen))
	}

	// Walking off the end is how a caller discovers the end, not a mistake.
	var past numberedPullRequests
	callStructured(t, session, "list_pull_requests", map[string]any{"repository": "fixture/bulk", "offset": 5000}, &past)
	if len(past.PullRequests) != 0 || past.Total != 205 || past.HasMore {
		t.Fatalf("an offset past the end did not return an empty page: %+v", past)
	}

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_pull_requests", Arguments: map[string]any{"offset": -1}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("a negative offset was accepted silently")
	}
}

func TestListFollowUpsPagesWithOffset(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-followup-paging")

	var all followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{}, &all)
	if all.Total != 3 || len(all.FollowUps) != 3 || all.HasMore {
		t.Fatalf("the unpaged listing changed: %+v", all)
	}

	var page followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"limit": 2}, &page)
	if len(page.FollowUps) != 2 || !page.HasMore {
		t.Fatalf("a limited page did not report the remainder: %+v", page)
	}

	var rest followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"limit": 2, "offset": 2}, &rest)
	if rest.Total != 3 || len(rest.FollowUps) != 1 || rest.HasMore {
		t.Fatalf("the second page is wrong: %+v", rest)
	}
	if rest.FollowUps[0].Number == page.FollowUps[0].Number || rest.FollowUps[0].Number == page.FollowUps[1].Number {
		t.Fatalf("the second page repeated a row from the first: %+v", rest)
	}

	var past followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"offset": 99}, &past)
	if len(past.FollowUps) != 0 || past.Total != 3 || past.HasMore {
		t.Fatalf("an offset past the end did not return an empty page: %+v", past)
	}

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_follow_ups", Arguments: map[string]any{"offset": -1}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatal("a negative offset was accepted silently")
	}
}

// The listing used to carry the pull request primary key as "id", a different sequence from the follow-up ids every tool taking an id resolves against, so get_follow_up would answer with an unrelated row of the same account rather than an error. The key never leaves the server now.
func TestListPullRequestsCarriesNoFollowUpLookingID(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-idspace")
	var rows struct {
		PullRequests []map[string]any `json:"pull_requests"`
	}
	callStructured(t, session, "list_pull_requests", map[string]any{}, &rows)
	if len(rows.PullRequests) != 4 {
		t.Fatalf("expected the fixture's pull requests, got %d", len(rows.PullRequests))
	}
	for _, row := range rows.PullRequests {
		if _, ok := row["id"]; ok {
			t.Fatalf("a pull request row carries an id the follow-up tools would misresolve: %+v", row)
		}
	}
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range tools.Tools {
		if tool.Name != "list_pull_requests" {
			continue
		}
		if strings.Contains(mustJSON(tool.OutputSchema), `"id"`) {
			t.Fatalf("the output schema still declares an id: %s", mustJSON(tool.OutputSchema))
		}
	}
}

// The checks_failed reason is authored-only by design, so asking for it never
// finds a red branch on a pull request this account only reviews. Answering
// "which branches are failing" used to mean pulling every row and filtering by
// hand; these filters are how that question gets asked instead.
func TestChecksFilterReachesTheBranchesTheReasonCannot(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-checks-filter")

	var byReason followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"reason": "checks_failed"}, &byReason)
	if byReason.Total != 0 {
		t.Fatalf("the only red branch is somebody else's, so no reason should match: %+v", byReason)
	}

	var byChecks followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"checks": "failure"}, &byChecks)
	if byChecks.Total != 1 || byChecks.FollowUps[0].Number != 13 {
		t.Fatalf("the checks filter missed the reviewing row: %+v", byChecks)
	}

	// The listing reaches further than the follow-up view above: it also carries
	// the red branch the workspace never tracked.
	var prs numberedPullRequests
	callStructured(t, session, "list_pull_requests", map[string]any{"checks": "failure"}, &prs)
	if prs.Total != 2 {
		t.Fatalf("the pull request listing missed a red branch: %+v", prs)
	}
	seen := map[int]bool{}
	for _, row := range prs.PullRequests {
		seen[row.Number] = true
	}
	if !seen[13] || !seen[14] {
		t.Fatalf("the listing did not return both red branches: %+v", prs)
	}

	// A row no detail sync has reached stores nothing at all, which has to answer
	// to unknown rather than disappearing from every filter.
	var blank numberedPullRequests
	callStructured(t, session, "list_pull_requests", map[string]any{"checks": "unknown"}, &blank)
	if blank.Total != 0 {
		t.Fatalf("every fixture row has a recorded state: %+v", blank)
	}

	var conflicted followUpListPayload
	callStructured(t, session, "list_follow_ups", map[string]any{"conflict": true}, &conflicted)
	if conflicted.Total != 1 || conflicted.FollowUps[0].Number != 11 {
		t.Fatalf("the conflict filter did not isolate one row: %+v", conflicted)
	}

	for _, tool := range []string{"list_follow_ups", "list_pull_requests"} {
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: tool, Arguments: map[string]any{"checks": "red"}})
		if err != nil {
			t.Fatal(err)
		}
		if !result.IsError {
			t.Fatalf("%s accepted an unknown check state silently", tool)
		}
	}
}

// Grouping failures by repository was the one question the summary could not
// answer: it counted conflicts but left the caller to tally red branches.
func TestListRepositoriesCountsFailingChecks(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-repos")
	var listed struct {
		Repositories []struct {
			Repository    string `json:"repository"`
			Open          int    `json:"open"`
			Attention     int    `json:"needs_attention"`
			Conflicts     int    `json:"conflicts"`
			ChecksFailing int    `json:"checks_failing"`
		} `json:"repositories"`
	}
	callStructured(t, session, "list_repositories", map[string]any{}, &listed)
	if len(listed.Repositories) != 1 {
		t.Fatalf("the fixture tracks one repository, got %+v", listed)
	}
	row := listed.Repositories[0]
	if row.Repository != "fixture/tools" || row.Open != 3 || row.Conflicts != 1 {
		t.Fatalf("the repository summary is wrong: %+v", row)
	}
	if row.ChecksFailing != 1 {
		t.Fatalf("the red branch was not counted: %+v", row)
	}
	// The reviewing row is red but is nobody's action item here, which is exactly
	// why the two counts have to be reported separately.
	if row.Attention != 2 {
		t.Fatalf("a branch somebody else owns became an action item: %+v", row)
	}
}

// The documented relationship between the two surfaces, pinned so it cannot
// drift into agreement or into a wider gap unnoticed: list_repositories counts
// the follow-up workspace, list_pull_requests counts everything synchronized,
// and a pull request the inclusion rules drop is the difference between them.
func TestRepositoryCountsUndercountTheRedBranches(t *testing.T) {
	_, session, _ := mcpFixture(t, "mcp-undercount")

	var red numberedPullRequests
	callStructured(t, session, "list_pull_requests", map[string]any{"checks": "failure"}, &red)
	if red.Total != 2 {
		t.Fatalf("both red branches are stored, got %+v", red)
	}

	var listed struct {
		Repositories []struct {
			ChecksFailing int `json:"checks_failing"`
		} `json:"repositories"`
	}
	callStructured(t, session, "list_repositories", map[string]any{}, &listed)
	if len(listed.Repositories) != 1 {
		t.Fatalf("the fixture tracks one repository, got %+v", listed)
	}
	// One of the two is requested through an unselected team, so the workspace
	// never sees it. Adding the per-repository counts up is the mistake this
	// asymmetry exists to warn about.
	if listed.Repositories[0].ChecksFailing != 1 {
		t.Fatalf("checks_failing is %d; the workspace should not see the untracked branch: %+v", listed.Repositories[0].ChecksFailing, listed)
	}
}
