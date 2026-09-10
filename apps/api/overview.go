package main

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"strconv"
	"time"
)

type overviewSummary struct {
	Total        int64 `json:"total"`
	Merged       int64 `json:"merged"`
	Open         int64 `json:"open"`
	Closed       int64 `json:"closed"`
	Repositories int64 `json:"repositories"`
}
type overviewRepository struct {
	Repo   string `json:"repo"`
	Total  int64  `json:"total"`
	Merged int64  `json:"merged"`
}
type overviewMonth struct {
	Month  string `json:"month"`
	Merged int64  `json:"merged"`
}

// The current-year view includes the same month last year through this month. Historical years keep their January–December boundaries.
func overviewPeriod(year int, now time.Time) (time.Time, time.Time) {
	now = now.UTC()
	if year == now.Year() {
		start := time.Date(year-1, now.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start, time.Date(year, now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	return start, start.AddDate(1, 0, 0)
}

func (s *Server) overview(c *gin.Context) {
	now := time.Now().UTC()
	visibility := c.DefaultQuery("visibility", "all")
	if visibility != "all" && visibility != "public" && visibility != "private" {
		c.JSON(400, gin.H{"error": "Invalid visibility"})
		return
	}
	if c.Query("visibility") != "" {
		if err := s.ensureRepositoryVisibility(c); err != nil {
			c.JSON(502, gin.H{"error": "Unable to verify repository visibility; retry"})
			return
		}
	}
	scope := func() *gorm.DB {
		q := sessionPRQuery(c, s.db).Model(&PullRequest{})
		if visibility == "public" || visibility == "private" {
			q = q.Where("repo_private = ?", visibility == "private")
		}
		return q
	}
	year := now.Year()
	scoped := c.Query("year") != ""
	if scoped {
		parsed, err := strconv.Atoi(c.Query("year"))
		if err != nil || parsed < 2008 || parsed > now.Year() {
			c.JSON(400, gin.H{"error": "Invalid overview year"})
			return
		}
		year = parsed
	}
	start, end := overviewPeriod(year, now)
	base := func() *gorm.DB {
		q := scope()
		if scoped {
			q = q.Where("COALESCE(merged_at, pr_created_at, updated_at) >= ? AND COALESCE(merged_at, pr_created_at, updated_at) < ?", start, end)
		}
		return q
	}
	var visibilityCounts struct {
		PublicRepositories  int64 `json:"public_repositories"`
		PrivateRepositories int64 `json:"private_repositories"`
		UnknownRepositories int64 `json:"unknown_repositories"`
		Public              int64 `json:"public"`
		Private             int64 `json:"private"`
		Unknown             int64 `json:"unknown"`
	}
	countsQuery := sessionPRQuery(c, s.db).Model(&PullRequest{})
	if scoped {
		countsQuery = countsQuery.Where("COALESCE(merged_at, pr_created_at, updated_at) >= ? AND COALESCE(merged_at, pr_created_at, updated_at) < ?", start, end)
	}
	if err := countsQuery.Select("COUNT(*) FILTER (WHERE repo_private = false) AS public, COUNT(*) FILTER (WHERE repo_private = true) AS private, COUNT(*) FILTER (WHERE repo_private IS NULL) AS unknown, COUNT(DISTINCT NULLIF(repo, '')) FILTER (WHERE repo_private = false) AS public_repositories, COUNT(DISTINCT NULLIF(repo, '')) FILTER (WHERE repo_private = true) AS private_repositories, COUNT(DISTINCT NULLIF(repo, '')) FILTER (WHERE repo_private IS NULL) AS unknown_repositories").Scan(&visibilityCounts).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load visibility counts"})
		return
	}
	var recordedYears []int
	if err := sessionPRQuery(c, s.db).Model(&PullRequest{}).Distinct("EXTRACT(YEAR FROM COALESCE(merged_at, pr_created_at, updated_at) AT TIME ZONE 'UTC')::integer").Pluck("EXTRACT(YEAR FROM COALESCE(merged_at, pr_created_at, updated_at) AT TIME ZONE 'UTC')::integer", &recordedYears).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load available years"})
		return
	}
	var connection OAuthToken
	s.db.Where("session_id = ? AND created_at > ?", requestSessionID(c), now.Add(-30*24*time.Hour)).First(&connection)
	firstYear := now.Year() - 1
	if connection.GitHubCreatedAt != nil && connection.GitHubCreatedAt.Year() >= 2008 {
		firstYear = connection.GitHubCreatedAt.Year()
	}
	for _, y := range recordedYears {
		if y >= 2008 && y < firstYear {
			firstYear = y
		}
	}
	years := []int{}
	for y := now.Year(); y >= firstYear; y-- {
		years = append(years, y)
	}
	var summary overviewSummary
	q := base()
	if err := q.Select(`COUNT(*) AS total, COUNT(*) FILTER (WHERE merged_at IS NOT NULL) AS merged, COUNT(*) FILTER (WHERE state='open' AND merged_at IS NULL) AS open, COUNT(*) FILTER (WHERE state='closed' AND merged_at IS NULL) AS closed, COUNT(DISTINCT NULLIF(repo,'')) AS repositories`).Scan(&summary).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load overview"})
		return
	}
	repos := []overviewRepository{}
	if err := base().Where("repo <> ''").Select("repo, COUNT(*) AS total, COUNT(*) FILTER (WHERE merged_at IS NOT NULL) AS merged").Group("repo").Order("total DESC, repo ASC").Scan(&repos).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load repository achievements"})
		return
	}
	var raw []overviewMonth
	trendQuery := scope().Where("merged_at >= ? AND merged_at < ?", start, end)
	if repo := c.Query("trend_repo"); repo != "" {
		if len(repo) > 255 {
			c.JSON(400, gin.H{"error": "Invalid trend repository"})
			return
		}
		trendQuery = trendQuery.Where("repo = ?", repo)
	}
	if err := trendQuery.Select("to_char(merged_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, COUNT(*) AS merged").Group("month").Order("month").Scan(&raw).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load merge history"})
		return
	}
	counts := map[string]int64{}
	for _, m := range raw {
		counts[m.Month] = m.Merged
	}
	months := make([]overviewMonth, 0, 13)
	for month := start; month.Before(end); month = month.AddDate(0, 1, 0) {
		key := month.Format("2006-01")
		months = append(months, overviewMonth{Month: key, Merged: counts[key]})
	}
	c.JSON(200, gin.H{"visibility_counts": visibilityCounts, "summary": summary, "repositories": repos, "months": months, "year": year, "years": years, "history_complete": connection.HistorySyncedAt != nil, "history_total": connection.HistoryTotal})
}
