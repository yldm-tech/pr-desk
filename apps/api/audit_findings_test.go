package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Every reason the MCP schema advertises has to be one presentation can attach,
// or the filter answers "no work" for a name the tool told the caller to use.
func TestAdvertisedReasonsArePresentable(t *testing.T) {
	schema := listFollowUpsInput{}
	_ = schema
	for _, reason := range presentableReasons {
		if !presentableReason(reason) {
			t.Fatalf("%s is listed but not accepted", reason)
		}
	}
	for _, absent := range []string{"changes_requested", "approval_revoked", "author_updated", ""} {
		if absent != "" && presentableReason(absent) {
			t.Fatalf("%s is accepted but presentation never emits it", absent)
		}
	}
}

// The notification names the reason it is about. A reason that reaches the
// message without a label contributes nothing, so the person is told a pull
// request needs them and not why.
func TestEveryNotifiableReasonHasALabel(t *testing.T) {
	pr := PullRequest{Repo: "fixture/calendar", Number: 17, Title: "Handle timezone boundaries"}
	reasons := []string{"human_feedback", "review_requested", "changes_requested", "author_updated", "approval_revoked", "conflict", "checks_failed", "overdue", "snooze_due"}
	for _, reason := range reasons {
		for _, language := range []string{"en", "zh-CN"} {
			body := followUpNotification(pr, FollowUp{}, []string{reason}, time.Now(), language)
			lines := strings.Split(body, "\n")
			if len(lines) < 2 || strings.TrimSpace(lines[1]) == "" {
				t.Fatalf("%s in %s has no label, so the message states no reason: %q", reason, language, body)
			}
		}
	}
}

// The review-inbox queries persist nothing, so they must not move the cursor the
// authored walk uses to resume. Leaving it attached made every full sync after
// the first resume from the previous run.
func TestReviewDiscoveryDoesNotInheritTheHistoryCursor(t *testing.T) {
	base := context.WithValue(context.Background(), historyCursorKey{}, historyCursor(func(time.Time) error {
		t.Fatal("review discovery moved the history cursor")
		return nil
	}))
	discovery := context.WithValue(context.WithValue(context.WithValue(base, historyPageSinkKey{}, nil), historyProgressKey{}, nil), historyCursorKey{}, nil)
	if _, ok := discovery.Value(historyCursorKey{}).(historyCursor); ok {
		t.Fatal("the cursor survived into the discovery context")
	}
}
