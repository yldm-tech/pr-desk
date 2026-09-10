package main

import (
	"context"
	"encoding/json"
	"errors"
	github "github.com/google/go-github/v68/github"
	"log"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type syncProgress struct {
	LastSyncedAt   *time.Time `json:"last_synced_at,omitempty"`
	HistoryCount   *int       `json:"history_count,omitempty"`
	OpenCount      *int       `json:"open_count,omitempty"`
	ResumePhase    string     `json:"resume_phase,omitempty"`
	ErrorCode      string     `json:"error_code,omitempty"`
	NextAutoSyncAt time.Time  `json:"next_auto_sync_at"`
	Mode           string     `json:"mode"`
	Status         string     `json:"status"`
	Phase          string     `json:"phase"`
	Completed      int        `json:"completed"`
	Total          int        `json:"total"`
	RetryAt        int64      `json:"retry_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}
type syncTracker struct {
	searchPhase string
	mode        string
	mu          sync.Mutex
	db          *gorm.DB
	sid         string
	value       syncProgress
}

func (p *syncTracker) save() {
	p.value.UpdatedAt = time.Now().UTC()
	raw, _ := json.Marshal(p.value)
	p.db.Model(&OAuthToken{}).Where("session_id = ?", p.sid).Update("sync_progress", string(raw))
}
func (p *syncTracker) set(phase string, completed, total int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.value.Mode, p.value.Status, p.value.Phase = p.mode, "running", phase
	p.value.Completed, p.value.Total = completed, total
	p.value.RetryAt, p.value.ErrorCode = 0, ""
	p.save()
}
func (p *syncTracker) advance() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.value.Completed++
	p.save()
}
func (p *syncTracker) waiting(until time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.value.ResumePhase = p.value.Phase
	p.value.Phase = "waiting"
	p.value.RetryAt = until.Unix()
	p.save()
}
func (p *syncTracker) finish(success bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.value.Status = "failed"
	if success {
		p.value.Status = "complete"
	}
	if success {
		p.value.RetryAt = 0
		p.value.ErrorCode = ""
	}
	p.save()
}

type historyProgressKey struct{}

func historyTracker(ctx context.Context) *syncTracker {
	p, _ := ctx.Value(historyProgressKey{}).(*syncTracker)
	return p
}
func (s *Server) getSyncProgress(c *gin.Context) {
	var token OAuthToken
	if requestSessionID(c) == "" || s.db.Where("session_id = ? AND created_at > ?", requestSessionID(c), time.Now().Add(-30*24*time.Hour)).First(&token).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	progress := syncProgress{Status: "idle", Phase: "history"}
	if token.SyncProgress != "" {
		if json.Unmarshal([]byte(token.SyncProgress), &progress) != nil {
			c.JSON(500, gin.H{"error": "Unable to load sync progress"})
			return
		}
	}
	if progress.Status == "running" && time.Since(progress.UpdatedAt) > 20*time.Minute {
		progress.Status = "interrupted"
	}
	progress.NextAutoSyncAt = nextAutoSyncAt(token, time.Now())
	progress.LastSyncedAt = token.HistorySyncedAt
	c.JSON(200, progress)
}

// Store a bounded code, never upstream URLs, response bodies, or credentials.
func (p *syncTracker) recordFailure(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	code := "upstream"
	var secondary *github.AbuseRateLimitError
	var primary *github.RateLimitError
	var response *github.ErrorResponse
	var network *url.Error
	switch {
	case errors.Is(err, errHistoryStorage):
		code = "storage"
	case errors.Is(err, context.Canceled):
		code = "interrupted"
	case errors.Is(err, context.DeadlineExceeded):
		code = "timeout"
	case errors.As(err, &secondary):
		code = "rate_limited"
		if secondary.RetryAfter != nil {
			p.value.RetryAt = time.Now().Add(*secondary.RetryAfter).Unix()
		}
	case errors.As(err, &primary):
		code = "rate_limited"
		p.value.RetryAt = primary.Rate.Reset.Time.Unix()
	case errors.As(err, &response):
		if response.Response != nil {
			switch response.Response.StatusCode {
			case 401:
				code = "reconnect"
			case 403:
				code = "forbidden"
			case 429:
				code = "rate_limited"
			}
		}
	case errors.As(err, &network):
		code = "network"
	default:
		if err != nil && (strings.Contains(err.Error(), "count changed") || strings.Contains(err.Error(), "fewer history") || strings.Contains(err.Error(), "incomplete history") || strings.Contains(err.Error(), "one-second interval")) {
			code = "incomplete_history"
		}
	}
	p.value.ErrorCode = code
	log.Printf("GitHub sync failure: code=%s phase=%s completed=%d total=%d", code, p.value.Phase, p.value.Completed, p.value.Total)
	p.save()
}
func (p *syncTracker) finishResult(success bool, result syncResult, ctxErr error) {
	if !success && p.value.ErrorCode == "" {
		if ctxErr != nil {
			p.recordFailure(ctxErr)
		} else {
			code := "upstream"
			switch result.status {
			case 401:
				code = "reconnect"
			case 403:
				code = "forbidden"
			case 429:
				code = "rate_limited"
			case 500:
				code = "storage"
			}
			p.mu.Lock()
			p.value.ErrorCode = code
			p.mu.Unlock()
		}
	}
	p.finish(success)
}

func (p *syncTracker) searchProgress(completed, total int) {
	phase := p.searchPhase
	if phase == "" {
		phase = "history"
	}
	p.set(phase, completed, total)
}
func (p *syncTracker) beginOpenSearch(changed int) {
	p.mu.Lock()
	p.value.HistoryCount = &changed
	p.searchPhase = "open"
	p.mu.Unlock()
	p.set("open", 0, 0)
}
func (p *syncTracker) summarize(history, open int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.value.HistoryCount == nil {
		p.value.HistoryCount = &history
	}
	p.value.OpenCount = &open
	p.save()
}
