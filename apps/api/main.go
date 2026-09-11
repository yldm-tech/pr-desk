package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"golang.org/x/oauth2"
	"golang.org/x/sync/errgroup"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type PullRequest struct {
	Role          string     `json:"role" gorm:"index;not null;default:authored"`
	ReviewTracked bool       `json:"-"`
	Author        string     `json:"author"`
	Draft         bool       `json:"draft"`
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
	GitHubID           int64      `gorm:"not null;default:0"`
	AuthorizationError string     `gorm:"not null;default:''"`
	SyncRequestedAt    *time.Time `json:"-"`
	FullSyncPending    bool       `json:"-"`
	SyncProgress       string     `json:"-"`
	GitHubCreatedAt    *time.Time
	HistorySyncedAt    *time.Time
	HistoryTotal       int
	ID                 uint   `gorm:"primaryKey"`
	SessionID          string `gorm:"index;not null"`
	Username           string
	Token              string
	CreatedAt          time.Time
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

type Server struct {
	db        *gorm.DB
	workerCtx context.Context
}

var appServer *Server
var githubHTTPClient = &http.Client{Timeout: 20 * time.Second}

func sessionPRQuery(c *gin.Context, db *gorm.DB) *gorm.DB {
	sid := requestSessionID(c)
	if c.GetBool("account_session") {
		return db.WithContext(c.Request.Context()).Where("session_id = ?", sid)
	}
	return db.WithContext(c.Request.Context()).Where("session_id = ?", sid).Where("session_id IN (?)", db.Model(&OAuthToken{}).Select("session_id").Where("session_id = ? AND created_at > ?", sid, time.Now().Add(-30*24*time.Hour)))
}

func requestSessionID(c *gin.Context) string {
	if value, ok := c.Get("storage_session"); ok {
		return value.(string)
	}
	v, _ := c.Cookie("pr_session")
	return v
}
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
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.New(log.New(os.Stderr, "", log.LstdFlags), logger.Config{LogLevel: logger.Warn, SlowThreshold: time.Second, ParameterizedQueries: true})})
	if err != nil {
		panic(err)
	}
	if err := migrateDatabase(db); err != nil {
		panic(err)
	}
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	s := &Server{db: db, workerCtx: workerCtx}
	appServer = s
	r := gin.New()
	// Do not log OAuth query parameters, cookies, or private search terms.
	r.Use(safeRequestLogger(), gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		log.Print("Request panic recovered; sensitive request details omitted")
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}))
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
	r.Use(cors.New(corsPolicy()))
	r.Use(requireMutationOrigin)
	r.GET("/.well-known/oauth-authorization-server", s.authorizationServerMetadata)
	r.GET("/.well-known/oauth-protected-resource", s.protectedResourceMetadata)
	r.GET("/health", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		sqlDB, err := db.DB()
		if err != nil || sqlDB.PingContext(ctx) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "database": "unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "database": "ok"})
	})
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
	r.StaticFile("/swagger.json", "docs/swagger.json")
	api := r.Group("/api/v1")
	api.Use(s.resolveBrowserSession)
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
	api.GET("/follow-ups", s.listFollowUps)
	api.POST("/follow-ups/:id", s.updateFollowUp)
	api.GET("/follow-up-settings", s.getFollowUpSettings)
	api.POST("/follow-up-settings", s.saveFollowUpSettings)
	api.GET("/review-teams", s.listReviewTeams)
	// Bearer-authenticated surface for the CLI and MCP clients. The MCP
	// endpoint carries its own authorization middleware, and the OAuth
	// endpoints are reachable before any token exists.
	api.GET("/oauth/authorize", s.authorizeEndpoint)
	api.POST("/oauth/authorize", s.authorizeEndpoint)
	api.POST("/oauth/token", s.tokenEndpoint)
	api.POST("/oauth/register", s.registerOAuthClient)
	api.Any("/mcp", s.mcpHandler())
	api.GET("/notification-destinations", s.listNotificationDestinations)
	api.POST("/notification-destinations", s.saveNotificationDestination)
	api.PUT("/notification-destinations/:id", s.saveNotificationDestination)
	api.DELETE("/notification-destinations/:id", s.deleteNotificationDestination)
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
	if c.GetBool("account_session") {
		err := s.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("id = ?", c.GetString("browser_session")).Delete(&BrowserSession{}).Error; err != nil {
				return err
			}
			return tx.Model(&OAuthToken{}).Where("session_id = ?", sid).Updates(map[string]any{"token": "", "authorization_error": "disconnected"}).Error
		})
		if err != nil {
			c.JSON(503, gin.H{"error": "Unable to disconnect; please retry"})
			return
		}
		sid = ""
	}
	if sid != "" {
		if err := s.db.WithContext(c.Request.Context()).Where("session_id = ?", sid).Delete(&OAuthToken{}).Error; err != nil {
			c.JSON(503, gin.H{"error": "Unable to disconnect; please retry"})
			return
		}
	}
	c.SetCookie("pr_connected", "", -1, "/", "", secureCookies(c), true)
	c.SetCookie("pr_session", "", -1, "/", "", secureCookies(c), true)
	c.JSON(200, gin.H{"connected": false})
}
func (s *Server) authStatus(c *gin.Context) {
	var t OAuthToken
	sid := requestSessionID(c)
	connected := false
	if c.GetBool("account_session") {
		connected = s.db.Where("session_id = ?", sid).First(&t).Error == nil
	} else {
		connected = sid != "" && connectionQuery(s.db).Where("session_id = ?", sid).First(&t).Error == nil
	}
	c.JSON(200, gin.H{"connected": connected, "username": t.Username, "sync_paused": connected && (t.AuthorizationError != "" || t.Token == ""), "last_synced_at": t.HistorySyncedAt})
}
func (s *Server) comments(c *gin.Context) {
	var v []ReviewComment
	if err := sessionPRQuery(c, s.db).Where("pull_request_id = ?", c.Param("id")).Order("created_at desc").Find(&v).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load comments"})
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
	err := sessionPRQuery(c, s.db).Where("role = ?", "authored").Model(&PullRequest{}).Select(`COUNT(*) AS total,
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
	q := sessionPRQuery(c, s.db).Where("role = ?", "authored").Where("state = ? AND merged_at IS NULL", "open").Model(&PullRequest{}).Select(`repo, COUNT(*) AS total, COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL) AS open, COUNT(*) FILTER (WHERE has_conflicts = true) AS conflicts, COUNT(*) FILTER (WHERE state = 'open' AND merged_at IS NULL AND (has_conflicts = true OR review_status = 'changes_requested' OR checks_status IN ('failure','error'))) AS needs_attention`).Group("repo").Order("repo ASC")
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
	c.SetCookie("oauth_state", state, 600, "/", "", secureCookies(c), true)
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
		c.SetCookie("oauth_state", "", -1, "/", "", secureCookies(c), true)
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
	c.SetCookie("oauth_state", "", -1, "/", "", secureCookies(c), true)
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
	storageID, err := newSessionID()
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to create account"})
		return
	}
	current, err := appServer.connectAccount(c.Request.Context(), OAuthToken{SessionID: storageID, Username: username, Token: encrypted, GitHubCreatedAt: &accountCreated}, user.GetID(), sessionID)
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to restore GitHub connection data"})
		return
	}

	c.SetCookie("pr_connected", "1", 86400*30, "/", "", secureCookies(c), true)
	c.SetCookie("pr_session", sessionID, 86400*30, "/", "", secureCookies(c), true)
	appServer.startLoginSync(current.SessionID)
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

func (s *Server) syncSession(ctx context.Context, sid string, automatic, full bool) (result syncResult) {
	var t OAuthToken
	if sid == "" || connectionQuery(s.db).Where("session_id = ?", sid).First(&t).Error != nil {
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
	now := time.Now()
	if automatic && now.Before(nextAutoSyncAt(t, now)) {
		return syncResult{200, gin.H{"synced": 0, "skipped": true}}
	}
	if full {
		if err := s.db.Model(&OAuthToken{}).Where("id = ?", t.ID).Update("full_sync_pending", true).Error; err != nil {
			return syncResult{500, gin.H{"error": "Unable to schedule full sync"}}
		}
		t.FullSyncPending = true
	}
	if err := s.db.Model(&OAuthToken{}).Where("id = ?", t.ID).Update("sync_requested_at", nil).Error; err != nil {
		return syncResult{500, gin.H{"error": "Unable to start sync"}}
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
	ctx = context.WithValue(ctx, historyPageSinkKey{}, historyPageSink(func(items []*github.Issue) error { return s.saveHistoryPage(ctx, sid, items) }))
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
	enrich := func(x *github.Issue) error { return s.syncPRDetails(ctx, token, sid, x) }
	for _, item := range items {
		item := item
		if item.GetState() != "open" {
			continue
		}
		group.Go(func() error { err := enrich(item); progress.advance(); return err })
	}
	if err := group.Wait(); err != nil {
		progress.recordFailure(err)
		if errors.Is(err, errDetailStorage) {
			return syncResult{500, gin.H{"error": "Unable to save PR details; retry sync"}}
		}
		return syncResult{502, gin.H{"error": "Some PR details could not be loaded; list data has been saved"}}
	}
	if err := s.syncReviewRequests(ctx, t, token, from, syncStarted); err != nil {
		progress.recordFailure(err)
		return syncResult{502, gin.H{"error": "Unable to complete review inbox sync; retry to refresh"}}
	}

	var historyTotal int64
	if err := s.db.Model(&PullRequest{}).Where("session_id = ? AND role = ?", sid, "authored").Count(&historyTotal).Error; err != nil {
		return syncResult{500, gin.H{"error": "Unable to count saved history"}}
	}
	if err := s.db.Model(&OAuthToken{}).Where("id = ?", t.ID).Updates(map[string]interface{}{"history_synced_at": syncStarted, "history_total": historyTotal, "full_sync_pending": false}).Error; err != nil {
		return syncResult{500, gin.H{"error": "Unable to save sync checkpoint"}}
	}
	if t.GitHubID > 0 {
		settings, err := loadFollowUpSettings(s.db, sid)
		if err != nil {
			return syncResult{500, gin.H{"error": "Unable to load inventory checkpoint"}}
		}
		if settings.BaselineAt == nil {
			settings.BaselineAt = &syncStarted
			if err := s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "session_id"}}, DoUpdates: clause.AssignmentColumns([]string{"baseline_at"})}).Create(&settings).Error; err != nil {
				return syncResult{500, gin.H{"error": "Unable to save inventory checkpoint"}}
			}
		}
	}
	succeeded = true
	return syncResult{200, gin.H{"synced": len(items)}}
}

func (s *Server) listPRs(c *gin.Context) {
	var prs []PullRequest
	q := sessionPRQuery(c, s.db).Where("role = ?", "authored").Where("state = ? AND merged_at IS NULL", "open")
	if st := c.Query("state"); st != "" {
		q = q.Where("state = ?", st)
	}
	if c.Query("conflicts") == "true" {
		q = q.Where("has_conflicts = ?", true)
	}
	if rs := c.Query("review_status"); rs != "" {
		q = q.Where("review_status = ?", rs)
	}
	if repo := c.Query("repo"); repo != "" {
		q = q.Where("repo = ?", repo)
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
		c.JSON(500, gin.H{"error": "Unable to load pull requests"})
		return
	}
	c.JSON(200, gin.H{"data": prs, "total": total, "limit": limit, "offset": offset})
}
func (s *Server) getPR(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	var p PullRequest
	if err := sessionPRQuery(c, s.db).First(&p, id).Error; err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	c.JSON(200, p)
}
func (s *Server) createPR(c *gin.Context) {
	var p PullRequest
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": "Invalid pull request payload"})
		return
	}
	p.SessionID = requestSessionID(c)
	var connection OAuthToken
	if p.SessionID == "" || connectionQuery(s.db).Where("session_id = ?", p.SessionID).First(&connection).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	if err := s.db.Create(&p).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to save pull request"})
		return
	}
	c.JSON(201, p)
}
