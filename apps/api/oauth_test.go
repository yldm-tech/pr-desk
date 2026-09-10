package main

import (
	"context"
	"golang.org/x/oauth2"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOAuthRedirectConfiguration(t *testing.T) {
	for _, tc := range []struct{ name, port, override, want string }{
		{"default", "", "", "http://localhost:8080/api/v1/auth/github/callback"},
		{"local port", "8081", "", "http://localhost:8081/api/v1/auth/github/callback"},
		{"explicit URL", "8081", "https://example.test/callback", "https://example.test/callback"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PORT", tc.port)
			t.Setenv("GITHUB_REDIRECT_URL", tc.override)
			router := gin.New()
			router.GET("/auth", githubAuth)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", "/auth", nil))
			location, err := url.Parse(w.Header().Get("Location"))
			if err != nil || w.Code != 302 {
				t.Fatalf("invalid authorization response: %d, %v", w.Code, err)
			}
			if got := location.Query().Get("redirect_uri"); got != tc.want {
				t.Fatalf("redirect_uri = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestOAuthDoesNotConnectWhenEncryptionFails(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", "")
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.RawQuery != "" {
			t.Fatal("token exchange must not put credentials in the URL")
		}
		if err := r.ParseForm(); err != nil || r.PostForm.Get("redirect_uri") != oauthRedirectURL() {
			t.Fatal("token exchange must use the same callback as authorization")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"access_token":"test-token"}`)), Header: make(http.Header)}, nil
	})}
	router := gin.New()
	router.GET("/callback", githubCallback)
	req := httptest.NewRequest("GET", "/callback?code=test&state=test-state", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "test-state"})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 500 {
		t.Fatalf("wanted 500, got %d", w.Code)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == "pr_connected" {
			t.Fatal("issued a connection cookie despite failed encryption")
		}
	}
	if strings.Contains(w.Body.String(), "test-token") {
		t.Fatal("response leaked token")
	}
}

func TestOAuthRejectsMissingOrMismatchedState(t *testing.T) {
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Fatal("invalid state must be rejected before exchange")
		return nil, nil
	})}
	for _, query := range []string{"", "?state=wrong"} {
		router := gin.New()
		router.GET("/callback", githubCallback)
		req := httptest.NewRequest("GET", "/callback"+query, nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "expected"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatalf("wanted 403, got %d", w.Code)
		}
	}
}

func TestOAuthDenialRedirectsWithoutExchangingCode(t *testing.T) {
	t.Setenv("WEB_ORIGIN", "http://localhost:5174")
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Fatal("denied authorization must not call GitHub token exchange")
		return nil, nil
	})}
	router := gin.New()
	router.GET("/callback", githubCallback)
	req := httptest.NewRequest("GET", "/callback?error=access_denied&state=denied-state", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "denied-state"})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusFound || w.Header().Get("Location") != "http://localhost:5174?oauth_error=access_denied" {
		t.Fatalf("unexpected denial response: %d %q", w.Code, w.Header().Get("Location"))
	}
}

func TestOAuthDenialRequiresState(t *testing.T) {
	router := gin.New()
	router.GET("/callback", githubCallback)
	for _, query := range []string{"?error=access_denied", "?error=access_denied&state=wrong"} {
		req := httptest.NewRequest("GET", "/callback"+query, nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "expected"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: got %d", query, w.Code)
		}
	}
}

func TestOAuthExchangeDoesNotProbeOrRetry(t *testing.T) {
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"temporarily_unavailable"}`))}, nil
	})}
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, githubHTTPClient)
	_, err := githubOAuthConfig().Exchange(ctx, "test-code")
	if err == nil || calls != 1 {
		t.Fatalf("exchange calls=%d error=%v", calls, err)
	}
}
