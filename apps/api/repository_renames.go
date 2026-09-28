package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/go-github/v68/github"
	"gorm.io/gorm"
)

// A repository renamed or transferred on GitHub keeps its pull requests, their numbers and their ids; only its owner/name and every URL under it change. Rows used to be found by URL alone, so the pull requests seen before a rename were never matched again and kept the old name and the state they had that day, while the ones seen after it arrived as new rows under the new name: one repository showed up as two or three.

// How often each repository's current name is asked of GitHub. Renames of a repository with activity are caught sooner, by the sync itself (see storedPullRequest); this catches the ones nothing has touched since.
const repositoryNameCheckInterval = 24 * time.Hour

func repositoryOf(item *github.Issue) string {
	return strings.TrimPrefix(item.GetRepositoryURL(), "https://api.github.com/repos/")
}

// storedPullRequest finds the row for a pull request GitHub returned: by GitHub's id, which survives a rename, or failing that by the URL rows were stored under before the id was kept.
//
// A row found by id under another repository name means one of the two names is out of date, but not which: search results can still carry a repository's old name for a while after a rename. So nothing is renamed here. Both names are marked for the name check at the start of the next sync, which asks GitHub's repository endpoint and moves and merges the rows then, and the caller leaves this row's name and URL as they are (see keepsStoredName).
func storedPullRequest(tx *gorm.DB, sid string, item *github.Issue) (PullRequest, bool, error) {
	var pr PullRequest
	if id := item.GetID(); id != 0 {
		err := tx.Where("session_id = ? AND git_hub_id = ?", sid, id).First(&pr).Error
		if err == nil {
			if repo := repositoryOf(item); repo != "" && pr.Repo != repo {
				if err := tx.Model(&PullRequest{}).Where("session_id = ? AND repo IN ?", sid, []string{pr.Repo, repo}).UpdateColumn("repo_name_checked_at", nil).Error; err != nil {
					return PullRequest{}, false, err
				}
			}
			return pr, true, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return PullRequest{}, false, err
		}
	}
	err := tx.Where("session_id = ? AND number = ? AND url = ?", sid, item.GetNumber(), item.GetHTMLURL()).First(&pr).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PullRequest{}, false, nil
	}
	return pr, err == nil, err
}

// keepsStoredName reports whether a write must leave a stored row's repository and URL alone because GitHub returned the pull request under another name (see storedPullRequest).
func keepsStoredName(stored PullRequest, found bool, item *github.Issue) bool {
	return found && stored.Repo != repositoryOf(item)
}

// renameRepository moves every row of a session from one repository name to another, then merges the rows the move leaves describing the same pull request twice.
func renameRepository(tx *gorm.DB, sid, from, to string) error {
	if from == "" || to == "" || from == to {
		return nil
	}
	oldPrefix := "https://github.com/" + from + "/"
	newPrefix := "https://github.com/" + to + "/"
	// UpdateColumns, not Updates: updated_at is GitHub activity time, and a rename is not activity.
	if err := tx.Model(&PullRequest{}).Where("session_id = ? AND repo = ?", sid, from).UpdateColumns(map[string]any{
		"repo": to,
		"url":  gorm.Expr("CASE WHEN lower(left(url, ?)) = lower(?) THEN ? || substr(url, ?) ELSE url END", len(oldPrefix), oldPrefix, newPrefix, len(oldPrefix)+1),
	}).Error; err != nil {
		return err
	}
	if err := renameRepositorySetting(tx, sid, from, to); err != nil {
		return err
	}
	var rows []PullRequest
	if err := tx.Where("session_id = ? AND repo = ?", sid, to).Order("updated_at DESC, id DESC").Find(&rows).Error; err != nil {
		return err
	}
	// Two rows under one number are one pull request unless both carry GitHub ids and those differ: then they are two, such as a pull request of a deleted repository whose name a renamed one has since taken, and neither may absorb the other.
	kept := map[int][]PullRequest{}
	for _, row := range rows {
		survivors := kept[row.Number]
		index := -1
		for i, survivor := range survivors {
			if survivor.GitHubID == 0 || row.GitHubID == 0 || survivor.GitHubID == row.GitHubID {
				index = i
				break
			}
		}
		if index < 0 {
			kept[row.Number] = append(survivors, row)
			continue
		}
		if err := mergePullRequest(tx, survivors[index], row); err != nil {
			return err
		}
		if survivors[index].GitHubID == 0 {
			survivors[index].GitHubID = row.GitHubID
		}
	}
	log.Printf("Repository renamed on GitHub: session rows moved from %s to %s", from, to)
	return nil
}

// mergePullRequest folds a stale copy of a pull request into the copy the sync kept feeding, the one with the latest GitHub activity. Comments move unless the survivor already holds them. A follow-up moves only when the survivor has none: when both have one, the survivor's is current and the stale one is dropped, along with any Handled or reminder set on it before the rename.
func mergePullRequest(tx *gorm.DB, survivor, stale PullRequest) error {
	if survivor.GitHubID == 0 && stale.GitHubID != 0 {
		if err := tx.Model(&PullRequest{}).Where("id = ?", survivor.ID).UpdateColumn("git_hub_id", stale.GitHubID).Error; err != nil {
			return err
		}
	}
	if survivor.RepoPrivate == nil && stale.RepoPrivate != nil {
		if err := tx.Model(&PullRequest{}).Where("id = ?", survivor.ID).UpdateColumn("repo_private", *stale.RepoPrivate).Error; err != nil {
			return err
		}
	}
	if err := tx.Exec(`UPDATE review_comments SET pull_request_id = ? WHERE session_id = ? AND pull_request_id = ? AND NOT EXISTS (
		SELECT 1 FROM review_comments kept WHERE kept.session_id = review_comments.session_id AND kept.pull_request_id = ? AND kept.git_hub_id = review_comments.git_hub_id AND kept.comment_type = review_comments.comment_type)`,
		survivor.ID, stale.SessionID, stale.ID, survivor.ID).Error; err != nil {
		return err
	}
	if err := tx.Where("session_id = ? AND pull_request_id = ?", stale.SessionID, stale.ID).Delete(&ReviewComment{}).Error; err != nil {
		return err
	}
	var follows []FollowUp
	if err := tx.Where("session_id = ? AND pull_request_id IN ?", stale.SessionID, []uint{survivor.ID, stale.ID}).Find(&follows).Error; err != nil {
		return err
	}
	for _, follow := range follows {
		if follow.PullRequestID != stale.ID {
			continue
		}
		if len(follows) == 1 {
			if err := tx.Model(&FollowUp{}).Where("id = ?", follow.ID).UpdateColumn("pull_request_id", survivor.ID).Error; err != nil {
				return err
			}
			continue
		}
		if err := tx.Where("follow_up_id = ?", follow.ID).Delete(&FollowUpEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&FollowUp{}, follow.ID).Error; err != nil {
			return err
		}
	}
	return tx.Delete(&PullRequest{}, stale.ID).Error
}

// A waiting period set for the old name would otherwise stop applying without a word. When both names already have one, the new name's stands.
func renameRepositorySetting(tx *gorm.DB, sid, from, to string) error {
	var settings FollowUpSettings
	err := tx.Where("session_id = ?", sid).First(&settings).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	days := map[string]int{}
	if json.Unmarshal([]byte(settings.RepositoryDaysJSON), &days) != nil {
		return nil
	}
	value, ok := days[from]
	if !ok {
		return nil
	}
	delete(days, from)
	if _, taken := days[to]; !taken {
		days[to] = value
	}
	encoded, err := json.Marshal(days)
	if err != nil {
		return err
	}
	return tx.Model(&FollowUpSettings{}).Where("session_id = ?", sid).UpdateColumn("repository_days_json", string(encoded)).Error
}

// reconcileRepositoryNames asks GitHub for the current name of every repository of the session not checked within the interval, and moves the rows of any that answers under another name. GitHub answers a request for an old name with the renamed repository. A repository that is gone or out of reach is left as it is. A rate limit ends the pass; any other failure skips that repository until the next sync.
func (s *Server) reconcileRepositoryNames(ctx context.Context, gh *github.Client, sid string) error {
	var repos []string
	if err := s.db.WithContext(ctx).Model(&PullRequest{}).Where("session_id = ?", sid).Group("repo").
		Having("MAX(repo_name_checked_at) IS NULL OR MAX(repo_name_checked_at) < ?", time.Now().Add(-repositoryNameCheckInterval)).
		Pluck("repo", &repos).Error; err != nil {
		return err
	}
	for _, repo := range repos {
		parts := strings.Split(repo, "/")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			continue
		}
		result, response, err := gh.Repositories.Get(ctx, parts[0], parts[1])
		current := repo
		if err != nil {
			if isRateLimited(err) {
				return err
			}
			// No answer at all, or a server error that outlasted the transport's retries, is GitHub being unreachable rather than this repository's problem: every other repository would wait out the same retries before the sync could start.
			if response == nil || response.StatusCode >= http.StatusInternalServerError {
				return err
			}
			if response.StatusCode != http.StatusNotFound && response.StatusCode != http.StatusForbidden && response.StatusCode != http.StatusUnavailableForLegalReasons {
				log.Printf("Repository name check skipped for %s: %v", repo, err)
				continue
			}
		} else if name := result.GetFullName(); name != "" {
			current = name
		}
		err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := renameRepository(tx, sid, repo, current); err != nil {
				return err
			}
			return tx.Model(&PullRequest{}).Where("session_id = ? AND repo = ?", sid, current).UpdateColumn("repo_name_checked_at", time.Now()).Error
		})
		if err != nil {
			return err
		}
	}
	return nil
}
