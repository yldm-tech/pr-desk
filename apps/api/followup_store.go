package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FollowUpSettings struct {
	SessionID          string     `gorm:"primaryKey" json:"-"`
	Timezone           string     `json:"timezone"`
	DigestTime         string     `json:"digest_time"`
	WaitDays           int        `json:"wait_days"`
	Language           string     `json:"language"`
	TeamsJSON          string     `json:"-"`
	RepositoryDaysJSON string     `json:"-"`
	InventoryAt        *time.Time `json:"inventory_at"`
	BaselineAt         *time.Time `json:"baseline_at"`
	LastDigestDate     string     `json:"-"`
	LastDigestAt       *time.Time `json:"-"`
}

type FollowUpEvent struct {
	ID           uint   `gorm:"primaryKey"`
	SessionID    string `gorm:"index;not null"`
	FollowUpID   uint   `gorm:"uniqueIndex:followup_event_version"`
	Version      uint64 `gorm:"uniqueIndex:followup_event_version"`
	ReasonsJSON  string
	CreatedAt    time.Time
	AvailableAt  time.Time `gorm:"index"`
	DispatchedAt *time.Time
}

func loadFollowUpSettings(db *gorm.DB, sid string) (FollowUpSettings, error) {
	settings := FollowUpSettings{SessionID: sid, Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}"}
	err := db.Where("session_id = ?", sid).First(&settings).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return settings, nil
	}
	return settings, err
}
func (settings FollowUpSettings) waitDays(repo string) int {
	var overrides map[string]int
	_ = json.Unmarshal([]byte(settings.RepositoryDaysJSON), &overrides)
	if days := overrides[repo]; days > 0 {
		return days
	}
	return settings.WaitDays
}

func (settings FollowUpSettings) includes(facts FollowUpFacts) bool {
	if facts.Role != "reviewer" || facts.DirectRequest {
		return true
	}
	var selected []string
	_ = json.Unmarshal([]byte(settings.TeamsJSON), &selected)
	for _, team := range facts.ReviewTeams {
		for _, value := range selected {
			if team == value {
				return true
			}
		}
	}
	return false
}

func persistFollowUp(tx *gorm.DB, pr PullRequest, facts FollowUpFacts, now time.Time) error {
	var row FollowUp
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("session_id = ? AND pull_request_id = ?", pr.SessionID, pr.ID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		row = FollowUp{SessionID: pr.SessionID, PullRequestID: pr.ID}
	} else if err != nil {
		return err
	}
	initial := row.FactsJSON == ""
	reasons := row.advanceFacts(facts, now)
	if initial && !facts.Draft && !facts.Closed {
		settings, err := loadFollowUpSettings(tx, pr.SessionID)
		if err != nil {
			return err
		}
		if settings.BaselineAt != nil {
			state, current := row.presentation(now, settings.waitDays(pr.Repo))
			if state == "action" {
				reasons = current
			}
		}
	}
	if err := tx.Save(&row).Error; err != nil {
		return err
	}
	if len(reasons) == 0 {
		return nil
	}
	raw, _ := json.Marshal(reasons)
	return tx.Create(&FollowUpEvent{SessionID: pr.SessionID, FollowUpID: row.ID, Version: row.Version, ReasonsJSON: string(raw), CreatedAt: now, AvailableAt: now.Add(5 * time.Minute)}).Error
}

type followUpView struct {
	FollowUp
	PR      PullRequest `json:"pr"`
	Role    string      `json:"role"`
	State   string      `json:"state"`
	Reasons []string    `json:"reasons"`
	Unread  bool        `json:"unread"`
	Excerpt string      `json:"excerpt"`
}

func (s *Server) followUpRows(c *gin.Context) ([]followUpView, error) {
	return s.collectFollowUps(requestSessionID(c), func() *gorm.DB { return sessionPRQuery(c, s.db) })
}

// accountFollowUps is the same view for a bearer-authenticated caller, which
// has no gin context. A bearer token always belongs to a connected account, so
// the legacy browser-only scoping in sessionPRQuery does not apply.
func (s *Server) accountFollowUps(ctx context.Context, sid string) ([]followUpView, error) {
	return s.collectFollowUps(sid, func() *gorm.DB { return s.db.WithContext(ctx).Where("session_id = ?", sid) })
}

func (s *Server) collectFollowUps(sid string, scope func() *gorm.DB) ([]followUpView, error) {
	settings, err := loadFollowUpSettings(s.db, sid)
	if err != nil {
		return nil, err
	}
	var records []FollowUp
	if err := scope().Order("last_activity_at DESC, id DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	var prs []PullRequest
	if tracked := trackedPullRequestIDs(records); len(tracked) > 0 {
		if err := scope().Where("id IN ?", tracked).Find(&prs).Error; err != nil {
			return nil, err
		}
	}
	byID := map[uint]PullRequest{}
	for _, pr := range prs {
		byID[pr.ID] = pr
	}
	rows := make([]followUpView, 0, len(records))
	now := time.Now()
	for _, row := range records {
		if !settings.includes(row.facts()) {
			continue
		}
		pr, ok := byID[row.PullRequestID]
		if !ok {
			continue
		}
		state, reasons := row.presentation(now, settings.waitDays(pr.Repo))
		facts := row.facts()
		rows = append(rows, followUpView{FollowUp: row, PR: pr, Role: facts.Role, State: state, Reasons: reasons, Unread: row.Version > row.ReadVersion, Excerpt: facts.HumanExcerpt})
	}
	rank := map[string]int{"action": 0, "follow_up": 1, "waiting": 2, "draft": 3, "archived": 4}
	sort.SliceStable(rows, func(i, j int) bool {
		if rank[rows[i].State] != rank[rows[j].State] {
			return rank[rows[i].State] < rank[rows[j].State]
		}
		return rows[i].LastActivityAt.After(rows[j].LastActivityAt)
	})
	return rows, nil
}

func (s *Server) listFollowUps(c *gin.Context) {
	rows, err := s.followUpRows(c)
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to load follow-ups"})
		return
	}
	counts := map[string]int{"authored": 0, "reviewer": 0, "follow_up": 0, "recent_merged": 0}
	for _, row := range rows {
		if row.State == "action" {
			counts[row.Role]++
		}
		if row.State == "follow_up" {
			counts["follow_up"]++
		}
		if row.facts().Merged && row.ArchivedAt != nil && row.ArchivedAt.After(time.Now().Add(-7*24*time.Hour)) {
			counts["recent_merged"]++
		}
	}
	settings, err := loadFollowUpSettings(s.db, requestSessionID(c))
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to load inventory status"})
		return
	}
	c.JSON(200, gin.H{"data": rows, "counts": counts, "baseline_complete": settings.BaselineAt != nil})
}

func (s *Server) updateFollowUp(c *gin.Context) {
	var input struct {
		Action  string     `json:"action"`
		Version uint64     `json:"version"`
		Until   *time.Time `json:"until"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": "Invalid action"})
		return
	}
	if input.Action != "read" && input.Action != "handled" && input.Action != "followed_up" && input.Action != "snooze" && input.Action != "unsnooze" {
		c.JSON(400, gin.H{"error": "Unknown action"})
		return
	}
	now := time.Now().UTC()
	if input.Action == "snooze" && (input.Until == nil || !input.Until.After(now) || input.Until.After(now.AddDate(1, 0, 0))) {
		c.JSON(400, gin.H{"error": "Choose a future reminder within one year"})
		return
	}
	status, err := s.applyFollowUpAction(c.Param("id"), input.Action, input.Version, input.Until, now, func(tx *gorm.DB) *gorm.DB { return sessionPRQuery(c, tx) })
	if err != nil {
		c.JSON(status, gin.H{"error": "Unable to update follow-up; refresh and retry"})
		return
	}
	c.JSON(200, gin.H{"updated": true})
}

// applyFollowUpAction holds the optimistic concurrency rule shared by the HTTP
// handler and the MCP tools: an action is refused when new activity arrived
// after the caller read the row, so an agent cannot mark away something it has
// not seen.
func (s *Server) applyFollowUpAction(id, action string, version uint64, until *time.Time, now time.Time, scope func(*gorm.DB) *gorm.DB) (int, error) {
	status := 200
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var row FollowUp
		if err := scope(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&row).Error; err != nil {
			status = 404
			return err
		}
		input := struct {
			Action  string
			Version uint64
			Until   *time.Time
		}{action, version, until}
		if row.Version != input.Version {
			status = 409
			return fmt.Errorf("new activity arrived; refresh before marking handled")
		}
		switch input.Action {
		case "read":
			row.ReadVersion = row.Version
		case "handled", "followed_up":
			row.ReadVersion = row.Version
			row.HandledVersion = row.Version
			row.NeedsConfirmation = false
			row.WaitingSince = now
			row.SnoozedUntil = nil
		case "snooze":
			row.SnoozedUntil = input.Until
		case "unsnooze":
			// Only the reminder is cancelled. Read and handled state stay as
			// they were, so this is not a back door to marking work away.
			row.SnoozedUntil = nil
		}
		return tx.Save(&row).Error
	})
	if err != nil && status == 200 {
		status = 500
	}
	return status, err
}
