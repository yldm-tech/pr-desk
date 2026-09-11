package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	github "github.com/google/go-github/v68/github"
	"gorm.io/gorm"
)

var errDetailStorage = errors.New("unable to save PR details")

// Fetch a complete detail snapshot before replacing cached metadata. A failed
// upstream call or database write must not turn a partial sync into success.
func (s *Server) syncPRDetails(ctx context.Context, token, sid string, issue *github.Issue) error {
	var account OAuthToken
	if err := s.db.WithContext(ctx).Where("session_id = ?", sid).First(&account).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if issue.GetState() != "open" {
		return nil
	}
	repo := strings.TrimPrefix(issue.GetRepositoryURL(), "https://api.github.com/repos/")
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("invalid repository")
	}
	base := "/repos/" + repo
	endpoint := fmt.Sprintf("%s/pulls/%d", base, issue.GetNumber())
	var detail struct {
		Title     string    `json:"title"`
		Draft     bool      `json:"draft"`
		CreatedAt time.Time `json:"created_at"`
		User      struct {
			Login string `json:"login"`
		} `json:"user"`
		Base struct {
			Repo struct {
				Private *bool `json:"private"`
			} `json:"repo"`
		} `json:"base"`
		Mergeable          *bool                    `json:"mergeable"`
		MergedAt           *time.Time               `json:"merged_at"`
		State              string                   `json:"state"`
		Comments           int                      `json:"comments"`
		ReviewComments     int                      `json:"review_comments"`
		RequestedReviewers []struct{ Login string } `json:"requested_reviewers"`
		RequestedTeams     []struct{ Slug string }  `json:"requested_teams"`
		Head               struct{ SHA string }     `json:"head"`
	}
	if err := githubJSON(ctx, token, "GET", endpoint, nil, &detail); err != nil {
		return err
	}
	reviews, err := fetchPages[githubReview](ctx, token, endpoint+"/reviews")
	if err != nil {
		return err
	}
	checksStatus := "unknown"
	if detail.Head.SHA != "" {
		combined, _, err := githubClient(token).Repositories.GetCombinedStatus(ctx, parts[0], parts[1], detail.Head.SHA, nil)
		if err != nil {
			return &githubRequestError{cause: err}
		}
		runs, err := fetchChecks(ctx, token, base, detail.Head.SHA)
		if err != nil {
			return err
		}
		state := combined.GetState()
		// GitHub returns pending when no legacy statuses exist. It must not
		// override successful Actions checks on a checks-only repository.
		if combined.GetTotalCount() == 0 && len(combined.Statuses) == 0 {
			state = ""
		}
		checksStatus = checkSummary(runs, state)
	}
	inline, err := fetchPages[activityComment](ctx, token, endpoint+"/comments")
	if err != nil {
		return err
	}
	conversation, err := fetchPages[activityComment](ctx, token, fmt.Sprintf("%s/issues/%d/comments", base, issue.GetNumber()))
	if err != nil {
		return err
	}
	reviewStatus := latestReviewStatus(reviews)
	if reviewStatus != "changes_requested" && len(detail.RequestedReviewers)+len(detail.RequestedTeams) > 0 {
		reviewStatus = "review_requested"
	}
	facts := FollowUpFacts{Draft: detail.Draft, Closed: detail.State == "closed", Merged: detail.MergedAt != nil, Checks: checksStatus, Review: reviewStatus, HeadSHA: detail.Head.SHA, CreatedAt: detail.CreatedAt}
	if account.GitHubID > 0 {
		snapshotHumanFacts(&facts, account.Username, append(inline, conversation...), reviews)
		settings, err := loadFollowUpSettings(s.db, sid)
		if err != nil {
			return err
		}
		var teams []string
		if err := json.Unmarshal([]byte(settings.TeamsJSON), &teams); err != nil {
			return err
		}
		selected := map[string]bool{}
		for _, team := range teams {
			selected[team] = true
		}
		for _, reviewer := range detail.RequestedReviewers {
			if strings.EqualFold(reviewer.Login, account.Username) {
				facts.Requested = true
				facts.DirectRequest = true
			}
		}
		for _, team := range detail.RequestedTeams {
			facts.ReviewTeams = append(facts.ReviewTeams, parts[0]+"/"+team.Slug)
			if selected[parts[0]+"/"+team.Slug] {
				facts.Requested = true
			}
		}
		events, err := fetchPages[reviewTimelineEvent](ctx, token, fmt.Sprintf("%s/issues/%d/timeline", base, issue.GetNumber()))
		if err != nil {
			return err
		}
		for _, event := range events {
			if event.Event == "review_requested" {
				if strings.EqualFold(event.RequestedReviewer.Login, account.Username) {
					facts.DirectRequest = true
				}
				if event.RequestedTeam.Slug != "" {
					facts.ReviewTeams = append(facts.ReviewTeams, parts[0]+"/"+event.RequestedTeam.Slug)
				}
			}
			if event.Event == "ready_for_review" && event.CreatedAt.After(facts.ReadyAt) {
				facts.ReadyAt = event.CreatedAt
			}
			if event.Event == "review_requested" && (strings.EqualFold(event.RequestedReviewer.Login, account.Username) || selected[parts[0]+"/"+event.RequestedTeam.Slug]) && event.CreatedAt.After(facts.RequestedAt) {
				facts.RequestedAt = event.CreatedAt
			}
		}
		if detail.Head.SHA != "" && !strings.EqualFold(detail.User.Login, account.Username) {
			var commit struct {
				Commit struct {
					Committer struct {
						Date time.Time `json:"date"`
					} `json:"committer"`
				} `json:"commit"`
			}
			if err := githubJSON(ctx, token, "GET", base+"/commits/"+detail.Head.SHA, nil, &commit); err != nil {
				return err
			}
			facts.AuthorAt = commit.Commit.Committer.Date
		}
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var pr PullRequest
		if err := tx.Where("session_id = ? AND number = ? AND url = ?", sid, issue.GetNumber(), issue.GetHTMLURL()).First(&pr).Error; err != nil {
			return err
		}
		// UpdatedAt is GitHub activity time, not the time our poll ran.
		updates := map[string]any{"comments_count": detail.Comments + detail.ReviewComments, "merged_at": detail.MergedAt, "review_status": reviewStatus, "checks_status": checksStatus, "updated_at": pr.UpdatedAt, "draft": detail.Draft}
		if detail.Title != "" {
			updates["title"] = detail.Title
		}
		if detail.User.Login != "" {
			updates["author"] = detail.User.Login
		}
		if detail.Base.Repo.Private != nil {
			updates["repo_private"] = *detail.Base.Repo.Private
		}
		if detail.Mergeable != nil {
			updates["has_conflicts"] = !*detail.Mergeable
		}
		if detail.State != "" {
			updates["state"] = detail.State
		}
		if err := tx.Model(&pr).Updates(updates).Error; err != nil {
			return err
		}
		for kind, comments := range map[string][]activityComment{"review": inline, "": conversation} {
			for _, comment := range comments {
				// Issue and review comment IDs are different GitHub namespaces.
				key := ReviewComment{SessionID: sid, PullRequestID: pr.ID, GitHubID: comment.ID, CommentType: kind}
				if err := tx.Where("session_id = ? AND pull_request_id = ? AND git_hub_id = ? AND comment_type = ?", sid, pr.ID, comment.ID, kind).
					Assign(map[string]any{"author": comment.User.Login, "body": comment.Body, "url": comment.URL, "created_at": comment.CreatedAt}).FirstOrCreate(&key).Error; err != nil {
					return err
				}
			}
		}
		if account.GitHubID > 0 {
			facts.Role = pr.Role
			if pr.Role == "reviewer" {
				settings, err := loadFollowUpSettings(tx, sid)
				if err != nil {
					return err
				}
				if !settings.includes(facts) {
					return nil
				}
				if err := tx.Model(&pr).Update("review_tracked", true).Error; err != nil {
					return err
				}
			}
			facts.Conflict = pr.HasConflicts
			if detail.Mergeable != nil {
				facts.Conflict = !*detail.Mergeable
			}
			if facts.CreatedAt.IsZero() && pr.PRCreatedAt != nil {
				facts.CreatedAt = *pr.PRCreatedAt
			}
			return persistFollowUp(tx, pr, facts, time.Now().UTC())
		}
		return nil
	})
	if err != nil {
		return errors.Join(errDetailStorage, err)
	}
	return nil
}
