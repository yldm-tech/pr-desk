import { expect, test, type Route } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

const row = (page: import("@playwright/test").Page, repo: string) => page.getByRole("listitem").filter({ has: page.getByRole("link", { name: new RegExp(`^${repo.split("/")[0]}\\s*/\\s*${repo.split("/")[1]}`) }) });

// Attention, Conflicts and Failing all count rows of the attention predicate (apps/api/main.go), so every nonzero one of them is a way into the Blocked view of that repository — the only list that holds exactly that set. The old page left Conflicts and Failing as dead numbers.
test("every nonzero attention, conflict and failing count leads to that repository's blocked pull requests", async ({ page }) => {
  await page.goto("/#/repos");
  const calendar = row(page, "fixture/calendar");
  await expect(calendar).toHaveCount(1);
  for (const name of ["1 failing PR · fixture/calendar", "1 conflict · fixture/calendar", "2 need attention · fixture/calendar"]) {
    const link = calendar.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", "#/prs/blocked?repo=fixture%2Fcalendar");
    await expect(link).toHaveAttribute("title", "Shows all blocked PRs in this repository");
  }
  const requested = page.waitForRequest((request) => request.url().includes("/pull-requests?") && new URL(request.url()).searchParams.get("attention") === "true");
  await calendar.getByRole("link", { name: "1 failing PR · fixture/calendar", exact: true }).click();
  expect(new URL((await requested).url()).searchParams.get("repo")).toBe("fixture/calendar");
  await expect(page).toHaveURL(/#\/prs\/blocked\?repo=fixture%2Fcalendar$/);
  await expect(page.getByRole("button", { name: /^Blocked/ })).toHaveAttribute("aria-pressed", "true");
});

test("open counts and View PRs lead to the repository's open list, and zeros lead nowhere", async ({ page }) => {
  await page.goto("/#/repos");
  const reviewer = row(page, "fixture/reviewer");
  await expect(reviewer.getByRole("link", { name: "2 open PRs · fixture/reviewer", exact: true })).toHaveAttribute("href", "#/prs?repo=fixture%2Freviewer");
  await expect(reviewer.getByRole("link", { name: "View PRs · fixture/reviewer", exact: true })).toHaveAttribute("href", "#/prs?repo=fixture%2Freviewer");
  // A zero has no list behind it: it is a quiet number in the table and absent from the card, never a link to an empty view.
  await expect(reviewer.getByRole("link")).toHaveCount(3);
  await expect(reviewer.getByRole("link", { name: /^fixture\s*\/\s*reviewer/ })).toHaveAttribute("href", "https://github.com/fixture/reviewer");
  await expect(reviewer.getByRole("link", { name: /^fixture\s*\/\s*reviewer/ })).toHaveAttribute("target", "_blank");
  await reviewer.getByRole("link", { name: "View PRs · fixture/reviewer", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs\?repo=fixture%2Freviewer$/);
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
});

// Every control writes the address, with replace, so the list is shareable and Back still leaves the page rather than stepping through keystrokes.
test("scope, owner, sort and search live in the address", async ({ page }) => {
  await page.goto("/#/repos");
  const scope = page.getByRole("group", { name: "Repository status" });
  await expect(scope.getByRole("button")).toHaveText(["All2", "Need attention1", "Have conflicts1"]);
  await expect(page.locator("#repositories").getByRole("heading", { level: 1, name: "Repositories" })).toBeVisible();
  await expect(page.getByText("2 repositories with open PRs")).toBeVisible();
  // Attention first by default: the repository with work on it leads.
  await expect(page.getByRole("listitem").first()).toContainText("calendar");

  await scope.getByRole("button", { name: /^Need attention/ }).click();
  await expect(page).toHaveURL(/#\/repos\?scope=attention$/);
  await expect(scope.getByRole("button", { name: /^Need attention/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("1 repository with open PRs")).toBeVisible();

  await scope.getByRole("button", { name: /^All/ }).click();
  await expect(page).toHaveURL(/#\/repos$/);
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Sort").selectOption("name");
  await expect(page).toHaveURL(/#\/repos\?sort=name$/);
  await expect(page.getByLabel("Sort")).toHaveValue("name");
  await page.getByLabel("Sort").selectOption("open");
  await expect(page).toHaveURL(/#\/repos\?sort=open$/);
  await expect(page.getByRole("listitem").first()).toContainText("calendar");

  await page.getByLabel("Owner").selectOption("fixture");
  await expect(page).toHaveURL(/owner=fixture/);
  await expect(page.getByLabel("Owner")).toHaveValue("fixture");
  await page.getByRole("searchbox", { name: "Search repositories" }).fill("review");
  await expect(page).toHaveURL(/q=review/);
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("listitem")).toContainText("reviewer");

  // Clear filters removes what narrows the list and leaves the sort, which only orders it.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/#\/repos\?sort=open$/);
  await expect(page.getByRole("listitem")).toHaveCount(2);

  // A reload keeps every one of them.
  await page.goto("/#/repos?scope=conflicts&sort=name&q=cal");
  await expect(page.getByRole("button", { name: /^Have conflicts/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Sort")).toHaveValue("name");
  await expect(page.getByRole("searchbox", { name: "Search repositories" })).toHaveValue("cal");
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

// An owner from a bookmark stays selectable even when no synced repository has it any more, so the page says why it is empty instead of silently snapping the select back to "All owners".
test("a stale owner from the address stays selected and the empty list can be cleared", async ({ page }) => {
  await page.goto("/#/repos?owner=ghost");
  await expect(page.getByLabel("Owner")).toHaveValue("ghost");
  await expect(page.getByText("No matching results")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page).toHaveURL(/#\/repos$/);
  await expect(page.getByRole("listitem")).toHaveCount(2);
});

test("a failed load says so and offers a retry", async ({ page }) => {
  let mode: "down" | "up" = "down";
  const data = { data: [{ repo: "fixture/calendar", total: 12, open: 4, conflicts: 1, needs_attention: 2, checks_failing: 1 }] };
  await installFixtures(page, { overrides: { repositories: (route: Route) => (mode === "up" ? route.fulfill({ json: data }) : route.fulfill({ status: 500, json: { error: "boom" } })) } });
  await page.goto("/#/repos");
  // The app retries a failed query once, after 600ms, so the failure is final within about a second.
  const alert = page.getByRole("alert").filter({ hasText: "Repositories could not be loaded" });
  await expect(alert).toBeVisible({ timeout: 5_000 });
  mode = "up";
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("the empty state for an account with nothing synced points at Sync", async ({ page }) => {
  await installFixtures(page, { overrides: { repositories: (route: Route) => route.fulfill({ json: { data: [] } }) } });
  await page.goto("/#/repos");
  await expect(page.getByText("No repositories yet. Connect GitHub and click Sync now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
});
