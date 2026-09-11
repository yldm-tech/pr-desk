package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"
)

// Each tool's schema rejects unknown fields outright, so a flag that does not
// apply is reported here rather than surfacing as a confusing server refusal.
var listCommands = map[string]struct {
	tool   string
	accept map[string]bool
}{
	"followups": {"list_follow_ups", map[string]bool{"state": true, "role": true, "repository": true, "reason": true, "checks": true, "conflict": true, "unread": true, "min_waiting_days": true, "sort": true, "limit": true}},
	"prs":       {"list_pull_requests", map[string]bool{"state": true, "role": true, "repository": true, "query": true, "checks": true, "conflict": true, "limit": true}},
	"repos":     {"list_repositories", map[string]bool{}},
	"summary":   {"get_follow_up_summary", map[string]bool{}},
	"sync":      {"get_sync_status", map[string]bool{}},
}

type listOptions struct {
	arguments map[string]any
	asJSON    bool
	showURL   bool
}

func listFlags(command string, args []string) (listOptions, error) {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	state := flags.String("state", "", "followups: action, waiting, follow_up, draft, archived; prs: open, closed, merged")
	role := flags.String("role", "", "authored or reviewer")
	repo := flags.String("repo", "", "owner/name")
	query := flags.String("query", "", "match against the title")
	reason := flags.String("reason", "", "checks_failed, conflict, human_feedback, review_requested, overdue, …")
	checks := flags.String("checks", "", "success, failure, pending, inconclusive or unknown")
	sortBy := flags.String("sort", "", "waiting for the longest wait first, or activity")
	minWaiting := flags.Int("min-waiting", 0, "only rows waiting at least this many days")
	limit := flags.Int("limit", 0, "maximum rows")
	conflict := flags.Bool("conflict", false, "only rows whose branch conflicts with its base")
	unread := flags.Bool("unread", false, "only rows with activity you have not read")
	showURL := flags.Bool("url", false, "add a column with the pull request URL")
	asJSON := flags.Bool("json", false, "print raw JSON")
	if err := flags.Parse(args); err != nil {
		return listOptions{}, err
	}
	arguments := map[string]any{}
	for key, value := range map[string]string{"state": *state, "role": *role, "repository": *repo, "query": *query, "reason": *reason, "checks": *checks, "sort": *sortBy} {
		if value != "" {
			arguments[key] = value
		}
	}
	if *limit > 0 {
		arguments["limit"] = *limit
	}
	if *minWaiting > 0 {
		arguments["min_waiting_days"] = *minWaiting
	}
	if *conflict {
		arguments["conflict"] = true
	}
	if *unread {
		arguments["unread"] = true
	}
	flagNames := map[string]string{"state": "--state", "role": "--role", "repository": "--repo", "query": "--query", "reason": "--reason", "checks": "--checks", "conflict": "--conflict", "sort": "--sort", "min_waiting_days": "--min-waiting", "unread": "--unread", "limit": "--limit"}
	accept := listCommands[command].accept
	for key := range arguments {
		if !accept[key] {
			return listOptions{}, fmt.Errorf("%s does not apply to: prdesk %s", flagNames[key], command)
		}
	}
	return listOptions{arguments: arguments, asJSON: *asJSON, showURL: *showURL}, nil
}

func runList(command string, args []string) error {
	options, err := listFlags(command, args)
	if err != nil {
		return err
	}
	stored, err := loadCredentials()
	if err != nil {
		return err
	}
	body, err := callTool(stored, listCommands[command].tool, options.arguments)
	if err != nil {
		return err
	}
	if options.asJSON {
		fmt.Println(string(body))
		return nil
	}
	switch command {
	case "followups":
		return printFollowUps(body, options.showURL)
	case "prs":
		return printPullRequests(body, options.showURL)
	case "repos":
		return printRepositories(body)
	case "sync":
		return printSyncStatus(body)
	default:
		return printSummary(body)
	}
}

// The timestamp is RFC3339; the table only has room for the date.
func dateOnly(timestamp string) string {
	if date, _, found := strings.Cut(timestamp, "T"); found {
		return date
	}
	return timestamp
}

func newTable() *tabwriter.Writer { return tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0) }

func truncate(value string, width int) string {
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	return string(runes[:width-1]) + "…"
}

type checkRow struct {
	Name       string `json:"name"`
	Conclusion string `json:"conclusion"`
	URL        string `json:"url"`
}

type followUpRow struct {
	ID            uint       `json:"id"`
	Version       uint64     `json:"version"`
	Repository    string     `json:"repository"`
	Number        int        `json:"number"`
	Title         string     `json:"title"`
	URL           string     `json:"url"`
	Author        string     `json:"author"`
	State         string     `json:"state"`
	Role          string     `json:"role"`
	Reasons       []string   `json:"reasons"`
	Unread        bool       `json:"unread"`
	Draft         bool       `json:"draft"`
	Conflict      bool       `json:"conflict"`
	Checks        string     `json:"checks"`
	FailingChecks []checkRow `json:"failing_checks"`
	ReviewState   string     `json:"review_state"`
	Excerpt       string     `json:"excerpt"`
	WaitingDays   int        `json:"waiting_days"`
	SnoozedUntil  string     `json:"snoozed_until"`
	UpdatedAt     string     `json:"updated_at"`
}

func printFollowUps(body []byte, showURL bool) error {
	var payload struct {
		FollowUps []followUpRow `json:"follow_ups"`
		Total     int           `json:"total"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if len(payload.FollowUps) == 0 {
		fmt.Println("Nothing is waiting for you.")
		return nil
	}
	table := newTable()
	header := "ID\tVERSION\tSTATE\tREPOSITORY\tPR\tWAITING\tREASONS\tTITLE"
	if showURL {
		header += "\tURL"
	}
	fmt.Fprintln(table, header)
	for _, row := range payload.FollowUps {
		title := truncate(row.Title, 48)
		if row.Unread {
			title = "* " + title
		}
		fmt.Fprintf(table, "%d\t%d\t%s\t%s\t#%d\t%dd\t%s\t%s", row.ID, row.Version, row.State, row.Repository, row.Number, row.WaitingDays, strings.Join(row.Reasons, ","), title)
		if showURL {
			fmt.Fprintf(table, "\t%s", row.URL)
		}
		fmt.Fprintln(table)
	}
	if err := table.Flush(); err != nil {
		return err
	}
	if payload.Total > len(payload.FollowUps) {
		fmt.Printf("\nShowing %d of %d; pass --limit to see more.\n", len(payload.FollowUps), payload.Total)
	}
	return nil
}

func printPullRequests(body []byte, showURL bool) error {
	var payload struct {
		PullRequests []struct {
			Repository  string `json:"repository"`
			Number      int    `json:"number"`
			Title       string `json:"title"`
			URL         string `json:"url"`
			State       string `json:"state"`
			ReviewState string `json:"review_state"`
			Checks      string `json:"checks"`
			Draft       bool   `json:"draft"`
			Conflict    bool   `json:"conflict"`
			Merged      bool   `json:"merged"`
			UpdatedAt   string `json:"updated_at"`
		} `json:"pull_requests"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if len(payload.PullRequests) == 0 {
		fmt.Println("No pull requests match.")
		return nil
	}
	table := newTable()
	header := "REPOSITORY\tPR\tSTATE\tREVIEW\tCHECKS\tFLAGS\tUPDATED\tTITLE"
	if showURL {
		header += "\tURL"
	}
	fmt.Fprintln(table, header)
	for _, row := range payload.PullRequests {
		flags := []string{}
		if row.Draft {
			flags = append(flags, "draft")
		}
		if row.Conflict {
			flags = append(flags, "conflict")
		}
		if row.Merged {
			flags = append(flags, "merged")
		}
		fmt.Fprintf(table, "%s\t#%d\t%s\t%s\t%s\t%s\t%s\t%s", row.Repository, row.Number, row.State, row.ReviewState, row.Checks, strings.Join(flags, ","), dateOnly(row.UpdatedAt), truncate(row.Title, 48))
		if showURL {
			fmt.Fprintf(table, "\t%s", row.URL)
		}
		fmt.Fprintln(table)
	}
	if err := table.Flush(); err != nil {
		return err
	}
	if payload.Total > len(payload.PullRequests) {
		fmt.Printf("\nShowing %d of %d; pass --limit to see more.\n", len(payload.PullRequests), payload.Total)
	}
	return nil
}

func printRepositories(body []byte) error {
	var payload struct {
		Repositories []struct {
			Repository    string `json:"repository"`
			Open          int    `json:"open"`
			Attention     int    `json:"needs_attention"`
			Conflicts     int    `json:"conflicts"`
			ChecksFailing int    `json:"checks_failing"`
		} `json:"repositories"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if len(payload.Repositories) == 0 {
		fmt.Println("No repositories are tracked yet.")
		return nil
	}
	table := newTable()
	fmt.Fprintln(table, "REPOSITORY\tOPEN\tATTENTION\tCONFLICTS\tFAILING")
	for _, row := range payload.Repositories {
		fmt.Fprintf(table, "%s\t%d\t%d\t%d\t%d\n", row.Repository, row.Open, row.Attention, row.Conflicts, row.ChecksFailing)
	}
	return table.Flush()
}

func printSummary(body []byte) error {
	var payload struct {
		NeedsAction   int  `json:"needs_action"`
		AwaitingOther int  `json:"awaiting_others"`
		TimeToFollow  int  `json:"time_to_follow_up"`
		Drafts        int  `json:"drafts"`
		Unread        int  `json:"unread"`
		Baseline      bool `json:"baseline_complete"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	table := newTable()
	fmt.Fprintf(table, "Needs your action\t%d\n", payload.NeedsAction)
	fmt.Fprintf(table, "Waiting on others\t%d\n", payload.AwaitingOther)
	fmt.Fprintf(table, "Ready to follow up\t%d\n", payload.TimeToFollow)
	fmt.Fprintf(table, "Drafts\t%d\n", payload.Drafts)
	fmt.Fprintf(table, "Unread\t%d\n", payload.Unread)
	if err := table.Flush(); err != nil {
		return err
	}
	if !payload.Baseline {
		fmt.Println("\nThe first inventory is still syncing, so an empty list is not conclusive yet.")
	}
	return nil
}

func printSyncStatus(body []byte) error {
	var payload struct {
		Status         string `json:"status"`
		Phase          string `json:"phase"`
		Completed      int    `json:"completed"`
		Total          int    `json:"total"`
		ReportedAt     string `json:"reported_at"`
		ReportedAgeMin int    `json:"reported_age_minutes"`
		LastSyncedAt   string `json:"last_synced_at"`
		StaleMinutes   int    `json:"stale_minutes"`
		NextAutoSyncAt string `json:"next_auto_sync_at"`
		Baseline       bool   `json:"baseline_complete"`
		ErrorCode      string `json:"error_code"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	table := newTable()
	status := payload.Status
	if payload.ReportedAt != "" {
		status += fmt.Sprintf("  (reported %s ago)", humanMinutes(payload.ReportedAgeMin))
	}
	fmt.Fprintf(table, "Status\t%s\n", status)
	if payload.Total > 0 {
		fmt.Fprintf(table, "Progress\t%s %d/%d\n", payload.Phase, payload.Completed, payload.Total)
	}
	if payload.LastSyncedAt == "" {
		fmt.Fprintln(table, "Last synced\tnever")
	} else {
		fmt.Fprintf(table, "Last synced\t%s (%s ago)\n", payload.LastSyncedAt, humanMinutes(payload.StaleMinutes))
	}
	if payload.NextAutoSyncAt != "" {
		fmt.Fprintf(table, "Next automatic sync\t%s\n", payload.NextAutoSyncAt)
	}
	if err := table.Flush(); err != nil {
		return err
	}
	if payload.ErrorCode == "reconnect" {
		fmt.Println("\nThe GitHub authorization lapsed; nothing will refresh until the account reconnects in the browser.")
	}
	if !payload.Baseline {
		fmt.Println("\nThe first inventory is still importing, so an empty list is not conclusive yet.")
	}
	return nil
}

func humanMinutes(minutes int) string {
	if minutes < 60 {
		return fmt.Sprintf("%dm", minutes)
	}
	if minutes < 60*24 {
		return fmt.Sprintf("%dh%dm", minutes/60, minutes%60)
	}
	return fmt.Sprintf("%dd%dh", minutes/(60*24), (minutes%(60*24))/60)
}

func runShow(args []string) error {
	flags := flag.NewFlagSet("show", flag.ContinueOnError)
	comments := flags.Int("comments", 0, "how many recent comments to print (default 20)")
	asJSON := flags.Bool("json", false, "print raw JSON")
	if err := flags.Parse(args); err != nil {
		return err
	}
	rest := flags.Args()
	if len(rest) < 1 {
		return errors.New("usage: prdesk show <id> (the identifier comes from the listing)")
	}
	id, err := strconv.ParseUint(rest[0], 10, 64)
	if err != nil {
		return errors.New("the identifier has to be a number")
	}
	arguments := map[string]any{"id": id}
	if *comments != 0 {
		arguments["comments"] = *comments
	}
	stored, err := loadCredentials()
	if err != nil {
		return err
	}
	body, err := callTool(stored, "get_follow_up", arguments)
	if err != nil {
		return err
	}
	if *asJSON {
		fmt.Println(string(body))
		return nil
	}
	return printFollowUpDetail(body)
}

func printFollowUpDetail(body []byte) error {
	var payload struct {
		FollowUp followUpRow `json:"follow_up"`
		Comments []struct {
			Author    string `json:"author"`
			Body      string `json:"body"`
			URL       string `json:"url"`
			Kind      string `json:"kind"`
			CreatedAt string `json:"created_at"`
		} `json:"comments"`
		Total int `json:"total_comments"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	row := payload.FollowUp
	fmt.Printf("%s #%d  %s\n%s\n\n", row.Repository, row.Number, row.Title, row.URL)
	table := newTable()
	fmt.Fprintf(table, "State\t%s\n", row.State)
	fmt.Fprintf(table, "Role\t%s\n", row.Role)
	if row.Author != "" {
		fmt.Fprintf(table, "Author\t%s\n", row.Author)
	}
	fmt.Fprintf(table, "Waiting\t%d days\n", row.WaitingDays)
	if len(row.Reasons) > 0 {
		fmt.Fprintf(table, "Reasons\t%s\n", strings.Join(row.Reasons, ", "))
	}
	if row.ReviewState != "" {
		fmt.Fprintf(table, "Review\t%s\n", row.ReviewState)
	}
	if row.Checks != "" {
		fmt.Fprintf(table, "Checks\t%s\n", row.Checks)
	}
	flags := []string{}
	if row.Draft {
		flags = append(flags, "draft")
	}
	if row.Conflict {
		flags = append(flags, "conflict")
	}
	if row.Unread {
		flags = append(flags, "unread")
	}
	if len(flags) > 0 {
		fmt.Fprintf(table, "Flags\t%s\n", strings.Join(flags, ", "))
	}
	if row.SnoozedUntil != "" {
		fmt.Fprintf(table, "Snoozed until\t%s\n", row.SnoozedUntil)
	}
	fmt.Fprintf(table, "Mark it with\tprdesk handled %d %d\n", row.ID, row.Version)
	if err := table.Flush(); err != nil {
		return err
	}
	// Naming the runs is the point: a cancelled or superseded check reads as red
	// on GitHub but says nothing about the code.
	if len(row.FailingChecks) > 0 {
		fmt.Println("\nChecks not passing:")
		checks := newTable()
		for _, check := range row.FailingChecks {
			fmt.Fprintf(checks, "  %s\t%s\t%s\n", check.Conclusion, truncate(check.Name, 44), check.URL)
		}
		if err := checks.Flush(); err != nil {
			return err
		}
	}
	if len(payload.Comments) == 0 {
		return nil
	}
	fmt.Printf("\nComments (%d of %d stored, newest first):\n", len(payload.Comments), payload.Total)
	for _, comment := range payload.Comments {
		fmt.Printf("\n  %s  %s  [%s]\n", comment.Author, dateOnly(comment.CreatedAt), comment.Kind)
		for _, line := range strings.Split(strings.TrimRight(comment.Body, "\n"), "\n") {
			fmt.Printf("  | %s\n", line)
		}
	}
	return nil
}

func runAction(command string, args []string) error {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		return err
	}
	rest := flags.Args()
	needed := 2
	if command == "snooze" {
		needed = 3
	}
	if len(rest) < needed {
		return fmt.Errorf("usage: prdesk %s <id> <version>%s (both come from the listing)", command, map[bool]string{true: " <days>"}[command == "snooze"])
	}
	id, err := strconv.ParseUint(rest[0], 10, 64)
	if err != nil {
		return errors.New("the identifier has to be a number")
	}
	version, err := strconv.ParseUint(rest[1], 10, 64)
	if err != nil {
		return errors.New("the version has to be a number; copy it from the listing")
	}
	arguments := map[string]any{"id": id, "version": version}
	tool := map[string]string{"read": "mark_follow_up_read", "handled": "mark_follow_up_handled", "snooze": "snooze_follow_up", "unsnooze": "unsnooze_follow_up"}[command]
	if command == "snooze" {
		days, err := strconv.Atoi(rest[2])
		if err != nil || days < 1 || days > 365 {
			return errors.New("choose between 1 and 365 days")
		}
		arguments["days"] = days
	}
	stored, err := loadCredentials()
	if err != nil {
		return err
	}
	if _, err := callTool(stored, tool, arguments); err != nil {
		return err
	}
	fmt.Println("Done.")
	return nil
}
