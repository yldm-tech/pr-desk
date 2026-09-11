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
		// The cooldown exists so a failing upstream is not hammered. A run this
		// process abandoned on its way down says nothing about the upstream, so
		// it earns no penalty: a deploy would otherwise freeze the data for
		// fifteen minutes every time, and a run of deploys can keep cancelling
		// the retry before it lands. Keyed on the code rather than the status so
		// that rows written before interrupted became a status still match.
		if progress.ErrorCode != "interrupted" && (progress.Status == "failed" || progress.Status == "interrupted" || progress.Status == "running") {
			delay := autoSyncFailureCooldown
			// A run still claiming to be active may genuinely be running in
			// another instance. Twenty minutes of silence is what the rest of the
			// system already treats as abandoned.
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
