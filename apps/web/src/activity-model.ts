import { z } from "zod";
const comment = z.object({ id: z.number(), body: z.string(), html_url: z.string(), path: z.string().optional(), line: z.number().nullable().optional(), created_at: z.string(), user: z.object({ login: z.string() }).nullable() });
export const activitySchema = z.object({ conversation: z.array(comment).nullable(), review_comments: z.array(comment).nullable(), threads: z.array(z.object({ id: z.string(), isResolved: z.boolean(), isOutdated: z.boolean(), path: z.string(), line: z.number().nullable() })).nullable(), checks: z.array(z.object({ id: z.number(), name: z.string(), status: z.string(), conclusion: z.string(), html_url: z.string() })).nullable(), warnings: z.array(z.string()) });
export type Activity = z.infer<typeof activitySchema>;
export function safeGitHubLink(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function checkTone(status: string, conclusion: string) {
  if (status !== "completed") return "pending";
  if (["success", "neutral", "skipped"].includes(conclusion)) return "success";
  if (["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"].includes(conclusion)) return "failure";
  return "unknown";
}
