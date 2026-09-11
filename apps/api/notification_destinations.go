package main

import (
	"encoding/json"
	"errors"
	"net/http"
	netmail "net/mail"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Shared with the settings form so both sides reject the same input.
const (
	destinationNameLimit      = 100
	destinationRecipientLimit = 20
)

type destinationInput struct {
	Kind     string   `json:"kind"`
	Name     string   `json:"name"`
	Enabled  *bool    `json:"enabled"`
	Token    string   `json:"token"`
	ChatID   int64    `json:"chat_id"`
	URL      string   `json:"url"`
	Secret   string   `json:"secret"`
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Username string   `json:"username"`
	Password string   `json:"password"`
	From     string   `json:"from"`
	To       []string `json:"to"`
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
	// A destination that gave up would otherwise fail in silence: nothing in the
	// UI distinguishes "nothing to send" from "everything was dropped".
	var abandoned []uint
	if err := s.db.Model(&NotificationDelivery{}).Where("session_id = ? AND last_error = ?", account.SessionID, "gave_up").Distinct("destination_id").Pluck("destination_id", &abandoned).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load notification destinations"})
		return
	}
	failing := map[uint]bool{}
	for _, id := range abandoned {
		failing[id] = true
	}
	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{"id": r.ID, "name": r.Name, "kind": destinationKind(r.Kind), "enabled": r.Enabled, "failing": failing[r.ID]})
	}
	// The form mirrors the outbound address policy, so it has to know whether this
	// deployment opted into private addresses.
	c.JSON(200, gin.H{"data": out, "allow_private_hosts": privateDestinationsAllowed()})
}

// Credentials are write-only: a field left empty on update keeps the stored
// value, so the enable and rename calls do not have to resend secrets.
func destinationConfigFor(kind string, in destinationInput, stored destinationConfig) (destinationConfig, error) {
	switch kind {
	case destinationTelegram:
		config := destinationConfig{Token: stored.Token, ChatID: stored.ChatID}
		if in.Token != "" {
			config.Token = in.Token
		}
		if in.ChatID != 0 {
			config.ChatID = in.ChatID
		}
		if config.Token == "" {
			return config, errors.New("A bot token is required")
		}
		if config.ChatID == 0 {
			return config, errors.New("A numeric chat ID is required")
		}
		return config, nil
	case destinationLark, destinationWebhook:
		config := destinationConfig{URL: stored.URL, Secret: stored.Secret}
		if in.URL != "" {
			endpoint, err := validateDestinationURL(in.URL)
			if err != nil {
				return config, err
			}
			config.URL = endpoint
		}
		if in.Secret != "" {
			config.Secret = in.Secret
		}
		if config.URL == "" {
			return config, errors.New("A webhook URL is required")
		}
		return config, nil
	case destinationEmail:
		config := destinationConfig{Host: stored.Host, Port: stored.Port, Username: stored.Username, Password: stored.Password, From: stored.From, To: stored.To}
		if in.Host != "" {
			host, err := validateDestinationHost(in.Host)
			if err != nil {
				return config, err
			}
			config.Host = host
		}
		if in.Port != 0 {
			config.Port = in.Port
		}
		if in.Username != "" {
			config.Username = in.Username
		}
		if in.Password != "" {
			config.Password = in.Password
		}
		if in.From != "" {
			config.From = in.From
		}
		if len(in.To) > 0 {
			config.To = in.To
		}
		if config.Host == "" {
			return config, errors.New("An SMTP host is required")
		}
		if config.Port < 0 || config.Port > 65535 {
			return config, errors.New("The SMTP port has to be between 1 and 65535")
		}
		if _, err := netmail.ParseAddress(config.From); err != nil {
			return config, errors.New("The sender address is not a valid email address")
		}
		if len(config.To) == 0 || len(config.To) > destinationRecipientLimit {
			return config, errors.New("Enter between one and twenty recipients")
		}
		recipients := make([]string, 0, len(config.To))
		for _, recipient := range config.To {
			address, err := netmail.ParseAddress(strings.TrimSpace(recipient))
			if err != nil {
				return config, errors.New("A recipient is not a valid email address")
			}
			recipients = append(recipients, address.Address)
		}
		config.To = recipients
		return config, nil
	}
	return destinationConfig{}, errors.New("Unknown notification channel")
}

func (s *Server) saveNotificationDestination(c *gin.Context) {
	account, ok := s.settingsAccount(c)
	if !ok {
		return
	}
	var in destinationInput
	if c.ShouldBindJSON(&in) != nil {
		c.JSON(400, gin.H{"error": "Invalid destination"})
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		c.JSON(400, gin.H{"error": "A name is required"})
		return
	}
	if len([]rune(in.Name)) > destinationNameLimit {
		c.JSON(400, gin.H{"error": "The name is too long"})
		return
	}
	if in.Enabled == nil {
		v := true
		in.Enabled = &v
	}
	var row NotificationDestination
	stored := destinationConfig{}
	kind := destinationKind(in.Kind)
	if id, _ := strconv.ParseUint(c.Param("id"), 10, 64); id > 0 {
		if s.db.Where("id = ? AND session_id = ?", id, account.SessionID).First(&row).Error != nil {
			c.Status(404)
			return
		}
		// The channel of an existing destination is fixed; its credentials belong to that provider.
		kind = destinationKind(row.Kind)
		stored, _ = destinationSettings(row)
	}
	if !knownDestinationKind(kind) {
		c.JSON(400, gin.H{"error": "Unknown notification channel"})
		return
	}
	config, err := destinationConfigFor(kind, in, stored)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	cipher, err := crypt(mustJSON(config))
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to protect credentials"})
		return
	}
	row.SessionID = account.SessionID
	row.Name = in.Name
	row.Kind = kind
	row.Enabled = *in.Enabled
	row.ConfigCipher = cipher
	if err := s.db.Save(&row).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to save destination"})
		return
	}
	c.JSON(200, gin.H{"id": row.ID, "name": row.Name, "kind": row.Kind, "enabled": row.Enabled})
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
