import { z } from "zod";
const comment = z.object({ id: z.number(), body: z.string(), html_url: z.string(), path: z.string().optional(), line: z.number().nullable().optional(), created_at: z.string(), user: z.object({ login: z.string() }).nullable() });
export const activitySchema = z.object({
  conversation: z.array(comment).nullable(),
  review_comments: z.array(comment).nullable(),
  threads: z.array(z.object({ id: z.string(), isResolved: z.boolean(), isOutdated: z.boolean(), path: z.string(), line: z.number().nullable() })).nullable(),
  checks: z.array(z.object({ id: z.number(), name: z.string(), status: z.string(), conclusion: z.string(), html_url: z.string() })).nullable(),
  warnings: z.array(z.string()),
});
export type Activity = z.infer<typeof activitySchema>;
export function safeGitHubLink(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
// The API still reports partial activity as English prose ("Checks: too many check runs"), built from two closed first-party sets. Split it so each half can be translated; anything unrecognised is shown as it arrived.
const warningSections: Record<string, string> = { Conversation: "activityWarningSection_conversation", "Review comments": "activityWarningSection_review_comments", "Review status": "activityWarningSection_review_status", Checks: "activityWarningSection_checks" };
const warningReasons: Record<string, string> = {
  "GitHub request unavailable": "activityWarningReason_unavailable",
  "invalid GitHub request": "activityWarningReason_invalid_request",
  "too many results; open GitHub for full activity": "activityWarningReason_too_many_results",
  "review thread status unavailable; check GitHub App permissions": "activityWarningReason_thread_permissions",
  "invalid GitHub pagination": "activityWarningReason_invalid_pagination",
  "too many review threads": "activityWarningReason_too_many_threads",
  "too many check runs": "activityWarningReason_too_many_checks",
};
export function activityWarningKeys(warning: string): { sectionKey?: string; reasonKey?: string; section: string; reason: string } {
  const split = warning.indexOf(": ");
  const section = split < 0 ? "" : warning.slice(0, split);
  const reason = split < 0 ? warning : warning.slice(split + 2);
  return { sectionKey: warningSections[section], reasonKey: warningReasons[reason], section, reason };
}

// The colour a check result is shown in. It used to be a class name the
// stylesheet turned into a colour; the mapping lives here now.
export function checkToneClass(tone: string) {
  if (tone === "success") return "text-[var(--success)]";
  if (tone === "failure") return "text-[var(--danger)]";
  if (tone === "pending") return "text-[var(--warning)]";
  return "text-[var(--muted)]";
}
export function checkTone(status: string, conclusion: string) {
  if (status !== "completed") return "pending";
  if (["success", "neutral", "skipped"].includes(conclusion)) return "success";
  if (["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"].includes(conclusion)) return "failure";
  return "unknown";
}
