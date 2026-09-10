package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"golang.org/x/oauth2"
	"golang.org/x/sync/errgroup"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type PullRequest struct {
	RepoPrivate   *bool      `json:"repo_private" gorm:"index"`
	ID            uint       `json:"id" gorm:"primaryKey"`
	SessionID     string     `json:"-" gorm:"index;not null"`
	Number        int        `json:"number"`
	Repo          string     `json:"repo" gorm:"index"`
	Title         string     `json:"title"`
	State         string     `json:"state" gorm:"index"`
	HasConflicts  bool       `json:"has_conflicts"`
	ReviewCount   int        `json:"review_count"`
	ReviewStatus  string     `json:"review_status"`
	CommentsCount int        `json:"comments_count"`
	ChecksStatus  string     `json:"checks_status"`
	PRCreatedAt   *time.Time `json:"created_at,omitempty"`
	MergedAt      *time.Time `json:"merged_at,omitempty"`
	URL           string     `json:"url"`
	UpdatedAt     time.Time  `json:"updated_at" gorm:"index"`
}
type OAuthToken struct {
	FullSyncPending bool   `json:"-"`
	SyncProgress    string `json:"-"`
	GitHubCreatedAt *time.Time
	HistorySyncedAt *time.Time
	HistoryTotal    int
	ID              uint   `gorm:"primaryKey"`
	SessionID       string `gorm:"index;not null"`
	Username        string
	Token           string
	CreatedAt       time.Time
}
type ReviewComment struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	GitHubID      uint64    `gorm:"column:git_hub_id;index" json:"github_id"`
	SessionID     string    `json:"-" gorm:"index;not null"`
	PullRequestID uint      `json:"pull_request_id" gorm:"index"`
	Author        string    `json:"author"`
	Body          string    `json:"body"`
	URL           string    `json:"url"`
	CreatedAt     time.Time `json:"created_at"`
	Resolved      bool      `json:"resolved"`
	CommentType   string    `json:"comment_type"`
}

type Server struct{ db *gorm.DB }

var appServer *Server
var githubHTTPClient = &http.Client{Timeout: 20 * time.Second}

func sessionPRQuery(c *gin.Context, db *gorm.DB) *gorm.DB {
	sid := requestSessionID(c)
	return db.WithContext(c.Request.Context()).Where("session_id = ?", sid).
		Where("session_id IN (?)", db.Model(&OAuthToken{}).Select("session_id").Where("session_id = ? AND created_at > ?", sid, time.Now().Add(-30*24*time.Hour)))
}

func requestSessionID(c *gin.Context) string { v, _ := c.Cookie("pr_session"); return v }
func newSessionID() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b), err
}

func main() {
	if _, err := tokenCipher(); err != nil {
		panic(err)
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=postgres dbname=pr_dashboard port=5432 sslmode=disable"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	if err := db.AutoMigrate(&PullRequest{}, &OAuthToken{}, &ReviewComment{}); err != nil {
		panic(err)
	}
	s := &Server{db}
	appServer = s
	r := gin.Default()
	registerWeb(r, frontendFiles())
	r.Use(func(c *gin.Context) {
		c.SetSameSite(http.SameSiteLaxMode)
		c.Next()
	})
	r.Use(func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			b := make([]byte, 16)
			if _, err := rand.Read(b); err == nil {
				requestID = base64.RawURLEncoding.EncodeToString(b)
			}
		}
		if requestID != "" {
			c.Header("X-Request-ID", requestID)
			c.Set("request_id", requestID)
		}
		c.Next()
	})
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	})
	r.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		c.Next()
	})
	r.Use(cors.New(cors.Config{AllowOrigins: []string{webOrigin()}, AllowCredentials: true, AllowHeaders: []string{"Content-Type", "Authorization"}, AllowMethods: []string{"GET", "POST", "OPTIONS"}}))
	r.Use(requireMutationOrigin)
	r.GET("/health", func(c *gin.Context) {
		sqlDB, err := db.DB()
		if err != nil || sqlDB.Ping() != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "database": "unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "database": "ok"})
	})
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
	r.StaticFile("/swagger.json", "docs/swagger.json")
	api := r.Group("/api/v1")
	api.GET("/pull-requests", s.listPRs)
	api.GET("/pull-requests/:id", s.getPR)
	api.POST("/pull-requests", s.createPR)
	api.GET("/auth/github", githubAuth)
	api.GET("/pull-requests/:id/activity", s.activity)
	api.GET("/auth/github/callback", githubCallback)
	api.POST("/auth/logout", s.logout)
	api.GET("/auth/status", s.authStatus)
	api.GET("/profile", s.profile)
	api.GET("/repository-access", s.repositoryAccess)
	api.GET("/repository-access/install", repositoryInstall)
	api.POST("/sync", s.syncGitHub)
	api.GET("/sync/progress", s.getSyncProgress)
	api.GET("/pull-requests/:id/comments", s.comments)
	api.GET("/stats", s.stats)
	api.GET("/overview", s.overview)
	api.GET("/repositories", s.repositories)
	addr := ":8080"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}
	srv := &http.Server{Addr: addr, Handler: r, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Minute, IdleTimeout: 120 * time.Second}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			panic(err)
		}
	}()
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	scheduler, err := s.startSyncScheduler(workerCtx, "@every 30s")
	if err != nil {
		panic(err)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	stopWorkers()
	workersStopped := scheduler.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	select {
	case <-workersStopped.Done():
	case <-ctx.Done():
	}
}
func (s *Server) logout(c *gin.Context) {
	sid := requestSessionID(c)
	if sid != "" {
		s.db.Where("session_id = ?", sid).Delete(&OAuthToken{})
	}
	c.SetCookie("pr_connected", "", -1, "/", "", c.Request.TLS != nil, true)
	c.SetCookie("pr_session", "", -1, "/", "", c.Request.TLS != nil, true)
	c.JSON(200, gin.H{"connected": false})
}
func (s *Server) authStatus(c *gin.Context) {
	var t OAuthToken
	sid := requestSessionID(c)
	connected := sid != "" && s.db.Where("session_id = ? AND created_at > ?", sid, time.Now().Add(-30*24*time.Hour)).First(&t).Error == nil
	c.JSON(200, gin.H{"connected": connected, "username": t.Username})
}
func (s *Server) comments(c *gin.Context) {
	var v []ReviewComment
	if err := sessionPRQuery(c, s.db).Where("pull_request_id = ?", c.Param("id")).Order("created_at desc").Find(&v).Error; err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": v})
}
func (s *Server) stats(c *gin.Context) {
	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	var result struct {
		Total       int64 `json:"total"`
		Open        int64 `json:"open"`
		Conflicts   int64 `json:"conflicts"`
		Merged      int64 `json:"merged"`
		NeedsReview int64 `json:"needs_review"`
		Attention   int64 `json:"attention"`
	}
	err := sessionPRQuery(c, s.db).Model(&PullRequest{}).Select(`COUNT(*) AS total,
 COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL) AS open,
 COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL AND has_conflicts) AS conflicts,
 COUNT(*) FILTER (WHERE merged_at >= ? AND merged_at < ?) AS merged,
 COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL AND review_status IN ('pending','review_requested','changes_requested')) AS needs_review,
 COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL AND (has_conflicts OR review_status = 'changes_requested' OR checks_status IN ('failure','error'))) AS attention`, monthStart, monthStart.AddDate(0, 1, 0)).Scan(&result).Error
	if err != nil {
		c.JSON(500, gin.H{"error": "unable to load statistics"})
		return
	}
	c.JSON(200, result)
}

func (s *Server) repositories(c *gin.Context) {
	type repositorySummary struct {
		Repo           string `json:"repo"`
		Total          int64  `json:"total"`
		Open           int64  `json:"open"`
		Conflicts      int64  `json:"conflicts"`
		NeedsAttention int64  `json:"needs_attention"`
	}
	var rows []repositorySummary
	rows = make([]repositorySummary, 0)
	q := sessionPRQuery(c, s.db).Where("state = ? AND merged_at IS NULL", "open").Model(&PullRequest{}).Select(`repo, COUNT(*) AS total, COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL) AS open, COUNT(*) FILTER (WHERE has_conflicts = true) AS conflicts, COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL AND (has_conflicts = true OR review_status = 'changes_requested' OR checks_status IN ('failure','error'))) AS needs_attention`).Group("repo").Order("repo ASC")
	if err := q.Scan(&rows).Error; err != nil {
		c.JSON(500, gin.H{"error": "unable to load repositories"})
		return
	}
	c.JSON(200, gin.H{"data": rows})
}

func oauthRedirectURL() string {
	if v := os.Getenv("GITHUB_REDIRECT_URL"); v != "" {
		return v
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	return "http://localhost:" + port + "/api/v1/auth/github/callback"
}

func githubOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID: os.Getenv("GITHUB_CLIENT_ID"), ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		Endpoint:    oauth2.Endpoint{AuthURL: "https://github.com/login/oauth/authorize", TokenURL: "https://github.com/login/oauth/access_token", AuthStyle: oauth2.AuthStyleInParams},
		RedirectURL: oauthRedirectURL(), Scopes: []string{"read:user", "repo"},
	}
}

func githubAuth(c *gin.Context) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		c.JSON(500, gin.H{"error": "failed to create oauth state"})
		return
	}
	state := base64.RawURLEncoding.EncodeToString(b)
	c.SetCookie("oauth_state", state, 600, "/", "", c.Request.TLS != nil, true)
	oauthCfg := githubOAuthConfig()
	c.Redirect(http.StatusFound, oauthCfg.AuthCodeURL(state))
}
func githubCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if c.Query("error") != "" {
		cookie, err := c.Cookie("oauth_state")
		if state == "" || err != nil || cookie != state {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid oauth state"})
			return
		}
		c.SetCookie("oauth_state", "", -1, "/", "", c.Request.TLS != nil, true)
		redirect := os.Getenv("WEB_ORIGIN")
		if redirect == "" {
			redirect = "http://localhost:5173"
		}
		c.Redirect(http.StatusFound, redirect+"?oauth_error=access_denied")
		return
	}
	cookie, _ := c.Cookie("oauth_state")
	if code == "" || state == "" || cookie == "" || state != cookie {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid oauth state"})
		return
	}
	c.SetCookie("oauth_state", "", -1, "/", "", c.Request.TLS != nil, true)
	oauthCfg := githubOAuthConfig()
	oauthCtx := context.WithValue(c.Request.Context(), oauth2.HTTPClient, githubHTTPClient)
	tok, err := oauthCfg.Exchange(oauthCtx, code)
	if err != nil || tok.AccessToken == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub token exchange unavailable"})
		return
	}
	accessToken := tok.AccessToken

	encrypted, err := crypt(accessToken)
	if err != nil {
		c.JSON(500, gin.H{"error": "unable to secure GitHub connection"})
		return
	}
	user, _, err := githubClient(accessToken).Users.Get(c.Request.Context(), "")
	if err != nil || user.GetID() == 0 || user.GetLogin() == "" {
		c.JSON(502, gin.H{"error": "Unable to verify GitHub account"})
		return
	}
	username := user.GetLogin()

	sessionID, err := newSessionID()
	if err != nil {
		c.JSON(500, gin.H{"error": "unable to create session"})
		return
	}
	accountCreated := user.GetCreatedAt().Time
	current := OAuthToken{SessionID: sessionID, Username: username, Token: encrypted, GitHubCreatedAt: &accountCreated}
	if err := appServer.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&current).Error; err != nil {
			return err
		}
		return restoreAccountCache(c.Request.Context(), tx, current, user.GetID())
	}); err != nil {
		c.JSON(500, gin.H{"error": "Unable to restore GitHub connection data"})
		return
	}

	c.SetCookie("pr_connected", "1", 86400*30, "/", "", c.Request.TLS != nil, true)
	c.SetCookie("pr_session", sessionID, 86400*30, "/", "", c.Request.TLS != nil, true)
	// Never expose the access token to the browser; return to the local UI.
	redirect := os.Getenv("WEB_ORIGIN")
	if redirect == "" {
		redirect = "http://localhost:5173"
	}
	c.Redirect(http.StatusFound, redirect+"?connected=1")
}

type syncResult struct {
	status int
	body   gin.H
}

func (s *Server) syncGitHub(c *gin.Context) {
	result := s.syncSession(c.Request.Context(), requestSessionID(c), c.Query("auto") == "1", c.Query("full") == "1")
	c.JSON(result.status, result.body)
}

func (s *Server) syncSession(ctx context.Context, sid string, automatic, full bool) (result syncResult) {
	var t OAuthToken
	if sid == "" || s.db.Where("session_id = ? AND created_at > ?", sid, time.Now().Add(-30*24*time.Hour)).First(&t).Error != nil {
		return syncResult{401, gin.H{"error": "not connected"}}
	}
	pool, err := s.db.DB()
	if err != nil {
		return syncResult{http.StatusServiceUnavailable, gin.H{"error": "Unable to acquire sync lock"}}
	}
	release, acquired, err := acquireSyncLock(ctx, pool, sid)
	if err != nil {
		return syncResult{http.StatusServiceUnavailable, gin.H{"error": "Unable to acquire sync lock"}}
	}
	if !acquired {
		return syncResult{http.StatusConflict, gin.H{"error": "A sync is already running for this session"}}
	}
	defer release()
	// Recheck after acquiring the lock: another tab may have just completed.
	if err := s.db.First(&t, t.ID).Error; err != nil {
		return syncResult{500, gin.H{"error": "Unable to load sync state"}}
	}
	if automatic && time.Now().Before(nextAutoSyncAt(t, time.Now())) {
		return syncResult{200, gin.H{"synced": 0, "skipped": true}}
	}
	if full {
		if err := s.db.Model(&OAuthToken{}).Where("id = ?", t.ID).Update("full_sync_pending", true).Error; err != nil {
			return syncResult{500, gin.H{"error": "Unable to schedule full sync"}}
		}
		t.FullSyncPending = true
	}
	incremental := t.HistorySyncedAt != nil && !t.FullSyncPending
	mode := "full"
	if incremental {
		mode = "incremental"
	}
	progress := &syncTracker{db: s.db, sid: sid, mode: mode}
	progress.set("account", 0, 0)
	succeeded := false
	defer func() { progress.finishResult(succeeded, result, ctx.Err()) }()
	ctx = context.WithValue(ctx, historyProgressKey{}, progress)
	token, err := decrypt(t.Token)
	if err != nil {
		return syncResult{401, gin.H{"error": "GitHub connection cannot be decrypted; reconnect GitHub"}}
	}
	gh := githubClient(token)
	from := time.Date(2008, 1, 1, 0, 0, 0, 0, time.UTC)
	query := "author:@me type:pr"
	if t.Username != "" {
		user, response, e := gh.Users.Get(ctx, "")
		if e != nil {
			progress.recordFailure(e)
			status := 502
			if response != nil && response.StatusCode >= 400 {
				status = response.StatusCode
			}
			return syncResult{status, gin.H{"error": "Unable to verify GitHub account"}}
		}
		if user.GetLogin() == "" || user.GetCreatedAt().IsZero() {
			return syncResult{502, gin.H{"error": "Invalid GitHub account profile"}}
		}
		from = user.GetCreatedAt().Time
		query = "author:" + user.GetLogin() + " type:pr"
		if err := s.db.Model(&OAuthToken{}).Where("id = ?", t.ID).Update("git_hub_created_at", from).Error; err != nil {
			return syncResult{500, gin.H{"error": "Unable to save account history range"}}
		}
	}
	progress.set("history", 0, 0)
	syncStarted := time.Now().UTC()
	var since *time.Time
	if incremental {
		since = t.HistorySyncedAt
	}
	items, err := fetchSyncHistory(ctx, gh, query, from, syncStarted, since)
	if err != nil {
		progress.recordFailure(err)
		status := 502
		var upstream *github.ErrorResponse
		if errors.As(err, &upstream) && upstream.Response != nil {
			status = upstream.Response.StatusCode
		}
		var secondary *github.AbuseRateLimitError
		var primary *github.RateLimitError
		if errors.As(err, &secondary) || errors.As(err, &primary) {
			return syncResult{http.StatusTooManyRequests, gin.H{"error": "GitHub rate limit reached; retry sync later"}}
		}
		return syncResult{status, gin.H{"error": "Unable to complete GitHub history sync; retry to refresh"}}
	}
	// Persist the authoritative search snapshot first. Enrichment can be slow or
	// unavailable; it must not leave a newly connected account looking empty.
	progress.set("saving", 0, len(items))
	for index, x := range items {
		var pr PullRequest
		updates := map[string]interface{}{"repo_private": nil, "title": x.GetTitle(), "state": x.GetState(), "repo": strings.TrimPrefix(x.GetRepositoryURL(), "https://api.github.com/repos/"), "updated_at": x.GetUpdatedAt().Time, "pr_created_at": x.GetCreatedAt().Time}
		if links := x.GetPullRequestLinks(); links != nil && links.MergedAt != nil {
			updates["merged_at"] = links.MergedAt.Time
		}
		if err := s.db.Where("session_id = ? AND number = ? AND url = ?", sid, x.GetNumber(), x.GetHTMLURL()).Assign(updates).FirstOrCreate(&pr, PullRequest{SessionID: sid, Number: x.GetNumber(), URL: x.GetHTMLURL()}).Error; err != nil {
			return syncResult{500, gin.H{"error": "Unable to save pull requests"}}
		}
		if (index+1)%100 == 0 {
			progress.set("saving", index+1, len(items))
		}
	}
	progress.set("saving", len(items), len(items))
	openTotal := 0
	for _, item := range items {
		if item.GetState() == "open" {
			openTotal++
		}
	}
	progress.summarize(len(items), openTotal)
	progress.set("details", 0, openTotal)
	group := new(errgroup.Group)
	group.SetLimit(4)
	enrich := func(x *github.Issue) error {
		if x.GetState() != "open" {
			return nil
		}
		var err error

		// Create the session-scoped row before importing child comments.
		var pr PullRequest
		repoName := strings.TrimPrefix(x.GetRepositoryURL(), "https://api.github.com/repos/")
		if err := s.db.Where("session_id = ? AND number = ? AND url = ?", sid, x.GetNumber(), x.GetHTMLURL()).
			Assign(map[string]interface{}{"title": x.GetTitle(), "state": x.GetState(), "repo": repoName, "updated_at": x.GetUpdatedAt().Time, "pr_created_at": x.GetCreatedAt().Time}).
			FirstOrCreate(&pr, PullRequest{SessionID: sid, Number: x.GetNumber(), URL: x.GetHTMLURL()}).Error; err != nil {
			return fmt.Errorf("Unable to save pull request; sync incomplete")
		}
		// Enrich each result with GitHub's mergeability and review metadata when available.
		parts := strings.Split(strings.TrimPrefix(x.GetRepositoryURL(), "https://api.github.com/repos/"), "/")
		var detail struct {
			Mergeable      *bool      `json:"mergeable"`
			MergedAt       *time.Time `json:"merged_at"`
			Comments       int        `json:"comments"`
			ReviewComments int        `json:"review_comments"`
			Head           struct {
				SHA string `json:"sha"`
			} `json:"head"`
		}
		var reviews []githubReview
		checksStatus := "unknown"
		if len(parts) >= 2 {
			if err := githubJSON(ctx, token, "GET", fmt.Sprintf("/repos/%s/%s/pulls/%d", parts[0], parts[1], x.GetNumber()), nil, &detail); err != nil {
				return fmt.Errorf("Unable to load PR details; sync incomplete: %w", err)
			}
			reviews, err = fetchPages[githubReview](ctx, token, fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews", parts[0], parts[1], x.GetNumber()))
			if err != nil {
				return fmt.Errorf("Unable to load reviews; sync incomplete: %w", err)
			}
			if detail.Head.SHA != "" {
				if status, _, e := gh.Repositories.GetCombinedStatus(ctx, parts[0], parts[1], detail.Head.SHA, nil); e == nil {
					checksStatus = status.GetState()
				}
			}
			inline, e := fetchPages[activityComment](ctx, token, fmt.Sprintf("/repos/%s/%s/pulls/%d/comments", parts[0], parts[1], x.GetNumber()))
			if e != nil {
				return fmt.Errorf("Unable to load review comments; sync incomplete: %w", e)
			}
			for _, cc := range inline {
				s.db.Where("session_id = ? AND git_hub_id = ?", sid, cc.ID).FirstOrCreate(&ReviewComment{GitHubID: cc.ID, SessionID: sid, PullRequestID: pr.ID, Author: cc.User.Login, Body: cc.Body, URL: cc.URL, CreatedAt: cc.CreatedAt, CommentType: "review"})
			}
		}
		conflict := detail.Mergeable != nil && !*detail.Mergeable
		s.db.Model(&PullRequest{}).Where("session_id = ? AND number = ? AND url = ?", sid, x.GetNumber(), x.GetHTMLURL()).Updates(map[string]interface{}{"has_conflicts": conflict, "comments_count": detail.Comments + detail.ReviewComments, "merged_at": detail.MergedAt})
		reviewStatus := latestReviewStatus(reviews)
		s.db.Model(&PullRequest{}).Where("session_id = ? AND number = ? AND url = ?", sid, x.GetNumber(), x.GetHTMLURL()).Updates(map[string]interface{}{"review_status": reviewStatus, "checks_status": checksStatus})
		if len(parts) >= 2 {
			comments, e := fetchPages[activityComment](ctx, token, fmt.Sprintf("/repos/%s/%s/issues/%d/comments", parts[0], parts[1], x.GetNumber()))
			if e != nil {
				return fmt.Errorf("Unable to load comments; sync incomplete: %w", e)
			}
			for _, cc := range comments {
				s.db.Where("session_id = ? AND git_hub_id = ?", sid, cc.ID).FirstOrCreate(&ReviewComment{GitHubID: cc.ID, SessionID: sid, PullRequestID: pr.ID, Author: cc.User.Login, Body: cc.Body, URL: cc.URL, CreatedAt: cc.CreatedAt})
			}
		}
		return nil
	}
	for _, item := range items {
		item := item
		if item.GetState() != "open" {
			continue
		}
		group.Go(func() error { err := enrich(item); progress.advance(); return err })
	}
	if err := group.Wait(); err != nil {
		progress.recordFailure(err)
		return syncResult{502, gin.H{"error": "Some PR details could not be loaded; list data has been saved"}}
	}

	var historyTotal int64
	if err := s.db.Model(&PullRequest{}).Where("session_id = ?", sid).Count(&historyTotal).Error; err != nil {
		return syncResult{500, gin.H{"error": "Unable to count saved history"}}
	}
	if err := s.db.Model(&OAuthToken{}).Where("id = ?", t.ID).Updates(map[string]interface{}{"history_synced_at": syncStarted, "history_total": historyTotal, "full_sync_pending": false}).Error; err != nil {
		return syncResult{500, gin.H{"error": "Unable to save sync checkpoint"}}
	}
	succeeded = true
	return syncResult{200, gin.H{"synced": len(items)}}
}

func (s *Server) listPRs(c *gin.Context) {
	var prs []PullRequest
	q := sessionPRQuery(c, s.db).Where("state = ? AND merged_at IS NULL", "open")
	if st := c.Query("state"); st != "" {
		q = q.Where("state = ?", st)
	}
	if c.Query("conflicts") == "true" {
		q = q.Where("has_conflicts = ?", true)
	}
	if rs := c.Query("review_status"); rs != "" {
		q = q.Where("review_status = ?", rs)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		if len(search) > 120 {
			c.JSON(400, gin.H{"error": "search query is too long"})
			return
		}
		// Treat user input as text; SQL wildcard characters are not search syntax.
		search = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
		pattern := "%" + search + "%"
		q = q.Where("title ILIKE ? ESCAPE '\\' OR repo ILIKE ? ESCAPE '\\'", pattern, pattern)
	}
	if c.Query("merged") == "true" {
		q = q.Where("1 = 0")
	}
	if c.Query("attention") == "true" {
		q = q.Where("state = ? AND merged_at IS NULL", "open").Where("has_conflicts = ? OR review_status = ? OR checks_status IN ?", true, "changes_requested", []string{"failure", "error"})
	}
	var total int64
	if err := q.Model(&PullRequest{}).Count(&total).Error; err != nil {
		c.JSON(500, gin.H{"error": "unable to count pull requests"})
		return
	}
	q = q.Order("updated_at desc, id desc")
	limit := 50
	if v, err := strconv.Atoi(c.DefaultQuery("limit", "50")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.DefaultQuery("offset", "0")); err == nil && v >= 0 {
		offset = v
	}
	q = q.Limit(limit).Offset(offset)
	if err := q.Find(&prs).Error; err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": prs, "total": total, "limit": limit, "offset": offset})
}
func (s *Server) getPR(c *gin.Context) {
	var p PullRequest
	if err := sessionPRQuery(c, s.db).First(&p, c.Param("id")).Error; err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	c.JSON(200, p)
}
func (s *Server) createPR(c *gin.Context) {
	var p PullRequest
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	p.SessionID = requestSessionID(c)
	var connection OAuthToken
	if p.SessionID == "" || s.db.Where("session_id = ? AND created_at > ?", p.SessionID, time.Now().Add(-30*24*time.Hour)).First(&connection).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	if err := s.db.Create(&p).Error; err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, p)
}
