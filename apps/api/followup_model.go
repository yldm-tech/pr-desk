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
	// Who said it. The excerpt used to render as an unattributed paragraph that read like the pull request's own description, and whether it came from a reviewer an hour ago or a drive-by two weeks back changes what the reader does about it.
	HumanBy string `json:"human_by"`
	// Whether the excerpt was cut, so the ellipsis is appended where the truncation happens rather than guessed at by the browser.
	HumanTruncated bool `json:"human_truncated"`
	// The reasons that actually set NeedsConfirmation, recorded rather than re-derived. presentation() used to synthesize one from the role alone, so a reviewer whose approval had been dismissed was told "Review requested" when nobody had requested anything, and changes requested on your own pull request were reported as "New comment to answer". Empty on rows written before this, which is what the fallback below is for.
	ConfirmReasons []string  `json:"confirm_reasons,omitempty"`
	AuthorAt       time.Time `json:"author_at"`
	HeadSHA        string    `json:"head_sha"`
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
	// One step of history, so a mis-tap is recoverable. `handled` overwrites WaitingSince with the current time and clears NeedsConfirmation, which destroys the one number this product is built on — how long something has been waiting — and no verb could put it back: `unsnooze` reverses a snooze and says so in its own comment. These are written on every state-changing action and consumed once by `undo`, so undo is a single step rather than a stack: a second undo has nothing to restore, which is the honest shape for a column-per-field snapshot.
	PrevReadVersion       *uint64    `json:"-"`
	PrevHandledVersion    *uint64    `json:"-"`
	PrevNeedsConfirmation *bool      `json:"-"`
	PrevWaitingSince      *time.Time `json:"-"`
	PrevSnoozedUntil      *time.Time `json:"-"`
	// Whether the row has a step to go back to, which is the only thing the browser needs in order to decide between offering Undo and not.
	Undoable  bool      `gorm:"-" json:"undoable"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
		next.ConfirmReasons = appendReason(next.ConfirmReasons, "human_feedback")
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
			next.ConfirmReasons = appendReason(next.ConfirmReasons, "changes_requested")
		}
	} else {
		if initial && (next.Requested || !next.RequestedAt.IsZero()) {
			f.NeedsConfirmation = true
			next.ConfirmReasons = appendReason(next.ConfirmReasons, "review_requested")
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
			next.ConfirmReasons = appendReason(next.ConfirmReasons, "human_feedback")
		}
		if requestChanged {
			reasons = append(reasons, "review_requested")
			f.NeedsConfirmation = true
		}
		if previous.MyReview == "APPROVED" && next.MyReview != "APPROVED" {
			reasons = append(reasons, "approval_revoked")
			f.NeedsConfirmation = true
			next.ConfirmReasons = appendReason(next.ConfirmReasons, "approval_revoked")
		}
		if next.MyReview == "CHANGES_REQUESTED" && ((initial && next.AuthorAt.After(next.MyReviewAt)) || (!initial && next.HeadSHA != previous.HeadSHA && (!decision || next.AuthorAt.After(next.MyReviewAt)))) {
			reasons = append(reasons, "author_updated")
			f.NeedsConfirmation = true
			next.ConfirmReasons = appendReason(next.ConfirmReasons, "author_updated")
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
	// A sync where nothing new happened computes no causes, so a confirmation that is still outstanding carries its original ones forward rather than falling back to the role guess on the next poll. Cleared with the flag, so a later confirmation starts from what actually caused it.
	if f.NeedsConfirmation && len(next.ConfirmReasons) == 0 {
		next.ConfirmReasons = previous.ConfirmReasons
	}
	if !f.NeedsConfirmation {
		next.ConfirmReasons = nil
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
	if f.NeedsConfirmation && len(facts.ConfirmReasons) > 0 {
		// What actually happened, recorded when it happened. The role-based guess below is the fallback for rows written before this was stored.
		reasons = append(reasons, facts.ConfirmReasons...)
	} else if f.NeedsConfirmation {
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
	// A live snooze outranks the reasons, otherwise deferring the two things worth deferring — a merge conflict and a red build — would write the column and change nothing observable, because both reasons are re-derived from synced facts on every read and no verb clears them. The version gate keeps the mute honest: advanceFacts bumps Version for every genuinely new reason, so anything that arrives after the snooze breaks straight back through to "action" and only what the user had already seen stays muted. The reasons ride along so the muted card can still say why it is muted.
	if f.SnoozedUntil != nil && now.Before(*f.SnoozedUntil) && f.Version <= f.ReadVersion {
		return "waiting", reasons
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

// appendReason keeps the recorded causes unique and ordered by first occurrence: a single poll can observe the same kind of activity twice, and a chip list that repeats itself reads as a rendering fault rather than as two events.
func appendReason(reasons []string, reason string) []string {
	for _, existing := range reasons {
		if existing == reason {
			return reasons
		}
	}
	return append(reasons, reason)
}
