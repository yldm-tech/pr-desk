package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

// The consent form carries a token issued by the page that renders it, so a
// test has to walk the same two steps a browser does.
func grantConsent(t *testing.T, r *gin.Engine, query url.Values, sessionCookie string) *httptest.ResponseRecorder {
	t.Helper()
	get := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+query.Encode(), nil)
	get.AddCookie(&http.Cookie{Name: "pr_session", Value: sessionCookie})
	page := httptest.NewRecorder()
	r.ServeHTTP(page, get)
	if page.Code != http.StatusOK {
		t.Fatal("the consent page did not render", page.Code, page.Body.String())
	}
	token := ""
	for _, cookie := range page.Result().Cookies() {
		if cookie.Name == consentCookie {
			token = cookie.Value
		}
	}
	form := url.Values{}
	for key, values := range query {
		form.Set(key, values[0])
	}
	form.Set(consentField, token)
	post := httptest.NewRequest(http.MethodPost, "/oauth/authorize", strings.NewReader(form.Encode()))
	post.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	post.AddCookie(&http.Cookie{Name: "pr_session", Value: sessionCookie})
	post.AddCookie(&http.Cookie{Name: consentCookie, Value: token})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, post)
	return w
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
	w := grantConsent(t, r, query, "oauth-browser-a")
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
	w := grantConsent(t, r, query, "oauth-browser-b")
	if w.Code != http.StatusFound {
		t.Fatal("consent did not redirect", w.Code, w.Body.String())
	}
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

// The consent page submits its parameters as form fields, not in the query
// string. Reading only the query made every real login fail with "Unknown
// client" while the tests that posted a query string kept passing.
func TestConsentSubmissionCarriesItsParametersInTheBody(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "http://localhost:8080")
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "body-a", Username: "b", Token: "encrypted"}, 9601, "body-browser"); err != nil {
		t.Fatal(err)
	}
	r := oauthRouter(s)
	verifier := "a-verifier-that-is-long-enough"
	form := url.Values{
		"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {"http://127.0.0.1:9/callback"},
		"code_challenge": {pkcePair(verifier)}, "code_challenge_method": {"S256"},
		"state": {"round-trip"}, "scope": {scopeFollowUpsRead},
	}
	w := grantConsent(t, r, form, "body-browser")
	if w.Code != http.StatusFound {
		t.Fatalf("the consent submission produced no code: %d %s", w.Code, w.Body.String())
	}
	location, _ := url.Parse(w.Header().Get("Location"))
	if location.Query().Get("code") == "" || location.Query().Get("state") != "round-trip" {
		t.Fatal("unexpected redirect", location.String())
	}
}

// Asking for write alone would otherwise produce a token the endpoint refuses
// on every call, because the middleware requires the read scope.
func TestWriteScopeImpliesRead(t *testing.T) {
	scopes, err := parseScopes(scopeFollowUpsWrite)
	if err != nil {
		t.Fatal(err)
	}
	if len(scopes) != 2 || scopes[0] != scopeFollowUpsRead {
		t.Fatal("a write-only grant was not widened to include reading", scopes)
	}
}

func TestCancelLinkSurvivesARedirectThatAlreadyHasAQuery(t *testing.T) {
	cancel := cancelURL(authorizeRequest{redirect: "https://agent.example.com/cb?tenant=acme", state: "s"})
	parsed, err := url.Parse(cancel)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("error") != "access_denied" || parsed.Query().Get("tenant") != "acme" {
		t.Fatal("the refusal did not survive the existing query", cancel)
	}
}

func TestRevokingATokenStopsItImmediately(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "revoke-a", Username: "r", Token: "encrypted"}, 9701, "revoke-browser-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "revoke-b", Username: "o", Token: "encrypted"}, 9702, "revoke-browser-b"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	token, record, err := issueAPIToken(db, "revoke-a", cliClientID, "laptop", []string{scopeFollowUpsRead}, now)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.GET("/api-tokens", s.listAPITokens)
	r.DELETE("/api-tokens/:id", s.revokeAPIToken)
	call := func(method, path, cookie string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, nil)
		request.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		return w
	}
	if w := call(http.MethodGet, "/api-tokens", "revoke-browser-a"); !strings.Contains(w.Body.String(), "laptop") {
		t.Fatal("the token is not listed", w.Body.String())
	}
	// Another account must not be able to revoke it.
	if w := call(http.MethodDelete, fmt.Sprintf("/api-tokens/%d", record.ID), "revoke-browser-b"); w.Code != http.StatusNotFound {
		t.Fatal("another account revoked this token", w.Code)
	}
	if _, err := lookupAPIToken(context.Background(), db, token, time.Now().UTC()); err != nil {
		t.Fatal("the token stopped working after a foreign revoke attempt", err)
	}
	if w := call(http.MethodDelete, fmt.Sprintf("/api-tokens/%d", record.ID), "revoke-browser-a"); w.Code != http.StatusNoContent {
		t.Fatal("the owner could not revoke the token", w.Code, w.Body.String())
	}
	if _, err := lookupAPIToken(context.Background(), db, token, time.Now().UTC()); err == nil {
		t.Fatal("a revoked token still verifies")
	}
}

// Claude Code and most other clients register http://localhost:PORT/callback.
// Refusing it made dynamic registration fail before the user ever saw a consent
// page, which surfaced only as "auth failed" in the client.
func TestRegistrationAcceptsTheLoopbackNamesClientsActuallyUse(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	r := oauthRouter(s)
	register := func(redirect string) int {
		body := `{"client_name":"Client","redirect_uris":["` + redirect + `"]}`
		request := httptest.NewRequest(http.MethodPost, "/oauth/register", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		return w.Code
	}
	for _, redirect := range []string{"http://localhost:53123/callback", "http://127.0.0.1:53123/callback", "http://[::1]:53123/callback"} {
		if code := register(redirect); code != http.StatusCreated {
			t.Errorf("%s was refused (%d)", redirect, code)
		}
	}
	// Still not a general-purpose open redirect.
	for _, redirect := range []string{"http://evil.example.com/callback", "http://localhost.evil.example.com/cb"} {
		if code := register(redirect); code != http.StatusBadRequest {
			t.Errorf("%s was accepted (%d)", redirect, code)
		}
	}
}

// Browsers do not reliably send Origin on a same-origin form post, so consent
// must not depend on it — that dependency is what answered a real sign-in with
// 403. The form carries its own token instead.
func TestConsentSucceedsWithoutOriginAndFailsWithoutItsToken(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("WEB_ORIGIN", "https://prdesk.example.com")
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "csrf-a", Username: "c", Token: "encrypted"}, 9801, "csrf-browser"); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(s.resolveBrowserSession, requireMutationOrigin)
	r.GET("/api/v1/oauth/authorize", s.authorizeEndpoint)
	r.POST("/api/v1/oauth/authorize", s.authorizeEndpoint)

	verifier := "consent-verifier-long-enough"
	query := url.Values{
		"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {"http://127.0.0.1:9/callback"},
		"code_challenge": {pkcePair(verifier)}, "code_challenge_method": {"S256"}, "scope": {scopeFollowUpsRead},
	}
	// Render the page to obtain the token and its cookie.
	get := httptest.NewRequest(http.MethodGet, "/api/v1/oauth/authorize?"+query.Encode(), nil)
	get.AddCookie(&http.Cookie{Name: "pr_session", Value: "csrf-browser"})
	page := httptest.NewRecorder()
	r.ServeHTTP(page, get)
	if page.Code != http.StatusOK {
		t.Fatal("the consent page did not render", page.Code, page.Body.String())
	}
	var issued string
	for _, cookie := range page.Result().Cookies() {
		if cookie.Name == consentCookie {
			issued = cookie.Value
		}
	}
	if issued == "" || !strings.Contains(page.Body.String(), issued) {
		t.Fatal("the page did not carry the token in both the cookie and the form")
	}

	submit := func(token string, withCookie bool) *httptest.ResponseRecorder {
		form := url.Values{}
		for key, values := range query {
			form.Set(key, values[0])
		}
		form.Set(consentField, token)
		request := httptest.NewRequest(http.MethodPost, "/api/v1/oauth/authorize", strings.NewReader(form.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		request.AddCookie(&http.Cookie{Name: "pr_session", Value: "csrf-browser"})
		if withCookie {
			request.AddCookie(&http.Cookie{Name: consentCookie, Value: issued})
		}
		// Deliberately no Origin header: this is the case that used to 403.
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		return w
	}

	if w := submit(issued, true); w.Code != http.StatusFound {
		t.Fatal("a legitimate consent without an Origin header was refused", w.Code, w.Body.String())
	}
	// A cross-site post cannot read the cookie value, and a Lax cookie is not
	// attached to it either. Both halves are refused.
	if w := submit("guessed-token", true); w.Code != http.StatusForbidden {
		t.Fatal("a forged token was accepted", w.Code)
	}
	if w := submit(issued, false); w.Code != http.StatusForbidden {
		t.Fatal("consent was accepted without the cookie", w.Code)
	}
}
