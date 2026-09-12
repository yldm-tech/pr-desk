import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { shouldRefreshAfterSync } from "./sync-model.ts";

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

test("does not refresh on the first snapshot after mount", () => {
  // Nothing has changed yet: there is no previous poll to have changed from, and
  // the sync it reports may have finished long before this tab was opened.
  assert.equal(shouldRefreshAfterSync(undefined, { status: "complete", updated_at: "2026-01-01T00:00:00Z" }), false);
  assert.equal(shouldRefreshAfterSync(undefined, { status: "running" }), false);
});
