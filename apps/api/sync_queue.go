package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	"gorm.io/gorm"
)

// Persist intent before acknowledging it. The scheduler recovers accepted work
// if the process stops before its worker starts.
func (s *Server) syncGitHub(c *gin.Context) {
	ctx, sid := c.Request.Context(), requestSessionID(c)
	var token OAuthToken
	if sid == "" || connectionQuery(s.db.WithContext(ctx)).Where("session_id = ?", sid).First(&token).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	pool, err := s.db.DB()
	if err != nil {
		c.JSON(503, gin.H{"error": "Unable to acquire sync lock"})
		return
	}
	release, acquired, err := acquireSyncLock(ctx, pool, sid)
	if err != nil {
		c.JSON(503, gin.H{"error": "Unable to acquire sync lock"})
		return
	}
	if !acquired {
		c.JSON(409, gin.H{"error": "A sync is already running for this session"})
		return
	}
	defer release()
	if s.db.WithContext(ctx).First(&token, token.ID).Error != nil {
		c.JSON(500, gin.H{"error": "Unable to load sync state"})
		return
	}
	now := time.Now().UTC()
	full := c.Query("full") == "1" || token.FullSyncPending
	mode := "full"
	if token.HistorySyncedAt != nil && !full {
		mode = "incremental"
	}
	progress, _ := json.Marshal(syncProgress{Status: "queued", Phase: "account", Mode: mode, UpdatedAt: now})
	if err := s.db.WithContext(ctx).Model(&OAuthToken{}).Where("id = ?", token.ID).Updates(map[string]interface{}{"sync_requested_at": now, "full_sync_pending": full, "sync_progress": string(progress)}).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to queue sync"})
		return
	}
	release()
	s.startLoginSync(sid)
	c.JSON(202, gin.H{"status": "queued"})
}

var errHistoryStorage = errors.New("unable to save history page")

// Commit every successful page. A later GitHub failure must not discard rows
// already fetched, or erase cached repository visibility and review details.
func (s *Server) saveHistoryPage(ctx context.Context, sid string, items []*github.Issue) error {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, x := range items {
			updates := map[string]interface{}{"title": x.GetTitle(), "state": x.GetState(), "repo": strings.TrimPrefix(x.GetRepositoryURL(), "https://api.github.com/repos/"), "updated_at": x.GetUpdatedAt().Time, "pr_created_at": x.GetCreatedAt().Time, "role": "authored", "author": x.GetUser().GetLogin()}
			if x.Repository != nil && x.Repository.Private != nil {
				updates["repo_private"] = x.Repository.GetPrivate()
			}
			if links := x.GetPullRequestLinks(); links != nil && links.MergedAt != nil {
				updates["merged_at"] = links.MergedAt.Time
			}
			var pr PullRequest
			if err := tx.Where("session_id = ? AND number = ? AND url = ?", sid, x.GetNumber(), x.GetHTMLURL()).Assign(updates).FirstOrCreate(&pr, PullRequest{SessionID: sid, Number: x.GetNumber(), URL: x.GetHTMLURL()}).Error; err != nil {
				return err
			}
			if x.GetState() == "closed" {
				var follow FollowUp
				err := tx.Where("session_id = ? AND pull_request_id = ?", sid, pr.ID).First(&follow).Error
				if err == nil {
					facts := follow.facts()
					facts.Closed = true
					facts.Merged = pr.MergedAt != nil
					if err := persistFollowUp(tx, pr, facts, time.Now().UTC()); err != nil {
						return err
					}
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return errors.Join(errHistoryStorage, err)
	}
	return nil
}
