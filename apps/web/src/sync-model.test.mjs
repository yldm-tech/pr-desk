import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { lastSyncedAt, shouldRefreshAfterSync, SYNC_STALE_AFTER_MS, syncHealth, syncPollInterval, syncRunInFlight } from "./sync-model.ts";

test("refreshes a sync completed entirely between polls", () => {
  assert.equal(shouldRefreshAfterSync({ status: "idle" }, { status: "complete", updated_at: "2026-09-10T00:00:00Z" }), true);
  assert.equal(shouldRefreshAfterSync({ status: "complete", updated_at: "2026-09-10T00:00:00Z" }, { status: "complete", updated_at: "2026-09-10T00:05:00Z" }), true);
});
test("does not repeatedly refresh an unchanged completed snapshot", () => {
  const snapshot = { status: "complete", updated_at: "2026-09-10T00:00:00Z" };
  assert.equal(shouldRefreshAfterSync(snapshot, snapshot), false);
  assert.equal(shouldRefreshAfterSync({ status: "running" }, { status: "running" }), false);
  assert.equal(shouldRefreshAfterSync(snapshot, undefined), false);
});
test("refreshes partial data after a running sync stops", () => {
  assert.equal(shouldRefreshAfterSync({ status: "running" }, { status: "failed" }), true);
});

test("a run in flight is polled every second, an idle tab every thirty", () => {
  assert.equal(syncPollInterval(true, "idle"), 1000);
  assert.equal(syncPollInterval(false, "queued"), 1000);
  assert.equal(syncPollInterval(false, "running"), 1000);
  for (const status of ["idle", "complete", "failed", "interrupted", undefined]) assert.equal(syncPollInterval(false, status), 30000);
});
test("only a run in flight keeps polling a hidden tab", () => {
  assert.equal(syncRunInFlight(true, undefined), true);
  assert.equal(syncRunInFlight(false, "queued"), true);
  assert.equal(syncRunInFlight(false, "running"), true);
  for (const status of ["idle", "complete", "failed", "interrupted", undefined]) assert.equal(syncRunInFlight(false, status), false);
});

test("does not refresh on the first snapshot after mount", () => {
  // Nothing has changed yet: there is no previous poll to have changed from, and the sync it reports may have finished long before this tab was opened.
  assert.equal(shouldRefreshAfterSync(undefined, { status: "complete", updated_at: "2026-01-01T00:00:00Z" }), false);
  assert.equal(shouldRefreshAfterSync(undefined, { status: "running" }), false);
});

test("sync health checks paused, failed, syncing, unknown, stale and fresh in that order", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const recent = "2026-09-27T11:56:00Z";
  const old = "2026-09-27T10:30:00Z";
  // Paused wins over everything, including a run the server still reports as running.
  assert.equal(syncHealth({ status: "running", last_synced_at: recent }, { sync_paused: true }, now), "paused");
  assert.equal(syncHealth({ status: "failed", last_synced_at: recent }, {}, now, { pending: true }), "failed");
  assert.equal(syncHealth({ status: "interrupted" }, {}, now), "failed");
  assert.equal(syncHealth({ status: "queued" }, {}, now), "syncing");
  assert.equal(syncHealth({ status: "running" }, {}, now, { pollError: true }), "syncing");
  assert.equal(syncHealth({ status: "complete", last_synced_at: recent }, {}, now, { pending: true }), "syncing");
  assert.equal(syncHealth({ status: "complete", last_synced_at: recent }, {}, now, { pollError: true }), "unknown");
  assert.equal(syncHealth({ status: "complete", last_synced_at: old }, {}, now), "stale");
  assert.equal(syncHealth({ status: "complete", last_synced_at: recent }, {}, now), "fresh");
  assert.equal(syncHealth({ status: "idle" }, {}, now), "first");
});

test("staleness starts one hour after the last completed sync", () => {
  const last = Date.parse("2026-09-27T11:00:00Z");
  const progress = { status: "complete", last_synced_at: "2026-09-27T11:00:00Z" };
  assert.equal(syncHealth(progress, {}, last + SYNC_STALE_AFTER_MS), "fresh");
  assert.equal(syncHealth(progress, {}, last + SYNC_STALE_AFTER_MS + 1), "stale");
  assert.equal(SYNC_STALE_AFTER_MS, 3600000);
});

test("the last sync time falls back to the session and ignores garbage", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  assert.equal(syncHealth(undefined, { last_synced_at: "2026-09-27T11:59:00Z" }, now), "fresh");
  assert.equal(lastSyncedAt({ status: "idle", last_synced_at: "not a date" }, undefined), null);
  assert.equal(lastSyncedAt({ status: "complete", last_synced_at: null }, { last_synced_at: "2026-09-27T11:00:00Z" }), Date.parse("2026-09-27T11:00:00Z"));
});
