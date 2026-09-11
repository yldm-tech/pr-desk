package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Browser sessions authenticate with a cookie, which a command line client and
// a remote MCP client cannot obtain. They present a bearer token instead. Only
// the hash is stored: a database copy is not enough to call the API.
type APIToken struct {
	ID         uint   `gorm:"primaryKey"`
	SessionID  string `gorm:"index;not null"`
	ClientID   string `gorm:"index"`
	Name       string `gorm:"not null"`
	TokenHash  string `gorm:"uniqueIndex;not null"`
	Scopes     string `gorm:"not null"`
	CreatedAt  time.Time
	ExpiresAt  time.Time `gorm:"index"`
	LastUsedAt *time.Time
	RevokedAt  *time.Time `gorm:"index"`
}

const (
	scopeFollowUpsRead  = "followups:read"
	scopeFollowUpsWrite = "followups:write"
	apiTokenPrefix      = "prd_"
	apiTokenLifetime    = 90 * 24 * time.Hour
)

// Every scope this deployment is willing to grant. A client asking for
// anything else is refused rather than silently downgraded, so an integration
// never believes it has a permission it does not have.
var grantableScopes = []string{scopeFollowUpsRead, scopeFollowUpsWrite}

func knownScope(scope string) bool {
	for _, known := range grantableScopes {
		if known == scope {
			return true
		}
	}
	return false
}

// parseScopes keeps the order stable and drops duplicates so that a stored
// grant can be compared literally.
func parseScopes(raw string) ([]string, error) {
	requested := strings.Fields(strings.ReplaceAll(raw, ",", " "))
	if len(requested) == 0 {
		return []string{scopeFollowUpsRead}, nil
	}
	seen := map[string]bool{}
	scopes := []string{}
	for _, scope := range requested {
		if !knownScope(scope) {
			return nil, errors.New("unsupported scope " + scope)
		}
		if !seen[scope] {
			seen[scope] = true
			scopes = append(scopes, scope)
		}
	}
	// Writing implies reading. The MCP endpoint requires the read scope on every
	// call, so a write-only grant would be refused on the very tools it was
	// requested for.
	if !seen[scopeFollowUpsRead] {
		scopes = append([]string{scopeFollowUpsRead}, scopes...)
	}
	return scopes, nil
}

func hashAPIToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// issueAPIToken returns the plaintext token exactly once; afterwards only its
// hash exists.
func issueAPIToken(db *gorm.DB, sessionID, clientID, name string, scopes []string, now time.Time) (string, APIToken, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", APIToken{}, err
	}
	token := apiTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	record := APIToken{
		SessionID: sessionID,
		ClientID:  clientID,
		Name:      name,
		TokenHash: hashAPIToken(token),
		Scopes:    strings.Join(scopes, " "),
		CreatedAt: now,
		ExpiresAt: now.Add(apiTokenLifetime),
	}
	if err := db.Create(&record).Error; err != nil {
		return "", APIToken{}, err
	}
	return token, record, nil
}

var errTokenRejected = errors.New("the token is not valid")

// lookupAPIToken resolves a presented token. Expiry and revocation are checked
// here rather than in a query filter so that a caller cannot distinguish an
// unknown token from a revoked one by timing the two branches differently.
func lookupAPIToken(ctx context.Context, db *gorm.DB, token string, now time.Time) (APIToken, error) {
	if !strings.HasPrefix(token, apiTokenPrefix) {
		return APIToken{}, errTokenRejected
	}
	var record APIToken
	if err := db.WithContext(ctx).Where("token_hash = ?", hashAPIToken(token)).First(&record).Error; err != nil {
		return APIToken{}, errTokenRejected
	}
	if record.RevokedAt != nil || !record.ExpiresAt.After(now) {
		return APIToken{}, errTokenRejected
	}
	// The account has to still be connected: a disconnected GitHub account can
	// no longer refresh its data, and its tokens stop working with it.
	var account OAuthToken
	if connectionQuery(db.WithContext(ctx)).Where("session_id = ? AND token <> ''", record.SessionID).First(&account).Error != nil {
		return APIToken{}, errTokenRejected
	}
	return record, nil
}

func (record APIToken) scopeList() []string {
	return strings.Fields(record.Scopes)
}

func (record APIToken) allows(scope string) bool {
	for _, granted := range record.scopeList() {
		if granted == scope {
			return true
		}
	}
	return false
}

// Last use is recorded on a best-effort basis: it powers the token list in the
// UI and must never fail a request that was otherwise authorized.
func touchAPIToken(db *gorm.DB, id uint, now time.Time) {
	_ = db.Model(&APIToken{}).Where("id = ?", id).UpdateColumn("last_used_at", now).Error
}

// Tokens outlive the machine they were issued to, so the account holder needs a
// way to end one early. Without this, a leaked credentials.json is valid for
// its full lifetime and the only remedy is disconnecting GitHub.
func (s *Server) listAPITokens(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	var rows []APIToken
	if err := s.db.Where("session_id = ? AND revoked_at IS NULL", account.SessionID).Order("id").Find(&rows).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load tokens"})
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, gin.H{"id": row.ID, "name": row.Name, "client_id": row.ClientID, "scopes": row.scopeList(), "created_at": row.CreatedAt, "expires_at": row.ExpiresAt, "last_used_at": row.LastUsedAt})
	}
	c.JSON(200, gin.H{"data": out})
}

func (s *Server) revokeAPIToken(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	now := time.Now().UTC()
	result := s.db.Model(&APIToken{}).Where("id = ? AND session_id = ? AND revoked_at IS NULL", id, account.SessionID).UpdateColumn("revoked_at", now)
	if result.Error != nil {
		c.JSON(500, gin.H{"error": "Unable to revoke the token"})
		return
	}
	if result.RowsAffected == 0 {
		c.Status(http.StatusNotFound)
		return
	}
	c.Status(http.StatusNoContent)
}

// A registration that never completed an authorization is abandoned. Pruning
// them keeps an unauthenticated endpoint from growing the table without bound.
func (s *Server) purgeUnusedOAuthClients(now time.Time) {
	cutoff := now.Add(-24 * time.Hour)
	_ = s.db.Where("created_at < ? AND client_id NOT IN (?) AND client_id NOT IN (?)",
		cutoff,
		s.db.Model(&APIToken{}).Select("client_id"),
		s.db.Model(&OAuthCode{}).Select("client_id"),
	).Delete(&OAuthClient{}).Error
}
