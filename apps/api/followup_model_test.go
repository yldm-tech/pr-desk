package main

import (
	"testing"
	"time"
)

func TestFollowUpReadHandledSnoozeAndNewFeedback(t *testing.T) {
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	facts := FollowUpFacts{Role: "authored", CreatedAt: now.Add(-30 * 24 * time.Hour), HumanAt: now.Add(-10 * 24 * time.Hour), HumanVersion: "comment-1"}
	var row FollowUp
	if events := row.advanceFacts(facts, now); len(events) != 0 {
		t.Fatal("baseline emitted historical notifications")
	}
	assertState := func(want string) {
		t.Helper()
		if state, _ := row.presentation(now, 7); state != want {
			t.Fatalf("state=%s want=%s", state, want)
		}
	}
	assertState("action")
	row.ReadVersion = row.Version
	assertState("action")
	row.NeedsConfirmation = false
	row.HandledVersion = row.Version
	row.WaitingSince = now
	assertState("waiting")
	now = now.Add(7 * 24 * time.Hour)
	assertState("follow_up")
	until := now.Add(3 * 24 * time.Hour)
	row.SnoozedUntil = &until
	assertState("waiting")
	facts.HumanAt = now
	facts.HumanVersion = "comment-2"
	if events := row.advanceFacts(facts, now); len(events) != 1 {
		t.Fatalf("new comment must notify even snoozed: %v", events)
	}
	assertState("action")
	row.NeedsConfirmation = false
	facts.Conflict = true
	row.advanceFacts(facts, now)
	assertState("action")
	row.ReadVersion = row.Version
	row.HandledVersion = row.Version
	assertState("action")
	facts.Conflict = false
	row.advanceFacts(facts, now)
	assertState("waiting")
	facts.Draft = true
	row.advanceFacts(facts, now)
	assertState("draft")
	facts.Closed = true
	row.advanceFacts(facts, now)
	assertState("archived")
}

func TestReviewDecisionLifecycle(t *testing.T) {
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	facts := FollowUpFacts{Role: "reviewer", Requested: true, RequestedAt: now, CreatedAt: now.Add(-24 * time.Hour), HeadSHA: "a"}
	var row FollowUp
	row.advanceFacts(facts, now)
	if !row.NeedsConfirmation {
		t.Fatal("request missing")
	}
	// A COMMENTED review deliberately does not replace the outstanding round.
	if events := row.advanceFacts(facts, now.Add(time.Minute)); len(events) > 0 || !row.NeedsConfirmation {
		t.Fatal("unchanged request repeated or cleared")
	}
	facts.Requested = false
	facts.MyReview = "CHANGES_REQUESTED"
	facts.MyReviewID = 1
	row.advanceFacts(facts, now)
	if row.NeedsConfirmation {
		t.Fatal("request changes should wait")
	}
	facts.HeadSHA = "b"
	facts.AuthorAt = now.Add(time.Hour)
	row.advanceFacts(facts, now.Add(time.Hour))
	if !row.NeedsConfirmation {
		t.Fatal("author revision did not reopen review")
	}
	facts.MyReview = "APPROVED"
	facts.MyReviewID = 2
	row.advanceFacts(facts, now.Add(2*time.Hour))
	if row.NeedsConfirmation {
		t.Fatal("approval didn't clear review")
	}
	facts.HeadSHA = "c"
	if events := row.advanceFacts(facts, now.Add(3*time.Hour)); len(events) != 0 || row.NeedsConfirmation {
		t.Fatal("ordinary push after approval reopened review")
	}
	facts.Requested = true
	facts.RequestedAt = now.Add(4 * time.Hour)
	row.advanceFacts(facts, now.Add(4*time.Hour))
	if !row.NeedsConfirmation {
		t.Fatal("explicit re-request ignored")
	}
	facts.Requested = false
	facts.MyReview = "DISMISSED"
	row.advanceFacts(facts, now.Add(5*time.Hour))
	if !row.NeedsConfirmation {
		t.Fatal("dismissed approval ignored")
	}
}

func TestNoisySnapshotsDontResetWaitingAndDraftsDontNotify(t *testing.T) {
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	facts := FollowUpFacts{Role: "authored", CreatedAt: now.Add(-8 * 24 * time.Hour)}
	var row FollowUp
	row.advanceFacts(facts, now)
	facts.Checks = "pending"
	row.advanceFacts(facts, now.Add(time.Hour))
	if state, _ := row.presentation(now, 7); state != "follow_up" {
		t.Fatal("CI reset waiting")
	}
	facts.Draft = true
	facts.Conflict = true
	facts.Checks = "failure"
	if events := row.advanceFacts(facts, now); len(events) > 0 {
		t.Fatal("draft notified")
	}
	facts.Draft = false
	if events := row.advanceFacts(facts, now); len(events) != 2 {
		t.Fatalf("ready must notify current failures: %v", events)
	}
	if !row.WaitingSince.Equal(now) {
		t.Fatal("ready did not start review clock")
	}
}

func TestHumanSnapshotsExcludeSelfAndBots(t *testing.T) {
	now := time.Now().UTC()
	comments := []activityComment{{ID: 1, Body: "self", CreatedAt: now}, {ID: 2, Body: "robot", CreatedAt: now}, {ID: 3, Body: "please fix", CreatedAt: now.Add(-time.Hour)}}
	comments[0].User.Login = "me"
	comments[1].User.Login = "checks[bot]"
	comments[2].User.Login = "reviewer"
	var facts FollowUpFacts
	snapshotHumanFacts(&facts, "me", comments, nil)
	if facts.HumanExcerpt != "please fix" || !facts.HumanAt.Equal(now.Add(-time.Hour)) {
		t.Fatal("wrong human baseline")
	}
	if humanActor("robot", "Bot") || humanActor("robot[bot]", "") {
		t.Fatal("bot detected as human")
	}
}

func TestReviewTeamSelectionDoesNotIncludeUnrequestedParticipation(t *testing.T) {
	settings := FollowUpSettings{TeamsJSON: `["fixture/reviewers"]`}
	for _, test := range []struct {
		facts FollowUpFacts
		want  bool
	}{
		{FollowUpFacts{Role: "authored"}, true},
		{FollowUpFacts{Role: "reviewer", DirectRequest: true}, true},
		{FollowUpFacts{Role: "reviewer", ReviewTeams: []string{"fixture/reviewers"}}, true},
		{FollowUpFacts{Role: "reviewer", ReviewTeams: []string{"fixture/other"}}, false},
		{FollowUpFacts{Role: "reviewer", MyReview: "COMMENTED"}, false},
	} {
		if got := settings.includes(test.facts); got != test.want {
			t.Fatalf("selection=%v want=%v", got, test.want)
		}
	}
}

func TestReviewBaselineAndResponseBetweenPolls(t *testing.T) {
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name          string
		review        string
		reply, commit bool
	}{
		{"comment-only review remains pending", "", false, false},
		{"reply after change request", "CHANGES_REQUESTED", true, false},
		{"commit after change request", "CHANGES_REQUESTED", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			facts := FollowUpFacts{Role: "reviewer", DirectRequest: true, CreatedAt: now.Add(-24 * time.Hour), RequestedAt: now.Add(-3 * time.Hour), MyReview: tc.review, MyReviewID: 1, MyReviewAt: now.Add(-2 * time.Hour), HeadSHA: "head"}
			if tc.reply {
				facts.HumanVersion = "author-reply"
				facts.HumanAt = now.Add(-time.Hour)
			}
			if tc.commit {
				facts.AuthorAt = now.Add(-time.Hour)
			}
			var row FollowUp
			if events := row.advanceFacts(facts, now); len(events) != 0 {
				t.Fatal("baseline produced notifications")
			}
			if !row.NeedsConfirmation {
				t.Fatal("baseline lost pending review")
			}
		})
	}
	var row FollowUp
	facts := FollowUpFacts{Role: "reviewer", Requested: true, CreatedAt: now.Add(-24 * time.Hour)}
	row.advanceFacts(facts, now)
	facts.Requested = false
	facts.MyReview = "CHANGES_REQUESTED"
	facts.MyReviewID = 4
	facts.MyReviewAt = now.Add(time.Hour)
	facts.HumanAt = now.Add(2 * time.Hour)
	facts.HumanVersion = "later-reply"
	row.advanceFacts(facts, now.Add(3*time.Hour))
	if !row.NeedsConfirmation {
		t.Fatal("review and later author reply in same poll lost reply")
	}
}
