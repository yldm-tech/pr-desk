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

	binary := filepath.Join(t.TempDir(), "pr-desk-cli")
	build := exec.Command("go", "build", "-o", binary, "./cmd/pr-desk-cli")
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
