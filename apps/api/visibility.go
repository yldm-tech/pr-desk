package main

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
	"strings"
)

func (s *Server) ensureRepositoryVisibility(c *gin.Context) error {
	var repos []string
	if err := sessionPRQuery(c, s.db).Model(&PullRequest{}).Where("repo_private IS NULL").Distinct("repo").Pluck("repo", &repos).Error; err != nil {
		return err
	}
	if len(repos) == 0 {
		return nil
	}
	var connection OAuthToken
	if err := s.db.Where("session_id = ?", requestSessionID(c)).First(&connection).Error; err != nil {
		return err
	}
	token, err := decrypt(connection.Token)
	if err != nil {
		return err
	}
	gh := githubClient(token)
	group, ctx := errgroup.WithContext(c.Request.Context())
	group.SetLimit(4)
	for _, repo := range repos {
		group.Go(func() error {
			parts := strings.Split(repo, "/")
			if len(parts) != 2 {
				return fmt.Errorf("invalid repository")
			}
			result, _, err := gh.Repositories.Get(ctx, parts[0], parts[1])
			if err != nil {
				return err
			}
			if result.Private == nil {
				return fmt.Errorf("missing repository visibility")
			}
			return storeRepositoryVisibility(s.db.WithContext(ctx), requestSessionID(c), repo, result.GetPrivate())
		})
	}
	return group.Wait()
}

// UpdateColumn, not Update: updated_at carries GitHub activity time, and gorm
// appends an auto-update-time assignment to a plain single-column Update, which
// would restamp every pull request of the repository with the backfill's clock.
func storeRepositoryVisibility(db *gorm.DB, sessionID, repo string, private bool) error {
	return db.Model(&PullRequest{}).Where("session_id = ? AND repo = ?", sessionID, repo).UpdateColumn("repo_private", private).Error
}
