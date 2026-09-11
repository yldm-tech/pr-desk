// Command prdesk reads a PR Desk account from the terminal and gives an
// agent a scriptable way in. It authenticates with the same authorization code
// flow a browser would use, keeping the GitHub credentials inside the server.
package main

import (
	"fmt"
	"os"
)

const usage = `prdesk — read and act on your PR Desk follow-ups

Usage:
  prdesk login [--host URL] [--write]   authorize this machine in the browser
  prdesk logout                         forget the stored token
  prdesk status                         show who is signed in
  prdesk followups [filters]            list tracked pull requests needing attention
  prdesk prs [filters]                  search synchronized pull requests
  prdesk repos                          per-repository counts
  prdesk summary                        counts by follow-up state
  prdesk read <id> <version>            mark a follow-up read
  prdesk handled <id> <version>         mark a follow-up handled
  prdesk snooze <id> <version> <days>   stop reminders for a while

Filters:
  --state action|waiting|follow_up|draft|archived
  --role authored|reviewer
  --repo owner/name
  --query text        (prs only)
  --limit N

Global:
  --json              print raw JSON instead of a table
  --host URL          server to talk to (default: stored host, then http://localhost:8080)

The identifier and version come from the listing; passing a stale version is
refused so that nothing is marked away after new activity arrived.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(2)
	}
	command, args := os.Args[1], os.Args[2:]
	var err error
	switch command {
	case "login":
		err = runLogin(args)
	case "logout":
		err = runLogout()
	case "status":
		err = runStatus(args)
	case "followups", "prs", "repos", "summary":
		err = runList(command, args)
	case "read", "handled", "snooze":
		err = runAction(command, args)
	case "help", "-h", "--help":
		fmt.Print(usage)
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", command, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error: "+err.Error())
		os.Exit(1)
	}
}
