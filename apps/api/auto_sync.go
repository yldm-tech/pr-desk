package main

import (
	"encoding/json"
	"time"
)

const autoSyncInterval = 5 * time.Minute
const autoSyncFailureCooldown = 15 * time.Minute

func nextAutoSyncAt(token OAuthToken, now time.Time) time.Time {
	if token.SyncRequestedAt != nil {
		return *token.SyncRequestedAt
	}
	next := now
	if token.HistorySyncedAt != nil {
		next = token.HistorySyncedAt.Add(autoSyncInterval)
	}
	var progress syncProgress
	if json.Unmarshal([]byte(token.SyncProgress), &progress) == nil {
		if progress.Status == "complete" && progress.UpdatedAt.Add(autoSyncInterval).After(next) {
			next = progress.UpdatedAt.Add(autoSyncInterval)
		}
		if progress.Status == "failed" || progress.Status == "interrupted" || progress.Status == "running" {
			delay := autoSyncFailureCooldown
			if progress.Status == "running" {
				delay = 20 * time.Minute
			}
			if until := progress.UpdatedAt.Add(delay); until.After(next) {
				next = until
			}
		}
		if until := time.Unix(progress.RetryAt, 0); until.After(next) {
			next = until
		}
	}
	return next
}
