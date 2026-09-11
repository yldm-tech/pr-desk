package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func pkcePair(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func oauthRouter(s *Server) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.GET("/oauth/authorize", s.authorizeEndpoint)
	r.POST("/oauth/authorize", s.authorizeEndpoint)
	r.POST("/oauth/token", s.tokenEndpoint)
	r.POST("/oauth/register", s.registerOAuthClient)
	return r
}

// The whole point of the flow is that a code is worthless without the verifier
// that produced its challenge, and that it cannot be spent twice.
func TestAuthorizationCodeRequiresItsVerifierAndIsSingleUse(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "oauth-a", Username: "a", Token: "encrypted"}, 9101, "oauth-browser-a"); err != nil {
		t.Fatal(err)
	}
	r := oauthRouter(s)
	verifier := "verifier-that-is-long-enough-to-be-real"
	redirect := "http://127.0.0.1:51234/callback"
	query := url.Values{
		"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {redirect},
		"code_challenge": {pkcePair(verifier)}, "code_challenge_method": {"S256"},
		"state": {"xyz"}, "scope": {scopeFollowUpsRead + " " + scopeFollowUpsWrite},
	}
	consent := httptest.NewRequest(http.MethodPost, "/oauth/authorize?"+query.Encode(), nil)
	consent.AddCookie(&http.Cookie{Name: "pr_session", Value: "oauth-browser-a"})
	consent.Header.Set("Origin", "http://localhost:8080")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, consent)
	if w.Code != http.StatusFound {
		t.Fatal("consent did not redirect", w.Code, w.Body.String())
	}
	location, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if location.Query().Get("state") != "xyz" {
		t.Fatal("state was not echoed", location.String())
	}
	code := location.Query().Get("code")
	if code == "" {
		t.Fatal("no authorization code was issued")
	}

	exchange := func(sentVerifier string) *httptest.ResponseRecorder {
		form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect}, "client_id": {cliClientID}, "code_verifier": {sentVerifier}}
		request := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		recorder := httptest.NewRecorder()
		r.ServeHTTP(recorder, request)
		return recorder
	}
	if w := exchange("a-different-verifier"); w.Code == http.StatusOK {
		t.Fatal("a code was redeemed with the wrong verifier")
	}
	// The failed attempt already consumed the code, which is what stops a
	// stolen code from being replayed after a guess.
	if w := exchange(verifier); w.Code == http.StatusOK {
		t.Fatal("a code survived an earlier redemption attempt")
	}
}

func TestAuthorizationCodeProducesAUsableToken(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "oauth-b", Username: "b", Token: "encrypted"}, 9102, "oauth-browser-b"); err != nil {
		t.Fatal(err)
	}
	r := oauthRouter(s)
	verifier := "another-verifier-long-enough"
	redirect := "http://127.0.0.1:51235/callback"
	query := url.Values{
		"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {redirect},
		"code_challenge": {pkcePair(verifier)}, "code_challenge_method": {"S256"}, "scope": {scopeFollowUpsRead},
	}
	consent := httptest.NewRequest(http.MethodPost, "/oauth/authorize?"+query.Encode(), nil)
	consent.AddCookie(&http.Cookie{Name: "pr_session", Value: "oauth-browser-b"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, consent)
	location, _ := url.Parse(w.Header().Get("Location"))
	form := url.Values{"grant_type": {"authorization_code"}, "code": {location.Query().Get("code")}, "redirect_uri": {redirect}, "client_id": {cliClientID}, "code_verifier": {verifier}}
	request := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenResponse := httptest.NewRecorder()
	r.ServeHTTP(tokenResponse, request)
	if tokenResponse.Code != http.StatusOK {
		t.Fatal("token exchange failed", tokenResponse.Code, tokenResponse.Body.String())
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		Scope       string `json:"scope"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if json.Unmarshal(tokenResponse.Body.Bytes(), &payload) != nil || payload.AccessToken == "" {
		t.Fatal("no access token", tokenResponse.Body.String())
	}
	if payload.Scope != scopeFollowUpsRead || payload.ExpiresIn <= 0 {
		t.Fatal("unexpected grant", payload)
	}
	record, err := lookupAPIToken(context.Background(), db, payload.AccessToken, time.Now().UTC())
	if err != nil {
		t.Fatal("the issued token does not verify", err)
	}
	if record.SessionID != "oauth-b" || record.allows(scopeFollowUpsWrite) {
		t.Fatal("the token carries the wrong account or scope", record)
	}
	// Only the hash is kept: a database copy must not be replayable.
	var stored APIToken
	if db.Where("id = ?", record.ID).First(&stored).Error != nil {
		t.Fatal("token row missing")
	}
	if strings.Contains(stored.TokenHash, payload.AccessToken) || stored.TokenHash == payload.AccessToken {
		t.Fatal("the plaintext token was stored")
	}
}

func TestAuthorizeRejectsUnregisteredRedirectsAndWeakFlows(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "oauth-c", Username: "c", Token: "encrypted"}, 9103, "oauth-browser-c"); err != nil {
		t.Fatal(err)
	}
	r := oauthRouter(s)
	cases := map[string]url.Values{
		"a redirect that is not loopback": {"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {"https://attacker.example.com/cb"}, "code_challenge": {"x"}, "code_challenge_method": {"S256"}},
		"plain PKCE":                      {"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {"http://127.0.0.1:5/callback"}, "code_challenge": {"x"}, "code_challenge_method": {"plain"}},
		"no PKCE at all":                  {"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {"http://127.0.0.1:5/callback"}},
		"an implicit grant":               {"response_type": {"token"}, "client_id": {cliClientID}, "redirect_uri": {"http://127.0.0.1:5/callback"}, "code_challenge": {"x"}, "code_challenge_method": {"S256"}},
		"an unknown client":               {"response_type": {"code"}, "client_id": {"someone-else"}, "redirect_uri": {"http://127.0.0.1:5/callback"}, "code_challenge": {"x"}, "code_challenge_method": {"S256"}},
		"an unsupported scope":            {"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {"http://127.0.0.1:5/callback"}, "code_challenge": {"x"}, "code_challenge_method": {"S256"}, "scope": {"admin"}},
	}
	for name, query := range cases {
		request := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+query.Encode(), nil)
		request.AddCookie(&http.Cookie{Name: "pr_session", Value: "oauth-browser-c"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s was accepted (status %d)", name, w.Code)
		}
		if location := w.Header().Get("Location"); location != "" {
			t.Errorf("%s produced a redirect to %s", name, location)
		}
	}
}

func TestDynamicRegistrationRefusesUnsafeRedirects(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	r := oauthRouter(s)
	register := func(body string) int {
		request := httptest.NewRequest(http.MethodPost, "/oauth/register", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		return w.Code
	}
	if code := register(`{"client_name":"Agent","redirect_uris":["https://agent.example.com/cb"]}`); code != http.StatusCreated {
		t.Fatal("a valid https client was refused", code)
	}
	if code := register(`{"client_name":"Agent","redirect_uris":["http://agent.example.com/cb"]}`); code != http.StatusBadRequest {
		t.Fatal("plain http outside loopback was registered", code)
	}
	if code := register(`{"client_name":"Agent","redirect_uris":[]}`); code != http.StatusBadRequest {
		t.Fatal("a client with no redirect was registered", code)
	}
}
