package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The CLI speaks the same MCP endpoint an agent uses. Keeping one surface means
// a command that works here works for the agent too, and there is no second
// transport to keep in step.
type bearerTransport struct {
	token string
	base  http.RoundTripper
}

func (b bearerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.Header.Set("Authorization", "Bearer "+b.token)
	return b.base.RoundTrip(clone)
}

func callTool(stored credentials, name string, arguments map[string]any) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	httpClient := &http.Client{Timeout: 60 * time.Second, Transport: bearerTransport{token: stored.Token, base: http.DefaultTransport}}
	client := mcp.NewClient(&mcp.Implementation{Name: "pr-desk-cli", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: stored.Host + "/api/v1/mcp", HTTPClient: httpClient}, nil)
	if err != nil {
		return nil, errors.New("cannot reach " + stored.Host + ": " + err.Error())
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil {
		return nil, err
	}
	if result.IsError {
		return nil, errors.New(toolErrorText(result))
	}
	if result.StructuredContent == nil {
		return json.Marshal(map[string]any{})
	}
	return json.Marshal(result.StructuredContent)
}

func toolErrorText(result *mcp.CallToolResult) string {
	for _, content := range result.Content {
		if text, ok := content.(*mcp.TextContent); ok && text.Text != "" {
			return text.Text
		}
	}
	return "the server refused the request"
}
