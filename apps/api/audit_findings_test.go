package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// reasonsPresentationCanEmit drives presentation over every combination of the
// state it reads and collects what it actually attaches. Deriving the set rather
// than restating it is the whole point: a name the MCP schema advertises that
// presentation cannot produce is a filter that answers "no work" for a value the
// tool told the caller to use, and a reason presentation produces that the
// schema omits is a filter that rejects something real.
func reasonsPresentationCanEmit(t *testing.T) map[string]bool {
	t.Helper()
	now := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	past, future := now.Add(-time.Hour), now.Add(time.Hour)
	emitted := map[string]bool{}
	// The four booleans presentation branches on, enumerated as a bitmask to keep
	// the sweep flat, then the five fields with more than two interesting values.
	for mask := 0; mask < 16; mask++ {
		for _, role := range []string{"authored", "reviewer"} {
			for _, checks := range []string{"success", "failure"} {
				for _, myReview := range []string{"", "APPROVED", "CHANGES_REQUESTED"} {
					for _, snoozed := range []*time.Time{nil, &past, &future} {
						for _, waiting := range []time.Time{{}, now.AddDate(0, 0, -30), now} {
							facts := FollowUpFacts{
								Role:     role,
								Checks:   checks,
								MyReview: myReview,
								Closed:   mask&1 != 0,
								Draft:    mask&2 != 0,
								Conflict: mask&4 != 0,
							}
							raw, err := json.Marshal(facts)
							if err != nil {
								t.Fatal(err)
							}
							follow := FollowUp{FactsJSON: string(raw), NeedsConfirmation: mask&8 != 0, SnoozedUntil: snoozed, WaitingSince: waiting}
							_, reasons := follow.presentation(now, 7)
							for _, reason := range reasons {
								emitted[reason] = true
							}
						}
					}
				}
			}
		}
	}
	if len(emitted) == 0 {
		t.Fatal("the sweep produced no reasons at all, so it proves nothing")
	}
	return emitted
}

func TestAdvertisedReasonsAreExactlyWhatPresentationEmits(t *testing.T) {
	emitted := reasonsPresentationCanEmit(t)
	for _, advertised := range presentableReasons {
		if !emitted[advertised] {
			t.Errorf("%s is advertised and accepted by the filter, but presentation never attaches it, so filtering on it returns nothing", advertised)
		}
	}
	for reason := range emitted {
		if !presentableReason(reason) {
			t.Errorf("presentation attaches %s, but the filter rejects it as unknown", reason)
		}
	}
}

// The schema text is what an agent reads to choose a value, so it has to name the
// same set the filter accepts.
func TestReasonSchemaNamesEveryAcceptedReason(t *testing.T) {
	field, ok := reflect.TypeOf(listFollowUpsInput{}).FieldByName("Reason")
	if !ok {
		t.Fatal("listFollowUpsInput has no Reason field")
	}
	schema := field.Tag.Get("jsonschema")
	if schema == "" {
		t.Fatal("the Reason field carries no jsonschema description")
	}
	for _, reason := range presentableReasons {
		if !strings.Contains(schema, reason) {
			t.Errorf("the filter accepts %s but the schema never names it: %q", reason, schema)
		}
	}
	// A name the schema still advertises after it stopped being accepted sends the
	// caller to a value that now errors.
	for _, retired := range []string{"changes_requested", "approval_revoked", "author_updated"} {
		if strings.Contains(schema, retired) {
			t.Errorf("the schema still advertises %s, which the filter rejects", retired)
		}
	}
}

// The notification names the reason it is about. A reason that reaches the
// message without a label contributes nothing, so the person is told a pull
// request needs them and not why. The two maps are the seam: they have to carry
// the same keys, because the language chosen at send time picks one of them.
func TestEveryNotifiableReasonHasALabelInBothLanguages(t *testing.T) {
	for reason := range reasonLabels {
		if reasonLabelsZH[reason] == "" {
			t.Errorf("%s has an English label but no Chinese one", reason)
		}
	}
	for reason := range reasonLabelsZH {
		if reasonLabels[reason] == "" {
			t.Errorf("%s has a Chinese label but no English one", reason)
		}
	}
	// Both the reasons presentation attaches and the ones only events raise reach
	// a notification, so every one of them needs a label.
	notifiable := reasonsPresentationCanEmit(t)
	for _, eventOnly := range []string{"changes_requested", "approval_revoked", "author_updated"} {
		notifiable[eventOnly] = true
	}
	names := make([]string, 0, len(notifiable))
	for reason := range notifiable {
		names = append(names, reason)
	}
	sort.Strings(names)
	pr := PullRequest{Repo: "fixture/calendar", Number: 17, Title: "Handle timezone boundaries"}
	for _, reason := range names {
		for _, language := range []string{"en", "zh-CN"} {
			body := followUpNotification(pr, FollowUp{}, []string{reason}, time.Now(), language)
			lines := strings.Split(body, "\n")
			if len(lines) < 2 || strings.TrimSpace(lines[1]) == "" {
				t.Errorf("%s in %s has no label, so the message states no reason: %q", reason, language, body)
			}
		}
	}
}

// The review-inbox queries persist nothing, so they must not move the cursor the
// authored walk resumes from. While the cursor was attached, each review query
// marked it at its own end, so a successful full sync left history_cursor
// pointing at that run and every later full sync started from there instead of
// from the account's creation — which is how a freshly installed GitHub App's
// newly visible private pull requests went unimported.
func TestReviewDiscoveryDoesNotMoveTheHistoryCursor(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	account := OAuthToken{SessionID: "cursor-owner", GitHubID: 4242, Username: "me", Token: "fixture"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = previous })
	searches := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/search/issues" {
			t.Errorf("unexpected GitHub call: %s", req.URL.Path)
		}
		searches++
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"total_count":0,"items":[]}`)), Request: req}, nil
	})}
	var marks []time.Time
	ctx := context.WithValue(context.Background(), historyCursorKey{}, historyCursor(func(completed time.Time) error {
		marks = append(marks, completed)
		return nil
	}))
	now := time.Now().UTC()
	if err := s.syncReviewRequests(ctx, account, "fixture", now.AddDate(-1, 0, 0), now); err != nil {
		t.Fatal(err)
	}
	if searches == 0 {
		t.Fatal("no search ran, so the cursor was never in a position to move and the test proves nothing")
	}
	if len(marks) > 0 {
		t.Fatalf("review discovery moved the history cursor to %v, so the next full sync would resume from this run", marks)
	}
}
