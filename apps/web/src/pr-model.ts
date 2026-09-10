import { z } from "zod";
import { safeGitHubLink } from "./activity-model";

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
});
const listSchema = z.object({ data: z.array(PRSchema).nullable(), total: z.number() });
const labels: Record<string, string> = { pending: "Awaiting review", review_requested: "Review requested", changes_requested: "Changes requested", approved: "Approved", open: "Open", closed: "Closed", merged: "Merged" };

export function parsePRList(body: unknown) {
  return (listSchema.parse(body).data ?? []).map((row) => {
    const state = row.merged_at ? "merged" : row.state === "closed" ? "closed" : row.review_status || row.state || "open";
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

const repositorySchema = z.object({ repo: z.string(), total: z.number().int().nonnegative(), open: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative(), needs_attention: z.number().int().nonnegative() });
export type RepositorySummary = z.infer<typeof repositorySchema>;
export function parseRepositoryList(body: unknown): RepositorySummary[] {
  return z
    .object({ data: z.array(repositorySchema) })
    .parse(body)
    .data.map((item) => ({ ...item, repo: item.repo.replace(/^https:\/\/api\.github\.com\/repos\//, "").replace(/\/$/, "") }));
}

export function parsePRPage(body: unknown) {
  const parsed = listSchema.parse(body);
  return { items: parsePRList(parsed), total: parsed.total };
}
export function listParameters(filter: string, page: number, search = "", repository = "") {
  const q = new URLSearchParams({ limit: "50", offset: String(page * 50) });
  if (repository) q.set("repo", repository);
  if (search.trim()) q.set("search", search.trim());
  if (filter === "Needs attention") q.set("attention", "true");
  else if (filter !== "All") {
    q.set("state", "open");
    const states: Record<string, string> = { "Review requested": "review_requested", "Changes requested": "changes_requested", Approved: "approved" };
    if (states[filter]) q.set("review_status", states[filter]);
  }
  return q.toString();
}
