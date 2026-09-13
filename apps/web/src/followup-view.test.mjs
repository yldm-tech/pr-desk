import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { factsSurvive, followUpSchema, groupItems, groupOf, handledIsUseful, isMuted, isReadyToMerge, matchesStatus, reasonTone, snoozeBounds, stableOrder, waitingLabel } from "./followup-view.ts";

const now = Date.parse("2026-09-13T12:00:00Z");
const day = 86400000;
const pr = { id: 1, repo: "org/repo", title: "Example", number: 7 };
const item = (overrides) => ({ id: 1, version: 3, role: "authored", state: "waiting", reasons: [], unread: false, excerpt: "", waiting_since: "2026-09-01T12:00:00Z", archived_at: null, snoozed_until: null, pr, ...overrides });

test("the schema keeps the snooze wake time the server has always sent", () => {
  const parsed = followUpSchema.parse({ ...item({ snoozed_until: "2026-09-20T00:00:00Z" }), pr: { ...pr, draft: true, review_status: "approved" } });
  assert.equal(parsed.snoozed_until, "2026-09-20T00:00:00Z");
  assert.equal(parsed.pr.draft, true);
  // A row that has never been snoozed parses with the field absent rather than failing.
  assert.equal(followUpSchema.parse({ ...item(), snoozed_until: undefined }).snoozed_until, undefined);
});

test("a mute is only a mute while its wake time is still ahead", () => {
  assert.equal(isMuted({ snoozed_until: new Date(now + day).toISOString() }, now), true);
  assert.equal(isMuted({ snoozed_until: new Date(now - day).toISOString() }, now), false);
  assert.equal(isMuted({ snoozed_until: null }, now), false);
  assert.equal(isMuted({}, now), false);
  assert.equal(isMuted({ snoozed_until: "not-a-date" }, now), false);
});

test("muted displaces waiting and never displaces action or follow-up", () => {
  const future = new Date(now + day).toISOString();
  assert.equal(groupOf(item({ state: "waiting", snoozed_until: future }), now), "muted");
  assert.equal(groupOf(item({ state: "action", snoozed_until: future }), now), "action");
  assert.equal(groupOf(item({ state: "follow_up", snoozed_until: future }), now), "follow_up");
  assert.equal(groupOf(item({ state: "draft", snoozed_until: future }), now), "draft");
  assert.equal(groupOf(item({ state: "archived", snoozed_until: future }), now), "archived");
  assert.equal(groupOf(item({ state: "waiting" }), now), "waiting");
});

test("groups come back in rank order, empty ones elided, order preserved inside", () => {
  const rows = [item({ id: 1, state: "archived" }), item({ id: 2, state: "waiting", snoozed_until: new Date(now + day).toISOString() }), item({ id: 3, state: "action" }), item({ id: 4, state: "waiting" }), item({ id: 5, state: "action" })];
  const groups = groupItems(rows, now);
  assert.deepEqual(
    groups.map((group) => group.group),
    ["action", "muted", "waiting", "archived"],
  );
  assert.deepEqual(
    groups[0].items.map((row) => row.id),
    [3, 5],
  );
  assert.equal(
    groups.find((group) => group.group === "follow_up"),
    undefined,
  );
  assert.deepEqual(groupItems([], now), []);
});

test("the default status is the set the sidebar badge counts", () => {
  const action = item({ state: "action" }),
    followUp = item({ state: "follow_up" }),
    waiting = item({ state: "waiting" }),
    archived = item({ state: "archived" }),
    muted = item({ state: "waiting", snoozed_until: new Date(now + day).toISOString() });
  assert.deepEqual(
    [action, followUp, waiting, archived, muted].map((row) => matchesStatus(row, "todo", now)),
    [true, true, false, false, false],
  );
  assert.deepEqual(
    [action, followUp, waiting, archived, muted].map((row) => matchesStatus(row, "all", now)),
    [true, true, true, false, true],
  );
  assert.deepEqual(
    [action, followUp, waiting, archived, muted].map((row) => matchesStatus(row, "muted", now)),
    [false, false, false, false, true],
  );
  assert.deepEqual(
    [action, followUp, waiting, archived, muted].map((row) => matchesStatus(row, "waiting", now)),
    [false, false, true, false, true],
  );
});

test("Handled is only offered where it can change something", () => {
  assert.equal(handledIsUseful(item({ reasons: ["human_feedback"] })), true);
  assert.equal(handledIsUseful(item({ reasons: ["conflict"] })), false);
  assert.equal(handledIsUseful(item({ reasons: ["conflict", "checks_failed"] })), false);
  assert.equal(handledIsUseful(item({ reasons: ["human_feedback", "conflict"] })), true);
  // A resting card carries no reasons at all; Handled there is a no-op the reader can still reasonably want.
  assert.equal(handledIsUseful(item({ reasons: [] })), true);
});

test("the confirmation says so when GitHub's own facts outlive the action", () => {
  assert.equal(factsSurvive(item({ reasons: ["human_feedback", "conflict"] })), true);
  assert.equal(factsSurvive(item({ reasons: ["checks_failed"] })), true);
  assert.equal(factsSurvive(item({ reasons: ["human_feedback", "overdue"] })), false);
  assert.equal(factsSurvive(item({ reasons: [] })), false);
});

test("Ready to merge needs the whole quadruple and belongs to the author", () => {
  const green = { ...pr, review_status: "approved", checks_status: "success", has_conflicts: false };
  assert.equal(isReadyToMerge(green, "authored"), true);
  // A reviewer looking at an approved, green PR is done with it and is not the person who merges, so the same facts produce nothing for them.
  assert.equal(isReadyToMerge(green, "reviewer"), false);
  assert.equal(isReadyToMerge({ ...green, checks_status: "failure" }, "authored"), false);
  assert.equal(isReadyToMerge({ ...green, review_status: "changes_requested" }, "authored"), false);
  assert.equal(isReadyToMerge({ ...green, has_conflicts: true }, "authored"), false);
  // No pipeline at all is not a passing pipeline, and neither is one that has not resolved.
  assert.equal(isReadyToMerge({ ...green, checks_status: undefined }, "authored"), false);
  assert.equal(isReadyToMerge({ ...green, checks_status: "unknown" }, "authored"), false);
  // A row nobody has reviewed is not ready however green the build is.
  assert.equal(isReadyToMerge({ ...green, review_status: undefined }, "authored"), false);
});

test("reason tones keep the three-way grouping and fall back to neutral", () => {
  assert.equal(reasonTone("conflict"), "blocked");
  assert.equal(reasonTone("checks_failed"), "blocked");
  assert.equal(reasonTone("human_feedback"), "action");
  assert.equal(reasonTone("overdue"), "waiting");
  // Both of these used to be unreachable on a card, because presentation() synthesized one reason from the role instead of recording what happened. They are emitted now, and both ask the reader to look again, so both take the action tone rather than falling through to neutral.
  assert.equal(reasonTone("author_updated"), "action");
  assert.equal(reasonTone("changes_requested"), "action");
  assert.equal(reasonTone("something_new"), "neutral");
});

test("the wait is a duration, and an unparseable one is no sentence at all", () => {
  assert.deepEqual(waitingLabel(new Date(now - 6 * day).toISOString(), now), { key: "followup.waitingDays", count: 6 });
  assert.deepEqual(waitingLabel(new Date(now - 3 * 3600000).toISOString(), now), { key: "followup.waitingToday", count: 0 });
  assert.deepEqual(waitingLabel(new Date(now + day).toISOString(), now), { key: "followup.waitingToday", count: 0 });
  assert.equal(waitingLabel("not-a-date", now), null);
  assert.equal(waitingLabel("", now), null);
});

test("the reminder picker cannot offer a date the server will refuse", () => {
  const bounds = snoozeBounds(now);
  assert.match(bounds.min, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.match(bounds.max, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.ok(bounds.min < bounds.max);
  // Both bounds are local wall-clock, so they are compared against the raw datetime-local value rather than an ISO instant.
  assert.equal(bounds.max.slice(0, 4), String(new Date(now).getFullYear() + 1));
  assert.ok(bounds.min > `${new Date(now).getFullYear()}-01-01T00:00`);
});

test("stableOrder holds known items in place and appends unseen ones", () => {
  const item = (id) => ({ id, version: 1, role: "authored", state: "action", reasons: [], unread: false, excerpt: "", waiting_since: "2026-09-01T00:00:00Z", archived_at: null, pr: { id, repo: "a/b", number: id, title: `t${id}` } });
  // The server has re-sorted 3 to the front and added 9; the reader's order was 1, 2, 3.
  const result = stableOrder([item(3), item(9), item(1), item(2)], [1, 2, 3]);
  assert.deepEqual(
    result.items.map((i) => i.id),
    [1, 2, 3, 9],
  );
  assert.deepEqual(result.added, [9]);
});

test("stableOrder with no remembered order leaves the server's order alone", () => {
  const item = (id) => ({ id, version: 1, role: "authored", state: "action", reasons: [], unread: false, excerpt: "", waiting_since: "2026-09-01T00:00:00Z", archived_at: null, pr: { id, repo: "a/b", number: id, title: `t${id}` } });
  // The first load has nothing to preserve, and inventing an order there would fight the server's ranking rather than protect the reader from it.
  const result = stableOrder([item(3), item(1)], []);
  assert.deepEqual(
    result.items.map((i) => i.id),
    [3, 1],
  );
  assert.deepEqual(result.added, []);
});
