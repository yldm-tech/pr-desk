// Everything the follow-up surfaces decide before they render anything: the shape of the payload, which group a row belongs to, which verbs can actually do something to it, and how long it has been waiting. It lives outside the components because two screens now show the same rows — the workspace and the PR table's follow-up chips — and a rule that exists twice is a rule that will disagree with itself. Nothing here imports React, so every one of these decisions is covered by followup-view.test.mjs rather than by a browser.
import { z } from "zod";
import { PRSchema } from "./pr-model";

// PRSchema is owned elsewhere and `draft` is only needed here, so the field is added at the point of use rather than by widening the shared schema. `snoozed_until` has been served since the snooze endpoint existed (FollowUp.SnoozedUntil, apps/api/followup_model.go) and was silently dropped by the old inline schema, which is why the browser could set a reminder it could then neither see nor cancel.
export const followUpSchema = z.object({
  id: z.number(),
  version: z.number(),
  role: z.string(),
  state: z.string(),
  reasons: z.array(z.string()),
  unread: z.boolean(),
  excerpt: z.string(),
  waiting_since: z.string(),
  archived_at: z.string().nullable(),
  // Whether the row has a step to go back to. Derived server-side from the snapshot columns, so the browser never has to guess whether Undo would do anything.
  undoable: z.boolean().optional(),
  // Who wrote the excerpt and when. Without them it renders as an unattributed paragraph that reads like the pull request description.
  excerpt_by: z.string().optional(),
  excerpt_at: z.string().optional(),
  snoozed_until: z.string().nullable().optional(),
  pr: PRSchema.extend({ draft: z.boolean().optional() }),
});
export const responseSchema = z.object({ data: z.array(followUpSchema), counts: z.record(z.string(), z.number()), baseline_complete: z.boolean() });
export type FollowUp = z.infer<typeof followUpSchema>;
export type FollowUpResponse = z.infer<typeof responseSchema>;
export type FollowUpPR = FollowUp["pr"];

// Reasons are grouped by what the reader has to do about them: a blocked PR
// needs a fix, an action is waiting on the reader, and the timing reasons only
// say that the clock ran out.
// `changes_requested` and `author_updated` are now reachable: presentation() records the reason that actually raised the confirmation instead of guessing one from the role, so a reviewer whose approval was dismissed no longer reads "Review requested" when nobody requested anything. Both ask the reader to do something, so both take the action tone.
export const reasonTones: Record<string, string> = { conflict: "blocked", checks_failed: "blocked", review_requested: "action", human_feedback: "action", changes_requested: "action", author_updated: "action", approval_revoked: "action", overdue: "waiting", snooze_due: "waiting" };
export const reasonTone = (reason: string) => reasonTones[reason] || "neutral";

export type FollowUpGroup = "action" | "follow_up" | "muted" | "waiting" | "draft" | "archived";

// Rank order is the server's own (followup_store.go sorts action, follow_up, waiting, draft, archived) with the muted split out of waiting, so the headings the reader sees are the order the payload already arrived in.
const groupRank: FollowUpGroup[] = ["action", "follow_up", "muted", "waiting", "draft", "archived"];

export function isMuted(item: Pick<FollowUp, "snoozed_until">, now: number): boolean {
  if (!item.snoozed_until) return false;
  const wake = Date.parse(item.snoozed_until);
  return !Number.isNaN(wake) && wake > now;
}

// Muted displaces `waiting` and nothing else. The server already reports a muted row as waiting, so this is a finer reading of a state it agrees with — never a second opinion about whether something needs action. A reason that arrived after the mute breaks the version gate server-side and comes back as `action`, and that must stay visible.
export function groupOf(item: FollowUp, now: number): FollowUpGroup {
  if (item.state === "action") return "action";
  if (item.state === "follow_up") return "follow_up";
  if (item.state === "draft") return "draft";
  if (item.state === "archived") return "archived";
  return isMuted(item, now) ? "muted" : "waiting";
}

export function groupItems(items: FollowUp[], now: number): { group: FollowUpGroup; items: FollowUp[] }[] {
  const buckets = new Map<FollowUpGroup, FollowUp[]>();
  for (const item of items) {
    const group = groupOf(item, now);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(item);
    else buckets.set(group, [item]);
  }
  // Empty groups are dropped rather than rendered as "(0)": a heading with no rows under it reads as a load failure.
  return groupRank.flatMap((group) => {
    const bucket = buckets.get(group);
    return bucket ? [{ group, items: bucket }] : [];
  });
}

// `todo` is the default because it is exactly what the sidebar badge sums (listFollowUps counts State == "action" and State == "follow_up"); no single option covered that set before, so the badge pointed at a view that could not show it.
export function matchesStatus(item: FollowUp, status: string, now: number): boolean {
  if (status === "todo") return item.state === "action" || item.state === "follow_up";
  if (status === "all") return item.state !== "archived";
  if (status === "muted") return isMuted(item, now);
  return item.state === status;
}

const factDerived = (reason: string) => reason === "conflict" || reason === "checks_failed";

// Never offer a verb that cannot do anything. `presentation()` re-derives conflict and checks_failed from synced GitHub facts on every read, while `handled` only clears NeedsConfirmation — so on a card whose reasons are all fact-derived, Handled posts successfully, changes nothing visible, and resets WaitingSince, buying the PR another full waiting period of silence. That card gets the blockedByGitHub sentence instead of a button.
export function handledIsUseful(item: Pick<FollowUp, "reasons">): boolean {
  return !(item.reasons.length > 0 && item.reasons.every(factDerived));
}

// Handled on a mixed card clears the confirmation but leaves the fact-derived reasons standing, so the confirmation has to say so or the reader re-taps a button that already worked.
export function factsSurvive(item: Pick<FollowUp, "reasons">): boolean {
  return item.reasons.some(factDerived);
}

// The one state the product had no word for, and the only place that decides it. Only on your own PR: a reviewer looking at an approved, green PR is done with it and is not the person who merges. It is the conjunction of "Approved", "CI: Success" and "no conflicts", so the card renders this instead of those three and never beside them — a chip displayed next to its own premises tells the reader nothing the premises did not.
export const isReadyToMerge = (pr: FollowUpPR, role: string) => role === "authored" && pr.review_status === "approved" && pr.checks_status === "success" && !pr.has_conflicts;

// The duration, not the instant. Mirrors waitingDays in mcp_server.go so the sentence a human reads and the number an agent reads come from the same rule, and returns null on an unparseable value rather than printing the literal "Invalid Date" the old card produced.
export function waitingLabel(iso: string, now: number): { key: string; count: number } | null {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return null;
  const days = Math.floor((now - started) / 86400000);
  return days > 0 ? { key: "followup.waitingDays", count: days } : { key: "followup.waitingToday", count: 0 };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
// datetime-local reads and writes local wall-clock time with no zone, so the bounds have to be built from the local getters rather than from toISOString. Both strings sort lexicographically in this format, so a caller can compare an input value against them directly. The ceiling mirrors the server's own rejection at followup_store.go, which the browser used to discover only by posting an invalid date and being refused.
export function snoozeBounds(now: number): { min: string; max: string } {
  const format = (date: Date) => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + 1);
  return { min: format(new Date(now + 60000)), max: format(max) };
}

// Holds the list still while someone is working through it. The server recomputes `presentation` against a fresh clock on every read and re-sorts by state rank, so a background poll — or the refetch the reader's own action triggers — rearranges the page under the pointer. Freezing the order means a card only moves when the reader does something that moves it.
//
// Items already known keep the position they had. Items the reader has never seen go to the end rather than being spliced into the middle, and are reported separately so the caller can append their ids to the held order — which is what makes adopting them idempotent under a double render, since the second pass finds them already ranked. The strip that used to offer to "show" them is gone: they render inside their own group either way, so it was offering something already on screen behind a button that reseeded the whole order from the server's rank. Array.prototype.sort is stable, so several new items keep the order the server sent them in.
export function stableOrder(items: FollowUp[], order: number[]): { items: FollowUp[]; added: number[] } {
  if (order.length === 0) return { items, added: [] };
  const rank = new Map(order.map((id, index) => [id, index]));
  const added = items.filter((item) => !rank.has(item.id)).map((item) => item.id);
  const sorted = [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  return { items: sorted, added };
}

// ---- Inbox decisions ----

// The verbs a row can offer, named after the CLI and MCP verbs they post (handled, snooze, unsnooze) or, for the two that leave for GitHub, after where they go. `open` and `merge` are links with no API call: the product cannot merge or push, so on a row only GitHub can move it says where to go instead of offering a button that would change nothing.
export type RowVerb = "handled" | "snooze" | "unsnooze" | "open" | "merge";

// Shippable and still on the list: the ready chip, the ready=1 filter and the summary's "ready to merge" count all read this one rule. A muted row is out of it because the reader has already deferred it, and an archived one because it has been merged or closed already.
export function matchesReady(item: FollowUp, now: Date = new Date()): boolean {
  return isReadyToMerge(item.pr, item.role) && item.state !== "archived" && !isMuted(item, now.getTime());
}

// The one table that decides what a row offers, read by the row, the sheet footer and the e / s / u / o keys alike, so none of them can offer a verb another withholds. The first matching rule wins. Handled is only ever offered on a row the reader still owes something (action or follow_up): on a waiting row it would restart a clock that is already running on someone else.
export function primaryAction(item: FollowUp, now: Date = new Date()): { primary: RowVerb | null; secondary: RowVerb[]; markRead: boolean } {
  const markRead = item.unread;
  if (item.state === "archived") return { primary: null, secondary: [], markRead };
  if (isMuted(item, now.getTime())) return { primary: "unsnooze", secondary: [], markRead };
  const owed = item.state === "action" || item.state === "follow_up";
  if (isReadyToMerge(item.pr, item.role)) return { primary: "merge", secondary: owed && handledIsUseful(item) ? ["handled", "snooze"] : ["snooze"], markRead };
  if (item.state === "draft" || item.state === "waiting") return { primary: null, secondary: ["snooze"], markRead };
  if (!handledIsUseful(item)) return { primary: "open", secondary: ["snooze"], markRead };
  return { primary: "handled", secondary: ["snooze"], markRead };
}

export type InboxSummary = { total: number; blocked: number; authored: number; reviewer: number; followUp: number; ready: number; recentMerged: number };

// The numbers the Inbox header states. `total` is the badge's formula (authored + reviewer + follow_up, which is what listFollowUps counts), so the headline, the nav badge and the default view's group headings are one number; followup-view.test.mjs holds the three together. `blocked` is derived from the rows because the server does not count it: to-do rows carrying a reason only a new push clears.
export function inboxSummary(items: FollowUp[], counts: Record<string, number>, now: Date = new Date()): InboxSummary {
  const authored = counts.authored || 0;
  const reviewer = counts.reviewer || 0;
  const followUp = counts.follow_up || 0;
  const todo = items.filter((item) => item.state === "action" || item.state === "follow_up");
  return {
    total: authored + reviewer + followUp,
    blocked: todo.filter((item) => item.reasons.some((reason) => reasonTone(reason) === "blocked")).length,
    authored,
    reviewer,
    followUp,
    ready: items.filter((item) => matchesReady(item, now)).length,
    recentMerged: counts.recent_merged || 0,
  };
}

const DAY_MS = 86400000;

// The wall-clock fields of an instant in an IANA zone, read through Intl because the browser has no other way to ask what time it is somewhere else.
function zonedParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(at);
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: field("year"), month: field("month"), day: field("day"), hour: field("hour"), minute: field("minute"), second: field("second") };
}

// The UTC instant at which a zone's clock reads the given wall time. The offset is measured at a first guess and then again at the answer, which is what lands a time on the far side of a DST change on the right hour.
function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (at: number) => {
    const p = zonedParts(at, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
  };
  return wall - offset(wall - offset(wall));
}

const digestClock = /^(\d{1,2}):(\d{2})/;

// The three one-tap reminders. "Tomorrow morning" is the next calendar day at the reader's own digest time in their own timezone once the settings have loaded — the moment the digest would bring the row back anyway — and 09:00 on the browser's clock until then. Every preset is clamped to the window the server accepts (snoozeBounds: a minute from now to a year from now), so none of them can come back as a save error.
export function snoozePresets(now: Date, settings?: { timezone: string; digest_time: string }): { key: "3d" | "7d" | "tomorrow"; until: Date }[] {
  const at = now.getTime();
  const min = at + 60000;
  const max = new Date(at);
  max.setFullYear(max.getFullYear() + 1);
  const clamp = (value: number) => new Date(Math.min(Math.max(value, min), max.getTime()));
  let tomorrow: number | undefined;
  const clock = settings ? digestClock.exec(settings.digest_time) : null;
  if (settings && clock) {
    try {
      const today = zonedParts(at, settings.timezone);
      // Date.UTC normalises day 32 into the next month, so "the next calendar day" needs no month arithmetic of its own.
      const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
      tomorrow = zonedInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), Number(clock[1]), Number(clock[2]), settings.timezone);
    } catch {
      // An unknown zone name throws a RangeError; the browser's own morning is the honest fallback.
      tomorrow = undefined;
    }
  }
  if (tomorrow === undefined || Number.isNaN(tomorrow)) {
    const local = new Date(at);
    local.setDate(local.getDate() + 1);
    local.setHours(9, 0, 0, 0);
    tomorrow = local.getTime();
  }
  return [
    { key: "3d", until: clamp(at + 3 * DAY_MS) },
    { key: "7d", until: clamp(at + 7 * DAY_MS) },
    { key: "tomorrow", until: clamp(tomorrow) },
  ];
}
