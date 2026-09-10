import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
      case "review-teams":
        data = { data: [{ id: "fixture/reviewers", name: "Reviewers" }] };
        break;
      default:
        data = { data: [] };
    }
    await route.fulfill({ json: data });
  });
});

test("overview preserves global follow-ups when contribution year changes", async ({ page }, testInfo) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
  await expect(page.locator(".followup-priority")).toContainText("Handle timezone boundaries");
  await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true });
  await page.getByRole("tab", { name: "2025", exact: true }).click();
  await expect(page.locator(".followup-priority")).toContainText("Review storage migration");
  await page.getByRole("link", { name: "View all follow-ups" }).click();
  await expect(page.locator(".followup-card")).toHaveCount(2);
});

test("read leaves task pending; explicit handling moves it to waiting", async ({ page }) => {
  await page.goto("/#/attention?role=authored&status=action");
  const card = page.locator(".followup-card");
  await expect(card).toHaveCount(1);
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark read", exact: true })).toHaveCount(0);
  await expect(card).toHaveCount(1);
  await page.getByRole("button", { name: "Handled · wait for others", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("waiting");
  await expect(card).toContainText("Handle timezone boundaries");
});

test("reviewer filter and mobile layout", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/attention?role=reviewer");
  await expect(page.locator(".followup-card")).toHaveCount(1);
  await expect(page.locator(".followup-card")).toContainText("Review storage migration");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-followups.png"), fullPage: true });
});

test("settings save timezone and selected review teams", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/Madrid");
  await page.getByLabel("fixture/reviewers", { exact: true }).check();
  const saved = page.waitForRequest((req) => req.url().endsWith("/follow-up-settings") && req.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ timezone: "Europe/Madrid", digest_time: "09:00", teams: ["fixture/reviewers"] });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
});
