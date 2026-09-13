// Everything the follow-up surfaces decide before they render anything: the shape of the payload, which group a row belongs to, which verbs can actually do something to it, and how long it has been waiting. It lives outside the components because two screens now show the same rows — the workspace and the PR table's follow-up chips — and a rule that exists twice is a rule that will disagree with itself. Nothing here imports React, so every one of these decisions is covered by followup-view.test.mjs rather than by a browser.
import { z } from "zod";
import { PRSchema } from "./pr-model";
import { checkToneClass } from "./activity-model";

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

// A fact chip states what is true of the pull request, as opposed to a reason chip, which states why the row exists. `i18nKey` is always a complete key path. When `valueKey` is set the label is `${t(i18nKey)}: ${t(valueKey)}`, which is how the PR table already writes "CI: Success". `className` carries a colour the tone cannot express and is appended after the chip class; only the CI chip uses it, and its tone is deliberately one no `data-[tone=…]` rule matches so the two never fight over the same property.
export type FactChip = { key: string; tone: string; i18nKey: string; valueKey?: string; className?: string; interpolation?: Record<string, string | number> };

const reviewFactKeys: Record<string, string> = { pending: "awaitingReview", review_requested: "reviewRequested", changes_requested: "changesRequested", approved: "approved" };
const reviewFactTones: Record<string, string> = { pending: "waiting", review_requested: "action", changes_requested: "blocked", approved: "ready" };

export function factChips(pr: FollowUpPR, role: string): FactChip[] {
  const chips: FactChip[] = [];
  const review = pr.review_status || "";
  const checks = pr.checks_status || "";
  if (reviewFactKeys[review]) chips.push({ key: "review", tone: reviewFactTones[review] || "neutral", i18nKey: reviewFactKeys[review] });
  // Absence of CI is not a check result, and neither is "unknown": a grey "CI: Unknown" on every row without a pipeline is noise that trains the reader to stop looking at the chip that matters.
  if (checks && checks !== "unknown") chips.push({ key: "checks", tone: "check", i18nKey: "ci", valueKey: checks, className: checkToneClass(checks) });
  if (pr.has_conflicts) chips.push({ key: "conflict", tone: "blocked", i18nKey: "conflict" });
  if (pr.draft) chips.push({ key: "draft", tone: "neutral", i18nKey: "draftStatus" });
  // The one state the product had no word for. Only on your own PR: a reviewer looking at an approved, green PR is done with it and is not the person who merges.
  if (role === "authored" && review === "approved" && checks === "success" && !pr.has_conflicts) chips.push({ key: "ready", tone: "ready", i18nKey: "followup.readyToMerge" });
  return chips;
}

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
// Items already known keep the position they had. Items the reader has never seen go to the end rather than being spliced into the middle, and are reported separately so the page can offer to take them rather than taking them silently. Array.prototype.sort is stable, so several new items keep the order the server sent them in.
export function stableOrder(items: FollowUp[], order: number[]): { items: FollowUp[]; added: number[] } {
  if (order.length === 0) return { items, added: [] };
  const rank = new Map(order.map((id, index) => [id, index]));
  const added = items.filter((item) => !rank.has(item.id)).map((item) => item.id);
  const sorted = [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  return { items: sorted, added };
}
