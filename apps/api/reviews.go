package main

import "time"

type githubReview struct {
	ID          int64     `json:"id"`
	State       string    `json:"state"`
	Body        string    `json:"body"`
	SubmittedAt time.Time `json:"submitted_at"`
	User        struct {
		Login string `json:"login"`
		Type  string `json:"type"`
	} `json:"user"`
}

// A later approval replaces that reviewer's earlier change request. Comments and unsubmitted drafts do not replace a submitted review decision.
func latestReviewStatus(reviews []githubReview) string {
	latest := map[string]githubReview{}
	for _, r := range reviews {
		if r.User.Login == "" {
			continue
		}
		switch r.State {
		case "APPROVED", "CHANGES_REQUESTED", "DISMISSED":
			old, ok := latest[r.User.Login]
			if !ok || r.SubmittedAt.After(old.SubmittedAt) || (r.SubmittedAt.Equal(old.SubmittedAt) && r.ID > old.ID) {
				latest[r.User.Login] = r
			}
		}
	}
	status := "pending"
	for _, r := range latest {
		if r.State == "CHANGES_REQUESTED" {
			return "changes_requested"
		}
		if r.State == "APPROVED" {
			status = "approved"
		}
	}
	return status
}
