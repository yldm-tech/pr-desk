package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAutoSyncSchedule(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name, status, code string
		elapsed            time.Duration
		checkpoint         bool
		want               time.Duration
	}{
		{"new connection", "", "", 0, false, 0},
		{"recent success", "complete", "", time.Minute, true, 4 * time.Minute},
		{"stale success", "complete", "", 6 * time.Minute, true, -time.Minute},
		{"failure cooldown", "failed", "", time.Minute, true, 14 * time.Minute},
		{"upstream failure still cools down", "failed", "upstream", time.Minute, true, 14 * time.Minute},
		{"storage failure still cools down", "failed", "storage", time.Minute, true, 14 * time.Minute},
		{"active sync", "running", "", time.Minute, true, 19 * time.Minute},
		// Our own shutdown says nothing about the upstream, so the run resumes at
		// the ordinary cadence instead of serving a fifteen minute penalty.
		{"shutdown mid-run does not cool down", "interrupted", "interrupted", time.Minute, true, 4 * time.Minute},
		// Written before interrupted became a status of its own.
		{"legacy interrupted row does not cool down", "failed", "interrupted", time.Minute, true, 4 * time.Minute},
		// A deploy landing during a stale checkpoint must still be due at once.
		{"interrupted with an old checkpoint is due now", "interrupted", "interrupted", 30 * time.Minute, true, -25 * time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stamp := now.Add(-tc.elapsed)
			token := OAuthToken{}
			if tc.checkpoint {
				token.HistorySyncedAt = &stamp
			}
			if tc.status != "" {
				b, _ := json.Marshal(syncProgress{Status: tc.status, ErrorCode: tc.code, UpdatedAt: stamp})
				token.SyncProgress = string(b)
			}
			got := nextAutoSyncAt(token, now)
			if !got.Equal(now.Add(tc.want)) {
				t.Fatalf("got %v want %v", got, now.Add(tc.want))
			}
		})
	}
}

// A rate limit carries its own retry time, which has to keep winning over the
// interrupted exemption if the two ever coincide.
func TestAutoSyncHonoursAnExplicitRetryTime(t *testing.T) {
	now := time.Now().UTC()
	retry := now.Add(42 * time.Minute)
	b, _ := json.Marshal(syncProgress{Status: "interrupted", ErrorCode: "interrupted", UpdatedAt: now, RetryAt: retry.Unix()})
	stamp := now.Add(-time.Minute)
	token := OAuthToken{HistorySyncedAt: &stamp, SyncProgress: string(b)}
	if got := nextAutoSyncAt(token, now); !got.Equal(retry.Truncate(time.Second)) {
		t.Fatalf("an explicit retry time was overridden: got %v want %v", got, retry)
	}
}
