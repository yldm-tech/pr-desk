// Command prdesk reads a PR Desk account from the terminal and gives an
// agent a scriptable way in. It authenticates with the same authorization code
// flow a browser would use, keeping the GitHub credentials inside the server.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
)

// Set by the release build. A binary built straight from a checkout reports
// "dev", which is the honest answer for one that no release produced.
var version = "dev"

const usage = `prdesk — read and act on your PR Desk follow-ups

Usage:
  prdesk login [--host URL] [--write]   authorize this machine in the browser
  prdesk logout                         forget the stored token
  prdesk status                         show who is signed in
  prdesk followups [filters]            list tracked pull requests needing attention
  prdesk show <id> [--comments N]       one follow-up in full, with its comment thread
  prdesk prs [filters]                  search synchronized pull requests
  prdesk repos                          per-repository counts
  prdesk summary                        counts by follow-up state
  prdesk sync                           how fresh the synchronized data is
  prdesk read <id> <version>            mark a follow-up read
  prdesk handled <id> <version>         mark a follow-up handled
  prdesk snooze <id> <version> <days>   stop reminders for a while
  prdesk unsnooze <id> <version>        let a snoozed follow-up surface again
  prdesk update [--check]               replace this binary with the latest release
  prdesk version                        print the version of this binary

Filters for followups:
  --state action|waiting|follow_up|draft|archived
  --role authored|reviewer
  --repo owner/name
  --reason checks_failed|conflict|human_feedback|review_requested|overdue|…
  --checks success|failure|pending|inconclusive|unknown
  --conflict          only rows whose branch conflicts with its base
  --unread            only rows with activity you have not read
  --min-waiting N     only rows waiting at least N days
  --sort waiting      longest wait first (default: by state, then activity)
  --limit N

Filters for prs:
  --state open|closed|merged
  --role authored|reviewer
  --repo owner/name
  --query text
  --checks success|failure|pending|inconclusive|unknown
  --conflict          only rows whose branch conflicts with its base
  --limit N

Global:
  --json              print raw JSON instead of a table
  --url               add the pull request URL to the table

A checks state of "inconclusive" means nothing failed: every run that did not
pass was cancelled or superseded. Use show to see which runs those were.

The checks_failed and conflict reasons are raised only on pull requests you
authored, because a red branch on somebody else's pull request is not yours to
fix. To see every failing branch whatever your role, filter on the state
itself: prdesk prs --state open --checks failure.

The identifier and version come from the listing; passing a stale version is
refused so that nothing is marked away after new activity arrived.
`

func main() { os.Exit(dispatch(os.Args[1:])) }

// Split from main so the exit status of a command is something a test can read.
func dispatch(arguments []string) int {
	if len(arguments) < 1 {
		fmt.Print(usage)
		return 2
	}
	command, args := arguments[0], arguments[1:]
	var err error
	switch command {
	case "login":
		err = runLogin(args)
	case "logout":
		err = runLogout()
	case "status":
		err = runStatus(args)
	case "followups", "prs", "repos", "summary", "sync":
		err = runList(command, args)
	case "show":
		err = runShow(args)
	case "read", "handled", "snooze", "unsnooze":
		err = runAction(command, args)
	case "update":
		err = runUpdate(args)
	case "version", "--version":
		fmt.Println(version)
		return 0
	case "help", "-h", "--help":
		fmt.Print(usage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", command, usage)
		return 2
	}
	// Asking a subcommand for help is not a failure: the flag list has already been printed on stdout, so saying "error:" here and exiting non-zero would abort any wrapper script that runs under set -e.
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error: "+err.Error())
		return 1
	}
	return 0
}
