package main

import (
	"flag"
	"io"
	"os"
	"strings"
	"testing"
)

// Go's flag package stops at the first positional, so every flag typed after the
// identifier used to be dropped without a word: "show 41 --json" printed a table
// into a jq pipeline and "show 41 --comments 50" quietly returned the default 20.
func TestParseWithPositionalsAcceptsFlagsOnEitherSideOfTheIdentifier(t *testing.T) {
	for _, tc := range []struct {
		name         string
		args         []string
		min, max     int
		wantRest     []string
		wantComments int
		wantJSON     bool
		wantErr      bool
	}{
		{name: "flag after the id", args: []string{"41", "--json"}, min: 1, max: 1, wantRest: []string{"41"}, wantJSON: true},
		{name: "valued flag after the id", args: []string{"41", "--comments", "50"}, min: 1, max: 1, wantRest: []string{"41"}, wantComments: 50},
		{name: "joined value", args: []string{"41", "--comments=50"}, min: 1, max: 1, wantRest: []string{"41"}, wantComments: 50},
		{name: "flag before the id", args: []string{"--json", "41"}, min: 1, max: 1, wantRest: []string{"41"}, wantJSON: true},
		{name: "single dash", args: []string{"-comments", "50", "41"}, min: 1, max: 1, wantRest: []string{"41"}, wantComments: 50},
		{name: "terminator", args: []string{"--", "41"}, min: 1, max: 1, wantRest: []string{"41"}},
		{name: "two positionals", args: []string{"41", "7"}, min: 2, max: 2, wantRest: []string{"41", "7"}},
		{name: "a trailing token nobody asked for", args: []string{"41", "7", "junk"}, min: 2, max: 2, wantErr: true},
		{name: "nothing to act on", args: []string{"--json"}, min: 1, max: 1, wantErr: true},
		{name: "an undeclared flag", args: []string{"41", "--nope"}, min: 1, max: 1, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			flags := flag.NewFlagSet("show", flag.ContinueOnError)
			comments := flags.Int("comments", 0, "how many recent comments to print")
			asJSON := flags.Bool("json", false, "print raw JSON")
			rest, err := parseWithPositionals(flags, tc.args, "usage: prdesk show <id>", tc.min, tc.max)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("the arguments were accepted: %v", rest)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if strings.Join(rest, ",") != strings.Join(tc.wantRest, ",") {
				t.Fatalf("positionals were %v, wanted %v", rest, tc.wantRest)
			}
			if *comments != tc.wantComments {
				t.Fatalf("--comments was %d, wanted %d", *comments, tc.wantComments)
			}
			if *asJSON != tc.wantJSON {
				t.Fatalf("--json was %v, wanted %v", *asJSON, tc.wantJSON)
			}
		})
	}
}

// A stray word is a mistyped command, not a filter the server should guess at.
func TestPositionalsAreRefusedByTheCommandsThatTakeNone(t *testing.T) {
	if _, err := listFlags("prs", []string{"auth", "--query", "x"}); err == nil {
		t.Fatal("a stray positional was swallowed by prs")
	}
	if err := runAction("handled", []string{"41", "7", "junk"}); err == nil {
		t.Fatal("a trailing token was ignored by handled")
	}
}

// Asking for help is not a failure. Exiting non-zero here aborts any wrapper
// script running under set -e, and the text belongs on stdout so it can be paged.
func TestSubcommandHelpExitsCleanlyOnStdout(t *testing.T) {
	for _, command := range []string{"followups", "prs", "show", "handled", "login", "status", "update"} {
		t.Run(command, func(t *testing.T) {
			var code int
			var out string
			problems := captureStderr(t, func() {
				out = captureStdout(t, func() error {
					code = dispatch([]string{command, "--help"})
					return nil
				})
			})
			if code != 0 {
				t.Fatalf("asking for help exited %d", code)
			}
			if problems != "" {
				t.Fatalf("help was reported as a failure: %q", problems)
			}
			if !strings.Contains(out, "usage: prdesk "+command) {
				t.Fatalf("the help text did not reach stdout:\n%s", out)
			}
		})
	}
}

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

// Both listings answer "what is failing"; the reason filter only ever covered
// the pull requests this account authored.
func TestListFlagsAcceptsChecksAndConflictForBothListings(t *testing.T) {
	for _, command := range []string{"followups", "prs"} {
		options, err := listFlags(command, []string{"--checks", "failure", "--conflict"})
		if err != nil {
			t.Fatalf("%s rejected the check filters: %v", command, err)
		}
		if options.arguments["checks"] != "failure" || options.arguments["conflict"] != true {
			t.Fatalf("%s dropped a check filter: %+v", command, options.arguments)
		}
	}
	// Left off, neither may be sent: conflict false would read as a filter for
	// the pull requests that do not conflict.
	options, err := listFlags("prs", []string{"--state", "open"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"checks", "conflict"} {
		if _, present := options.arguments[key]; present {
			t.Fatalf("an unset %s reached the server", key)
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

// Anyone who can comment on the pull request writes these bytes. An escape
// sequence in them can repaint the screen over the check verdict this view
// exists to report, so nothing from GitHub reaches the terminal unfiltered.
func TestPrintFollowUpDetailStripsTerminalControlSequences(t *testing.T) {
	body := []byte(`{
		"follow_up": {"id": 7, "version": 3, "repository": "fixture/tools", "number": 12,
			"title": "before\u001b[31mafter", "url": "https://github.com/fixture/tools/pull/12",
			"author": "some\u001bone", "state": "action", "role": "authored",
			"failing_checks": [{"name": "unit\u001b[2Ktests", "conclusion": "failure", "url": "https://github.com/r/1"}],
			"waiting_days": 5},
		"comments": [{"author": "reviewer", "body": "before\u001b[2J\u001b[Hafter", "kind": "review", "created_at": "2026-09-12T01:00:00Z"}],
		"total_comments": 1
	}`)
	out := captureStdout(t, func() error { return printFollowUpDetail(body) })
	if strings.ContainsRune(out, 0x1b) {
		t.Fatalf("an escape sequence reached the terminal:\n%q", out)
	}
	for _, want := range []string{"before", "after", "unit", "tests", "reviewer"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the readable text was lost with the escape, missing %q:\n%s", want, out)
		}
	}
}

func TestPrintFollowUpsStripsTerminalControlSequences(t *testing.T) {
	body := []byte(`{"follow_ups":[{"id":1,"version":2,"repository":"a/b","number":9,"title":"red\u001b[31m\tclaim","url":"https://github.com/a/b/pull/9","state":"action","waiting_days":3}],"total":1}`)
	out := captureStdout(t, func() error { return printFollowUps(body, true, 0) })
	if strings.ContainsRune(out, 0x1b) {
		t.Fatalf("an escape sequence reached the table:\n%q", out)
	}
	// A tab inside a title would otherwise open a column of its own.
	if strings.Count(out, "\t") != 0 {
		t.Fatalf("a title split the table into extra cells:\n%q", out)
	}
}

// Stripping must cost nothing to the text people actually write, including the
// zero-width joiner that holds a composed emoji together.
func TestSafeTextLeavesOrdinaryTextAlone(t *testing.T) {
	for _, value := range []string{"Fix the login redirect", "修复登录跳转 — #41", "ship it 🚀", "👨‍👩‍👧 family"} {
		if got := safeText(value); got != value {
			t.Fatalf("ordinary text was altered: %q became %q", value, got)
		}
	}
	if got := safeText("a\tb\x1bc\x7fd"); got != "a\uFFFDb\uFFFDc\uFFFDd" {
		t.Fatalf("a control character survived: %q", got)
	}
}

func TestPrintFollowUpsAddsTheURLColumnOnlyWhenAsked(t *testing.T) {
	body := []byte(`{"follow_ups":[{"id":1,"version":2,"repository":"a/b","number":9,"title":"x","url":"https://github.com/a/b/pull/9","state":"action","reasons":["conflict"],"waiting_days":3}],"total":1}`)
	plain := captureStdout(t, func() error { return printFollowUps(body, false, 0) })
	if strings.Contains(plain, "https://github.com") {
		t.Fatalf("the URL leaked into the default table:\n%s", plain)
	}
	withURL := captureStdout(t, func() error { return printFollowUps(body, true, 0) })
	if !strings.Contains(withURL, "https://github.com/a/b/pull/9") {
		t.Fatalf("--url did not add the column:\n%s", withURL)
	}
}

// The server caps a page at two hundred rows, so the old advice to raise --limit could not reach row 201. The hint has to name the offset that does.
func TestPageHintNamesTheOffsetOfTheNextPage(t *testing.T) {
	body := []byte(`{"follow_ups":[{"id":1,"version":2,"repository":"a/b","number":9,"title":"x","url":"https://github.com/a/b/pull/9","state":"action","waiting_days":3}],"total":3}`)
	out := captureStdout(t, func() error { return printFollowUps(body, false, 1) })
	if !strings.Contains(out, "--offset 2") || !strings.Contains(out, "Showing 2-2 of 3") {
		t.Fatalf("the next page was not addressable:\n%s", out)
	}
	last := captureStdout(t, func() error { return printFollowUps(body, false, 2) })
	if strings.Contains(last, "--offset") {
		t.Fatalf("the final page still offered a next page:\n%s", last)
	}
}

func TestAnEmptyPagePastTheEndIsNotAnEmptyList(t *testing.T) {
	body := []byte(`{"follow_ups":[],"total":300}`)
	out := captureStdout(t, func() error { return printFollowUps(body, false, 400) })
	if !strings.Contains(out, "offset 400") || !strings.Contains(out, "300 match") {
		t.Fatalf("a page past the end read as an empty inbox:\n%s", out)
	}
	empty := captureStdout(t, func() error { return printFollowUps([]byte(`{"follow_ups":[],"total":0}`), false, 0) })
	if !strings.Contains(empty, "Nothing is waiting for you.") {
		t.Fatalf("an actually empty list lost its message:\n%s", empty)
	}
}

// A comment body is prose: its indentation is content, not a column break, and Windows line endings must not leave a stray marker at the end of every line.
func TestCommentBodiesKeepTheirIndentationAndSurviveCRLF(t *testing.T) {
	body := []byte(`{"follow_up":{"id":1,"version":2,"repository":"a/b","number":9,"title":"x","url":"https://github.com/a/b/pull/9","state":"action","waiting_days":1},
		"comments":[{"author":"reviewer","body":"look here:\r\n\tindented example\u001b[2J","kind":"review","created_at":"2026-09-12T01:00:00Z"}],"total_comments":1}`)
	out := captureStdout(t, func() error { return printFollowUpDetail(body) })
	if !strings.Contains(out, "\tindented example") {
		t.Fatalf("the indentation of a quoted example was destroyed:\n%q", out)
	}
	if strings.ContainsRune(out, 0x1b) || strings.ContainsRune(out, '\r') {
		t.Fatalf("a control character reached the terminal:\n%q", out)
	}
}

func TestListFlagsSendTheOffsetToBothListings(t *testing.T) {
	for _, command := range []string{"followups", "prs"} {
		options, err := listFlags(command, []string{"--offset", "200"})
		if err != nil {
			t.Fatalf("%s refused an offset: %v", command, err)
		}
		if options.arguments["offset"] != 200 || options.offset != 200 {
			t.Fatalf("%s dropped the offset: %+v", command, options)
		}
	}
	if _, err := listFlags("repos", []string{"--offset", "10"}); err == nil {
		t.Fatal("a listing without paging accepted an offset")
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

// "interrupted" on its own still reads as something being wrong. It is not.
func TestPrintSyncStatusExplainsAnInterruptedRun(t *testing.T) {
	body := []byte(`{"status":"interrupted","error_code":"interrupted","reported_at":"2026-09-11T18:39:03Z","reported_age_minutes":2,"last_synced_at":"2026-09-11T18:27:07Z","stale_minutes":14,"baseline_complete":true}`)
	out := captureStdout(t, func() error { return printSyncStatus(body) })
	if !strings.Contains(out, "restarted") || !strings.Contains(out, "no cooldown") {
		t.Fatalf("an interrupted run was not explained:\n%s", out)
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
