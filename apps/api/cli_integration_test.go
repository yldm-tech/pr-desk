package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// The CLI talks to the same MCP endpoint an agent uses, so this exercises the
// transport, the bearer middleware, the tools and the rendering in one go.
// Anything that only works because a test called a function directly would be
// missed here.
func TestCLIReadsFollowUpsThroughMCP(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the CLI binary")
	}
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "cli-a", Username: "cli", Token: "encrypted"}, 9401, "cli-browser-a"); err != nil {
		t.Fatal(err)
	}
	pr := PullRequest{SessionID: "cli-a", Repo: "fixture/cli", Number: 12, Title: "Handle the command line", State: "open", UpdatedAt: now, Role: "authored"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	follow := FollowUp{SessionID: "cli-a", PullRequestID: pr.ID, Version: 2, WaitingSince: now.Add(-96 * time.Hour), LastActivityAt: now, FactsJSON: `{"role":"authored","needs_confirmation":true}`, NeedsConfirmation: true}
	if err := db.Create(&follow).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&FollowUpSettings{SessionID: "cli-a", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}", BaselineAt: &now}).Error; err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Any("/api/v1/mcp", s.mcpHandler())
	server := httptest.NewServer(router)
	defer server.Close()

	binary := filepath.Join(t.TempDir(), "prdesk")
	build := exec.Command("go", "build", "-o", binary, "./cmd/prdesk")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("cannot build the CLI: ", string(out))
	}

	token, _, err := issueAPIToken(db, "cli-a", cliClientID, "cli test", []string{scopeFollowUpsRead, scopeFollowUpsWrite}, now)
	if err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	stored, _ := json.Marshal(map[string]any{"host": server.URL, "token": token, "scopes": scopeFollowUpsRead + " " + scopeFollowUpsWrite, "expires_at": now.Add(time.Hour)})
	if err := os.WriteFile(filepath.Join(configDir, "credentials.json"), stored, 0o600); err != nil {
		t.Fatal(err)
	}

	run := func(args ...string) string {
		command := exec.Command(binary, args...)
		command.Env = append(os.Environ(), "PR_DESK_CONFIG_DIR="+configDir)
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("%v failed: %s", args, string(out))
		}
		return string(out)
	}

	listing := run("followups")
	if !strings.Contains(listing, "fixture/cli") || !strings.Contains(listing, "Handle the command line") {
		t.Fatal("the follow-up is missing from the listing:\n" + listing)
	}
	if !strings.Contains(listing, "#12") {
		t.Fatal("the pull request number is missing:\n" + listing)
	}

	asJSON := run("followups", "--json")
	var payload struct {
		FollowUps []struct {
			ID      uint   `json:"id"`
			Version uint64 `json:"version"`
		} `json:"follow_ups"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(asJSON)), &payload) != nil || len(payload.FollowUps) != 1 {
		t.Fatal("--json did not produce a usable document:\n" + asJSON)
	}

	// The version from the listing is what makes the write safe to apply.
	run("handled", strings.TrimSpace(itoa(payload.FollowUps[0].ID)), strings.TrimSpace(utoa(payload.FollowUps[0].Version)))
	var after FollowUp
	if db.Where("id = ?", follow.ID).First(&after).Error != nil {
		t.Fatal("follow-up disappeared")
	}
	if after.HandledVersion != 2 {
		t.Fatal("the CLI write did not reach the database", after.HandledVersion)
	}
}

// Every new command names a tool and its arguments as plain strings on the
// client side. A typo there compiles, passes the unit tests and only fails when
// somebody runs it, so the wiring is exercised against the real endpoint.
func TestCLICoversTheNewCommandsEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the CLI binary")
	}
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "cli-b", Username: "cli", Token: "encrypted"}, 9402, "cli-browser-b"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&OAuthToken{}).Where("session_id = ?", "cli-b").Update("history_synced_at", now.Add(-30*time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	checks, err := json.Marshal([]checkRunSummary{{Name: "Stale PR", Conclusion: "cancelled", URL: "https://github.com/fixture/cli/runs/3"}})
	if err != nil {
		t.Fatal(err)
	}
	pr := PullRequest{SessionID: "cli-b", Repo: "fixture/cli", Number: 44, Title: "Report the real check state", State: "open", UpdatedAt: now, Role: "authored", HasConflicts: true, ChecksStatus: "inconclusive", ChecksJSON: string(checks), Author: "someone", URL: "https://github.com/fixture/cli/pull/44"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	follow := FollowUp{SessionID: "cli-b", PullRequestID: pr.ID, Version: 3, WaitingSince: now.Add(-40 * 24 * time.Hour), LastActivityAt: now, FactsJSON: `{"role":"authored","conflict":true}`}
	if err := db.Create(&follow).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ReviewComment{SessionID: "cli-b", PullRequestID: pr.ID, GitHubID: 9, Author: "reviewer", Body: "The cancelled run is not a real failure.", URL: "https://github.com/c/9", CommentType: "review", CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&FollowUpSettings{SessionID: "cli-b", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}", BaselineAt: &now}).Error; err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Any("/api/v1/mcp", s.mcpHandler())
	server := httptest.NewServer(router)
	defer server.Close()

	binary := filepath.Join(t.TempDir(), "prdesk")
	if out, err := exec.Command("go", "build", "-o", binary, "./cmd/prdesk").CombinedOutput(); err != nil {
		t.Fatal("cannot build the CLI: ", string(out))
	}
	token, _, err := issueAPIToken(db, "cli-b", cliClientID, "cli test", []string{scopeFollowUpsRead, scopeFollowUpsWrite}, now)
	if err != nil {
		t.Fatal(err)
	}
	configDir := t.TempDir()
	stored, _ := json.Marshal(map[string]any{"host": server.URL, "token": token, "scopes": scopeFollowUpsRead + " " + scopeFollowUpsWrite, "expires_at": now.Add(time.Hour)})
	if err := os.WriteFile(filepath.Join(configDir, "credentials.json"), stored, 0o600); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) string {
		command := exec.Command(binary, args...)
		command.Env = append(os.Environ(), "PR_DESK_CONFIG_DIR="+configDir)
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("%v failed: %s", args, string(out))
		}
		return string(out)
	}

	if filtered := run("followups", "--reason", "conflict", "--min-waiting", "30", "--sort", "waiting", "--url"); !strings.Contains(filtered, "#44") || !strings.Contains(filtered, "https://github.com/fixture/cli/pull/44") {
		t.Fatal("the filters or the URL column did not survive the round trip:\n" + filtered)
	}
	if excluded := run("followups", "--reason", "checks_failed"); !strings.Contains(excluded, "Nothing is waiting") {
		t.Fatal("an inconclusive check was reported as a failure:\n" + excluded)
	}
	detail := run("show", itoa(follow.ID))
	for _, want := range []string{"fixture/cli #44", "inconclusive", "Stale PR", "cancelled", "The cancelled run is not a real failure."} {
		if !strings.Contains(detail, want) {
			t.Fatalf("show is missing %q:\n%s", want, detail)
		}
	}
	if sync := run("sync"); !strings.Contains(sync, "Last synced") || !strings.Contains(sync, "30m ago") {
		t.Fatal("the freshness report did not come through:\n" + sync)
	}
	if prs := run("prs", "--state", "open", "--role", "authored"); !strings.Contains(prs, "#44") {
		t.Fatal("the pull request filters did not survive the round trip:\n" + prs)
	}

	run("snooze", itoa(follow.ID), utoa(follow.Version), "5")
	run("unsnooze", itoa(follow.ID), utoa(follow.Version))
	var after FollowUp
	if db.Where("id = ?", follow.ID).First(&after).Error != nil {
		t.Fatal("follow-up disappeared")
	}
	if after.SnoozedUntil != nil {
		t.Fatal("unsnooze did not reach the database")
	}

	// A flag the command cannot use is refused locally, before authenticating.
	rejected := exec.Command(binary, "prs", "--reason", "conflict")
	rejected.Env = append(os.Environ(), "PR_DESK_CONFIG_DIR="+configDir)
	out, err := rejected.CombinedOutput()
	if err == nil {
		t.Fatal("a flag that does not apply was accepted:\n" + string(out))
	}
	if !strings.Contains(string(out), "--reason does not apply") {
		t.Fatal("the refusal does not name the flag:\n" + string(out))
	}
}

func itoa(v uint) string { return utoa(uint64(v)) }
func utoa(v uint64) string {
	if v == 0 {
		return "0"
	}
	digits := []byte{}
	for v > 0 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
		v /= 10
	}
	return string(digits)
}
