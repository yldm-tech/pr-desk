import type { Page } from "@playwright/test";

// Every route worth a look, shared by the layout matrix and the comparison harness so the two cannot drift apart. The filtered listing is included because it is the only state that shows the repository chip above the follow-ups.
// `/#/attention?status=all` earns its place because the workspace now defaults to the badge's set: the Muted group, the drafts and the ordinary waiting rows — and with them the collapsed disclosure, the Muted-until chip and the Cancel reminder button — render on no other route, so without it the matrix would never measure them. `/#/blocked` is the new fifth PR filter; adding it here is the whole cost of bringing it into the sweep.
export const ROUTES = ["/#/", "/#/attention", "/#/attention?status=all", "/#/attention?repo=fixture/reviewer", "/#/pull-requests", "/#/blocked", "/#/repositories", "/#/about", "/#/settings", "/#/settings?tab=notifications", "/#/settings?tab=access"];

// The three routes whose layout actually changes band: the overview grid, the pull-request table and the repository list. Used where walking all of ROUTES would only repeat the shell. `/#/blocked` is deliberately not here: it is the pull-request table with one query parameter changed, so it flips exactly the bands `/#/pull-requests` already covers.
export const STRUCTURAL_ROUTES = ["/#/", "/#/pull-requests", "/#/repositories"];

// The stub API both the suite and the comparison harness run against, so a
// screenshot and a computed-style capture see the same application.
// The locale is a parameter rather than a constant because width is not the only axis the layout has to survive: Spanish is the worst case for every label in the shell and Japanese is the worst case for line breaking, and neither was rendered anywhere in the suite before. English stays the default so no existing test changes.
export async function installFixtures(page: Page, options: { locale?: string } = {}) {
  const locale = options.locale ?? "en";
  await page.addInitScript((language) => localStorage.setItem("i18nextLng", language), locale);
  // A reminder has to be live to be a reminder, so the muted row's wake-up time is relative to the run rather than a date that quietly falls into the past.
  const reminder = new Date(Date.now() + 7 * 86400000).toISOString();
  // The `pr` objects used to carry id/repo/number/title/url and nothing else, so every fact the card now draws from them — review state, CI, conflict, draft, "ready to merge" — was absent from the fixture and therefore absent from the twenty-four-viewport sweep as well as from every assertion here. Each task below exists for one shape the workspace has to be able to render: an ordinary action item, a reviewer item, a follow-up that is ready to merge, a muted one, one whose reasons are all fact-derived (so Handled would do nothing), and a draft.
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
      snoozed_until: null as string | null,
      pr: { id: 1, repo: "fixture/calendar", number: 17, title: "Handle timezone boundaries", url: "https://github.com/fixture/calendar/pull/17", review_status: "changes_requested", checks_status: "failure", has_conflicts: true, draft: false },
    },
    {
      id: 2,
      version: 1,
      role: "reviewer",
      state: "action",
      reasons: ["review_requested"],
      unread: true,
      excerpt: "",
      waiting_since: "2026-09-02T00:00:00Z",
      archived_at: null,
      snoozed_until: null as string | null,
      pr: { id: 2, repo: "fixture/reviewer", number: 24, title: "Review storage migration", url: "https://github.com/fixture/reviewer/pull/24", review_status: "pending", checks_status: "success", has_conflicts: false, draft: false },
    },
    // Approved, green and conflict-free: the one state the product had no word for, and the only row that can produce the "Ready to merge" chip. It is a follow_up so it lands in the default view, where the chip is worth measuring.
    {
      id: 3,
      version: 1,
      role: "authored",
      state: "follow_up",
      reasons: ["overdue"],
      unread: false,
      excerpt: "",
      waiting_since: "2026-08-20T00:00:00Z",
      archived_at: null,
      snoozed_until: null as string | null,
      pr: { id: 3, repo: "fixture/calendar", number: 31, title: "Ship the release notes", url: "https://github.com/fixture/calendar/pull/31", review_status: "approved", checks_status: "success", has_conflicts: false, draft: false },
    },
    // Snoozed into next week. The server reports a muted row as `waiting`; the browser splits it back out, so this is the only row that renders the Muted group, the Muted-until chip and the Cancel reminder button.
    {
      id: 4,
      version: 1,
      role: "authored",
      state: "waiting",
      reasons: [] as string[],
      unread: false,
      excerpt: "",
      waiting_since: "2026-09-03T00:00:00Z",
      archived_at: null,
      snoozed_until: reminder as string | null,
      pr: { id: 4, repo: "fixture/calendar", number: 33, title: "Tune the query planner", url: "https://github.com/fixture/calendar/pull/33", review_status: "pending", checks_status: "success", has_conflicts: false, draft: false },
    },
    // Every reason on this card is re-derived from GitHub on each read, so Handled would post successfully and change nothing. The card must offer the sentence instead of the button.
    {
      id: 5,
      version: 1,
      role: "authored",
      state: "action",
      reasons: ["conflict", "checks_failed"],
      unread: false,
      excerpt: "",
      waiting_since: "2026-09-04T00:00:00Z",
      archived_at: null,
      snoozed_until: null as string | null,
      pr: { id: 5, repo: "fixture/calendar", number: 35, title: "Rebase the storage migration", url: "https://github.com/fixture/calendar/pull/35", review_status: "changes_requested", checks_status: "failure", has_conflicts: true, draft: false },
    },
    // Joined to the third table row below, so the draft is one pull request telling one story on both screens rather than two fixtures that happen to agree.
    {
      id: 6,
      version: 1,
      role: "authored",
      state: "draft",
      reasons: [] as string[],
      unread: false,
      excerpt: "",
      waiting_since: "2026-09-05T00:00:00Z",
      archived_at: null,
      snoozed_until: null as string | null,
      pr: { id: 6, repo: "fixture/calendar", number: 40, title: "Prototype the digest", url: "https://github.com/fixture/calendar/pull/40", review_status: "pending", checks_status: "unknown", has_conflicts: false, draft: true },
    },
  ];
  // POST /follow-ups/:id, for every id rather than only the first: five of the six tasks are now acted on by some test, and a mutation that silently no-ops would let an assertion about the aftermath pass for the wrong reason. The writes mirror applyFollowUpAction — snooze also marks the row read, which is what makes the server's version gate satisfiable at the moment of snoozing.
  const mutate = (id: number, body: { action: string; until?: string }) => {
    const task = tasks.find((entry) => entry.id === id);
    if (!task) return;
    if (body.action === "unsnooze") {
      task.snoozed_until = null;
      return;
    }
    task.unread = false;
    if (body.action === "snooze") task.snoozed_until = body.until ?? null;
    if (body.action === "handled" || body.action === "followed_up") {
      task.state = "waiting";
      task.reasons = [];
    }
  };
  const destinations: { id: number; name: string; kind: string; enabled: boolean }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1/", "");
    let data: unknown = {};
    const acted = /^follow-ups\/(\d+)$/.exec(path);
    if (acted) {
      mutate(Number(acted[1]), route.request().postDataJSON());
      return route.fulfill({ json: { updated: true } });
    }
    switch (path) {
      case "auth/status":
        data = { connected: true, username: "fixture", sync_paused: false };
        break;
      case "stats":
        // `attention` is the Blocked tile's number and also what /#/blocked asks the list endpoint for, so it counts the same rows the list below returns for that predicate: PR 2 (changes requested, failing, conflicted).
        data = { open: 3, needs_review: 1, conflicts: 1, merged: 5, attention: 1 };
        break;
      case "sync/progress":
        data = { status: "complete", phase: "details", completed: 2, total: 2, retry_at: 0, last_synced_at: "2026-09-11T00:00:00Z" };
        break;
      case "follow-ups":
        // Counted the way listFollowUps counts — action rows by role, plus every follow_up — so the sidebar badge and the default workspace view are the same number here for the same reason they are in the server.
        data = {
          baseline_complete: true,
          data: tasks,
          counts: { authored: tasks.filter((task) => task.role === "authored" && task.state === "action").length, reviewer: tasks.filter((task) => task.role === "reviewer" && task.state === "action").length, follow_up: tasks.filter((task) => task.state === "follow_up").length, recent_merged: 5 },
        };
        break;
      case "pull-requests":
        data = {
          total: 3,
          data: [
            { id: 1, repo: "fixture/calendar", number: 17, title: "Handle timezone boundaries", url: "https://github.com/fixture/calendar/pull/17", updated_at: "2026-09-10T00:00:00Z", review_status: "review_requested", checks_status: "success", state: "open", comments_count: 2, has_conflicts: false, merged_at: null },
            { id: 2, repo: "fixture/reviewer", number: 24, title: "Review storage migration", url: "https://github.com/fixture/reviewer/pull/24", updated_at: "2026-09-09T00:00:00Z", review_status: "changes_requested", checks_status: "failure", state: "open", comments_count: 0, has_conflicts: true, merged_at: null },
            // A draft with no pipeline, which is two rows in one: the status pill has to read Draft rather than the review status it would otherwise inherit, and an unknown check result has to print nothing rather than a full-width grey "CI: Unknown".
            { id: 6, repo: "fixture/calendar", number: 40, title: "Prototype the digest", url: "https://github.com/fixture/calendar/pull/40", updated_at: "2026-09-08T00:00:00Z", review_status: "pending", checks_status: "unknown", state: "open", comments_count: 0, has_conflicts: false, merged_at: null, draft: true },
          ],
        };
        break;
      case "pull-requests/1/activity":
      case "pull-requests/2/activity":
      case "pull-requests/6/activity":
        data = {
          warnings: ["Some review threads could not be read."],
          conversation: [{ id: 1, body: "Please cover the timezone boundary.", html_url: "https://github.com/fixture/calendar/pull/17#issuecomment-1", created_at: "2026-09-10T00:00:00Z", user: { login: "fixture" } }],
          review_comments: [{ id: 2, body: "This branch needs a test.", html_url: "https://github.com/fixture/calendar/pull/17#discussion_r2", path: "src/calendar.ts", line: 42, created_at: "2026-09-10T01:00:00Z", user: { login: "reviewer" } }],
          threads: [{ id: "t1", isResolved: false, isOutdated: false, path: "src/calendar.ts", line: 42 }],
          checks: [{ id: 3, name: "build", status: "completed", conclusion: "success", html_url: "https://github.com/fixture/calendar/runs/3" }],
        };
        break;
      case "profile":
        data = { login: "fixture", name: "Fixture User", avatar_url: "", bio: "Keeps an eye on pull requests.", company: "Fixture Inc", location: "Earth", created_at: "2015-03-01T00:00:00Z", followers: 42, following: 7, public_repos: 13 };
        break;
      case "repositories":
        data = {
          data: [
            { repo: "fixture/calendar", total: 12, open: 4, conflicts: 1, needs_attention: 2, checks_failing: 1 },
            { repo: "fixture/reviewer", total: 7, open: 2, conflicts: 0, needs_attention: 0, checks_failing: 0 },
          ],
        };
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
