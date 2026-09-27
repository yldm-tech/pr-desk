import type { Page, Route } from "@playwright/test";

// Every route worth a look, shared by the layout matrix and the comparison harness so the two cannot drift apart. The filtered listing is included because it is the only state that shows the repository chip above the follow-ups.
// `/#/inbox?status=all` earns its place because the workspace defaults to the badge's set: the Muted group, the drafts and the ordinary waiting rows — and with them the collapsed disclosure, the Muted-until chip and the Cancel reminder button — render on no other route, so without it the matrix would never measure them. `/#/prs/blocked` is the fifth PR view; adding it here is the whole cost of bringing it into the sweep.
export const ROUTES = ["/#/inbox", "/#/inbox?status=all", "/#/inbox?repo=fixture/reviewer", "/#/prs", "/#/prs/blocked", "/#/repos", "/#/insights", "/#/about", "/#/settings", "/#/settings?tab=notifications", "/#/settings?tab=access", "/#/settings?tab=github"];

// The routes whose layout actually changes band: the Inbox list, the pull-request table, the repository list and the Insights grid. Used where walking all of ROUTES would only repeat the shell. `/#/prs/blocked` is deliberately not here: it is the pull-request table with one filter changed, so it flips exactly the bands `/#/prs` already covers.
export const STRUCTURAL_ROUTES = ["/#/inbox", "/#/prs", "/#/repos", "/#/insights"];

// Every address the application used to answer on, paired with where it lands now (spec §3.3). The query string always survives: push notifications and digests link to `#/attention?focus=<id>` (apps/api/notifications.go), and a bookmark of a filtered list is worth as much as the filter. The old `/` read `year`, `visibility` and `repo` for its contribution overview, so those parameters decide that it meant Insights. An unknown address lands on the Inbox with its query dropped, as the old catch-all did.
export const LEGACY_ROUTES: { from: string; to: string }[] = [
  { from: "/#/", to: "/#/inbox" },
  { from: "/#/?year=2025", to: "/#/insights?year=2025" },
  { from: "/#/?visibility=all", to: "/#/insights?visibility=all" },
  { from: "/#/?repo=fixture/calendar", to: "/#/insights?repo=fixture/calendar" },
  { from: "/#/attention", to: "/#/inbox" },
  { from: "/#/attention?focus=1", to: "/#/inbox?focus=1" },
  { from: "/#/attention?role=reviewer&status=all&repo=fixture/reviewer&tone=action", to: "/#/inbox?role=reviewer&status=all&repo=fixture/reviewer&tone=action" },
  { from: "/#/pull-requests", to: "/#/prs" },
  { from: "/#/pull-requests?q=storage&repo=fixture/reviewer", to: "/#/prs?q=storage&repo=fixture/reviewer" },
  { from: "/#/review-requested", to: "/#/prs/review-requested" },
  { from: "/#/changes-requested?q=storage", to: "/#/prs/changes-requested?q=storage" },
  { from: "/#/approved", to: "/#/prs/approved" },
  { from: "/#/blocked?repo=fixture/calendar", to: "/#/prs/blocked?repo=fixture/calendar" },
  { from: "/#/merged", to: "/#/prs/merged" },
  { from: "/#/repositories", to: "/#/repos" },
  { from: "/#/repositories?scope=attention&sort=name", to: "/#/repos?scope=attention&sort=name" },
  { from: "/#/settings?tab=schedule", to: "/#/settings" },
  { from: "/#/settings?tab=notifications", to: "/#/settings?tab=notifications" },
  { from: "/#/settings?tab=access", to: "/#/settings?tab=access" },
  { from: "/#/about", to: "/#/about" },
  { from: "/#/follow-ups", to: "/#/inbox" },
  { from: "/#/prs/unknown?q=storage", to: "/#/prs?q=storage" },
];

// A replacement for one stubbed endpoint, keyed by its path under /api/v1/ exactly as the switch below spells it ("follow-ups", "sync/progress", "pull-requests/101/activity"). An override answers instead of the default for every method, so a spec that needs a state the defaults do not describe — a failed poll, an incomplete baseline, a 409 — adds it here rather than editing this file.
export type FixtureOverride = (route: Route) => unknown;

// The stub API both the suite and the comparison harness run against, so a
// screenshot and a computed-style capture see the same application.
// The locale is a parameter rather than a constant because width is not the only axis the layout has to survive: Spanish is the worst case for every label in the shell and Japanese is the worst case for line breaking, and neither was rendered anywhere in the suite before. English stays the default so no existing test changes.
export async function installFixtures(page: Page, options: { locale?: string; overrides?: Record<string, FixtureOverride> } = {}) {
  const locale = options.locale ?? "en";
  const overrides = options.overrides ?? {};
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
      undoable: false,
      snoozed_until: null as string | null,
      // The facts match the reasons on purpose. presentation() appends conflict and checks_failed to ANY authored row carrying them, independently of the confirmation, so "human_feedback alone on a conflicted, red-CI pull request of my own" is a row the server cannot produce — and a fixture that produces it lets the card be judged against a state that does not exist. Row 35 below is the blocked case, with the reasons to match.
      pr: { id: 101, repo: "fixture/calendar", number: 17, title: "Handle timezone boundaries", url: "https://github.com/fixture/calendar/pull/17", review_status: "changes_requested", checks_status: "success", has_conflicts: false, draft: false },
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
      undoable: false,
      snoozed_until: null as string | null,
      pr: { id: 102, repo: "fixture/reviewer", number: 24, title: "Review storage migration", url: "https://github.com/fixture/reviewer/pull/24", review_status: "pending", checks_status: "success", has_conflicts: false, draft: false },
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
      undoable: false,
      snoozed_until: null as string | null,
      pr: { id: 103, repo: "fixture/calendar", number: 31, title: "Ship the release notes", url: "https://github.com/fixture/calendar/pull/31", review_status: "approved", checks_status: "success", has_conflicts: false, draft: false },
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
      undoable: false,
      snoozed_until: reminder as string | null,
      pr: { id: 104, repo: "fixture/calendar", number: 33, title: "Tune the query planner", url: "https://github.com/fixture/calendar/pull/33", review_status: "pending", checks_status: "success", has_conflicts: false, draft: false },
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
      undoable: false,
      snoozed_until: null as string | null,
      pr: { id: 105, repo: "fixture/calendar", number: 35, title: "Rebase the storage migration", url: "https://github.com/fixture/calendar/pull/35", review_status: "changes_requested", checks_status: "failure", has_conflicts: true, draft: false },
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
      undoable: false,
      snoozed_until: null as string | null,
      pr: { id: 106, repo: "fixture/calendar", number: 40, title: "Prototype the digest", url: "https://github.com/fixture/calendar/pull/40", review_status: "pending", checks_status: "unknown", has_conflicts: false, draft: true },
    },
  ];
  // POST /follow-ups/:id, for every id rather than only the first: five of the six tasks are now acted on by some test, and a mutation that silently no-ops would let an assertion about the aftermath pass for the wrong reason. The writes mirror applyFollowUpAction followed by presentation(), because a fixture that is more forgiving than the server is how a destructive path passes CI: this one used to answer `handled` by emptying `reasons` and never touching `waiting_since`, so a blocked row obediently disappeared and the clock the whole product ranks by was never seen to reset.
  // One step of history per row, mirroring the snapshot columns: the fixture has to be able to give a row back, or an assertion about undo would pass against a mutation that never happened.
  const previous = new Map<number, string>();
  // presentation() re-derives these two from synced GitHub facts on every read, so no verb in the product can clear them. They are what `handledIsUseful` refuses a button for, and what `factsSurvive` warns about on a mixed card.
  const factDerived = (reason: string) => reason === "conflict" || reason === "checks_failed";
  const mutate = (id: number, body: { action: string; until?: string }) => {
    const task = tasks.find((entry) => entry.id === id);
    if (!task) return;
    if (body.action === "undo") {
      const snapshot = previous.get(id);
      if (!snapshot) return;
      Object.assign(task, JSON.parse(snapshot));
      previous.delete(id);
      return;
    }
    // `read` takes no snapshot, the same exclusion followup_store.go makes: the one step of history is spent on the action that changed something rather than on the last one to arrive, and clicking a title to go and read the thread is the most ordinary interaction in the product.
    if (body.action !== "read") {
      previous.set(id, JSON.stringify(task));
      task.undoable = true;
    }
    if (body.action === "unsnooze") {
      task.snoozed_until = null;
      return;
    }
    task.unread = false;
    if (body.action === "snooze") {
      task.snoozed_until = body.until ?? null;
      // A live snooze is reported as `waiting` with the reasons still attached — the browser's Muted group is a finer reading of a state the server agrees with, never a second opinion about whether something needs action.
      task.state = "waiting";
      return;
    }
    if (body.action === "handled" || body.action === "followed_up") {
      // The server clears NeedsConfirmation and rewrites WaitingSince, and that is all: the fact-derived reasons come straight back out of the next read, so a row that is only blocked stays exactly where it was with a clock that now says "today". That is the damage the card's withheld button exists to prevent, and it has to be observable here for any test to catch it.
      task.reasons = task.reasons.filter(factDerived);
      task.waiting_since = new Date().toISOString();
      task.state = task.reasons.length > 0 ? "action" : "waiting";
    }
  };
  const destinations: { id: number; name: string; kind: string; enabled: boolean }[] = [];
  // The pull requests the list endpoint knows about. Every DB id differs from both its PR number and the id of the follow-up that points at it, so a surface that sends the number, or the follow-up id, where the PullRequest id belongs asks for an activity URL the stub answers with a 404 and the test fails.
  const pulls = [
    {
      id: 101,
      repo: "fixture/calendar",
      number: 17,
      title: "Handle timezone boundaries",
      url: "https://github.com/fixture/calendar/pull/17",
      updated_at: "2026-09-10T00:00:00Z",
      review_status: "review_requested",
      checks_status: "success",
      state: "open",
      comments_count: 2,
      has_conflicts: false,
      merged_at: null as string | null,
      draft: false,
    },
    {
      id: 102,
      repo: "fixture/reviewer",
      number: 24,
      title: "Review storage migration",
      url: "https://github.com/fixture/reviewer/pull/24",
      updated_at: "2026-09-09T00:00:00Z",
      review_status: "changes_requested",
      checks_status: "failure",
      state: "open",
      comments_count: 0,
      has_conflicts: true,
      merged_at: null as string | null,
      draft: false,
    },
    // A draft with no pipeline, which is two rows in one: the status pill has to read Draft rather than the review status it would otherwise inherit, and an unknown check result has to print nothing rather than a full-width grey "CI: Unknown".
    {
      id: 106,
      repo: "fixture/calendar",
      number: 40,
      title: "Prototype the digest",
      url: "https://github.com/fixture/calendar/pull/40",
      updated_at: "2026-09-08T00:00:00Z",
      review_status: "pending",
      checks_status: "unknown",
      state: "open",
      comments_count: 0,
      has_conflicts: false,
      merged_at: null as string | null,
      draft: true,
    },
    // Finished work, so the merged view has a row to show and the default view has one to leave out.
    {
      id: 107,
      repo: "fixture/calendar",
      number: 28,
      title: "Add the digest scheduler",
      url: "https://github.com/fixture/calendar/pull/28",
      updated_at: "2026-09-06T00:00:00Z",
      review_status: "approved",
      checks_status: "success",
      state: "closed",
      comments_count: 3,
      has_conflicts: false,
      merged_at: "2026-09-06T00:00:00Z" as string | null,
      draft: false,
    },
  ];
  // listPRs in apps/api/main.go, clause for clause: an explicit merged= or state= replaces the open-and-unmerged default rather than narrowing it, attention= is the Blocked predicate on top of open and unmerged, search matches title or repository case-insensitively and a bare or #-prefixed number matches the PR number, and the total is counted before the page is cut.
  const listPulls = (params: URLSearchParams) => {
    const state = params.get("state");
    let rows = params.get("merged") === "true" ? pulls.filter((pr) => pr.merged_at !== null) : state ? pulls.filter((pr) => pr.state === state) : pulls.filter((pr) => pr.state === "open" && pr.merged_at === null);
    const review = params.get("review_status");
    if (review) rows = rows.filter((pr) => pr.review_status === review);
    const repo = params.get("repo");
    if (repo) rows = rows.filter((pr) => pr.repo === repo);
    const search = (params.get("search") ?? "").trim();
    if (search) {
      const needle = search.toLowerCase();
      const number = Number(search.replace(/^#/, ""));
      rows = rows.filter((pr) => pr.title.toLowerCase().includes(needle) || pr.repo.toLowerCase().includes(needle) || (Number.isInteger(number) && number > 0 && pr.number === number));
    }
    if (params.get("attention") === "true") rows = rows.filter((pr) => pr.state === "open" && pr.merged_at === null && (pr.has_conflicts || pr.review_status === "changes_requested" || ["failure", "error"].includes(pr.checks_status)));
    rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const limit = Number(params.get("limit") ?? 50);
    const offset = Number(params.get("offset") ?? 0);
    return { total: rows.length, data: rows.slice(offset, offset + (limit > 0 && limit <= 200 ? limit : 50)), limit, offset };
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1/", "");
    const override = overrides[path];
    if (override) return override(route);
    let data: unknown = {};
    const activity = /^pull-requests\/(\d+)\/activity$/.exec(path);
    if (activity) {
      const pr = pulls.find((entry) => entry.id === Number(activity[1]));
      if (!pr) return route.fulfill({ status: 404, json: { error: "pull request not found" } });
      return route.fulfill({
        json: {
          warnings: ["Some review threads could not be read."],
          conversation: [{ id: 1, body: "Please cover the timezone boundary.", html_url: `${pr.url}#issuecomment-1`, created_at: "2026-09-10T00:00:00Z", user: { login: "fixture" } }],
          review_comments: [{ id: 2, body: "This branch needs a test.", html_url: `${pr.url}#discussion_r2`, path: "src/calendar.ts", line: 42, created_at: "2026-09-10T01:00:00Z", user: { login: "reviewer" } }],
          threads: [{ id: "t1", isResolved: false, isOutdated: false, path: "src/calendar.ts", line: 42 }],
          checks: [{ id: 3, name: "build", status: "completed", conclusion: "success", html_url: `https://github.com/${pr.repo}/runs/3` }],
        },
      });
    }
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
        // `attention` is the Blocked tile's number and also what /#/prs/blocked asks the list endpoint for, so it counts the same rows the list stub returns for that predicate: PR 102 (changes requested, failing, conflicted).
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
        data = listPulls(url.searchParams);
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
