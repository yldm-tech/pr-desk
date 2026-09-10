package main

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Browser credentials never double as the durable storage/worker partition.
// OAuthToken.SessionID remains the opaque account partition for existing data.
type BrowserSession struct {
	ID        string    `gorm:"primaryKey;size:64"`
	AccountID uint      `gorm:"index;not null"`
	ExpiresAt time.Time `gorm:"index;not null"`
}

func migrateDatabase(db *gorm.DB) error {
	if err := db.AutoMigrate(&PullRequest{}, &OAuthToken{}, &ReviewComment{}, &BrowserSession{}, &FollowUp{}, &FollowUpSettings{}, &FollowUpEvent{}, &NotificationDestination{}, &NotificationDelivery{}); err != nil {
		return err
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS oauth_github_account ON " + db.NamingStrategy.TableName("OAuthToken") + "(git_hub_id) WHERE git_hub_id > 0").Error
}

func (s *Server) resolveBrowserSession(c *gin.Context) {
	raw, _ := c.Cookie("pr_session")
	// Explicit empty value prevents a forged durable partition from falling back
	// to the legacy cookie lookup in requestSessionID.
	c.Set("storage_session", "")
	if raw != "" {
		var browser BrowserSession
		if s.db.WithContext(c.Request.Context()).Where("id = ? AND expires_at > ?", raw, time.Now()).First(&browser).Error == nil {
			var account OAuthToken
			if s.db.WithContext(c.Request.Context()).First(&account, browser.AccountID).Error == nil {
				c.Set("storage_session", account.SessionID)
				c.Set("browser_session", raw)
				c.Set("account_session", true)
			}
		} else {
			// Existing sessions remain usable until their normal expiry. They are
			// never accepted as browser credentials after becoming an account.
			var legacy OAuthToken
			if s.db.Where("session_id = ? AND git_hub_id = 0 AND created_at > ?", raw, time.Now().Add(-30*24*time.Hour)).First(&legacy).Error == nil {
				c.Set("storage_session", raw)
			}
		}
	}
	c.Next()
}

// Valid credentials for workers; modern account credentials are suspended on
// GitHub authorization failure, independent of a browser's login age.
func connectionQuery(db *gorm.DB) *gorm.DB {
	return db.Where("(git_hub_id > 0 AND authorization_error = '' AND token <> '') OR (git_hub_id = 0 AND created_at > ?)", time.Now().Add(-30*24*time.Hour))
}

func (s *Server) connectAccount(ctx context.Context, candidate OAuthToken, githubID int64, browserID string) (OAuthToken, error) {
	if githubID <= 0 || browserID == "" {
		return OAuthToken{}, errors.New("invalid account identity")
	}
	var account OAuthToken
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize first logins and reauthorizations for the same GitHub ID.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", githubID).Error; err != nil {
			return err
		}
		err := tx.Where("git_hub_id = ?", githubID).First(&account).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			account = candidate
			account.GitHubID = githubID
			if err := tx.Create(&account).Error; err != nil {
				return err
			}
			if err := restoreAccountCache(ctx, tx, account, githubID); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			if err := tx.Model(&account).Updates(map[string]any{"username": candidate.Username, "token": candidate.Token, "authorization_error": "", "git_hub_created_at": candidate.GitHubCreatedAt}).Error; err != nil {
				return err
			}
		}
		return tx.Create(&BrowserSession{ID: browserID, AccountID: account.ID, ExpiresAt: time.Now().Add(30 * 24 * time.Hour)}).Error
	})
	return account, err
}
