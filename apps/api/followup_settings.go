package main

import (
	"encoding/json"
	"regexp"
	"time"
	_ "time/tzdata" // The minimal production image has no system zoneinfo database.

	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

type settingsInput struct {
	Timezone       string         `json:"timezone"`
	DigestTime     string         `json:"digest_time"`
	WaitDays       int            `json:"wait_days"`
	Teams          []string       `json:"teams"`
	RepositoryDays map[string]int `json:"repository_days"`
}

func (s *Server) settingsAccount(c *gin.Context) (OAuthToken, bool) {
	var account OAuthToken
	if !c.GetBool("account_session") || s.db.Where("session_id = ? AND git_hub_id > 0", requestSessionID(c)).First(&account).Error != nil {
		c.JSON(401, gin.H{"error": "Reconnect GitHub to configure account follow-ups"})
		return account, false
	}
	return account, true
}

func (s *Server) getFollowUpSettings(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	settings, err := loadFollowUpSettings(s.db, account.SessionID)
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to load preferences"})
		return
	}
	var teams []string
	_ = json.Unmarshal([]byte(settings.TeamsJSON), &teams)
	var overrides map[string]int
	_ = json.Unmarshal([]byte(settings.RepositoryDaysJSON), &overrides)
	c.JSON(200, settingsInput{Timezone: settings.Timezone, DigestTime: settings.DigestTime, WaitDays: settings.WaitDays, Teams: teams, RepositoryDays: overrides})
}

var repositoryNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func (s *Server) saveFollowUpSettings(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	var input settingsInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "Invalid preferences"})
		return
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil || input.Timezone == "Local" || input.Timezone == "" {
		c.JSON(400, gin.H{"error": "Choose an IANA timezone"})
		return
	}
	if _, err := time.Parse("15:04", input.DigestTime); err != nil || len(input.DigestTime) != 5 || input.WaitDays < 1 || input.WaitDays > 365 || len(input.Teams) > 50 || len(input.RepositoryDays) > 200 {
		c.JSON(400, gin.H{"error": "Invalid schedule"})
		return
	}
	for repo, days := range input.RepositoryDays {
		if !repositoryNamePattern.MatchString(repo) || len(repo) > 255 || days < 1 || days > 365 {
			c.JSON(400, gin.H{"error": "Invalid repository waiting period"})
			return
		}
	}
	for _, team := range input.Teams {
		if !repositoryNamePattern.MatchString(team) || len(team) > 255 {
			c.JSON(400, gin.H{"error": "Invalid team"})
			return
		}
	}
	teams, _ := json.Marshal(input.Teams)
	overrides, _ := json.Marshal(input.RepositoryDays)
	settings := FollowUpSettings{SessionID: account.SessionID, Timezone: input.Timezone, DigestTime: input.DigestTime, WaitDays: input.WaitDays, TeamsJSON: string(teams), RepositoryDaysJSON: string(overrides)}
	if err := s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "session_id"}}, DoUpdates: clause.AssignmentColumns([]string{"timezone", "digest_time", "wait_days", "teams_json", "repository_days_json"})}).Create(&settings).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to save preferences"})
		return
	}
	c.JSON(200, gin.H{"saved": true})
}

func (s *Server) listReviewTeams(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	token, err := decrypt(account.Token)
	if err != nil {
		c.JSON(401, gin.H{"error": "Reconnect GitHub"})
		return
	}
	var teams []struct {
		Slug         string `json:"slug"`
		Name         string `json:"name"`
		Organization struct {
			Login string `json:"login"`
		} `json:"organization"`
	}
	teams, err = fetchPages[struct {
		Slug         string `json:"slug"`
		Name         string `json:"name"`
		Organization struct {
			Login string `json:"login"`
		} `json:"organization"`
	}](c.Request.Context(), token, "/user/teams")
	if err != nil {
		c.JSON(502, gin.H{"error": "Unable to list teams; check GitHub organization permissions"})
		return
	}
	result := []gin.H{}
	for _, team := range teams {
		result = append(result, gin.H{"id": team.Organization.Login + "/" + team.Slug, "name": team.Name})
	}
	c.JSON(200, gin.H{"data": result})
}
