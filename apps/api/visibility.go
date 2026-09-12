package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
)

func (s *Server) ensureRepositoryVisibility(c *gin.Context) error {
	var repos []string
	// Repositories asked about recently are skipped: the ones that never resolve
	// are exactly the ones that would otherwise be asked about on every request.
	// The bound keeps one overview from waiting on hundreds of round trips; what
	// is left over is picked up by the next request.
	cutoff := time.Now().Add(-visibilityRecheckAfter)
	if err := sessionPRQuery(c, s.db).Model(&PullRequest{}).
		Where("repo_private IS NULL").
		Where("repo_visibility_checked_at IS NULL OR repo_visibility_checked_at < ?", cutoff).
		Distinct("repo").Limit(visibilityBatchLimit).Pluck("repo", &repos).Error; err != nil {
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
			result, response, err := gh.Repositories.Get(ctx, parts[0], parts[1])
			if err != nil {
				// A repository that was deleted, made private or blocked must not
				// fail the whole overview: its rows stay NULL and are reported in
				// the existing unknown-visibility bucket. Rate limiting also
				// answers 403, so it is separated out first — treating a throttled
				// response as "unknown" would hide a real failure and freeze the
				// visibility of every repository behind it.
				var limited *github.RateLimitError
				var abuse *github.AbuseRateLimitError
				if !errors.As(err, &limited) && !errors.As(err, &abuse) && response != nil && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusUnavailableForLegalReasons) {
					// Record that the question was asked. Without this the answer is
					// indistinguishable from never having asked, and the repository is
					// re-fetched on every overview for the life of the account.
					return markVisibilityChecked(s.db.WithContext(ctx), requestSessionID(c), repo)
				}
				return err
			}
			if result.Private == nil {
				return fmt.Errorf("missing repository visibility")
			}
			if err := markVisibilityChecked(s.db.WithContext(ctx), requestSessionID(c), repo); err != nil {
				return err
			}
			return storeRepositoryVisibility(s.db.WithContext(ctx), requestSessionID(c), repo, result.GetPrivate())
		})
	}
	return group.Wait()
}

// How long a repository GitHub would not resolve is left alone before asking
// again, and how many are resolved in one request.
const (
	visibilityRecheckAfter = 24 * time.Hour
	visibilityBatchLimit   = 50
)

// markVisibilityChecked records the attempt, whatever its answer was.
func markVisibilityChecked(db *gorm.DB, sessionID, repo string) error {
	return db.Model(&PullRequest{}).Where("session_id = ? AND repo = ?", sessionID, repo).UpdateColumn("repo_visibility_checked_at", time.Now()).Error
}

// UpdateColumn, not Update: updated_at carries GitHub activity time, and gorm
// appends an auto-update-time assignment to a plain single-column Update, which
// would restamp every pull request of the repository with the backfill's clock.
func storeRepositoryVisibility(db *gorm.DB, sessionID, repo string, private bool) error {
	return db.Model(&PullRequest{}).Where("session_id = ? AND repo = ?", sessionID, repo).UpdateColumn("repo_private", private).Error
}
