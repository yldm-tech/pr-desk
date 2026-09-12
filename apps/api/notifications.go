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
	// Health is carried by the destination rather than derived from delivery history, so it can be cleared the moment the destination accepts a message again and it survives the retention sweep below. migrateDatabase seeds it from the delivery history that used to answer this question, so an upgrade does not report a dead endpoint as healthy.
	Failing   bool      `gorm:"not null;default:false" json:"failing"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type NotificationDelivery struct {
	// The claim below orders by id and reads only rows that are neither sent nor parked, so the partial index leads with id and covers exactly the live backlog: delivered rows leave it instead of being scanned past on every tick.
	ID            uint   `gorm:"primaryKey;index:notification_outbox_pending,where:sent_at IS NULL AND skipped_at IS NULL"`
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

// The backoff doubles to a 64-minute cap, so the eleven waits between twelve
// attempts are 1+2+4+8+16+32 minutes and then five more at the cap: 63 + 320
// minutes, six hours and twenty-three minutes. A destination that has accepted
// nothing in that window is broken, not briefly unavailable.
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

// Every reason that can reach a notification, in both languages the product
// ships notifications in. The two maps carry the same keys: a reason present in
// one and missing from the other reaches the message with no label at all, which
// names the pull request and not why it needs anybody.
var (
	reasonLabels   = map[string]string{"human_feedback": "New human feedback", "review_requested": "Review requested", "changes_requested": "Changes requested", "author_updated": "Author updated the PR", "approval_revoked": "Approval dismissed", "conflict": "Merge conflict", "checks_failed": "Checks failed", "overdue": "Waiting over the follow-up period", "snooze_due": "Reminder due"}
	reasonLabelsZH = map[string]string{"human_feedback": "新的人工反馈", "review_requested": "请求你审核", "changes_requested": "有人要求修改", "author_updated": "作者更新了 PR", "approval_revoked": "批准已撤回", "conflict": "存在合并冲突", "checks_failed": "检查失败", "overdue": "等待超过设定期限", "snooze_due": "提醒已到期"}
)

func followUpNotification(pr PullRequest, follow FollowUp, reasons []string, now time.Time, language ...string) string {
	facts := follow.facts()
	parts := []string{fmt.Sprintf("%s #%d · %s", pr.Repo, pr.Number, pr.Title)}
	labels := reasonLabels
	if len(language) > 0 && language[0] == "zh-CN" {
		labels = reasonLabelsZH
	}
	for _, reason := range reasons {
		if label := labels[reason]; label != "" {
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
		includedIDs := []uint{}
		for _, follow := range follows {
			if settings.includes(follow.facts()) {
				included = append(included, follow)
				includedIDs = append(includedIDs, follow.ID)
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
		// Events of a follow-up the current filter excludes are never reached by the loop above, so they would stay pending and be delivered as news on the day their team is selected again. They are retired where they were skipped instead. Only the rows this tick actually read are retired: a follow-up created after the snapshot carries its own clock, so a blanket predicate would silently swallow the first event of a pull request that arrived while this transaction was open.
		selected := map[uint]bool{}
		for _, id := range includedIDs {
			selected[id] = true
		}
		stale := []uint{}
		for _, event := range events {
			if !selected[event.FollowUpID] {
				stale = append(stale, event.ID)
			}
		}
		if len(stale) > 0 {
			if err := tx.Model(&FollowUpEvent{}).Where("id IN ?", stale).Update("dispatched_at", now).Error; err != nil {
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
	// The message may already be accepted upstream by the time shutdown cancels ctx, and a refused outcome write leaves the row claimable again two minutes later, so the outcome is recorded on a handle that shutdown cannot cancel. The next claim still runs on ctx and ends the loop. The budget starts here rather than before the send, or a send that used its own thirty seconds would leave nothing to record the result with — which is precisely the slow upstream whose message must not be sent twice.
	outcomeCtx, cancelOutcome := context.WithTimeout(context.WithoutCancel(ctx), outcomeWriteBudget)
	defer cancelOutcome()
	updates := map[string]any{"leased_until": nil}
	failing := destination.Failing
	if err == nil {
		updates["sent_at"] = now
		updates["last_error"] = ""
		failing = false
	} else if delivery.Attempts >= deliveryAttemptLimit {
		// By now the backoff is an hour and the destination has been failing for
		// about a day. Retrying forever keeps a dead endpoint in the queue and
		// hides it, so the message is parked and the destination is reported as
		// failing where the account holder can see it.
		updates["skipped_at"] = now
		updates["last_error"] = "gave_up"
		failing = true
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
	// The outcome goes first: it is what keeps a delivered message from being sent again, and the health of the destination can wait for the next attempt.
	if err := s.db.WithContext(outcomeCtx).Model(&NotificationDelivery{}).Where("id = ? AND attempts = ?", delivery.ID, delivery.Attempts).Updates(updates).Error; err != nil {
		return true, err
	}
	if failing == destination.Failing {
		return true, nil
	}
	return true, s.db.WithContext(outcomeCtx).Model(&NotificationDestination{}).Where("id = ?", destination.ID).Update("failing", failing).Error
}

// How long the outcome write is given after the send returns. A variable so a test can shorten it; nothing changes it at runtime.
var outcomeWriteBudget = 10 * time.Second

// A sent or parked row is kept only as a ledger: the claim above never reads it again and the settings page reads the destination's own flag, so nothing but an operator looking at history depends on it. Thirty days is far beyond the lifetime of every dedupe key the unique index protects, which is what decides the floor here: a digest key carries a local date and can only come up again within a day of it, even if a timezone change moves the local date backwards, an event key carries follow-up event ids that are never reused, and the single inventory message is guarded by the settings row rather than by its delivery. Dispatched events go with them because the materializer only ever selects rows with dispatched_at IS NULL.
const notificationRetention = 30 * 24 * time.Hour

func (s *Server) purgeDeliveredNotifications(now time.Time) {
	cutoff := now.Add(-notificationRetention)
	_ = s.db.Where("(sent_at IS NOT NULL AND sent_at < ?) OR (skipped_at IS NOT NULL AND skipped_at < ?)", cutoff, cutoff).Delete(&NotificationDelivery{}).Error
	_ = s.db.Where("dispatched_at IS NOT NULL AND dispatched_at < ?", cutoff).Delete(&FollowUpEvent{}).Error
}
