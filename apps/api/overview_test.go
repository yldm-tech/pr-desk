package main

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOverviewIncludesOutcomesAndIsolatesSession(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&OAuthToken{SessionID: "overview"}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	old := now.AddDate(-2, 0, 0)
	rows := []PullRequest{{SessionID: "overview", Repo: "org/a", State: "open"}, {SessionID: "overview", Repo: "org/a", State: "closed", MergedAt: &now}, {SessionID: "overview", Repo: "org/b", State: "closed"}, {SessionID: "overview", Repo: "org/b", State: "closed", MergedAt: &old}, {SessionID: "other", Repo: "private/other", State: "open"}}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	s := &Server{db: db}
	r.GET("/overview", s.overview)
	for _, sid := range []string{"overview", "unknown"} {
		req := httptest.NewRequest("GET", "/overview", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: sid})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var result struct {
			Summary      overviewSummary
			Repositories []overviewRepository
			Months       []overviewMonth
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 {
			t.Fatalf("status %d", w.Code)
		}
		if len(result.Months) != 13 {
			t.Fatal("missing zero-filled months")
		}
		if sid == "unknown" {
			if result.Summary.Total != 0 || len(result.Repositories) != 0 {
				t.Fatal("cross-session data leak")
			}
			continue
		}
		if result.Summary != (overviewSummary{Total: 4, Merged: 2, Open: 1, Closed: 1, Repositories: 2}) {
			t.Fatalf("incorrect totals: %+v", result.Summary)
		}
		if len(result.Repositories) != 2 || result.Repositories[0].Repo != "org/a" || result.Repositories[0].Total != 2 {
			t.Fatal("incorrect repository aggregation")
		}
		var monthly int64
		for _, m := range result.Months {
			monthly += m.Merged
		}
		if monthly != 1 {
			t.Fatalf("incorrect date window: %d", monthly)
		}
	}
}

func TestOverviewYearFiltersAllSections(t *testing.T) {
	db := integrationDB(t)
	accountCreated := time.Date(2015, 5, 27, 0, 0, 0, 0, time.UTC)
	db.Create(&OAuthToken{SessionID: "years", GitHubCreatedAt: &accountCreated})
	year := time.Now().UTC().Year()
	now := time.Date(year, 3, 1, 0, 0, 0, 0, time.UTC)
	before := now.AddDate(-1, 0, 0)
	db.Create(&[]PullRequest{{SessionID: "years", Repo: "current/repo", State: "closed", MergedAt: &now}, {SessionID: "years", Repo: "old/repo", State: "closed", MergedAt: &before}, {SessionID: "years", Repo: "old/open", State: "open", UpdatedAt: before}})
	r := gin.New()
	s := &Server{db: db}
	r.GET("/overview", s.overview)
	for _, target := range []int{year, year - 1} {
		req := httptest.NewRequest("GET", fmt.Sprintf("/overview?year=%d", target), nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "years"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Summary      overviewSummary
			Months       []overviewMonth
			Repositories []overviewRepository
			Year         int
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		want := int64(1)
		if target == year-1 {
			want = 2
		}
		if w.Code != 200 || body.Year != target || body.Summary.Total != want || int64(len(body.Repositories)) != want {
			t.Fatalf("year %d: %s", target, w.Body.String())
		}
		start, end := overviewPeriod(target, time.Now().UTC())
		expectedMonths := 12
		if target == year {
			expectedMonths = 13
		}
		if len(body.Months) != expectedMonths || body.Months[0].Month != start.Format("2006-01") || body.Months[len(body.Months)-1].Month != end.AddDate(0, -1, 0).Format("2006-01") {
			t.Fatal("incorrect overview period")
		}
	}
	req := httptest.NewRequest("GET", "/overview", nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "years"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var rangeResult struct {
		Years           []int
		HistoryComplete bool `json:"history_complete"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &rangeResult); err != nil {
		t.Fatal(err)
	}
	if len(rangeResult.Years) != year-2015+1 || rangeResult.Years[len(rangeResult.Years)-1] != 2015 || rangeResult.HistoryComplete {
		t.Fatal("account age or pending history status incorrect")
	}
	for _, invalid := range []string{"oops", "1999", "9999"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/overview?year="+invalid, nil))
		if w.Code != 400 {
			t.Fatal("invalid year accepted")
		}
	}
}

func TestOverviewRepositoryDistributionIncludesEveryRepository(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&OAuthToken{SessionID: "distribution"}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	rows := []PullRequest{}
	for i := 0; i < 12; i++ {
		rows = append(rows, PullRequest{SessionID: "distribution", Repo: fmt.Sprintf("org/repo-%02d", i), State: "open", PRCreatedAt: &now})
	}
	rows = append(rows, PullRequest{SessionID: "distribution", Repo: "org/repo-00", State: "closed", MergedAt: &now})
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	s := &Server{db: db}
	r.GET("/overview", s.overview)
	req := httptest.NewRequest("GET", fmt.Sprintf("/overview?year=%d", now.Year()), nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "distribution"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var body struct {
		Summary      overviewSummary
		Repositories []overviewRepository
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(body.Repositories) != 12 {
		t.Fatalf("repository distribution truncated: %s", w.Body.String())
	}
	var total int64
	for _, repo := range body.Repositories {
		total += repo.Total
	}
	if total != body.Summary.Total || total != 13 || body.Repositories[0].Total != 2 {
		t.Fatalf("distribution denominator mismatch: %s", w.Body.String())
	}
}

func TestOverviewVisibilityFiltersAllSections(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "visibility"})
	now := time.Now().UTC()
	public, private := false, true
	db.Create(&[]PullRequest{
		{SessionID: "visibility", Repo: "org/public", State: "closed", MergedAt: &now, RepoPrivate: &public},
		{SessionID: "visibility", Repo: "org/public", State: "closed", MergedAt: &now, RepoPrivate: &public},
		{SessionID: "visibility", Repo: "org/private", State: "closed", MergedAt: &now, RepoPrivate: &private},
	})
	r := gin.New()
	s := &Server{db: db}
	r.GET("/overview", s.overview)
	for _, scope := range []string{"all", "public", "private"} {
		req := httptest.NewRequest("GET", fmt.Sprintf("/overview?year=%d&visibility=%s", now.Year(), scope), nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "visibility"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			VisibilityCounts struct {
				Public, Private, Unknown int64
				PublicRepositories       int64 `json:"public_repositories"`
				PrivateRepositories      int64 `json:"private_repositories"`
				UnknownRepositories      int64 `json:"unknown_repositories"`
			} `json:"visibility_counts"`
			Summary      overviewSummary
			Repositories []overviewRepository
			Months       []overviewMonth
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.VisibilityCounts.Public != 2 || body.VisibilityCounts.Private != 1 || body.VisibilityCounts.Unknown != 0 {
			t.Fatal("scope counts must describe both ranges")
		}
		if body.VisibilityCounts.PublicRepositories != 1 || body.VisibilityCounts.PrivateRepositories != 1 || body.VisibilityCounts.UnknownRepositories != 0 {
			t.Fatal("repository counts must deduplicate PRs")
		}
		want := int64(3)
		wantRepos := int64(2)
		if scope == "public" {
			want = 2
			wantRepos = 1
		}
		if scope == "private" {
			want = 1
			wantRepos = 1
		}
		var merged int64
		for _, month := range body.Months {
			merged += month.Merged
		}
		if w.Code != 200 || body.Summary.Total != want || int64(len(body.Repositories)) != wantRepos || merged != want {
			t.Fatalf("incorrect visibility scope: %s", w.Body.String())
		}
		if scope == "private" && body.Repositories[0].Repo != "org/private" {
			t.Fatal("public repository leaked into private scope")
		}
		if scope == "public" && body.Repositories[0].Repo != "org/public" {
			t.Fatal("private repository leaked into public scope")
		}
	}
}

func TestOverviewPeriodBoundaries(t *testing.T) {
	for _, month := range []time.Month{time.January, time.September, time.December} {
		now := time.Date(2026, month, 10, 12, 0, 0, 0, time.UTC)
		start, end := overviewPeriod(2026, now)
		if start != time.Date(2025, month, 1, 0, 0, 0, 0, time.UTC) || end != time.Date(2026, month+1, 1, 0, 0, 0, 0, time.UTC) {
			t.Fatal("rolling boundaries incorrect")
		}
		months := 0
		for cursor := start; cursor.Before(end); cursor = cursor.AddDate(0, 1, 0) {
			months++
		}
		if months != 13 {
			t.Fatal("both endpoint months must be included")
		}
		start, end = overviewPeriod(2025, now)
		if start.Month() != time.January || start.Year() != 2025 || end.Year() != 2026 || end.Month() != time.January {
			t.Fatal("historical year changed")
		}
	}
}

func TestCurrentYearIncludesPreviousSameMonthAndExcludesOutsideWindow(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "rolling"})
	now := time.Now().UTC()
	start, end := overviewPeriod(now.Year(), now)
	before := start.Add(-time.Second)
	currentMonth := end.AddDate(0, -1, 0)
	public := false
	db.Create(&[]PullRequest{
		{SessionID: "rolling", Repo: "org/before", State: "closed", MergedAt: &before, RepoPrivate: &public},
		{SessionID: "rolling", Repo: "org/start", State: "closed", MergedAt: &start, RepoPrivate: &public},
		{SessionID: "rolling", Repo: "org/current", State: "closed", MergedAt: &currentMonth, RepoPrivate: &public},
		{SessionID: "rolling", Repo: "org/open", State: "open", PRCreatedAt: &start, RepoPrivate: &public},
		{SessionID: "rolling", Repo: "org/after", State: "closed", MergedAt: &end, RepoPrivate: &public},
	})
	r := gin.New()
	s := &Server{db: db}
	r.GET("/overview", s.overview)
	req := httptest.NewRequest("GET", fmt.Sprintf("/overview?year=%d&visibility=public", now.Year()), nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "rolling"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var result struct {
		Summary          overviewSummary
		Repositories     []overviewRepository
		Months           []overviewMonth
		VisibilityCounts struct {
			Public             int64
			PublicRepositories int64 `json:"public_repositories"`
		} `json:"visibility_counts"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || result.Summary.Total != 3 || result.Summary.Merged != 2 || len(result.Repositories) != 3 || result.VisibilityCounts.Public != 3 || result.VisibilityCounts.PublicRepositories != 3 {
		t.Fatalf("inconsistent range: %s", w.Body.String())
	}
	if len(result.Months) != 13 || result.Months[0].Merged != 1 || result.Months[12].Merged != 1 {
		t.Fatal("same month endpoints not included")
	}
}

func TestTrendRepositoryFilterKeepsSummaryAndVisibility(t *testing.T) {
	db := integrationDB(t)
	db.Create(&OAuthToken{SessionID: "trend-repos"})
	now := time.Now().UTC()
	public, private := false, true
	db.Create(&[]PullRequest{
		{SessionID: "trend-repos", Repo: "org/a", State: "closed", MergedAt: &now, RepoPrivate: &public},
		{SessionID: "trend-repos", Repo: "org/b", State: "closed", MergedAt: &now, RepoPrivate: &public},
		{SessionID: "trend-repos", Repo: "org/secret", State: "closed", MergedAt: &now, RepoPrivate: &private},
	})
	r := gin.New()
	s := &Server{db: db}
	r.GET("/overview", s.overview)
	for _, tc := range []struct {
		scope, repo    string
		summary, trend int64
	}{{"public", "org/a", 2, 1}, {"public", "org/secret", 2, 0}, {"private", "org/a", 1, 0}, {"private", "org/secret", 1, 1}} {
		req := httptest.NewRequest("GET", fmt.Sprintf("/overview?year=%d&visibility=%s&trend_repo=%s", now.Year(), tc.scope, tc.repo), nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "trend-repos"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Summary overviewSummary
			Months  []overviewMonth
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		var total int64
		for _, month := range body.Months {
			total += month.Merged
		}
		if w.Code != 200 || body.Summary.Total != tc.summary || total != tc.trend {
			t.Fatalf("scope=%s repo=%s summary=%d trend=%d", tc.scope, tc.repo, body.Summary.Total, total)
		}
	}
}

// The repositories table reported conflicts but left a red branch to be counted
// by hand, which is the one number it shares with the MCP tool. Its scope stays
// deliberately narrower than that tool: pull requests this account authored.
func TestRepositorySummaryCountsFailingChecks(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&OAuthToken{SessionID: "repo-checks"}).Error; err != nil {
		t.Fatal(err)
	}
	rows := []PullRequest{
		{SessionID: "repo-checks", Repo: "org/a", State: "open", Role: "authored", ChecksStatus: "failure"},
		// GitHub's own wording for the same thing, stored before checkSummary
		// folded it into failure.
		{SessionID: "repo-checks", Repo: "org/a", State: "open", Role: "authored", ChecksStatus: "error"},
		{SessionID: "repo-checks", Repo: "org/a", State: "open", Role: "authored", ChecksStatus: "success"},
		// Red, but somebody else's: out of scope for this endpoint by design.
		{SessionID: "repo-checks", Repo: "org/a", State: "open", Role: "reviewer", ChecksStatus: "failure"},
		{SessionID: "repo-checks", Repo: "org/b", State: "open", Role: "authored", ChecksStatus: "inconclusive"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.GET("/repositories", (&Server{db: db}).repositories)
	req := httptest.NewRequest("GET", "/repositories", nil)
	req.AddCookie(&http.Cookie{Name: "pr_session", Value: "repo-checks"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	var result struct {
		Data []struct {
			Repo          string `json:"repo"`
			Open          int    `json:"open"`
			ChecksFailing int    `json:"checks_failing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	byRepo := map[string]int{}
	open := map[string]int{}
	for _, row := range result.Data {
		byRepo[row.Repo] = row.ChecksFailing
		open[row.Repo] = row.Open
	}
	if byRepo["org/a"] != 2 {
		t.Fatalf("org/a reports %d failing, wanted the failure and the error: %+v", byRepo["org/a"], result.Data)
	}
	if open["org/a"] != 3 {
		t.Fatalf("org/a counts %d open, so the authored-only scope moved: %+v", open["org/a"], result.Data)
	}
	// inconclusive means nothing is known to be broken and must not be counted.
	if byRepo["org/b"] != 0 {
		t.Fatalf("a cancelled run was counted as a failure: %+v", result.Data)
	}
}
