package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The CLI speaks the same MCP endpoint an agent uses. Keeping one surface means
// a command that works here works for the agent too, and there is no second
// transport to keep in step.
type bearerTransport struct {
	token string
	base  http.RoundTripper
	// The server answers a revoked token with a bare status the SDK reduces to "Unauthorized", too late to tell apart from the deployment being down. The round trip is the only place that still knows, and it may run on another goroutine, so the answer is carried back in an atomic.
	refused *atomic.Bool
}

func (b bearerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.Header.Set("Authorization", "Bearer "+b.token)
	response, err := b.base.RoundTrip(clone)
	if err == nil && (response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden) {
		b.refused.Store(true)
	}
	return response, err
}

func callTool(stored credentials, name string, arguments map[string]any) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	refused := &atomic.Bool{}
	httpClient := &http.Client{Timeout: 60 * time.Second, Transport: bearerTransport{token: stored.Token, base: http.DefaultTransport, refused: refused}}
	client := mcp.NewClient(&mcp.Implementation{Name: "prdesk", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: stored.Host + "/api/v1/mcp", HTTPClient: httpClient}, nil)
	if err != nil {
		if refused.Load() {
			return nil, tokenRefused(stored.Host)
		}
		return nil, errors.New("cannot reach " + stored.Host + ": " + err.Error())
	}
	defer session.Close()
	// Initialization is the only place the server names its release, so the skew
	// check rides along with work the caller already asked for.
	if initialized := session.InitializeResult(); initialized != nil && initialized.ServerInfo != nil {
		noticeServerVersion(initialized.ServerInfo.Version)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil {
		if refused.Load() {
			return nil, tokenRefused(stored.Host)
		}
		return nil, fmt.Errorf("%s: %w", stored.Host, err)
	}
	if result.IsError {
		return nil, errors.New(toolErrorText(result))
	}
	if result.StructuredContent == nil {
		return json.Marshal(map[string]any{})
	}
	return json.Marshal(result.StructuredContent)
}

// A token outlives its welcome without expiring: revoking it, or disconnecting the account from GitHub, leaves a credentials.json the local expiry check is happy with. Naming the remedy is the difference between signing in again and going to look at DNS.
func tokenRefused(host string) error {
	return errors.New("the stored token is no longer accepted by " + host + "; run: prdesk login")
}

func toolErrorText(result *mcp.CallToolResult) string {
	for _, content := range result.Content {
		if text, ok := content.(*mcp.TextContent); ok && text.Text != "" {
			return text.Text
		}
	}
	return "the server refused the request"
}
