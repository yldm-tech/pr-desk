package main

import "testing"

func completed(name, conclusion string) checkRun {
	return checkRun{Name: name, Status: "completed", Conclusion: conclusion, URL: "https://github.com/x/y/runs/1"}
}

// A run that a concurrency group stopped reports cancelled, which reads as a red
// cross on GitHub while saying nothing about the code. Treating it as a failure
// is what turns a healthy branch into a follow-up that needs action.
func TestCheckSummarySeparatesAnInconclusiveRunFromAFailure(t *testing.T) {
	for _, tc := range []struct {
		name     string
		runs     []checkRun
		combined string
		want     string
	}{
		{"a cancelled run among successes is not a failure", []checkRun{completed("build", "success"), completed("stale", "cancelled")}, "", "inconclusive"},
		{"a stale run alone is inconclusive", []checkRun{completed("stale", "stale")}, "", "inconclusive"},
		{"a real failure still outranks a cancelled run", []checkRun{completed("test", "failure"), completed("stale", "cancelled")}, "", "failure"},
		{"a timed out run is a failure", []checkRun{completed("test", "timed_out")}, "", "failure"},
		{"a run awaiting action is a failure", []checkRun{completed("deploy", "action_required")}, "", "failure"},
		{"a startup failure is a failure", []checkRun{completed("test", "startup_failure")}, "", "failure"},
		{"work still running outranks a cancelled run", []checkRun{{Name: "build", Status: "in_progress"}, completed("stale", "cancelled")}, "", "pending"},
		{"all green stays success", []checkRun{completed("build", "success"), completed("lint", "skipped")}, "", "success"},
		{"a legacy status failure survives a cancelled run", []checkRun{completed("stale", "cancelled")}, "failure", "failure"},
		{"no runs and no statuses is unknown", nil, "", "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := checkSummary(tc.runs, tc.combined); got != tc.want {
				t.Fatalf("summary was %q, wanted %q", got, tc.want)
			}
		})
	}
}

// The summary alone cannot distinguish a broken test from a superseded run, so
// the names have to travel with it.
func TestUnhealthyChecksNamesTheRunsFailuresFirst(t *testing.T) {
	runs := []checkRun{
		completed("build", "success"),
		completed("stale", "cancelled"),
		{Name: "e2e", Status: "in_progress"},
		completed("unit", "failure"),
	}
	got := unhealthyChecks(runs, nil)
	if len(got) != 3 {
		t.Fatalf("expected the three non-passing runs, got %d: %+v", len(got), got)
	}
	if got[0].Name != "unit" || got[0].Conclusion != "failure" {
		t.Fatalf("the real failure is not first: %+v", got)
	}
	for _, run := range got {
		if run.Name == "build" {
			t.Fatal("a passing run was recorded, which is noise on every listing")
		}
		if run.Name == "e2e" && run.Conclusion != "pending" {
			t.Fatalf("a run still going was not reported as pending: %+v", run)
		}
	}
}

func TestUnhealthyChecksStaysBounded(t *testing.T) {
	runs := []checkRun{}
	for i := 0; i < maxRecordedChecks*3; i++ {
		runs = append(runs, completed("job", "failure"))
	}
	if got := len(unhealthyChecks(runs, nil)); got != maxRecordedChecks {
		t.Fatalf("recorded %d checks, wanted the cap of %d", got, maxRecordedChecks)
	}
}

// Vercel, Netlify and most non-Actions integrations report through the older
// commit status API. Such a repository summarises as failure through the
// combined state while contributing no check run, so reading runs alone leaves
// a red mark with nothing named behind it.
func TestUnhealthyChecksNamesAFailingCommitStatus(t *testing.T) {
	runs := []checkRun{completed("build", "success")}
	statuses := []commitStatus{
		{Context: "Vercel", State: "failure", URL: "https://vercel.com/x"},
		{Context: "licence/cla", State: "success"},
	}
	// This is the shape GitHub reports for that repository: every check run
	// green, the combined state red because of the status.
	if got := checkSummary(runs, "failure"); got != "failure" {
		t.Fatalf("a failing commit status did not reach the summary: %q", got)
	}
	got := unhealthyChecks(runs, statuses)
	if len(got) != 1 {
		t.Fatalf("expected only the failing status, got %+v", got)
	}
	if got[0].Name != "Vercel" || got[0].Conclusion != "failure" || got[0].URL == "" {
		t.Fatalf("the status was not named usefully: %+v", got[0])
	}
}

func TestUnhealthyChecksOrdersStatusFailuresWithTheRest(t *testing.T) {
	runs := []checkRun{{Name: "e2e", Status: "queued"}, completed("unit", "failure")}
	statuses := []commitStatus{{Context: "ci/circleci", State: "error"}, {Context: "deploy", State: "pending"}}
	got := unhealthyChecks(runs, statuses)
	if len(got) != 4 {
		t.Fatalf("expected two failures and two pending, got %+v", got)
	}
	// Failures first regardless of which API reported them.
	for _, run := range got[:2] {
		if run.Conclusion != "failure" && run.Conclusion != "error" {
			t.Fatalf("a pending entry outranked a failure: %+v", got)
		}
	}
	for _, run := range got[2:] {
		if run.Conclusion != "pending" {
			t.Fatalf("a failure was sorted after a pending entry: %+v", got)
		}
	}
}

func TestUnhealthyChecksIgnoresPassingStatuses(t *testing.T) {
	statuses := []commitStatus{{Context: "Vercel", State: "success"}, {Context: "cla", State: "success"}}
	if got := unhealthyChecks(nil, statuses); len(got) != 0 {
		t.Fatalf("passing statuses were recorded as noise: %+v", got)
	}
}

// presentation is what decides whether the row lands in the action list, so the
// new state has to reach it intact.
func TestAnInconclusiveCheckDoesNotRaiseAnAction(t *testing.T) {
	if failedChecks("inconclusive") {
		t.Fatal("an inconclusive check counts as failed, so cancelled runs still raise an action")
	}
	if !failedChecks("failure") || !failedChecks("error") {
		t.Fatal("a real failure stopped counting as failed")
	}
}
