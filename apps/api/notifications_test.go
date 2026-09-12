package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDigestUsesUserTimezoneAndOncePerLocalDay(t *testing.T) {
	settings := FollowUpSettings{Timezone: "Asia/Tokyo", DigestTime: "09:00"}
	before := time.Date(2026, 9, 11, 23, 59, 0, 0, time.UTC)
	if _, due := digestDue(settings, before); due { // It is 08:59 tomorrow in Tokyo.
		t.Fatal("early digest")
	}
	date, due := digestDue(settings, before.Add(time.Minute))
	if !due || date != "2026-09-12" {
		t.Fatal("timezone not respected")
	}
	settings.LastDigestDate = date
	if _, due := digestDue(settings, before.Add(2*time.Hour)); due {
		t.Fatal("same local day repeated")
	}
	settings = FollowUpSettings{Timezone: "America/New_York", DigestTime: "01:30"}
	first := time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)
	date, due = digestDue(settings, first)
	if !due {
		t.Fatal("DST first occurrence omitted")
	}
	settings.LastDigestDate = date
	if _, due := digestDue(settings, first.Add(time.Hour)); due {
		t.Fatal("DST repeated digest")
	}
}

func TestNotificationCoalescingTargetsAndRetry(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	settings := FollowUpSettings{SessionID: "notify", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, BaselineAt: &now, InventoryAt: &now}
	db.Create(&settings)
	destinations := []NotificationDestination{{SessionID: "notify", Name: "one", Enabled: true}, {SessionID: "notify", Name: "two", Enabled: true}, {SessionID: "notify", Name: "off", Enabled: false}}
	db.Create(&destinations)
	pr := PullRequest{SessionID: "notify", Repo: "fixture/repo", Number: 1, Title: "Synthetic", URL: "https://github.com/fixture/repo/pull/1"}
	db.Create(&pr)
	facts := FollowUpFacts{Role: "authored", CreatedAt: now}
	persistFollowUp(db, pr, facts, now)
	facts.HumanVersion = "new-comment"
	facts.HumanAt = now.Add(time.Minute)
	persistFollowUp(db, pr, facts, now.Add(time.Minute))
	facts.Conflict = true
	persistFollowUp(db, pr, facts, now.Add(2*time.Minute))
	if err := s.queueAccountNotifications(context.Background(), "notify", now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&NotificationDelivery{}).Count(&count)
	if count != 0 {
		t.Fatal("coalescing window not respected")
	}
	if err := s.queueAccountNotifications(context.Background(), "notify", now.Add(6*time.Minute)); err != nil {
		t.Fatal(err)
	}
	db.Model(&NotificationDelivery{}).Count(&count)
	if count != 2 {
		t.Fatalf("need one message per enabled target, got %d", count)
	}
	if err := s.queueAccountNotifications(context.Background(), "notify", now.Add(7*time.Minute)); err != nil {
		t.Fatal(err)
	}
	db.Model(&NotificationDelivery{}).Count(&count)
	if count != 2 {
		t.Fatal("materialization duplicate")
	}
	failure := func(context.Context, NotificationDestination, NotificationDelivery) error {
		return errors.New("sensitive upstream error deliberately not stored")
	}
	if _, err := s.deliverOneNotification(context.Background(), now.Add(6*time.Minute), failure); err != nil {
		t.Fatal(err)
	}
	var first NotificationDelivery
	db.Order("id").First(&first)
	if first.SentAt != nil || first.LastError != "delivery_failed" || first.Attempts != 1 {
		t.Fatal("bad retry record")
	}
	var delivered []uint
	success := func(_ context.Context, d NotificationDestination, m NotificationDelivery) error {
		delivered = append(delivered, d.ID)
		if !strings.Contains(m.Body, "New human feedback") || !strings.Contains(m.Body, "Merge conflict") {
			t.Fatal("events not coalesced")
		}
		return nil
	}
	for range 3 {
		if _, err := s.deliverOneNotification(context.Background(), now.Add(8*time.Minute), success); err != nil {
			t.Fatal(err)
		}
	}
	if len(delivered) != 2 {
		t.Fatalf("independent delivery retry failed: %v", delivered)
	}
	var follow FollowUp
	db.First(&follow)
	if follow.ReadVersion != 0 || follow.HandledVersion != 0 || !follow.NeedsConfirmation {
		t.Fatal("delivery cleared work")
	}
}

func TestInventoryAndEmptyDigest(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	settings := FollowUpSettings{SessionID: "inventory", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, BaselineAt: &now}
	db.Create(&settings)
	db.Create(&NotificationDestination{SessionID: "inventory", Name: "one", Enabled: true})
	for _, at := range []time.Time{now, now.Add(time.Minute), now.Add(24 * time.Hour)} {
		if err := s.queueAccountNotifications(context.Background(), "inventory", at); err != nil {
			t.Fatal(err)
		}
	}
	var deliveries []NotificationDelivery
	db.Find(&deliveries)
	if len(deliveries) != 1 || !strings.HasPrefix(deliveries[0].MessageKey, "inventory:") {
		t.Fatalf("empty or repeated digest sent: %d", len(deliveries))
	}
}

func TestUnicodeNotificationChunking(t *testing.T) {
	text := strings.Repeat("贡献🙂\n", 3000)
	parts := notificationParts(text)
	if strings.Join(parts, "") != text {
		t.Fatal("lost message text")
	}
	for _, part := range parts {
		if len([]rune(part)) > 3500 {
			t.Fatal("oversized message")
		}
	}
}

func TestDisabledDestinationDoesNotSendQueuedMessages(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	target := NotificationDestination{SessionID: "owner", Name: "disabled-after-queue", Enabled: true}
	db.Create(&target)
	if err := queueMessage(db, []NotificationDestination{target}, "test", "synthetic notification", now); err != nil {
		t.Fatal(err)
	}
	db.Model(&target).Update("enabled", false)
	called := false
	claimed, err := s.deliverOneNotification(context.Background(), now, func(context.Context, NotificationDestination, NotificationDelivery) error { called = true; return nil })
	if err != nil || !claimed || called {
		t.Fatal("disabled destination sent", err)
	}
	var delivery NotificationDelivery
	db.First(&delivery)
	if delivery.SkippedAt == nil || delivery.SentAt != nil {
		t.Fatal("disabled target reported sent")
	}
	if claimed, err := s.deliverOneNotification(context.Background(), now.Add(time.Hour), func(context.Context, NotificationDestination, NotificationDelivery) error { called = true; return nil }); err != nil || claimed || called {
		t.Fatal("skipped delivery was retried", err)
	}
}

func TestDeliveryErrorSummaryRemovesEndpoints(t *testing.T) {
	if summary := deliveryErrorSummary(nil); summary != "" {
		t.Fatal("a success produced an error reason", summary)
	}
	summary := deliveryErrorSummary(errors.New(`Post "https://open.feishu.cn/open-apis/bot/v2/hook/9f3-secret": dial tcp 1.2.3.4:443: i/o timeout`))
	if strings.Contains(summary, "9f3-secret") || strings.Contains(summary, "https://") {
		t.Fatal("the webhook endpoint survived into the stored reason", summary)
	}
	if !strings.Contains(summary, "[endpoint]") || !strings.Contains(summary, "i/o timeout") {
		t.Fatal("the reason lost the part an operator needs", summary)
	}
	if long := deliveryErrorSummary(errors.New(strings.Repeat("跟", 400))); len([]rune(long)) != 200 {
		t.Fatal("long reasons are not bounded", len([]rune(long)))
	}
}

// A disconnected account keeps its follow-up rows frozen, so every waiting row
// eventually looks overdue and would produce a digest every day forever.
func TestOutboxOnlyMaterializesConnectedAccounts(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "outbox-live", Username: "live", Token: "encrypted"}, 9001, "outbox-browser-live"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "outbox-gone", Username: "gone", Token: "encrypted"}, 9002, "outbox-browser-gone"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&OAuthToken{}).Where("session_id = ?", "outbox-gone").Updates(map[string]any{"token": "", "authorization_error": "disconnected"}).Error; err != nil {
		t.Fatal(err)
	}
	sessions, err := s.notifiableSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, sid := range sessions {
		found[sid] = true
	}
	if !found["outbox-live"] {
		t.Fatal("a connected account was skipped", sessions)
	}
	if found["outbox-gone"] {
		t.Fatal("a disconnected account would still be sent notifications", sessions)
	}
}

// A destination that never recovers must not stay in the queue forever: the
// message is parked, and the destination is reported as failing so it is
// visible instead of silently dropped.
func TestDeliveryGivesUpAfterRepeatedFailures(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	cipher, err := crypt(mustJSON(destinationConfig{URL: "https://example.test/hook"}))
	if err != nil {
		t.Fatal(err)
	}
	destination := NotificationDestination{SessionID: "give-up", Name: "broken", Kind: destinationWebhook, Enabled: true, ConfigCipher: cipher}
	if err := db.Create(&destination).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&NotificationDelivery{SessionID: "give-up", DestinationID: destination.ID, MessageKey: "k:0", Body: "body", AvailableAt: now, Attempts: deliveryAttemptLimit - 1}).Error; err != nil {
		t.Fatal(err)
	}
	failing := func(context.Context, NotificationDestination, NotificationDelivery) error {
		return errors.New("endpoint is gone")
	}
	claimed, err := s.deliverOneNotification(context.Background(), now.Add(time.Hour), failing)
	if err != nil || !claimed {
		t.Fatal("the delivery was not attempted", claimed, err)
	}
	var row NotificationDelivery
	if err := db.Where("destination_id = ?", destination.ID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.SkippedAt == nil || row.LastError != "gave_up" {
		t.Fatal("a permanently failing delivery is still queued", row.SkippedAt, row.LastError)
	}
	// It must not be claimed again on the next tick.
	if claimed, err := s.deliverOneNotification(context.Background(), now.Add(2*time.Hour), failing); err != nil || claimed {
		t.Fatal("a parked delivery was retried", claimed, err)
	}
	var flagged NotificationDestination
	if err := db.Where("id = ?", destination.ID).First(&flagged).Error; err != nil {
		t.Fatal(err)
	}
	if !flagged.Failing {
		t.Fatal("a destination that gave up is not reported as failing")
	}
	// A destination that accepts a message again is working, whatever became of the parked one.
	if err := db.Create(&NotificationDelivery{SessionID: "give-up", DestinationID: destination.ID, MessageKey: "k:1", Body: "body", AvailableAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	accepted := func(context.Context, NotificationDestination, NotificationDelivery) error { return nil }
	if claimed, err := s.deliverOneNotification(context.Background(), now.Add(3*time.Hour), accepted); err != nil || !claimed {
		t.Fatal("the recovery message was not delivered", claimed, err)
	}
	var recovered NotificationDestination
	if err := db.Where("id = ?", destination.ID).First(&recovered).Error; err != nil {
		t.Fatal(err)
	}
	if recovered.Failing {
		t.Fatal("the warning outlived the outage it was about")
	}
}

// A message the upstream already accepted must not be sent again because the
// process was asked to stop before its outcome was written.
func TestDeliveryOutcomeSurvivesShutdown(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	target := NotificationDestination{SessionID: "shutdown", Name: "accepting", Enabled: true}
	db.Create(&target)
	if err := queueMessage(db, []NotificationDestination{target}, "shutdown", "synthetic notification", now); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	claimed, err := s.deliverOneNotification(ctx, now, func(context.Context, NotificationDestination, NotificationDelivery) error { cancel(); return nil })
	if err != nil || !claimed {
		t.Fatal("the delivery outcome was not recorded", claimed, err)
	}
	var row NotificationDelivery
	if err := db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.SentAt == nil || row.LeasedUntil != nil {
		t.Fatal("a sent message stayed claimable", row.SentAt, row.LeasedUntil)
	}
	called := false
	// The lease is two minutes, so the next tick past it would send it a second time.
	if claimed, err := s.deliverOneNotification(context.Background(), now.Add(3*time.Minute), func(context.Context, NotificationDestination, NotificationDelivery) error { called = true; return nil }); err != nil || claimed || called {
		t.Fatal("a delivered message was sent again after the restart", claimed, err)
	}
}

// The write that records a delivery has to be given its budget after the send, not before it: a slow upstream is exactly the case where the message lands and the outcome must still be storable, and an expired handle would send it again on the next tick.
func TestASlowSendStillLeavesRoomToRecordItsOutcome(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	target := NotificationDestination{SessionID: "slow", Name: "accepting", Enabled: true}
	db.Create(&target)
	if err := queueMessage(db, []NotificationDestination{target}, "slow", "synthetic notification", now); err != nil {
		t.Fatal(err)
	}
	previous := outcomeWriteBudget
	outcomeWriteBudget = 50 * time.Millisecond
	t.Cleanup(func() { outcomeWriteBudget = previous })
	claimed, err := s.deliverOneNotification(context.Background(), now, func(context.Context, NotificationDestination, NotificationDelivery) error {
		time.Sleep(80 * time.Millisecond)
		return nil
	})
	if err != nil || !claimed {
		t.Fatal("a slow send lost its outcome", claimed, err)
	}
	var row NotificationDelivery
	if err := db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.SentAt == nil {
		t.Fatal("the message would be sent again on the next tick")
	}
}

// Deselecting a team while its events wait out the aggregation window used to
// leave them pending until the team came back, when they were announced as news.
func TestEventsOfAnExcludedFollowUpAreRetired(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	settings := FollowUpSettings{SessionID: "teams", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, TeamsJSON: `["org/platform"]`, BaselineAt: &now, InventoryAt: &now}
	db.Create(&settings)
	db.Create(&NotificationDestination{SessionID: "teams", Name: "one", Enabled: true})
	pr := PullRequest{SessionID: "teams", Repo: "fixture/repo", Number: 1, Title: "Synthetic", URL: "https://github.com/fixture/repo/pull/1"}
	db.Create(&pr)
	facts := FollowUpFacts{Role: "reviewer", ReviewTeams: []string{"org/platform"}, CreatedAt: now}
	if err := persistFollowUp(db, pr, facts, now); err != nil {
		t.Fatal(err)
	}
	facts.HumanVersion = "new-comment"
	facts.HumanAt = now.Add(time.Minute)
	if err := persistFollowUp(db, pr, facts, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var pending int64
	db.Model(&FollowUpEvent{}).Where("dispatched_at IS NULL").Count(&pending)
	if pending == 0 {
		t.Fatal("the fixture produced no event to strand")
	}
	if err := db.Model(&FollowUpSettings{}).Where("session_id = ?", "teams").Update("teams_json", "[]").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.queueAccountNotifications(context.Background(), "teams", now.Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&NotificationDelivery{}).Count(&count)
	if count != 0 {
		t.Fatal("an excluded follow-up was announced", count)
	}
	db.Model(&FollowUpEvent{}).Where("dispatched_at IS NULL").Count(&pending)
	if pending != 0 {
		t.Fatal("an excluded follow-up left its events waiting forever", pending)
	}
	if err := db.Model(&FollowUpSettings{}).Where("session_id = ?", "teams").Update("teams_json", `["org/platform"]`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.queueAccountNotifications(context.Background(), "teams", now.Add(20*time.Minute)); err != nil {
		t.Fatal(err)
	}
	db.Model(&NotificationDelivery{}).Count(&count)
	if count != 0 {
		t.Fatal("retired events were replayed when the team was selected again", count)
	}
}

// The claim reads the backlog in id order on every tick, so without an index
// restricted to rows that are neither sent nor parked it walks the primary key
// past every message the deployment ever delivered.
func TestOutboxClaimIsIndexedOverPendingRows(t *testing.T) {
	db := integrationDB(t)
	if !db.Migrator().HasIndex(&NotificationDelivery{}, "notification_outbox_pending") {
		t.Fatal("the outbox claim has no index over the pending deliveries")
	}
	var definition string
	if err := db.Raw("SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'notification_outbox_pending'").Scan(&definition).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(definition, "sent_at IS NULL") || !strings.Contains(definition, "skipped_at IS NULL") {
		t.Fatal("the index covers delivered rows too", definition)
	}
}

// The sweep may only take history: a queued message or an undispatched event is
// still work, and a delivery row that any dedupe key still needs is not history.
func TestPurgeKeepsQueuedNotificationsAndPendingEvents(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	old := now.Add(-notificationRetention - time.Hour)
	recent := now.Add(-time.Hour)
	destination := NotificationDestination{SessionID: "retention", Name: "one", Enabled: true}
	db.Create(&destination)
	db.Create(&NotificationDelivery{SessionID: "retention", DestinationID: destination.ID, MessageKey: "digest:2020-01-01:0", Body: "sent long ago", AvailableAt: old, SentAt: &old})
	db.Create(&NotificationDelivery{SessionID: "retention", DestinationID: destination.ID, MessageKey: "event:1:1:0", Body: "parked long ago", AvailableAt: old, SkippedAt: &old})
	db.Create(&NotificationDelivery{SessionID: "retention", DestinationID: destination.ID, MessageKey: "digest:today:0", Body: "sent an hour ago", AvailableAt: recent, SentAt: &recent})
	db.Create(&NotificationDelivery{SessionID: "retention", DestinationID: destination.ID, MessageKey: "digest:today:1", Body: "still queued", AvailableAt: old})
	db.Create(&FollowUpEvent{SessionID: "retention", FollowUpID: 1, Version: 1, ReasonsJSON: "[]", CreatedAt: old, AvailableAt: old, DispatchedAt: &old})
	db.Create(&FollowUpEvent{SessionID: "retention", FollowUpID: 2, Version: 1, ReasonsJSON: "[]", CreatedAt: old, AvailableAt: old})
	s.purgeDeliveredNotifications(now)
	var kept []NotificationDelivery
	db.Order("id").Find(&kept)
	if len(kept) != 2 || kept[0].MessageKey != "digest:today:0" || kept[1].MessageKey != "digest:today:1" {
		t.Fatalf("the sweep did not keep exactly the recent and queued rows: %v", kept)
	}
	var events []FollowUpEvent
	db.Order("id").Find(&events)
	if len(events) != 1 || events[0].DispatchedAt != nil {
		t.Fatalf("the sweep did not keep exactly the undispatched event: %v", events)
	}
}
