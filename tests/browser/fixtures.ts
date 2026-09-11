import type { Page } from "@playwright/test";

// The stub API both the suite and the comparison harness run against, so a
// screenshot and a computed-style capture see the same application.
export async function installFixtures(page: Page) {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const tasks = [
    {
      id: 1,
      version: 1,
      role: "authored",
      state: "action",
      reasons: ["human_feedback"],
      unread: true,
      excerpt: "Please cover the timezone boundary.",
      waiting_since: "2026-09-01T00:00:00Z",
      archived_at: null,
      pr: { id: 1, repo: "fixture/calendar", number: 17, title: "Handle timezone boundaries", url: "https://github.com/fixture/calendar/pull/17" },
    },
    { id: 2, version: 1, role: "reviewer", state: "action", reasons: ["review_requested"], unread: true, excerpt: "", waiting_since: "2026-09-01T00:00:00Z", archived_at: null, pr: { id: 2, repo: "fixture/reviewer", number: 24, title: "Review storage migration", url: "https://github.com/fixture/reviewer/pull/24" } },
  ];
  const destinations: { id: number; name: string; kind: string; enabled: boolean }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    switch (url.pathname.replace("/api/v1/", "")) {
      case "auth/status":
        data = { connected: true, username: "fixture", sync_paused: false };
        break;
      case "stats":
        data = { open: 2, needs_review: 1, conflicts: 0, merged: 5, attention: 1 };
        break;
      case "sync/progress":
        data = { status: "complete", phase: "details", completed: 2, total: 2, retry_at: 0, last_synced_at: "2026-09-11T00:00:00Z" };
        break;
      case "follow-ups":
        data = { baseline_complete: true, data: tasks, counts: { authored: tasks.filter((task) => task.role === "authored" && task.state === "action").length, reviewer: 1, follow_up: 0, recent_merged: 5 } };
        break;
      case "follow-ups/1": {
        const body = route.request().postDataJSON();
        tasks[0].unread = false;
        if (body.action === "handled" || body.action === "followed_up") {
          tasks[0].state = "waiting";
          tasks[0].reasons = [];
        }
        data = { updated: true };
        break;
      }
      case "pull-requests":
        data = {
          total: 2,
          data: [
            { id: 1, repo: "fixture/calendar", number: 17, title: "Handle timezone boundaries", url: "https://github.com/fixture/calendar/pull/17", updated_at: "2026-09-10T00:00:00Z", review_status: "review_requested", checks_status: "success", state: "open", comments_count: 2, has_conflicts: false, merged_at: null },
            { id: 2, repo: "fixture/reviewer", number: 24, title: "Review storage migration", url: "https://github.com/fixture/reviewer/pull/24", updated_at: "2026-09-09T00:00:00Z", review_status: "changes_requested", checks_status: "failure", state: "open", comments_count: 0, has_conflicts: true, merged_at: null },
          ],
        };
        break;
      case "pull-requests/1/activity":
      case "pull-requests/2/activity":
        data = {
          warnings: ["Some review threads could not be read."],
          conversation: [{ id: 1, body: "Please cover the timezone boundary.", html_url: "https://github.com/fixture/calendar/pull/17#issuecomment-1", created_at: "2026-09-10T00:00:00Z", user: { login: "fixture" } }],
          review_comments: [{ id: 2, body: "This branch needs a test.", html_url: "https://github.com/fixture/calendar/pull/17#discussion_r2", path: "src/calendar.ts", line: 42, created_at: "2026-09-10T01:00:00Z", user: { login: "reviewer" } }],
          threads: [{ id: "t1", isResolved: false, isOutdated: false, path: "src/calendar.ts", line: 42 }],
          checks: [{ id: 3, name: "build", status: "completed", conclusion: "success", html_url: "https://github.com/fixture/calendar/runs/3" }],
        };
        break;
      case "repositories":
        data = { data: [] };
        break;
      case "repository-access":
        data = { has_installations: true, can_read_private: true, installations: [] };
        break;
      case "overview":
        data = {
          visibility_counts: { public: 12, private: 0, unknown: 0, public_repositories: 1, private_repositories: 0, unknown_repositories: 0 },
          history_complete: true,
          history_total: 12,
          year: 2026,
          years: [2026, 2025],
          summary: { total: 12, merged: 10, open: 2, closed: 0, repositories: 1 },
          repositories: [{ repo: "fixture/calendar", total: 12, merged: 10 }],
          months: [{ month: "2026-09", merged: 10 }],
        };
        break;
      case "follow-up-settings":
        data = route.request().method() === "POST" ? { saved: true } : { timezone: "Asia/Tokyo", digest_time: "09:00", wait_days: 7, teams: [], repository_days: {} };
        break;
      case "api-tokens":
        data = { data: [{ id: 1, name: "PR Desk CLI", client_id: "prdesk", scopes: ["followups:read", "followups:write"], created_at: "2026-09-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", last_used_at: "2026-09-10T00:00:00Z" }] };
        break;
      case "review-teams":
        data = { data: [{ id: "fixture/reviewers", name: "Reviewers" }] };
        break;
      case "notification-destinations":
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          destinations.push({ id: destinations.length + 1, name: body.name, kind: body.kind || "telegram", enabled: true });
          data = destinations[destinations.length - 1];
        } else data = { data: destinations };
        break;
      default:
        data = { data: [] };
    }
    await route.fulfill({ json: data });
  });
}
