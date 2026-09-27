import { expect, test, type Route } from "@playwright/test";
import { installFixtures, type FixtureOverride } from "./fixtures";

const overview = (patch: Record<string, unknown> = {}) => ({
  visibility_counts: { public: 12, private: 0, unknown: 0, public_repositories: 1, private_repositories: 0, unknown_repositories: 0 },
  history_complete: true,
  history_total: 12,
  year: 2026,
  years: [2026, 2025],
  summary: { total: 12, merged: 10, open: 2, closed: 0, repositories: 1 },
  repositories: [{ repo: "fixture/calendar", total: 12, merged: 10 }],
  months: [{ month: "2026-09", merged: 10 }],
  ...patch,
});

// The contribution overview moved from the landing page to its own route. Changing the year is a parameter of that route, so it survives a reload and a shared link.
test("insights switches the contribution year from its tab", async ({ page }, testInfo) => {
  await installFixtures(page);
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
  await page.getByRole("tab", { name: "2025", exact: true }).click();
  await expect(page).toHaveURL(/#\/insights\?year=2025$/);
  await expect(page.getByRole("tab", { name: "2025", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByRole("tab", { name: "2025", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("insights.png"), fullPage: true });
});

// The outcome legend counted sets the interface had no way to open; each count it can open is a link to the list that holds it, and Closed, which has no list, stays text.
test("insights names its report and opens what it counts", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expect(page).toHaveTitle("Insights · PR Desk");
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Closed", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveAttribute("href", "#/prs");
  await page.getByRole("link", { name: "Merged", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs\/merged$/);
});

// The donut and its pointer-dependent click are gone: the breakdown is a table, the name opens that repository's pull requests inside the app, and GitHub is a separate, labelled way out.
test("the repository breakdown is a table whose rows open the repository's pull requests", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/#/insights");
  const table = page.locator("table#repository-breakdown");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Repository", "PRs", "Share"]);
  const row = table.getByRole("row", { name: /fixture\/calendar/ });
  await expect(row.getByRole("cell")).toHaveText(["12", "100%"]);
  const github = row.getByRole("link", { name: "Open fixture/calendar on GitHub (opens in a new tab)" });
  await expect(github).toHaveAttribute("href", "https://github.com/fixture/calendar");
  await expect(github).toHaveAttribute("target", "_blank");
  await row.getByRole("link", { name: "fixture/calendar", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs\?repo=fixture%2Fcalendar$/);
});

test("the stat strip and the outcomes print every value", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/#/insights");
  await expect(page.getByText("Merge rate", { exact: true }).locator("..")).toContainText("83.3%");
  await expect(page.getByText("Merged contributions", { exact: true }).locator("..")).toContainText("10");
  await expect(page.getByText("10 merges in this period")).toBeVisible();
  // The chart covers the server's thirteen-month period, with the quiet months drawn as zero rather than dropped.
  await expect(page.getByText(/Sep 2025 – Sep 2026 · UTC/)).toBeVisible();
});

// The visibility scope is a set of pressed toggles, not tabs: the only tabs on the page are the years.
test("visibility is a toggle group that writes the address and says what it covers", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/#/insights");
  const scope = page.getByRole("group", { name: "Repository visibility" });
  await expect(scope.getByRole("button", { name: /^Public/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Showing 1 public repository." })).toBeVisible();
  await scope.getByRole("button", { name: /^All/ }).click();
  await expect(page).toHaveURL(/visibility=all/);
  await expect(page.getByText("Showing all contributions in this period")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText(["2026", "2025"]);
});

test("the trend repository is a native select that asks for that repository's months", async ({ page }) => {
  const trendRequests: string[] = [];
  await installFixtures(page, {
    overrides: {
      overview: (route: Route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("trend_repo")) trendRequests.push(url.searchParams.get("trend_repo")!);
        return route.fulfill({ json: overview(url.searchParams.get("trend_repo") ? { months: [{ month: "2026-08", merged: 3 }] } : {}) });
      },
    },
  });
  await page.goto("/#/insights");
  await page.getByRole("combobox", { name: "Trend repository" }).selectOption("fixture/calendar");
  await expect(page).toHaveURL(/repo=fixture%2Fcalendar/);
  await expect(page.getByText("3 merges in this period")).toBeVisible();
  expect(trendRequests).toEqual(["fixture/calendar"]);
  await expect(page.getByRole("link", { name: "fixture/calendar (opens in a new tab)" })).toHaveAttribute("href", "https://github.com/fixture/calendar");
});

// Without an installation that can read pull requests, the private scope says why and offers the three ways forward: install, check again, or manage it in Settings.
test("the private scope without access offers the install, a recheck and the settings tab", async ({ page }) => {
  await installFixtures(page, { overrides: { "repository-access": (route) => route.fulfill({ json: { has_installations: false, can_read_private: false, install_url: "https://github.com/apps/pr-desk/installations/new", installations: [] } }) } });
  await page.goto("/#/insights?visibility=private");
  await expect(page.getByRole("group", { name: "Repository visibility" }).getByRole("button", { name: /^Private/ })).toContainText("Not authorized");
  await expect(page.getByRole("status").filter({ hasText: "no accessible installations" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Install GitHub App/ })).toHaveAttribute("href", "https://github.com/apps/pr-desk/installations/new");
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  await page.getByRole("link", { name: "Manage in Settings" }).click();
  await expect(page).toHaveURL(/#\/settings\?tab=github$/);
});

test("the private scope lists each installation and what it may read", async ({ page }) => {
  await installFixtures(page, {
    overrides: {
      "repository-access": (route) =>
        route.fulfill({
          json: {
            has_installations: true,
            can_read_private: true,
            installations: [
              { account: "fixture", repository_selection: "all", can_read_prs: true, settings_url: "https://github.com/settings/installations/1" },
              { account: "acme", repository_selection: "selected", can_read_prs: false, settings_url: "https://github.com/organizations/acme/settings/installations/2" },
            ],
          },
        }),
    },
  });
  await page.goto("/#/insights?visibility=private");
  const list = page.getByRole("list", { name: "Installations" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").filter({ hasText: "fixture" })).toContainText("All repositories authorized");
  await expect(list.getByRole("listitem").filter({ hasText: "acme" }).locator("[data-tone=blocked]")).toHaveText("No pull request access");
  await expect(list.getByRole("link", { name: /^Configure/ }).first()).toHaveAttribute("href", "https://github.com/settings/installations/1");
});

// A grant found by rechecking starts one full sync, so the private repositories the last sync skipped are read. Arriving on the page with access already granted is not a grant and starts nothing.
test("granting private access starts exactly one full sync", async ({ page }) => {
  let granted = false;
  const syncs: string[] = [];
  const access: FixtureOverride = (route) =>
    route.fulfill({ json: granted ? { has_installations: true, can_read_private: true, installations: [{ account: "fixture", repository_selection: "all", can_read_prs: true, settings_url: "https://github.com/settings/installations/1" }] } : { has_installations: false, can_read_private: false, installations: [] } });
  await installFixtures(page, {
    overrides: {
      "repository-access": access,
      sync: (route) => {
        syncs.push(new URL(route.request().url()).search);
        return route.fulfill({ json: { status: "queued" } });
      },
    },
  });
  await page.goto("/#/insights?visibility=private");
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  expect(syncs).toEqual([]);
  granted = true;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("list", { name: "Installations" })).toBeVisible();
  await expect.poll(() => syncs).toEqual(["?full=1"]);
  // Another answer with the same access is not a second grant.
  await page
    .getByRole("group", { name: "Repository visibility" })
    .getByRole("button", { name: /^Public/ })
    .click();
  await page
    .getByRole("group", { name: "Repository visibility" })
    .getByRole("button", { name: /^Private/ })
    .click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("list", { name: "Installations" })).toBeVisible();
  expect(syncs).toEqual(["?full=1"]);
});

test("a failed report offers a retry and the widest scope", async ({ page }) => {
  let fail = true;
  await installFixtures(page, { overrides: { overview: (route) => (fail ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.fulfill({ json: overview() })) } });
  await page.goto("/#/insights");
  const alert = page.getByRole("alert").filter({ hasText: "Unable to load contributions" });
  // The query keeps TanStack's default three retries with backoff, as it always has, so the error takes about seven seconds to settle.
  await expect(alert).toBeVisible({ timeout: 15000 });
  await expect(alert.getByRole("button", { name: "All contributions" })).toBeVisible();
  fail = false;
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
});

// Honest data: an unfinished history sync is said above the numbers, and the counts it would make wrong show a dash.
test("an incomplete history says the totals are partial", async ({ page }) => {
  await installFixtures(page, { overrides: { overview: (route) => route.fulfill({ json: overview({ history_complete: false, visibility_counts: { public: 12, private: 0, unknown: 0, public_repositories: 0, private_repositories: 0, unknown_repositories: 0 } }) }) } });
  await page.goto("/#/insights");
  await expect(page.getByText("These totals are partial")).toBeVisible();
  await expect(page.getByRole("group", { name: "Repository visibility" }).getByRole("button", { name: /^Public/ })).toContainText("—");
});

test("a year with no contributions says so instead of drawing empty charts", async ({ page }) => {
  await installFixtures(page, { overrides: { overview: (route) => route.fulfill({ json: overview({ summary: { total: 0, merged: 0, open: 0, closed: 0, repositories: 0 }, repositories: [], months: [] }) }) } });
  await page.goto("/#/insights");
  await expect(page.getByText("No contributions yet. Connect GitHub and sync.")).toBeVisible();
  await expect(page.locator("#repository-breakdown")).toHaveCount(0);
});
