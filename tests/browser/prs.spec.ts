import { expect, test } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// The draft is the ready-to-merge rule seen from the other side: it says everything in a table row that would otherwise inherit a review status nobody was asked for.
test("a draft row says Draft once and no review or CI state it does not have", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Prototype the digest" });
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
  // A draft's "pending" only means nobody has reviewed something nobody was asked to review, and a repository without a pipeline has no check result to report.
  await expect(row).not.toContainText("Awaiting review");
  await expect(row).not.toContainText("CI:");
});

// A merge conflict and a red build are the two states only the author can clear, and they were the only ones the table could not be filtered to, while listPRs has honoured `attention=true` since it was written. The tile and the pill are the same SQL predicate, so this asserts the number and its destination are the same question.
test("the blocked filter asks the list endpoint for the rows the tile counts", async ({ page }) => {
  const requested = page.waitForRequest((request) => request.url().includes("/api/v1/pull-requests?"));
  await page.goto("/#/prs/blocked");
  expect(new URL((await requested).url()).searchParams.get("attention")).toBe("true");
  await expect(page.getByRole("button", { name: "Blocked", exact: true })).toHaveAttribute("aria-pressed", "true");

  // The third stat tile counts the same rows and is now a link to them; it used to be an inert "Conflicts" number with no view behind it.
  // The list answers with the same rows: the one conflicted, failing pull request, and nothing that is only waiting for review.
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(0);

  await page.goto("/#/prs");
  await page.getByRole("link", { name: /^Blocked/ }).click();
  await expect(page).toHaveURL(/#\/prs\/blocked$/);
  await expect(page.getByRole("button", { name: "Blocked", exact: true })).toHaveAttribute("aria-pressed", "true");
});

// Two lists of the same pull requests with no bridge between them: the table could not say whether a row was already handled or already snoozed, and reading every comment on a PR left the workspace still insisting it was unread.
test("the table carries the follow-up state, and reading the thread records it", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Handle timezone boundaries" });
  await expect(row.getByTestId("row-follow-up")).toHaveText("Needs my action");
  await expect(row.getByTestId("unread-dot")).toBeVisible();
  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/1") && request.method() === "POST");
  await row.getByRole("button", { name: "Unread activity on #17" }).click();
  expect((await posted).postDataJSON()).toMatchObject({ action: "read" });
  // The decision can be recorded here rather than on a second trip to the workspace.
  await expect(page.getByRole("button", { name: /^Handled · wait for others/ })).toBeVisible();
  await expect(row.getByTestId("unread-dot")).toHaveCount(0);
});

// "Show me just this repository" was a two-screen detour through Repositories even though the name was right there in the row. The title link one cell over still goes to GitHub.
test("the repository cell filters the list instead of leaving for github.com", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Handle timezone boundaries" });
  await row.getByRole("button", { name: "Show only fixture/calendar" }).click();
  await expect(page).toHaveURL(/#\/prs\?repo=fixture%2Fcalendar$/);
  // The stub filters by repository the way listPRs does, so the other repository's row is gone.
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear the fixture/calendar filter" })).toBeVisible();
});

// "All pull requests" was open-and-unmerged, so nothing the reader had finished could be reached from the route named after all of them, while the same page advertised a merged count. The endpoint answered merged=true with a guaranteed-empty predicate; it now replaces the default rather than intersecting with it.
test("merged work is reachable from the list that claims to hold it", async ({ page }) => {
  await page.goto("/#/prs");
  const merged = page.waitForRequest((request) => request.url().includes("/pull-requests?") && request.url().includes("merged=true"));
  await page.getByRole("button", { name: "Merged", exact: true }).click();
  await merged;
  await expect(page).toHaveURL(/#\/prs\/merged$/);
  await expect(page.getByRole("row").filter({ hasText: "Add the digest scheduler" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(0);
});

// A view pill changes what the list is and keeps what the reader narrowed it to: the search and the repository travel with it, the page number does not, because page 2 of one view is a meaningless offset into another.
test("a view pill keeps the search and the repository and starts from the first page", async ({ page }) => {
  await page.goto("/#/prs?q=storage&repo=fixture/reviewer&page=2");
  await page.getByRole("button", { name: "Changes requested", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs\/changes-requested\?q=storage&repo=fixture%2Freviewer$/);
  await expect(page.getByRole("button", { name: "Changes requested", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
});

// The activity endpoint loads a PullRequest by its primary key (apps/api/activity.go), which is neither the PR number nor the follow-up id. Every fixture keeps the three apart and the stub answers any other id with a 404, so sending the wrong one fails here instead of showing an empty thread in production.
test("the activity sheet asks for the pull request by its id, not its number", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Review storage migration" });
  const requested = page.waitForRequest((request) => /\/pull-requests\/\d+\/activity$/.test(new URL(request.url()).pathname));
  await row.getByRole("button", { name: /activity .*#24$/ }).click();
  expect(new URL((await requested).url()).pathname).toMatch(/\/pull-requests\/102\/activity$/);
  const dialog = page.getByRole("dialog", { name: "Comments · fixture/reviewer #24" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("This branch needs a test.")).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  // Leaving the list closes the sheet: it has no history entry of its own, so a route change must not leave it mounted over another page.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: /activity .*#24$/ })).toBeFocused();
});
