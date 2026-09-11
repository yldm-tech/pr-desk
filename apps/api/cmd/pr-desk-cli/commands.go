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

func listFlags(name string, args []string) (map[string]any, bool, error) {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	state := flags.String("state", "", "action, waiting, follow_up, draft or archived")
	role := flags.String("role", "", "authored or reviewer")
	repo := flags.String("repo", "", "owner/name")
	query := flags.String("query", "", "match against the title")
	limit := flags.Int("limit", 0, "maximum rows")
	asJSON := flags.Bool("json", false, "print raw JSON")
	if err := flags.Parse(args); err != nil {
		return nil, false, err
	}
	arguments := map[string]any{}
	for key, value := range map[string]string{"state": *state, "role": *role, "repository": *repo, "query": *query} {
		if value != "" {
			arguments[key] = value
		}
	}
	if *limit > 0 {
		arguments["limit"] = *limit
	}
	return arguments, *asJSON, nil
}

func runList(command string, args []string) error {
	arguments, asJSON, err := listFlags(command, args)
	if err != nil {
		return err
	}
	stored, err := loadCredentials()
	if err != nil {
		return err
	}
	tool := map[string]string{"followups": "list_follow_ups", "prs": "list_pull_requests", "repos": "list_repositories", "summary": "get_follow_up_summary"}[command]
	if command == "repos" || command == "summary" {
		arguments = map[string]any{}
	}
	if command == "prs" {
		delete(arguments, "state")
		delete(arguments, "role")
	}
	body, err := callTool(stored, tool, arguments)
	if err != nil {
		return err
	}
	if asJSON {
		fmt.Println(string(body))
		return nil
	}
	switch command {
	case "followups":
		return printFollowUps(body)
	case "prs":
		return printPullRequests(body)
	case "repos":
		return printRepositories(body)
	default:
		return printSummary(body)
	}
}

func newTable() *tabwriter.Writer { return tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0) }

func truncate(value string, width int) string {
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	return string(runes[:width-1]) + "…"
}

func printFollowUps(body []byte) error {
	var payload struct {
		FollowUps []struct {
			ID          uint     `json:"id"`
			Version     uint64   `json:"version"`
			Repository  string   `json:"repository"`
			Number      int      `json:"number"`
			Title       string   `json:"title"`
			State       string   `json:"state"`
			Role        string   `json:"role"`
			Reasons     []string `json:"reasons"`
			Unread      bool     `json:"unread"`
			WaitingDays int      `json:"waiting_days"`
		} `json:"follow_ups"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if len(payload.FollowUps) == 0 {
		fmt.Println("Nothing is waiting for you.")
		return nil
	}
	table := newTable()
	fmt.Fprintln(table, "ID\tVERSION\tSTATE\tREPOSITORY\tPR\tWAITING\tREASONS\tTITLE")
	for _, row := range payload.FollowUps {
		title := truncate(row.Title, 48)
		if row.Unread {
			title = "* " + title
		}
		fmt.Fprintf(table, "%d\t%d\t%s\t%s\t#%d\t%dd\t%s\t%s\n", row.ID, row.Version, row.State, row.Repository, row.Number, row.WaitingDays, strings.Join(row.Reasons, ","), title)
	}
	if err := table.Flush(); err != nil {
		return err
	}
	if payload.Total > len(payload.FollowUps) {
		fmt.Printf("\nShowing %d of %d; pass --limit to see more.\n", len(payload.FollowUps), payload.Total)
	}
	return nil
}

func printPullRequests(body []byte) error {
	var payload struct {
		PullRequests []struct {
			Repository  string `json:"repository"`
			Number      int    `json:"number"`
			Title       string `json:"title"`
			State       string `json:"state"`
			ReviewState string `json:"review_state"`
			Draft       bool   `json:"draft"`
			Conflict    bool   `json:"conflict"`
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
	fmt.Fprintln(table, "REPOSITORY\tPR\tSTATE\tREVIEW\tFLAGS\tUPDATED\tTITLE")
	for _, row := range payload.PullRequests {
		flags := []string{}
		if row.Draft {
			flags = append(flags, "draft")
		}
		if row.Conflict {
			flags = append(flags, "conflict")
		}
		fmt.Fprintf(table, "%s\t#%d\t%s\t%s\t%s\t%s\t%s\n", row.Repository, row.Number, row.State, row.ReviewState, strings.Join(flags, ","), truncate(row.UpdatedAt, 10), truncate(row.Title, 48))
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
			Repository string `json:"repository"`
			Open       int    `json:"open"`
			Attention  int    `json:"needs_attention"`
			Conflicts  int    `json:"conflicts"`
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
	fmt.Fprintln(table, "REPOSITORY\tOPEN\tATTENTION\tCONFLICTS")
	for _, row := range payload.Repositories {
		fmt.Fprintf(table, "%s\t%d\t%d\t%d\n", row.Repository, row.Open, row.Attention, row.Conflicts)
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
		return fmt.Errorf("usage: pr-desk-cli %s <id> <version>%s (both come from the listing)", command, map[bool]string{true: " <days>"}[command == "snooze"])
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
	tool := map[string]string{"read": "mark_follow_up_read", "handled": "mark_follow_up_handled", "snooze": "snooze_follow_up"}[command]
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
