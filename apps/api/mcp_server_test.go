package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type bearerRoundTripper struct {
	token string
	base  http.RoundTripper
}

func (b bearerRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	if b.token != "" {
		clone.Header.Set("Authorization", "Bearer "+b.token)
	}
	return b.base.RoundTrip(clone)
}

// mcpHarness stands up the real endpoint over HTTP so the transport, the
// bearer middleware and the tools are all exercised together.
func mcpHarness(t *testing.T, s *Server) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Any("/api/v1/mcp", s.mcpHandler())
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return server
}

func mcpConnect(t *testing.T, endpoint, token string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	httpClient := &http.Client{Transport: bearerRoundTripper{token: token, base: http.DefaultTransport}}
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: endpoint, HTTPClient: httpClient}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func TestMCPRequiresATokenAndAdvertisesWhereToGetOne(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	server := mcpHarness(t, s)
	response, err := http.Post(server.URL+"/api/v1/mcp", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatal("an unauthenticated call was not refused", response.StatusCode)
	}
	// Without this header a client cannot discover the authorization server.
	if challenge := response.Header.Get("WWW-Authenticate"); !strings.Contains(challenge, "resource_metadata") {
		t.Fatal("the refusal does not point at the resource metadata", challenge)
	}
}

func TestMCPToolsAreScopedToTheTokensAccount(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	for _, account := range []struct{ sid, browser, repo string }{{"mcp-a", "mcp-browser-a", "fixture/alpha"}, {"mcp-b", "mcp-browser-b", "fixture/beta"}} {
		if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: account.sid, Username: account.sid, Token: "encrypted"}, int64(len(account.sid)+9200), account.browser); err != nil {
			t.Fatal(err)
		}
		pr := PullRequest{SessionID: account.sid, Repo: account.repo, Number: 1, Title: "Tracked in " + account.repo, State: "open", UpdatedAt: now, Role: "authored"}
		if err := db.Create(&pr).Error; err != nil {
			t.Fatal(err)
		}
		follow := FollowUp{SessionID: account.sid, PullRequestID: pr.ID, Version: 1, WaitingSince: now.Add(-48 * time.Hour), LastActivityAt: now, FactsJSON: `{"role":"authored","needs_confirmation":true}`, NeedsConfirmation: true}
		if err := db.Create(&follow).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&FollowUpSettings{SessionID: account.sid, Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}", BaselineAt: &now}).Error; err != nil {
			t.Fatal(err)
		}
	}
	server := mcpHarness(t, s)
	token, _, err := issueAPIToken(db, "mcp-a", cliClientID, "test", []string{scopeFollowUpsRead}, now)
	if err != nil {
		t.Fatal(err)
	}
	session := mcpConnect(t, server.URL+"/api/v1/mcp", token)

	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.Tools) < 5 {
		t.Fatal("the tool list is unexpectedly short", len(tools.Tools))
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_follow_ups", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatal("listing failed", toolText(result))
	}
	text := toolText(result) + mustJSON(result.StructuredContent)
	if !strings.Contains(text, "fixture/alpha") {
		t.Fatal("the account's own follow-up is missing", text)
	}
	if strings.Contains(text, "fixture/beta") {
		t.Fatal("another account's follow-up leaked through MCP", text)
	}

	// A read-only token must not be able to change state.
	write, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "mark_follow_up_read", Arguments: map[string]any{"id": 1, "version": 1}})
	if err != nil {
		t.Fatal(err)
	}
	if !write.IsError || !strings.Contains(toolText(write), scopeFollowUpsWrite) {
		t.Fatal("a read-only token was allowed to write", toolText(write))
	}
}

func TestMCPWriteToolsHonourOptimisticConcurrency(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "mcp-w", Username: "w", Token: "encrypted"}, 9301, "mcp-browser-w"); err != nil {
		t.Fatal(err)
	}
	pr := PullRequest{SessionID: "mcp-w", Repo: "fixture/writes", Number: 3, Title: "Needs handling", State: "open", UpdatedAt: now, Role: "authored"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	follow := FollowUp{SessionID: "mcp-w", PullRequestID: pr.ID, Version: 4, WaitingSince: now.Add(-72 * time.Hour), LastActivityAt: now, FactsJSON: `{"role":"authored","needs_confirmation":true}`, NeedsConfirmation: true}
	if err := db.Create(&follow).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&FollowUpSettings{SessionID: "mcp-w", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}", BaselineAt: &now}).Error; err != nil {
		t.Fatal(err)
	}
	server := mcpHarness(t, s)
	token, _, err := issueAPIToken(db, "mcp-w", cliClientID, "test", []string{scopeFollowUpsRead, scopeFollowUpsWrite}, now)
	if err != nil {
		t.Fatal(err)
	}
	session := mcpConnect(t, server.URL+"/api/v1/mcp", token)

	stale, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "mark_follow_up_handled", Arguments: map[string]any{"id": follow.ID, "version": 1}})
	if err != nil {
		t.Fatal(err)
	}
	if !stale.IsError {
		t.Fatal("a stale version was accepted, so an agent could mark away unseen activity")
	}
	fresh, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "mark_follow_up_handled", Arguments: map[string]any{"id": follow.ID, "version": 4}})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.IsError {
		t.Fatal("the current version was refused", toolText(fresh))
	}
	var after FollowUp
	if db.Where("id = ?", follow.ID).First(&after).Error != nil {
		t.Fatal("follow-up disappeared")
	}
	if after.HandledVersion != 4 {
		t.Fatal("the follow-up was not marked handled", after.HandledVersion)
	}
}

func toolText(result *mcp.CallToolResult) string {
	parts := []string{}
	for _, content := range result.Content {
		if text, ok := content.(*mcp.TextContent); ok {
			parts = append(parts, text.Text)
		}
	}
	return strings.Join(parts, " ")
}

// A client resolves the metadata URL by appending the resource's path to the
// well-known prefix (RFC 9728). Serving only the bare prefix let that request
// fall through to the single-page app, so the client parsed HTML as JSON and
// reported an authentication failure with nothing to act on.
func TestMetadataIsServedAtThePathFormClientsDerive(t *testing.T) {
	t.Setenv("WEB_ORIGIN", "https://prdesk.example.com")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	s := &Server{}
	r.GET("/.well-known/oauth-protected-resource", s.protectedResourceMetadata)
	r.GET("/.well-known/oauth-protected-resource/*resource", s.protectedResourceMetadata)
	r.GET("/.well-known/oauth-authorization-server", s.authorizationServerMetadata)
	r.GET("/.well-known/oauth-authorization-server/*resource", s.authorizationServerMetadata)

	for _, path := range []string{
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-protected-resource/api/v1/mcp",
		"/.well-known/oauth-authorization-server",
		"/.well-known/oauth-authorization-server/api/v1/mcp",
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s answered %d", path, w.Code)
		}
		if !strings.Contains(w.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("%s is not JSON: %s", path, w.Header().Get("Content-Type"))
		}
		var document map[string]any
		if json.Unmarshal(w.Body.Bytes(), &document) != nil {
			t.Fatalf("%s did not return a JSON document: %s", path, w.Body.String())
		}
		if document["resource"] == nil && document["issuer"] == nil {
			t.Fatalf("%s carries neither a resource nor an issuer: %s", path, w.Body.String())
		}
	}
}
