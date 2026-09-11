package main

import (
	"encoding/json"
	"strings"
	"time"
)

// Facts are a complete successful GitHub snapshot, never a partial fetch. Local
// read/handled/snooze state lives separately and cannot mutate these facts.
type FollowUpFacts struct {
	DirectRequest bool      `json:"direct_request"`
	ReviewTeams   []string  `json:"review_teams"`
	Role          string    `json:"role"`
	Draft         bool      `json:"draft"`
	Closed        bool      `json:"closed"`
	Merged        bool      `json:"merged"`
	Conflict      bool      `json:"conflict"`
	Checks        string    `json:"checks"`
	Review        string    `json:"review"`
	MyReview      string    `json:"my_review"`
	MyReviewID    int64     `json:"my_review_id"`
	MyReviewAt    time.Time `json:"my_review_at"`
	Requested     bool      `json:"requested"`
	RequestedAt   time.Time `json:"requested_at"`
	ReadyAt       time.Time `json:"ready_at"`
	CreatedAt     time.Time `json:"created_at"`
	HumanAt       time.Time `json:"human_at"`
	HumanVersion  string    `json:"human_version"`
	HumanExcerpt  string    `json:"human_excerpt"`
	AuthorAt      time.Time `json:"author_at"`
	HeadSHA       string    `json:"head_sha"`
}

type FollowUp struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	SessionID         string     `gorm:"uniqueIndex:followup_owner_pr;not null" json:"-"`
	PullRequestID     uint       `gorm:"uniqueIndex:followup_owner_pr;not null" json:"pull_request_id"`
	FactsJSON         string     `json:"-"`
	Version           uint64     `json:"version"`
	ReadVersion       uint64     `json:"read_version"`
	HandledVersion    uint64     `json:"handled_version"`
	NeedsConfirmation bool       `json:"needs_confirmation"`
	WaitingSince      time.Time  `json:"waiting_since"`
	SnoozedUntil      *time.Time `json:"snoozed_until"`
	LastActivityAt    time.Time  `json:"last_activity_at"`
	ArchivedAt        *time.Time `json:"archived_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (f FollowUp) facts() FollowUpFacts {
	var facts FollowUpFacts
	_ = json.Unmarshal([]byte(f.FactsJSON), &facts)
	return facts
}
func failedChecks(state string) bool { return state == "failure" || state == "error" }
func latestTime(times ...time.Time) time.Time {
	var latest time.Time
	for _, value := range times {
		if value.After(latest) {
			latest = value
		}
	}
	return latest
}
func humanActor(login, kind string) bool {
	return login != "" && !strings.EqualFold(kind, "Bot") && !strings.HasSuffix(strings.ToLower(login), "[bot]")
}

// advanceFacts returns reasons for an event notification. Baseline imports set
// pending work but return no notifications: inventory is emitted once instead.
func (f *FollowUp) advanceFacts(next FollowUpFacts, now time.Time) []string {
	previous := f.facts()
	initial := f.FactsJSON == ""
	reasons := []string{}
	if initial {
		f.WaitingSince = latestTime(next.CreatedAt, next.ReadyAt, next.HumanAt, next.RequestedAt)
		if f.WaitingSince.IsZero() {
			f.WaitingSince = now
		}
	}
	humanChanged := next.HumanVersion != "" && next.HumanVersion != previous.HumanVersion
	requestChanged := next.Requested && (!previous.Requested || next.RequestedAt.After(previous.RequestedAt))
	ready := previous.Draft && !next.Draft
	reopened := previous.Closed && !next.Closed
	if humanChanged {
		reasons = append(reasons, "human_feedback")
		f.NeedsConfirmation = true
	}
	if next.Role == "authored" {
		if next.Conflict && (!previous.Conflict || ready || reopened) {
			reasons = append(reasons, "conflict")
		}
		if failedChecks(next.Checks) && (!failedChecks(previous.Checks) || ready || reopened) {
			reasons = append(reasons, "checks_failed")
		}
		if next.Review == "changes_requested" && previous.Review != next.Review {
			reasons = append(reasons, "changes_requested")
			f.NeedsConfirmation = true
		}
	} else {
		if initial && (next.Requested || !next.RequestedAt.IsZero()) {
			f.NeedsConfirmation = true
		}
		// Submitted review decisions clear that round. COMMENTED is not a decision.
		decision := next.MyReviewID != previous.MyReviewID || next.MyReview != previous.MyReview
		if decision && (next.MyReview == "APPROVED" || next.MyReview == "CHANGES_REQUESTED") {
			f.NeedsConfirmation = false
			if !next.MyReviewAt.IsZero() {
				f.WaitingSince = next.MyReviewAt
			}
		}
		// A single poll can observe both our review and the author's later reply.
		// Only feedback preceding the review is covered by that decision.
		if next.MyReview == "CHANGES_REQUESTED" && humanChanged && next.HumanAt.After(next.MyReviewAt) {
			f.NeedsConfirmation = true
		}
		if requestChanged {
			reasons = append(reasons, "review_requested")
			f.NeedsConfirmation = true
		}
		if previous.MyReview == "APPROVED" && next.MyReview != "APPROVED" {
			reasons = append(reasons, "approval_revoked")
			f.NeedsConfirmation = true
		}
		if next.MyReview == "CHANGES_REQUESTED" && ((initial && next.AuthorAt.After(next.MyReviewAt)) || (!initial && next.HeadSHA != previous.HeadSHA && (!decision || next.AuthorAt.After(next.MyReviewAt)))) {
			reasons = append(reasons, "author_updated")
			f.NeedsConfirmation = true
			f.WaitingSince = now
		}
		// Ordinary discussion/commits after approval do not revoke that decision.
		if next.MyReview == "APPROVED" && !requestChanged && !next.Requested {
			f.NeedsConfirmation = false
			reasons = nil
		}
	}
	if ready || reopened {
		f.WaitingSince = now
		f.SnoozedUntil = nil
		if next.Role == "reviewer" && next.Requested {
			f.NeedsConfirmation = true
			reasons = append(reasons, "review_requested")
		}
		if next.Role == "authored" && f.NeedsConfirmation {
			reasons = append(reasons, "human_feedback")
		}
	}
	// Human progress (and revisions when waiting on an author) is the clock,
	// never GitHub's general updated_at or a polling timestamp.
	progressAt := next.HumanAt
	if next.Role == "reviewer" && next.MyReview == "CHANGES_REQUESTED" {
		progressAt = latestTime(progressAt, next.AuthorAt)
	}
	if progressAt.After(f.WaitingSince) {
		f.WaitingSince = progressAt
	}
	if len(reasons) > 0 || initial {
		f.Version++
		f.LastActivityAt = now
	}
	if next.Closed {
		if !previous.Closed || initial {
			closed := now
			f.ArchivedAt = &closed
		}
		f.NeedsConfirmation = false
		reasons = nil
	} else {
		f.ArchivedAt = nil
	}
	raw, _ := json.Marshal(next)
	f.FactsJSON = string(raw)
	if initial || next.Draft {
		return nil
	}
	return reasons
}

func (f FollowUp) presentation(now time.Time, waitDays int) (string, []string) {
	facts := f.facts()
	if facts.Closed {
		return "archived", []string{}
	}
	if facts.Draft {
		return "draft", []string{}
	}
	reasons := []string{}
	if f.NeedsConfirmation {
		if facts.Role == "reviewer" {
			reasons = append(reasons, "review_requested")
		} else {
			reasons = append(reasons, "human_feedback")
		}
	}
	if facts.Role == "authored" {
		if facts.Conflict {
			reasons = append(reasons, "conflict")
		}
		if failedChecks(facts.Checks) {
			reasons = append(reasons, "checks_failed")
		}
	}
	if len(reasons) > 0 {
		return "action", reasons
	}
	if facts.Role == "reviewer" && facts.MyReview == "APPROVED" {
		return "waiting", reasons
	}
	if waitDays < 1 {
		waitDays = 7
	}
	if f.SnoozedUntil != nil {
		if now.Before(*f.SnoozedUntil) {
			return "waiting", reasons
		}
		return "follow_up", []string{"snooze_due"}
	}
	if !f.WaitingSince.IsZero() && !now.Before(f.WaitingSince.Add(time.Duration(waitDays)*24*time.Hour)) {
		return "follow_up", []string{"overdue"}
	}
	return "waiting", reasons
}
