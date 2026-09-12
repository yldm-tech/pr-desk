package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type NotificationDestination struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	SessionID    string    `gorm:"index;not null" json:"-"`
	Name         string    `json:"name"`
	Kind         string    `gorm:"not null;default:telegram" json:"kind"`
	Enabled      bool      `json:"enabled"`
	ConfigCipher string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type NotificationDelivery struct {
	ID            uint   `gorm:"primaryKey"`
	SessionID     string `gorm:"index;not null"`
	DestinationID uint   `gorm:"uniqueIndex:destination_message;not null"`
	MessageKey    string `gorm:"uniqueIndex:destination_message;not null"`
	Body          string
	Attempts      int
	AvailableAt   time.Time  `gorm:"index"`
	LeasedUntil   *time.Time `gorm:"index"`
	SentAt        *time.Time
	SkippedAt     *time.Time
	LastError     string
	CreatedAt     time.Time
}

// The backoff doubles to a 64-minute cap, so twelve attempts span 1+2+4+8+16+32
// minutes and then five hours at the cap: six hours and twenty-three minutes. A
// destination that has accepted nothing in that window is broken, not briefly
// unavailable.
const deliveryAttemptLimit = 12

type notificationSender func(context.Context, NotificationDestination, NotificationDelivery) error

// A failed delivery records only a fixed classification, so that an upstream
// message can never carry a credential or a recipient into the database. The
// detail is logged instead, and endpoints are stripped first because a webhook
// URL is itself the secret.
var deliveryURLPattern = regexp.MustCompile(`https?://\S+`)

func deliveryErrorSummary(err error) string {
	if err == nil {
		return ""
	}
	summary := strings.TrimSpace(deliveryURLPattern.ReplaceAllString(err.Error(), "[endpoint]"))
	if summary == "" {
		return "delivery_failed"
	}
	if runes := []rune(summary); len(runes) > 200 {
		return string(runes[:200])
	}
	return summary
}

// Only the pull requests a follow-up points at are ever looked up.
func trackedPullRequestIDs(follows []FollowUp) []uint {
	seen := map[uint]bool{}
	ids := make([]uint, 0, len(follows))
	for _, follow := range follows {
		if !seen[follow.PullRequestID] {
			seen[follow.PullRequestID] = true
			ids = append(ids, follow.PullRequestID)
		}
	}
	return ids
}

func digestDue(settings FollowUpSettings, now time.Time) (string, bool) {
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return "", false
	}
	local := now.In(location)
	date := local.Format("2006-01-02")
	if date == settings.LastDigestDate || local.Format("15:04") < settings.DigestTime {
		return date, false
	}
	return date, true
}

func queueMessage(tx *gorm.DB, destinations []NotificationDestination, key, body string, now time.Time) error {
	for _, destination := range destinations {
		for index, part := range notificationParts(body) {
			message := NotificationDelivery{SessionID: destination.SessionID, DestinationID: destination.ID, MessageKey: fmt.Sprintf("%s:%d", key, index), Body: part, AvailableAt: now}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&message).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func notificationParts(body string) []string {
	runes := []rune(body)
	parts := []string{}
	for len(runes) > 3500 {
		end := 3500
		for i := end; i > 2500; i-- {
			if runes[i] == '\n' {
				end = i
				break
			}
		}
		parts = append(parts, string(runes[:end]))
		runes = runes[end:]
	}
	if len(runes) > 0 {
		parts = append(parts, string(runes))
	}
	return parts
}

func followUpNotification(pr PullRequest, follow FollowUp, reasons []string, now time.Time, language ...string) string {
	facts := follow.facts()
	labels := map[string]string{"human_feedback": "New human feedback", "review_requested": "Review requested", "changes_requested": "Changes requested", "author_updated": "Author updated the PR", "approval_revoked": "Approval dismissed", "conflict": "Merge conflict", "checks_failed": "Checks failed", "overdue": "Waiting over the follow-up period", "snooze_due": "Reminder due"}
	parts := []string{fmt.Sprintf("%s #%d · %s", pr.Repo, pr.Number, pr.Title)}
	zh := len(language) > 0 && language[0] == "zh-CN"
	for _, reason := range reasons {
		label := labels[reason]
		if label != "" {
			if zh {
				label = map[string]string{"human_feedback": "新的人工反馈", "review_requested": "请求你审核", "changes_requested": "有人要求修改", "author_updated": "作者更新了 PR", "approval_revoked": "批准已撤回", "conflict": "存在合并冲突", "checks_failed": "检查失败", "overdue": "等待超过设定期限", "snooze_due": "提醒已到期"}[reason]
			}
			parts = append(parts, label)
		}
	}
	if !follow.WaitingSince.IsZero() {
		days := int(now.Sub(follow.WaitingSince).Hours() / 24)
		if days < 0 {
			days = 0
		}
		parts = append(parts, fmt.Sprintf("Waiting: %d days", days))
	}
	if facts.HumanExcerpt != "" {
		parts = append(parts, facts.HumanExcerpt)
	}
	parts = append(parts, pr.URL, strings.TrimRight(webOrigin(), "/")+fmt.Sprintf("/#/attention?focus=%d", follow.ID))
	return strings.Join(parts, "\n")
}

// Account transaction locks serialize materialization across replicas. Every
// destination has its own unique message key; retries never clear task state.
func (s *Server) queueAccountNotifications(ctx context.Context, sid string, now time.Time) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var settings FollowUpSettings
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("session_id = ?", sid).First(&settings).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if settings.BaselineAt == nil {
			return nil
		}
		var destinations []NotificationDestination
		if err := tx.Where("session_id = ? AND enabled = true", sid).Order("id").Find(&destinations).Error; err != nil {
			return err
		}
		if len(destinations) == 0 {
			return nil
		}
		var follows []FollowUp
		if err := tx.Where("session_id = ?", sid).Find(&follows).Error; err != nil {
			return err
		}
		var prs []PullRequest
		if tracked := trackedPullRequestIDs(follows); len(tracked) > 0 {
			if err := tx.Where("session_id = ? AND id IN ?", sid, tracked).Find(&prs).Error; err != nil {
				return err
			}
		}
		byID := map[uint]PullRequest{}
		for _, pr := range prs {
			byID[pr.ID] = pr
		}
		included := follows[:0]
		for _, follow := range follows {
			if settings.includes(follow.facts()) {
				included = append(included, follow)
			}
		}
		follows = included
		firstInventory := settings.InventoryAt == nil
		if firstInventory {
			open, action, overdue := 0, 0, 0
			for _, follow := range follows {
				state, _ := follow.presentation(now, settings.waitDays(byID[follow.PullRequestID].Repo))
				if state != "archived" {
					open++
				}
				if state == "action" {
					action++
				}
				if state == "follow_up" {
					overdue++
				}
			}
			body := fmt.Sprintf("PR Desk · Initial inventory\n%d tracked open PRs · %d need action · %d need follow-up\n%s/#/attention", open, action, overdue, strings.TrimRight(webOrigin(), "/"))
			if err := queueMessage(tx, destinations, "inventory", body, now); err != nil {
				return err
			}
			location, err := time.LoadLocation(settings.Timezone)
			if err != nil {
				return err
			}
			if err := tx.Model(&settings).Updates(map[string]any{"inventory_at": now, "last_digest_at": now, "last_digest_date": now.In(location).Format("2006-01-02")}).Error; err != nil {
				return err
			}
		}
		var events []FollowUpEvent
		if err := tx.Where("session_id = ? AND dispatched_at IS NULL", sid).Order("created_at ASC, id ASC").Find(&events).Error; err != nil {
			return err
		}
		groups := map[uint][]FollowUpEvent{}
		for _, event := range events {
			groups[event.FollowUpID] = append(groups[event.FollowUpID], event)
		}
		for _, follow := range follows {
			batch := groups[follow.ID]
			if len(batch) == 0 || now.Before(batch[0].AvailableAt) {
				continue
			}
			cutoff := batch[0].AvailableAt
			ids := []uint{}
			reasonSet := map[string]bool{}
			for _, event := range batch {
				if event.CreatedAt.After(cutoff) {
					break
				}
				ids = append(ids, event.ID)
				if event.Version <= follow.HandledVersion {
					continue
				}
				var reasons []string
				if err := json.Unmarshal([]byte(event.ReasonsJSON), &reasons); err != nil {
					return err
				}
				for _, reason := range reasons {
					reasonSet[reason] = true
				}
			}
			facts := follow.facts()
			pr := byID[follow.PullRequestID]
			if !facts.Conflict {
				delete(reasonSet, "conflict")
			}
			if !failedChecks(facts.Checks) {
				delete(reasonSet, "checks_failed")
			}
			if !follow.NeedsConfirmation {
				for _, reason := range []string{"human_feedback", "review_requested", "author_updated", "approval_revoked", "changes_requested"} {
					delete(reasonSet, reason)
				}
			}
			if len(reasonSet) > 0 && !facts.Draft && !facts.Closed {
				reasons := []string{}
				for reason := range reasonSet {
					reasons = append(reasons, reason)
				}
				sort.Strings(reasons)
				if err := queueMessage(tx, destinations, fmt.Sprintf("event:%d:%d", follow.ID, batch[0].ID), followUpNotification(pr, follow, reasons, now, settings.Language), now); err != nil {
					return err
				}
			}
			if err := tx.Model(&FollowUpEvent{}).Where("id IN ?", ids).Update("dispatched_at", now).Error; err != nil {
				return err
			}
		}
		if date, due := digestDue(settings, now); due && !firstInventory {
			lines := []string{}
			since := now.Add(-24 * time.Hour)
			if settings.LastDigestAt != nil {
				since = *settings.LastDigestAt
			}
			for _, follow := range follows {
				pr := byID[follow.PullRequestID]
				state, reasons := follow.presentation(now, settings.waitDays(pr.Repo))
				if state == "follow_up" {
					lines = append(lines, followUpNotification(pr, follow, reasons, now, settings.Language))
				}
				if state == "archived" && follow.ArchivedAt != nil && follow.ArchivedAt.After(since) && !follow.facts().Draft {
					outcome := "Closed"
					if follow.facts().Merged {
						outcome = "Merged"
					}
					lines = append(lines, fmt.Sprintf("%s · %s #%d · %s\n%s", outcome, pr.Repo, pr.Number, pr.Title, pr.URL))
				}
			}
			if len(lines) > 0 {
				if err := queueMessage(tx, destinations, "digest:"+date, "PR Desk · Daily follow-up\n\n"+strings.Join(lines, "\n\n"), now); err != nil {
					return err
				}
			}
			if err := tx.Model(&settings).Updates(map[string]any{"last_digest_date": date, "last_digest_at": now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) deliverOneNotification(ctx context.Context, now time.Time, send notificationSender) (bool, error) {
	var delivery NotificationDelivery
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("sent_at IS NULL AND skipped_at IS NULL AND available_at <= ? AND (leased_until IS NULL OR leased_until < ?)", now, now).Order("id").First(&delivery).Error; err != nil {
			return err
		}
		lease := now.Add(2 * time.Minute)
		delivery.Attempts++
		delivery.LeasedUntil = &lease
		return tx.Save(&delivery).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var destination NotificationDestination
	if err := s.db.WithContext(ctx).Where("id = ? AND session_id = ? AND enabled = true", delivery.DestinationID, delivery.SessionID).First(&destination).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return true, s.db.Model(&delivery).Updates(map[string]any{"skipped_at": now, "leased_until": nil}).Error
		}
		return true, err
	}
	sendCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	err = send(sendCtx, destination, delivery)
	updates := map[string]any{"leased_until": nil}
	if err == nil {
		updates["sent_at"] = now
		updates["last_error"] = ""
	} else if delivery.Attempts >= deliveryAttemptLimit {
		// By now the backoff is an hour and the destination has been failing for
		// about a day. Retrying forever keeps a dead endpoint in the queue and
		// hides it, so the message is parked and the destination is reported as
		// failing where the account holder can see it.
		updates["skipped_at"] = now
		updates["last_error"] = "gave_up"
		log.Printf("Notification outbox: destination %d gave up after %d attempts: %s", destination.ID, delivery.Attempts, deliveryErrorSummary(err))
	} else {
		delay := time.Minute * time.Duration(1<<min(delivery.Attempts-1, 6))
		updates["available_at"] = now.Add(delay)
		// The stored reason stays a fixed classification on purpose: an upstream
		// message can quote credentials or recipients. The detail an operator
		// needs goes to the log instead, with endpoints removed.
		updates["last_error"] = "delivery_failed"
		log.Printf("Notification outbox: destination %d attempt %d failed: %s", destination.ID, delivery.Attempts, deliveryErrorSummary(err))
	}
	return true, s.db.WithContext(ctx).Model(&NotificationDelivery{}).Where("id = ? AND attempts = ?", delivery.ID, delivery.Attempts).Updates(updates).Error
}
