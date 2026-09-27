import { z } from "zod";
import { safeGitHubLink } from "./activity-model";
import type { GlyphKind, Tone } from "./tone";

export const PRSchema = z.object({
  id: z.number().int().positive(),
  repo: z.string(),
  title: z.string(),
  number: z.number().int().positive(),
  url: z.string().optional(),
  merged_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
  review_status: z.string().optional(),
  checks_status: z.string().optional(),
  state: z.string().optional(),
  comments_count: z.number().optional(),
  has_conflicts: z.boolean().optional(),
  // Served all along (PullRequest.Draft, apps/api/main.go) and dropped on the floor, which is why a work-in-progress nobody has been shown claimed to be awaiting review.
  draft: z.boolean().optional(),
});
const listSchema = z.object({ data: z.array(PRSchema).nullable(), total: z.number() });
const labels: Record<string, string> = { pending: "Awaiting review", review_requested: "Review requested", changes_requested: "Changes requested", approved: "Approved", open: "Open", closed: "Closed", merged: "Merged", draft: "Draft" };

export function parsePRList(body: unknown) {
  return (listSchema.parse(body).data ?? []).map((row) => {
    // Draft outranks the review status, because a draft's "pending" only means no review has been submitted on something nobody was asked to review. It does not outrank merged or closed: those are outcomes, and a draft that was closed is closed.
    const state = row.merged_at ? "merged" : row.state === "closed" ? "closed" : row.draft ? "draft" : row.review_status || row.state || "open";
    const date = row.updated_at ? new Date(row.updated_at) : null;
    return {
      ...row,
      url: row.url ? safeGitHubLink(row.url) : undefined,
      repo: row.repo.replace(/^https:\/\/api\.github\.com\/repos\//, ""),
      status: labels[state] ?? state,
      updated: date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Unknown",
      comments: row.comments_count ?? 0,
      conflict: row.has_conflicts ?? false,
    };
  });
}
export type PR = ReturnType<typeof parsePRList>[number];

// The English status labels parsePRList produces, mapped to the translation keys that render them. A label with no entry is printed as it came.
const statusKeys: Record<string, string> = { Open: "openStatus", "Awaiting review": "awaitingReview", "Needs attention": "attention", "Review requested": "reviewRequested", "Changes requested": "changesRequested", Approved: "approved", Merged: "merged", Closed: "closed", Conflict: "conflict", Draft: "draftStatus" };
export function statusKey(status: string) {
  return statusKeys[status] || status;
}

// The one glyph a pull-request row leads with, from the facts the row itself carries. Outcomes come first, because a merged or closed pull request is finished whatever its last review said. Then the two states only the author can clear (a conflict or a red build), which is the same predicate the Blocked view asks the API for. A draft comes next, because its review status only means nobody was asked yet. The follow-up's blocked reasons are derived server-side from exactly these facts (has_conflicts and checks_status), so the row needs nothing from the follow-up to be right.
export function prTone(pr: Pick<PR, "merged_at" | "state" | "draft" | "conflict" | "checks_status" | "review_status">): { tone: Tone; kind: GlyphKind } {
  if (pr.merged_at) return { tone: "neutral", kind: "merged" };
  if (pr.state === "closed") return { tone: "neutral", kind: "closed" };
  if (pr.conflict || pr.checks_status === "failure" || pr.checks_status === "error") return { tone: "blocked", kind: "blocked" };
  if (pr.draft) return { tone: "neutral", kind: "draft" };
  if (pr.review_status === "changes_requested") return { tone: "action", kind: "action" };
  if (pr.review_status === "review_requested") return { tone: "waiting", kind: "waiting" };
  if (pr.review_status === "approved") return { tone: "ready", kind: "ready" };
  return { tone: "neutral", kind: "open" };
}

// The check results worth a chip: a failure is the author's to fix and a pending run says the verdict is not in yet. Success is the expected state and says nothing, `inconclusive` is not something the author can act on, and `unknown` is the absence of CI rather than a result. The values are checkSummary's (apps/api/activity.go).
export function checksChip(status: string | undefined): "failing" | "pending" | null {
  if (status === "failure" || status === "error") return "failing";
  if (status === "pending") return "pending";
  return null;
}

const repositorySchema = z.object({ repo: z.string(), total: z.number().int().nonnegative(), open: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative(), needs_attention: z.number().int().nonnegative(), checks_failing: z.number().int().nonnegative().default(0) });
export type RepositorySummary = z.infer<typeof repositorySchema>;
export function parseRepositoryList(body: unknown): RepositorySummary[] {
  return z
    .object({ data: z.array(repositorySchema) })
    .parse(body)
    .data.map((item) => ({ ...item, repo: item.repo.replace(/^https:\/\/api\.github\.com\/repos\//, "").replace(/\/$/, "") }));
}

// The OAuth callback answers with a real query string while the app routes on the fragment, so the flag has to be read once and then stripped by hand. A search without either flag comes back untouched, so no reason exists to rewrite the URL.
export function oauthBanner(search: string): { error: string | null; cleanedSearch: string } {
  const params = new URLSearchParams(search);
  if (!params.has("oauth_error") && !params.has("connected")) return { error: null, cleanedSearch: search };
  const error = params.get("oauth_error");
  params.delete("oauth_error");
  params.delete("connected");
  const rest = params.toString();
  return { error, cleanedSearch: rest ? "?" + rest : "" };
}

export function parsePRPage(body: unknown) {
  const parsed = listSchema.parse(body);
  return { items: parsePRList(parsed), total: parsed.total };
}
export function listParameters(filter: string, page: number, search = "", repository = "") {
  const q = new URLSearchParams({ limit: "50", offset: String(page * 50) });
  if (repository) q.set("repo", repository);
  if (search.trim()) q.set("search", search.trim());
  // The two states only the author can clear — a merge conflict and a red build — were the only ones the table could not filter to, while listPRs has honoured `attention=true` since it was written (apps/api/main.go) with the same predicate the Blocked stat tile counts.
  if (filter === "Blocked") q.set("attention", "true");
  // The other half of the honest pair: the default view is open and unmerged, and this is the only way to reach what the reader actually finished.
  else if (filter === "Merged") q.set("merged", "true");
  else if (filter !== "All") {
    q.set("state", "open");
    const states: Record<string, string> = { "Review requested": "review_requested", "Changes requested": "changes_requested", Approved: "approved" };
    if (states[filter]) q.set("review_status", states[filter]);
  }
  return q.toString();
}
