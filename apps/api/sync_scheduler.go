package main

import (
	"context"
	"github.com/robfig/cron/v3"
	"log"
	"time"
)

// Login work outlives the callback request, but stops with the server. The
// existing advisory lock and checkpoint also arbitrate the scheduler and tabs.
func (s *Server) startLoginSync(sessionID string) <-chan struct{} {
	done := make(chan struct{})
	ctx := s.workerCtx
	if ctx == nil {
		ctx = context.Background()
	}
	go func() {
		defer close(done)
		if ctx.Err() != nil {
			return
		}
		runCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
		defer cancel()
		result := s.syncSession(runCtx, sessionID, true, false)
		if result.status >= 400 && result.status != 409 {
			log.Printf("Login sync failed (HTTP %d); background retry applies", result.status)
		}
	}()
	return done
}

// Persisted checkpoints survive restarts; advisory locks arbitrate instances.
func (s *Server) startSyncScheduler(ctx context.Context, schedule string) (*cron.Cron, error) {
	scheduler := cron.New(cron.WithChain(cron.Recover(cron.DefaultLogger), cron.SkipIfStillRunning(cron.DefaultLogger)))
	_, err := scheduler.AddFunc(schedule, func() { s.syncDueSessions(ctx) })
	if err != nil {
		return nil, err
	}
	// Materialize and deliver notification outbox independently of GitHub sync.
	// Delivery is best-effort and persisted retries are picked up on the next tick.
	if _, err := scheduler.AddFunc("@every 30s", func() { s.processNotificationOutbox(ctx) }); err != nil {
		return nil, err
	}
	scheduler.Start()
	log.Print("Background sync scheduler started (5 minute cadence)")
	return scheduler, nil
}

func (s *Server) processNotificationOutbox(ctx context.Context) {
	var settings []FollowUpSettings
	if err := s.db.WithContext(ctx).Find(&settings).Error; err != nil {
		return
	}
	now := time.Now().UTC()
	for _, item := range settings {
		if err := s.queueAccountNotifications(ctx, item.SessionID, now); err != nil {
			continue
		}
		for i := 0; i < 100; i++ {
			claimed, err := s.deliverOneNotification(ctx, now, sendTelegramNotification)
			if err != nil || !claimed {
				break
			}
		}
	}
}

func (s *Server) syncDueSessions(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	var sessions []OAuthToken
	if err := connectionQuery(s.db.WithContext(ctx)).Where("session_id <> '' AND token <> ''").Order("history_synced_at ASC NULLS FIRST").Find(&sessions).Error; err != nil {
		log.Print("Background sync: unable to load eligible connections")
		return
	}
	for _, session := range sessions {
		if ctx.Err() != nil {
			return
		}
		now := time.Now()
		if now.Before(nextAutoSyncAt(session, now)) {
			continue
		}
		// Serial execution limits search pressure; shutdown cancels SDK waits.
		runCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
		result := s.syncSession(runCtx, session.SessionID, true, false)
		cancel()
		if result.status == 200 && result.body["skipped"] != true {
			log.Print("Background sync completed")
		}
		if result.status >= 400 && result.status != 409 {
			log.Printf("Background sync failed (HTTP %d); cooldown applies", result.status)
		}
	}
}
