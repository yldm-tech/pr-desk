package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PR Desk acts as its own authorization server so that a command line client
// and a remote MCP client can obtain a token without ever seeing the GitHub
// credentials, and without a browser cookie. The account holder still
// authenticates through the existing GitHub sign-in; this layer only issues
// tokens for an already authenticated browser session.

// The CLI ships with a fixed public identifier. It is a public client: it
// cannot keep a secret, so PKCE is mandatory and its redirect is restricted to
// the loopback interface (RFC 8252).
const cliClientID = "pr-desk-cli"

type OAuthClient struct {
	ID           uint   `gorm:"primaryKey"`
	ClientID     string `gorm:"uniqueIndex;not null"`
	Name         string `gorm:"not null"`
	RedirectURIs string `gorm:"not null"`
	CreatedAt    time.Time
}

// An authorization code is single use and short lived. Only its hash is
// stored, for the same reason API tokens are hashed.
type OAuthCode struct {
	ID          uint   `gorm:"primaryKey"`
	CodeHash    string `gorm:"uniqueIndex;not null"`
	ClientID    string `gorm:"not null"`
	SessionID   string `gorm:"index;not null"`
	RedirectURI string `gorm:"not null"`
	Challenge   string `gorm:"not null"`
	Scopes      string `gorm:"not null"`
	Resource    string
	ExpiresAt   time.Time `gorm:"index"`
	UsedAt      *time.Time
}

func (c OAuthClient) redirects() []string { return strings.Fields(c.RedirectURIs) }

// A loopback redirect may use any port, because the client picks a free one at
// runtime; everything else has to match what was registered, exactly.
func loopbackRedirect(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" {
		return false
	}
	host := parsed.Hostname()
	return host == "127.0.0.1" || host == "::1"
}

func redirectAllowed(client OAuthClient, redirect string) bool {
	for _, registered := range client.redirects() {
		if registered == redirect {
			return true
		}
		if registered == "loopback" && loopbackRedirect(redirect) {
			return true
		}
	}
	return false
}

func (s *Server) oauthClient(clientID string) (OAuthClient, bool) {
	if clientID == cliClientID {
		return OAuthClient{ClientID: cliClientID, Name: "PR Desk CLI", RedirectURIs: "loopback"}, true
	}
	var client OAuthClient
	if s.db.Where("client_id = ?", clientID).First(&client).Error != nil {
		return OAuthClient{}, false
	}
	return client, true
}

func issuerURL() string { return strings.TrimRight(webOrigin(), "/") }

func (s *Server) authorizationServerMetadata(c *gin.Context) {
	issuer := issuerURL()
	c.JSON(http.StatusOK, gin.H{
		"issuer":                                issuer,
		"authorization_endpoint":                issuer + "/api/v1/oauth/authorize",
		"token_endpoint":                        issuer + "/api/v1/oauth/token",
		"registration_endpoint":                 issuer + "/api/v1/oauth/register",
		"scopes_supported":                      grantableScopes,
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
	})
}

func (s *Server) protectedResourceMetadata(c *gin.Context) {
	issuer := issuerURL()
	c.JSON(http.StatusOK, gin.H{
		"resource":              issuer + "/api/v1/mcp",
		"authorization_servers": []string{issuer},
		"scopes_supported":      grantableScopes,
	})
}

// Dynamic client registration, kept to the minimum an MCP client needs. No
// secret is issued: every client here is public and must use PKCE.
func (s *Server) registerOAuthClient(c *gin.Context) {
	var in struct {
		ClientName   string   `json:"client_name"`
		RedirectURIs []string `json:"redirect_uris"`
	}
	if c.ShouldBindJSON(&in) != nil || len(in.RedirectURIs) == 0 || len(in.RedirectURIs) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_client_metadata"})
		return
	}
	for _, redirect := range in.RedirectURIs {
		parsed, err := url.Parse(redirect)
		if err != nil || parsed.Fragment != "" || (parsed.Scheme != "https" && !loopbackRedirect(redirect)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_redirect_uri"})
			return
		}
	}
	name := strings.TrimSpace(in.ClientName)
	if name == "" || len([]rune(name)) > 100 {
		name = "MCP client"
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	client := OAuthClient{ClientID: "mcp_" + base64.RawURLEncoding.EncodeToString(raw), Name: name, RedirectURIs: strings.Join(in.RedirectURIs, " "), CreatedAt: time.Now().UTC()}
	if err := s.db.Create(&client).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"client_id": client.ClientID, "client_name": client.Name, "redirect_uris": client.redirects(), "token_endpoint_auth_method": "none", "grant_types": []string{"authorization_code"}, "response_types": []string{"code"}})
}

type authorizeRequest struct {
	client    OAuthClient
	redirect  string
	challenge string
	state     string
	scopes    []string
	resource  string
}

// Errors before the redirect URI is validated must be shown to the user rather
// than sent to an unvalidated address, otherwise the endpoint becomes an open
// redirector.
func (s *Server) parseAuthorizeRequest(c *gin.Context) (authorizeRequest, string) {
	clientID := c.Query("client_id")
	client, ok := s.oauthClient(clientID)
	if !ok {
		return authorizeRequest{}, "Unknown client"
	}
	redirect := c.Query("redirect_uri")
	if !redirectAllowed(client, redirect) {
		return authorizeRequest{}, "The redirect address is not registered for this client"
	}
	if c.Query("response_type") != "code" {
		return authorizeRequest{}, "Only the authorization code flow is supported"
	}
	if c.Query("code_challenge_method") != "S256" || c.Query("code_challenge") == "" {
		return authorizeRequest{}, "This server requires PKCE with S256"
	}
	scopes, err := parseScopes(c.Query("scope"))
	if err != nil {
		return authorizeRequest{}, err.Error()
	}
	return authorizeRequest{client: client, redirect: redirect, challenge: c.Query("code_challenge"), state: c.Query("state"), scopes: scopes, resource: c.Query("resource")}, ""
}

var consentPage = template.Must(template.New("consent").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorize {{.Client}}</title>
<style>
body{background:#f7f7f9;color:#27272f;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
main{background:#fff;border:1px solid #e2e2e9;border-radius:14px;padding:28px;max-width:420px;width:calc(100% - 32px)}
h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.7;color:#6b6b78;margin:0 0 16px}
ul{font-size:14px;padding-left:20px;margin:0 0 20px}li{margin:6px 0}
button{font:inherit;font-size:14px;border-radius:8px;padding:10px 16px;border:1px solid #5d47bd;background:#5d47bd;color:#fff;cursor:pointer}
a{display:inline-block;margin-left:12px;color:#6b6b78;font-size:14px}
strong{color:#27272f}
</style></head><body><main>
<h1>Authorize {{.Client}}</h1>
<p><strong>{{.Client}}</strong> is asking to use your PR Desk account <strong>{{.Account}}</strong>.</p>
<ul>{{range .Scopes}}<li>{{.}}</li>{{end}}</ul>
<form method="post" action="/api/v1/oauth/authorize">
{{range $key, $value := .Fields}}<input type="hidden" name="{{$key}}" value="{{$value}}">{{end}}
<button type="submit">Authorize</button><a href="{{.Cancel}}">Cancel</a>
</form>
</main></body></html>`))

var scopeDescriptions = map[string]string{
	scopeFollowUpsRead:  "Read your pull requests, follow-ups and activity",
	scopeFollowUpsWrite: "Mark follow-ups read or handled, snooze them, and start a sync",
}

func (s *Server) authorizeEndpoint(c *gin.Context) {
	request, problem := s.parseAuthorizeRequest(c)
	if problem != "" {
		c.String(http.StatusBadRequest, problem)
		return
	}
	account, ok := s.settingsAccount(c)
	if !ok {
		// settingsAccount already answered 401 for an API caller; a browser is
		// sent through the normal GitHub sign-in and comes back here.
		c.Abort()
		return
	}
	if c.Request.Method == http.MethodPost {
		s.completeAuthorization(c, request, account.SessionID)
		return
	}
	descriptions := make([]string, 0, len(request.scopes))
	for _, scope := range request.scopes {
		descriptions = append(descriptions, scopeDescriptions[scope])
	}
	fields := map[string]string{
		"client_id": request.client.ClientID, "redirect_uri": request.redirect, "response_type": "code",
		"code_challenge": request.challenge, "code_challenge_method": "S256", "state": request.state,
		"scope": strings.Join(request.scopes, " "), "resource": request.resource,
	}
	cancel := request.redirect + "?error=access_denied"
	if request.state != "" {
		cancel += "&state=" + url.QueryEscape(request.state)
	}
	c.Status(http.StatusOK)
	c.Header("Content-Type", "text/html; charset=utf-8")
	_ = consentPage.Execute(c.Writer, map[string]any{"Client": request.client.Name, "Account": account.Username, "Scopes": descriptions, "Fields": fields, "Cancel": cancel})
}

func (s *Server) completeAuthorization(c *gin.Context, request authorizeRequest, sessionID string) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		c.String(http.StatusInternalServerError, "Unable to complete authorization")
		return
	}
	code := base64.RawURLEncoding.EncodeToString(raw)
	record := OAuthCode{
		CodeHash: hashAPIToken(code), ClientID: request.client.ClientID, SessionID: sessionID,
		RedirectURI: request.redirect, Challenge: request.challenge, Scopes: strings.Join(request.scopes, " "),
		Resource: request.resource, ExpiresAt: time.Now().UTC().Add(time.Minute),
	}
	if err := s.db.Create(&record).Error; err != nil {
		c.String(http.StatusInternalServerError, "Unable to complete authorization")
		return
	}
	target, err := url.Parse(request.redirect)
	if err != nil {
		c.String(http.StatusBadRequest, "The redirect address is not usable")
		return
	}
	query := target.Query()
	query.Set("code", code)
	if request.state != "" {
		query.Set("state", request.state)
	}
	target.RawQuery = query.Encode()
	c.Redirect(http.StatusFound, target.String())
}

func (s *Server) tokenEndpoint(c *gin.Context) {
	if c.PostForm("grant_type") != "authorization_code" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported_grant_type"})
		return
	}
	code, verifier := c.PostForm("code"), c.PostForm("code_verifier")
	if code == "" || verifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	var record OAuthCode
	now := time.Now().UTC()
	// The code is claimed inside a transaction so that two simultaneous
	// redemptions cannot both succeed.
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("code_hash = ?", hashAPIToken(code)).First(&record).Error; err != nil {
			return err
		}
		if record.UsedAt != nil || !record.ExpiresAt.After(now) {
			return errTokenRejected
		}
		return tx.Model(&record).UpdateColumn("used_at", now).Error
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant"})
		return
	}
	if record.ClientID != c.PostForm("client_id") || record.RedirectURI != c.PostForm("redirect_uri") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant"})
		return
	}
	sum := sha256.Sum256([]byte(verifier))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != record.Challenge {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant"})
		return
	}
	client, _ := s.oauthClient(record.ClientID)
	token, issued, err := issueAPIToken(s.db, record.SessionID, record.ClientID, client.Name, strings.Fields(record.Scopes), now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   int(time.Until(issued.ExpiresAt).Seconds()),
		"scope":        record.Scopes,
	})
}

// Expired codes are removed on a schedule rather than at read time so the
// table cannot grow without bound on an abandoned flow.
func (s *Server) purgeExpiredOAuthCodes(now time.Time) {
	_ = s.db.Where("expires_at < ?", now.Add(-time.Hour)).Delete(&OAuthCode{}).Error
}
