package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Revoking a token, or disconnecting the account from GitHub, leaves a
// credentials.json the local expiry check is happy with. The server answers with
// a bare status the SDK reduces to "Unauthorized"; reported as "cannot reach",
// that sends someone to look at DNS instead of signing in again.
func TestCallToolNamesARefusedToken(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "invalid token", status)
		}))
		_, err := callTool(credentials{Host: server.URL, Token: "prdesk_revoked"}, "get_follow_up_summary", nil)
		server.Close()
		if err == nil {
			t.Fatalf("a %d was reported as success", status)
		}
		if !strings.Contains(err.Error(), "prdesk login") {
			t.Fatalf("a %d did not say what to do: %v", status, err)
		}
		if strings.Contains(err.Error(), "cannot reach") {
			t.Fatalf("a %d was blamed on the network: %v", status, err)
		}
	}
}

// A server that is genuinely down has to keep reading as one.
func TestCallToolStillReportsAnUnreachableHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	host := server.URL
	server.Close()

	_, err := callTool(credentials{Host: host, Token: "prdesk_x"}, "get_follow_up_summary", nil)
	if err == nil {
		t.Fatal("an unreachable host was reported as success")
	}
	if !strings.Contains(err.Error(), "cannot reach "+host) {
		t.Fatalf("an unreachable host was not named: %v", err)
	}
	if strings.Contains(err.Error(), "prdesk login") {
		t.Fatalf("an outage was reported as a credential problem: %v", err)
	}
}
