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
