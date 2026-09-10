package main

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
)

type destinationInput struct {
	Name    string `json:"name"`
	Token   string `json:"token"`
	ChatID  int64  `json:"chat_id"`
	Enabled *bool  `json:"enabled"`
}

func (s *Server) listNotificationDestinations(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	var rows []NotificationDestination
	if err := s.db.Where("session_id = ?", account.SessionID).Order("id").Find(&rows).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load notification destinations"})
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{"id": r.ID, "name": r.Name, "enabled": r.Enabled})
	}
	c.JSON(200, gin.H{"data": out})
}

func (s *Server) saveNotificationDestination(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	var in destinationInput
	if c.ShouldBindJSON(&in) != nil || in.Name == "" || len(in.Name) > 100 {
		c.JSON(400, gin.H{"error": "Name and chat_id are required"})
		return
	}
	if in.Enabled == nil {
		v := true
		in.Enabled = &v
	}
	cfg := map[string]any{"token": in.Token, "chat_id": in.ChatID}
	var row NotificationDestination
	if id, _ := strconv.ParseUint(c.Param("id"), 10, 64); id > 0 {
		if s.db.Where("id = ? AND session_id = ?", id, account.SessionID).First(&row).Error != nil {
			c.Status(404)
			return
		}
		if in.Token == "" {
			plain, _ := decrypt(row.ConfigCipher)
			_ = json.Unmarshal([]byte(plain), &cfg)
		}
	} else if in.ChatID == 0 {
		c.JSON(400, gin.H{"error": "chat_id is required for a new destination"})
		return
	}
	if in.ChatID != 0 {
		cfg["chat_id"] = in.ChatID
	}
	if cfg["token"] == "" {
		c.JSON(400, gin.H{"error": "token is required for a new destination"})
		return
	}
	cipher, err := crypt(mustJSON(cfg))
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to protect credentials"})
		return
	}
	row.SessionID = account.SessionID
	row.Name = in.Name
	row.Enabled = *in.Enabled
	row.ConfigCipher = cipher
	if err := s.db.Save(&row).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to save destination"})
		return
	}
	c.JSON(200, gin.H{"id": row.ID, "name": row.Name, "enabled": row.Enabled})
}
func (s *Server) deleteNotificationDestination(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	if id == 0 || s.db.Where("id = ? AND session_id = ?", id, account.SessionID).Delete(&NotificationDestination{}).RowsAffected == 0 {
		c.Status(http.StatusNotFound)
		return
	}
	c.Status(http.StatusNoContent)
}
func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
