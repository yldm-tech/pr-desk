package main

import (
	"io"
	"os"
	"strings"
	"testing"
)

// Each tool rejects unknown fields, so a flag that does not apply has to be
// caught here. Otherwise it surfaces as a schema refusal that reads like a
// sign-in problem.
func TestListFlagsRejectsFlagsTheCommandDoesNotAccept(t *testing.T) {
	for _, tc := range []struct {
		command string
		args    []string
		wantErr string
	}{
		{"prs", []string{"--reason", "conflict"}, "--reason does not apply to: prdesk prs"},
		{"prs", []string{"--sort", "waiting"}, "--sort does not apply to: prdesk prs"},
		{"prs", []string{"--unread"}, "--unread does not apply to: prdesk prs"},
		{"followups", []string{"--query", "auth"}, "--query does not apply to: prdesk followups"},
		{"repos", []string{"--state", "action"}, "--state does not apply to: prdesk repos"},
		{"summary", []string{"--limit", "5"}, "--limit does not apply to: prdesk summary"},
		{"sync", []string{"--repo", "a/b"}, "--repo does not apply to: prdesk sync"},
	} {
		t.Run(tc.command+strings.Join(tc.args, ""), func(t *testing.T) {
			_, err := listFlags(tc.command, tc.args)
			if err == nil {
				t.Fatal("the flag was accepted for a command that cannot use it")
			}
			if err.Error() != tc.wantErr {
				t.Fatalf("error was %q, wanted %q", err, tc.wantErr)
			}
		})
	}
}

func TestListFlagsBuildsTheToolArguments(t *testing.T) {
	options, err := listFlags("followups", []string{"--state", "action", "--reason", "checks_failed", "--min-waiting", "14", "--unread", "--sort", "waiting", "--limit", "50", "--url"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"state": "action", "reason": "checks_failed", "min_waiting_days": 14, "unread": true, "sort": "waiting", "limit": 50}
	if len(options.arguments) != len(want) {
		t.Fatalf("argument count is %d, wanted %d: %+v", len(options.arguments), len(want), options.arguments)
	}
	for key, value := range want {
		if options.arguments[key] != value {
			t.Fatalf("%s was %v, wanted %v", key, options.arguments[key], value)
		}
	}
	if !options.showURL {
		t.Fatal("--url did not reach the printer")
	}
	// An unset flag must not be sent at all; an empty string is a filter that
	// matches nothing rather than no filter.
	if _, present := options.arguments["role"]; present {
		t.Fatal("an unset flag was sent to the server")
	}
}

func TestListFlagsAcceptsStateForBothListings(t *testing.T) {
	for _, command := range []string{"followups", "prs"} {
		options, err := listFlags(command, []string{"--state", "open"})
		if err != nil {
			t.Fatalf("%s rejected --state: %v", command, err)
		}
		if options.arguments["state"] != "open" {
			t.Fatalf("%s dropped --state", command)
		}
	}
}

func captureStdout(t *testing.T, run func() error) string {
	t.Helper()
	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	runErr := run()
	writer.Close()
	os.Stdout = original
	out, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if runErr != nil {
		t.Fatal(runErr)
	}
	return string(out)
}

// The detail view exists so a cancelled run can be told apart from a red test
// without opening GitHub, so the run names have to reach the terminal.
func TestPrintFollowUpDetailShowsChecksAndComments(t *testing.T) {
	body := []byte(`{
		"follow_up": {"id": 7, "version": 3, "repository": "fixture/tools", "number": 12,
			"title": "Fresh human feedback", "url": "https://github.com/fixture/tools/pull/12",
			"author": "someone", "state": "action", "role": "authored", "reasons": ["human_feedback"],
			"unread": true, "conflict": false, "checks": "inconclusive",
			"failing_checks": [{"name": "Stale PR", "conclusion": "cancelled", "url": "https://github.com/r/1"}],
			"waiting_days": 5},
		"comments": [{"author": "reviewer", "body": "Needs a rebase.\nThen it can land.", "kind": "review", "created_at": "2026-09-12T01:00:00Z"}],
		"total_comments": 2
	}`)
	out := captureStdout(t, func() error { return printFollowUpDetail(body) })
	for _, want := range []string{"fixture/tools #12", "inconclusive", "Stale PR", "cancelled", "prdesk handled 7 3", "reviewer", "Needs a rebase.", "Then it can land.", "1 of 2"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the detail view is missing %q:\n%s", want, out)
		}
	}
}

func TestPrintFollowUpsAddsTheURLColumnOnlyWhenAsked(t *testing.T) {
	body := []byte(`{"follow_ups":[{"id":1,"version":2,"repository":"a/b","number":9,"title":"x","url":"https://github.com/a/b/pull/9","state":"action","reasons":["conflict"],"waiting_days":3}],"total":1}`)
	plain := captureStdout(t, func() error { return printFollowUps(body, false) })
	if strings.Contains(plain, "https://github.com") {
		t.Fatalf("the URL leaked into the default table:\n%s", plain)
	}
	withURL := captureStdout(t, func() error { return printFollowUps(body, true) })
	if !strings.Contains(withURL, "https://github.com/a/b/pull/9") {
		t.Fatalf("--url did not add the column:\n%s", withURL)
	}
}

func TestPrintSyncStatusExplainsALapsedAuthorization(t *testing.T) {
	body := []byte(`{"status":"failed","error_code":"reconnect","last_synced_at":"2026-09-11T00:00:00Z","stale_minutes":1500,"baseline_complete":true}`)
	out := captureStdout(t, func() error { return printSyncStatus(body) })
	if !strings.Contains(out, "reconnect") {
		t.Fatalf("a lapsed authorization was not explained:\n%s", out)
	}
	if !strings.Contains(out, "1d1h") {
		t.Fatalf("the age was not made readable:\n%s", out)
	}
}

// Reading a failure without knowing when it was decided is what sends someone
// investigating a run that ended before the last restart.
func TestPrintSyncStatusDatesTheVerdict(t *testing.T) {
	body := []byte(`{"status":"failed","error_code":"storage","reported_at":"2026-09-11T14:00:00Z","reported_age_minutes":180,"last_synced_at":"2026-09-11T16:00:00Z","stale_minutes":60,"baseline_complete":true}`)
	out := captureStdout(t, func() error { return printSyncStatus(body) })
	if !strings.Contains(out, "reported 3h0m ago") {
		t.Fatalf("the verdict was printed without its age:\n%s", out)
	}
	if !strings.Contains(out, "1h0m ago") {
		t.Fatalf("the data age is missing:\n%s", out)
	}
}

// A status with no timestamp must not render an age of zero, which would read
// as "decided just now".
func TestPrintSyncStatusOmitsTheAgeWhenItIsUnknown(t *testing.T) {
	body := []byte(`{"status":"idle","baseline_complete":true}`)
	out := captureStdout(t, func() error { return printSyncStatus(body) })
	if strings.Contains(out, "reported") {
		t.Fatalf("an unknown verdict age was rendered anyway:\n%s", out)
	}
}

func TestHumanMinutes(t *testing.T) {
	for _, tc := range []struct {
		minutes int
		want    string
	}{{5, "5m"}, {59, "59m"}, {60, "1h0m"}, {135, "2h15m"}, {1440, "1d0h"}, {1500, "1d1h"}} {
		if got := humanMinutes(tc.minutes); got != tc.want {
			t.Fatalf("%d minutes rendered as %q, wanted %q", tc.minutes, got, tc.want)
		}
	}
}

func TestTruncateKeepsMultiByteTitlesIntact(t *testing.T) {
	if got := truncate("短标题", 10); got != "短标题" {
		t.Fatalf("a short title was altered: %q", got)
	}
	got := truncate("这是一个很长的标题需要被截断", 6)
	if []rune(got)[5] != '…' || len([]rune(got)) != 6 {
		t.Fatalf("truncation did not land on a rune boundary: %q", got)
	}
}
