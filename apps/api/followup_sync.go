package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	github "github.com/google/go-github/v68/github"
	"gorm.io/gorm"
)

type reviewTimelineEvent struct {
	Event             string    `json:"event"`
	CreatedAt         time.Time `json:"created_at"`
	RequestedReviewer struct {
		Login string `json:"login"`
	} `json:"requested_reviewer"`
	RequestedTeam struct {
		Slug string `json:"slug"`
	} `json:"requested_team"`
}

func snapshotHumanFacts(facts *FollowUpFacts, username string, comments []activityComment, reviews []githubReview) {
	latestKey := ""
	add := func(at time.Time, key, body string) {
		if at.After(facts.HumanAt) || (at.Equal(facts.HumanAt) && key > latestKey) {
			facts.HumanAt = at
			latestKey = key
			facts.HumanVersion = fmt.Sprintf("%s:%s:%x", at.UTC().Format(time.RFC3339Nano), key, sha256.Sum256([]byte(body)))
			runes := []rune(body)
			if len(runes) > 240 {
				runes = runes[:240]
			}
			facts.HumanExcerpt = string(runes)
		}
	}
	for _, c := range comments {
		if c.AuthorIsHumanOther(username) {
			add(latestTime(c.CreatedAt, c.UpdatedAt), fmt.Sprintf("comment:%s:%d", c.URL, c.ID), c.Body)
		}
	}
	var myReview githubReview
	for _, r := range reviews {
		if strings.EqualFold(r.User.Login, username) {
			if r.State == "APPROVED" || r.State == "CHANGES_REQUESTED" || r.State == "DISMISSED" {
				if r.SubmittedAt.After(myReview.SubmittedAt) || (r.SubmittedAt.Equal(myReview.SubmittedAt) && r.ID > myReview.ID) {
					myReview = r
				}
			}
		} else if r.State != "PENDING" && humanActor(r.User.Login, r.User.Type) {
			add(r.SubmittedAt, fmt.Sprintf("review:%d:%s", r.ID, r.State), r.Body)
		}
	}
	facts.MyReview, facts.MyReviewID = myReview.State, myReview.ID
	facts.MyReviewAt = myReview.SubmittedAt
}

func (c activityComment) AuthorIsHumanOther(username string) bool {
	return humanActor(c.User.Login, c.User.Type) && !strings.EqualFold(c.User.Login, username)
}

// Search alone cannot maintain a review inbox: GitHub removes requested-review
// matches after a review. Refresh previously tracked reviews independently.
func (s *Server) syncReviewRequests(ctx context.Context, token OAuthToken, plaintext string, from, through time.Time) error {
	if token.GitHubID == 0 {
		return nil
	}
	settings, err := loadFollowUpSettings(s.db, token.SessionID)
	if err != nil {
		return err
	}
	var teams []string
	if err := json.Unmarshal([]byte(settings.TeamsJSON), &teams); err != nil {
		return err
	}
	queries := []string{"type:pr state:open review-requested:" + token.Username, "type:pr state:open reviewed-by:" + token.Username}
	for _, team := range teams {
		queries = append(queries, "type:pr state:open team-review-requested:"+team)
	}
	// No authored page sink and no history-count tracker for review discovery, and
	// no cursor either: the cursor records how far the authored walk has persisted
	// pages, and these queries persist nothing. Leaving it attached makes every
	// review query mark the cursor at its own end, so the next full sync resumes
	// from the last run rather than from the account's creation.
	discoveryCtx := context.WithValue(context.WithValue(context.WithValue(ctx, historyPageSinkKey{}, nil), historyProgressKey{}, nil), historyCursorKey{}, nil)
	seen := map[string]bool{}
	for _, query := range queries {
		items, err := fetchHistory(discoveryCtx, githubClient(plaintext), query, from, through)
		if err != nil {
			return err
		}
		for _, item := range items {
			if strings.EqualFold(item.GetUser().GetLogin(), token.Username) || seen[item.GetHTMLURL()] {
				continue
			}
			seen[item.GetHTMLURL()] = true
			if err := s.saveReviewDiscovery(ctx, token.SessionID, item); err != nil {
				return err
			}
			if err := s.syncPRDetails(ctx, plaintext, token.SessionID, item); err != nil {
				return err
			}
		}
	}
	var tracked []PullRequest
	if err := s.db.WithContext(ctx).Where("session_id = ? AND role = ? AND state = ? AND review_tracked = true", token.SessionID, "reviewer", "open").Find(&tracked).Error; err != nil {
		return err
	}
	for _, pr := range tracked {
		var follow FollowUp
		if err := s.db.Where("session_id = ? AND pull_request_id = ?", token.SessionID, pr.ID).First(&follow).Error; err != nil {
			return err
		}
		if !settings.includes(follow.facts()) {
			continue
		}
		if seen[pr.URL] {
			continue
		}
		item := &github.Issue{Number: github.Ptr(pr.Number), HTMLURL: github.Ptr(pr.URL), RepositoryURL: github.Ptr("https://api.github.com/repos/" + pr.Repo), State: github.Ptr("open")}
		if err := s.syncPRDetails(ctx, plaintext, token.SessionID, item); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) saveReviewDiscovery(ctx context.Context, sid string, item *github.Issue) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing PullRequest
		err := tx.Where("session_id = ? AND url = ?", sid, item.GetHTMLURL()).First(&existing).Error
		if err == nil {
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		created := item.GetCreatedAt().Time
		return tx.Create(&PullRequest{SessionID: sid, Role: "reviewer", Author: item.GetUser().GetLogin(), Repo: strings.TrimPrefix(item.GetRepositoryURL(), "https://api.github.com/repos/"), Number: item.GetNumber(), Title: item.GetTitle(), State: item.GetState(), URL: item.GetHTMLURL(), PRCreatedAt: &created, UpdatedAt: item.GetUpdatedAt().Time}).Error
	})
}
