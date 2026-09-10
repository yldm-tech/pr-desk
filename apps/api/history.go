package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/cenkalti/backoff/v5"
	github "github.com/google/go-github/v68/github"
	"golang.org/x/time/rate"
	"log"
	"time"
)

// Share a conservative search budget across sessions; avoid bursts between partitions.
var historySearchLimiter = rate.NewLimiter(rate.Every(3*time.Second), 1)

// GitHub caps each search at 1000 results. Split creation-time intervals until each query fits, then paginate it completely. Intervals are inclusive seconds with no overlap. The SDK handles rate-limit waits and context cancellation.
func fetchHistory(ctx context.Context, gh *github.Client, query string, from, through time.Time) ([]*github.Issue, error) {
	ctx = context.WithValue(ctx, github.SleepUntilPrimaryRateLimitResetWhenRateLimited, true)
	from = from.UTC().Truncate(time.Second)
	through = through.UTC().Truncate(time.Second)
	items := []*github.Issue{}
	seen := map[string]bool{}
	expected := -1
	var fetch func(time.Time, time.Time) error
	fetch = func(start, end time.Time) error {
		q := fmt.Sprintf("%s created:%s..%s", query, start.Format(time.RFC3339), end.Format(time.RFC3339))
		options := &github.SearchOptions{Sort: "created", Order: "asc", ListOptions: github.ListOptions{PerPage: 100, Page: 1}}
		result, err := searchHistoryPage(ctx, gh, q, options)
		if err != nil {
			return err
		}
		if expected < 0 && result.Total != nil {
			expected = result.GetTotal()
			if p := historyTracker(ctx); p != nil {
				p.searchProgress(len(items), expected)
			}
		}
		if result.GetTotal() > 1000 || result.GetIncompleteResults() {
			seconds := int64(end.Sub(start) / time.Second)
			if seconds < 1 {
				return fmt.Errorf("GitHub search cannot completely resolve a one-second interval")
			}
			middle := start.Add(time.Duration(seconds/2) * time.Second)
			if err := fetch(start, middle); err != nil {
				return err
			}
			return fetch(middle.Add(time.Second), end)
		}
		total := result.GetTotal()
		received := 0
		for {
			if result.GetIncompleteResults() {
				return fmt.Errorf("GitHub returned incomplete history")
			}
			received += len(result.Issues)
			for _, item := range result.Issues {
				key := item.GetHTMLURL()
				if key == "" {
					key = fmt.Sprintf("%s/%d", item.GetRepositoryURL(), item.GetNumber())
				}
				if !seen[key] {
					seen[key] = true
					items = append(items, item)
				}
			}
			if p := historyTracker(ctx); p != nil {
				p.searchProgress(len(items), expected)
			}
			if len(items) > 0 && len(items)%1000 == 0 {
				log.Printf("GitHub history sync: collected %d records", len(items))
			}
			if len(result.Issues) < 100 || options.Page*100 >= total {
				break
			}
			options.Page++
			result, err = searchHistoryPage(ctx, gh, q, options)
			if err != nil {
				return err
			}
		}
		if received < total {
			return fmt.Errorf("GitHub returned fewer history records than advertised")
		}
		return nil
	}
	if err := fetch(from, through); err != nil {
		return nil, err
	}
	if expected >= 0 && len(items) != expected {
		return nil, fmt.Errorf("GitHub history count changed or contains gaps; retry sync")
	}
	return items, nil
}

// Secondary limits are distinct from permission errors. Retry the same page, preserving completed partitions; never retry ordinary authorization failures.
func searchHistoryPage(ctx context.Context, gh *github.Client, query string, options *github.SearchOptions) (*github.IssuesSearchResult, error) {
	attempt := 0
	return backoff.Retry(ctx, func() (*github.IssuesSearchResult, error) {
		attempt++
		if err := historySearchLimiter.Wait(ctx); err != nil {
			return nil, backoff.Permanent(err)
		}
		result, _, err := gh.Search.Issues(ctx, query, options)
		if err == nil {
			return result, nil
		}
		var limited *github.AbuseRateLimitError
		if !errors.As(err, &limited) || attempt >= 3 {
			return nil, backoff.Permanent(err)
		}
		wait := time.Minute * time.Duration(1<<(attempt-1))
		if limited.RetryAfter != nil {
			wait = *limited.RetryAfter
		}
		if p := historyTracker(ctx); p != nil {
			p.waiting(time.Now().Add(wait))
		}
		return nil, errors.Join(err, &backoff.RetryAfterError{Duration: wait})
	}, backoff.WithMaxTries(3), backoff.WithMaxElapsedTime(0))
}

// Re-read a day around the checkpoint for delayed search indexing. Open PRs are refreshed independently because check runs need not update issue dates.
func fetchSyncHistory(ctx context.Context, gh *github.Client, query string, from, through time.Time, since *time.Time) ([]*github.Issue, error) {
	if since == nil {
		return fetchHistory(ctx, gh, query, from, through)
	}
	updatedQuery := query + " updated:>=" + since.Add(-24*time.Hour).UTC().Format(time.RFC3339)
	changed, err := fetchHistory(ctx, gh, updatedQuery, from, through)
	if err != nil {
		return nil, err
	}
	if p := historyTracker(ctx); p != nil {
		p.beginOpenSearch(len(changed))
	}
	open, err := fetchHistory(ctx, gh, query+" state:open", from, through)
	if err != nil {
		return nil, err
	}
	if p := historyTracker(ctx); p != nil {
		p.summarize(len(changed), len(open))
	}
	seen := map[string]bool{}
	items := make([]*github.Issue, 0, len(changed)+len(open))
	// The later open snapshot wins for PRs reopened during the search.
	for _, batch := range [][]*github.Issue{open, changed} {
		for _, item := range batch {
			key := item.GetHTMLURL()
			if key == "" {
				key = fmt.Sprintf("%s/%d", item.GetRepositoryURL(), item.GetNumber())
			}
			if !seen[key] {
				seen[key] = true
				items = append(items, item)
			}
		}
	}
	return items, nil
}
