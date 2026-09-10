package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAutoSyncSchedule(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name, status string
		elapsed      time.Duration
		checkpoint   bool
		want         time.Duration
	}{
		{"new connection", "", 0, false, 0},
		{"recent success", "complete", time.Minute, true, 4 * time.Minute},
		{"stale success", "complete", 6 * time.Minute, true, -time.Minute},
		{"failure cooldown", "failed", time.Minute, true, 14 * time.Minute},
		{"active sync", "running", time.Minute, true, 19 * time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stamp := now.Add(-tc.elapsed)
			token := OAuthToken{}
			if tc.checkpoint {
				token.HistorySyncedAt = &stamp
			}
			if tc.status != "" {
				b, _ := json.Marshal(syncProgress{Status: tc.status, UpdatedAt: stamp})
				token.SyncProgress = string(b)
			}
			got := nextAutoSyncAt(token, now)
			if !got.Equal(now.Add(tc.want)) {
				t.Fatalf("got %v want %v", got, now.Add(tc.want))
			}
		})
	}
}
