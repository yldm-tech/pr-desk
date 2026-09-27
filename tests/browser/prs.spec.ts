import { expect, test, type Route } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// The draft is the ready-to-merge rule seen from the other side: it says everything in a table row that would otherwise inherit a review status nobody was asked for.
test("a draft row says Draft once and no review or CI state it does not have", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Prototype the digest" });
  await expect(row.getByText("Draft", { exact: true })).toHaveCount(1);
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
  // A draft's "pending" only means nobody has reviewed something nobody was asked to review, and a repository without a pipeline has no check result to report. The follow-up chip would only repeat "Draft", so it is left out too.
  await expect(row).not.toContainText("Awaiting review");
  await expect(row).not.toContainText("CI");
  await expect(row.getByTestId("row-follow-up")).toHaveCount(0);
  // A green build is the expected state and earns no chip either; only the failing one does.
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).not.toContainText("CI");
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" }).getByText("CI failing")).toBeVisible();
});

// A merge conflict and a red build are the two states only the author can clear, and listPRs has honoured `attention=true` since it was written. The pill's count and the pill's list are the same SQL predicate, so this asserts the number and its destination are the same question.
test("the blocked filter asks the list endpoint for the rows its count counts", async ({ page }) => {
  const requested = page.waitForRequest((request) => request.url().includes("/api/v1/pull-requests?"));
  await page.goto("/#/prs/blocked");
  expect(new URL((await requested).url()).searchParams.get("attention")).toBe("true");
  const pill = page.getByRole("group", { name: "Pull request views" }).getByRole("button", { name: /^Blocked/ });
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  // The count on the pill is /stats' attention, which counts the same rows.
  await expect(pill).toContainText("1");
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(0);
  await expect(page).toHaveTitle("Blocked · Pull requests · PR Desk");

  await page.goto("/#/prs");
  await expect(page).toHaveTitle("Pull requests · PR Desk");
  await page.getByRole("button", { name: /^Blocked/ }).click();
  await expect(page).toHaveURL(/#\/prs\/blocked$/);
  await expect(page.getByRole("button", { name: /^Blocked/ })).toHaveAttribute("aria-pressed", "true");
});

// The stat tiles are gone; their numbers live on the pills. Merged carries none, because /stats counts this month's merges while the view lists every merge.
test("the view pills carry the counts the stats endpoint can back, and nothing else", async ({ page }) => {
  await page.goto("/#/prs");
  const views = page.getByRole("group", { name: "Pull request views" });
  await expect(views.getByRole("button")).toHaveText(["Open3", "Review requested1", "Changes requested", "Approved", "Blocked1", "Merged"]);
  await expect(views.getByRole("button", { name: /^Open/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Pull requests" })).toBeVisible();
  // The count beside the heading is the list's own total, not the stats figure.
  await expect(page.locator("header").filter({ has: page.getByRole("heading", { level: 1, name: "Pull requests" }) })).toContainText("3");
  await expect(page.getByRole("columnheader")).toHaveText(["Pull request", "Repository", "Status", "Updated", "Activity"]);
});

test("a failed stats request says so under the pills and leaves the list alone", async ({ page }) => {
  let fail = true;
  await installFixtures(page, { overrides: { stats: (route: Route) => (fail ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.fulfill({ json: { open: 3, needs_review: 1, conflicts: 1, merged: 5, attention: 1 } })) } });
  await page.goto("/#/prs");
  // /stats keeps TanStack's default three retries, so the failure takes a few seconds to be final.
  await expect(page.getByRole("status").filter({ hasText: "Statistics could not be updated." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Open/ })).toContainText("—");
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(1);
  fail = false;
  await page.getByRole("status").filter({ hasText: "Statistics could not be updated." }).getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: /^Open/ })).toContainText("3");
  await expect(page.getByText("Statistics could not be updated.")).toHaveCount(0);
});

// Two lists of the same pull requests with no bridge between them: the table could not say whether a row was already handled or already snoozed, and reading every comment on a PR left the Inbox still insisting it was unread.
test("the table carries the follow-up state, and reading the thread records it", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Handle timezone boundaries" });
  await expect(row.getByTestId("row-follow-up")).toHaveText("Needs my action");
  await expect(row.getByTestId("row-follow-up").locator("[data-tone]")).toHaveAttribute("data-tone", "action");
  await expect(row.getByTestId("unread-dot")).toBeVisible();
  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/1") && request.method() === "POST");
  await row.getByRole("button", { name: "Unread activity on #17" }).click();
  expect((await posted).postDataJSON()).toMatchObject({ action: "read" });
  // The decision can be recorded here rather than on a second trip to the Inbox.
  await expect(page.getByRole("button", { name: /^Handled · wait for others/ })).toBeVisible();
  await expect(row.getByTestId("unread-dot")).toHaveCount(0);
});

// "Show me just this repository" was a two-screen detour through Repositories even though the name was right there in the row. The title link one cell over still goes to GitHub.
test("the repository cell filters the list instead of leaving for github.com", async ({ page }) => {
  await page.goto("/#/prs");
  const row = page.getByRole("row").filter({ hasText: "Handle timezone boundaries" });
  await expect(row.getByRole("link", { name: /^Handle timezone boundaries/ })).toHaveAttribute("href", "https://github.com/fixture/calendar/pull/17");
  await row.getByRole("button", { name: "Show only fixture/calendar" }).click();
  await expect(page).toHaveURL(/#\/prs\?repo=fixture%2Fcalendar$/);
  // The stub filters by repository the way listPRs does, so the other repository's row is gone.
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(0);
  await expect(page.getByTestId("repository-chip")).toHaveText("fixture/calendar");
  await page.getByRole("button", { name: "Clear the fixture/calendar filter" }).click();
  await expect(page).toHaveURL(/#\/prs$/);
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
});

// "All pull requests" was open-and-unmerged, so nothing the reader had finished could be reached from the route named after all of them. The endpoint answered merged=true with a guaranteed-empty predicate; it now replaces the default rather than intersecting with it.
test("merged work is reachable from the list that claims to hold it", async ({ page }) => {
  await page.goto("/#/prs");
  const merged = page.waitForRequest((request) => request.url().includes("/pull-requests?") && request.url().includes("merged=true"));
  await page.getByRole("button", { name: "Merged", exact: true }).click();
  await merged;
  await expect(page).toHaveURL(/#\/prs\/merged$/);
  const row = page.getByRole("row").filter({ hasText: "Add the digest scheduler" });
  await expect(row).toBeVisible();
  await expect(row.locator("[data-glyph]")).toHaveAttribute("data-glyph", "merged");
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(0);
});

// A view pill changes what the list is and keeps what the reader narrowed it to: the search and the repository travel with it, the page number does not, because page 2 of one view is a meaningless offset into another.
test("a view pill keeps the search and the repository and starts from the first page", async ({ page }) => {
  await page.goto("/#/prs?q=storage&repo=fixture/reviewer&page=2");
  await expect(page.getByRole("button", { name: "Back to first page" })).toBeVisible();
  await page.getByRole("button", { name: "Changes requested", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs\/changes-requested\?q=storage&repo=fixture%2Freviewer$/);
  await expect(page.getByRole("button", { name: "Changes requested", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
});

// Search is a server query, so it commits on Enter and resets the page; the clear button commits the empty search at once. There is no separate search button to find.
test("search commits on Enter and clears in one step", async ({ page }) => {
  await page.goto("/#/prs?page=2");
  const box = page.getByRole("searchbox", { name: "Search pull requests" });
  await box.fill("#24");
  await expect(page).toHaveURL(/page=2/);
  const searched = page.waitForRequest((request) => request.url().includes("/pull-requests?") && new URL(request.url()).searchParams.get("search") === "#24");
  await box.press("Enter");
  expect(new URL((await searched).url()).searchParams.get("offset")).toBe("0");
  await expect(page).toHaveURL(/#\/prs\?q=%2324$/);
  await expect(page.getByRole("row").filter({ hasText: "Review storage migration" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs$/);
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
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
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: /activity .*#24$/ })).toBeFocused();
});

// j and k walk the table the way they walk the Inbox. Moving the cursor is looking, not reading, so it posts nothing; Enter is the explicit request and opens the activity, which is what records the read.
test("j and k move a cursor through the table without reading, and Enter opens the row", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/follow-ups/")) posts.push(request.url());
  });
  await page.goto("/#/prs");
  const rows = page.locator('[role="table"] > [role="row"][id^="pr-row-"]');
  await expect(rows).toHaveCount(3);
  await page.locator("body").press("j");
  await expect(rows.nth(0)).toHaveAttribute("data-active", "true");
  await expect(rows.nth(0)).toBeFocused();
  await expect.poll(() => rows.nth(0).evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(rows.nth(2)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toHaveAttribute("data-active", "true");
  await expect(rows.nth(0)).toContainText("Handle timezone boundaries");
  expect(posts).toEqual([]);

  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/1") && request.method() === "POST");
  await page.keyboard.press("Enter");
  expect((await posted).postDataJSON()).toMatchObject({ action: "read" });
  await expect(page.getByRole("dialog", { name: "Comments · fixture/calendar #17" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Escape with no overlay open clears the cursor.
  await page.locator("body").press("Escape");
  await expect(page.locator("[data-active]")).toHaveCount(0);
});

test("o opens the cursor row on GitHub in a new tab", async ({ page, context }) => {
  await context.route("https://github.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }));
  await page.goto("/#/prs");
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toBeVisible();
  await page.locator("body").press("j");
  await page.keyboard.press("j");
  const opened = context.waitForEvent("page");
  await page.keyboard.press("o");
  const tab = await opened;
  await expect.poll(() => tab.url()).toBe("https://github.com/fixture/reviewer/pull/24");
  await tab.close();
});

// The pager only appears when there is a second page to reach, and each step asks the server for the next fifty.
test("the pager shows only when there is more than one page", async ({ page }) => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    id: 1000 + index,
    repo: "fixture/bulk",
    number: index + 1,
    title: `Bulk change ${index + 1}`,
    url: `https://github.com/fixture/bulk/pull/${index + 1}`,
    updated_at: "2026-09-01T00:00:00Z",
    review_status: "pending",
    checks_status: "success",
    state: "open",
    comments_count: 0,
    has_conflicts: false,
    merged_at: null,
    draft: false,
  }));
  await installFixtures(page, {
    overrides: {
      "pull-requests": (route: Route) => {
        const params = new URL(route.request().url()).searchParams;
        const offset = Number(params.get("offset") ?? 0);
        return route.fulfill({ json: { total: rows.length, data: rows.slice(offset, offset + 50) } });
      },
    },
  });
  await page.goto("/#/prs");
  const pager = page.getByRole("navigation", { name: "Pagination" });
  await expect(pager).toContainText("Page 1 · 120 results");
  await expect(pager.getByRole("button", { name: "Previous" })).toBeDisabled();
  const next = page.waitForRequest((request) => request.url().includes("/pull-requests?") && new URL(request.url()).searchParams.get("offset") === "50");
  await pager.getByRole("button", { name: "Next" }).click();
  await next;
  await expect(page).toHaveURL(/#\/prs\?page=2$/);
  await expect(pager).toContainText("Page 2 · 120 results");
  await expect(page.getByRole("row").filter({ hasText: "Bulk change 51" })).toHaveCount(1);
  await pager.getByRole("button", { name: "Next" }).click();
  await expect(pager).toContainText("Page 3 · 120 results");
  await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("a list that cannot load says so and offers a retry", async ({ page }) => {
  let mode: "down" | "up" = "down";
  await installFixtures(page, {
    overrides: {
      "pull-requests": (route: Route) =>
        mode === "down"
          ? route.fulfill({ status: 500, json: { error: "boom" } })
          : route.fulfill({
              json: {
                total: 1,
                data: [
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
                    merged_at: null,
                    draft: false,
                  },
                ],
              },
            }),
    },
  });
  await page.goto("/#/prs");
  const alert = page.getByRole("alert").filter({ hasText: "Unable to load pull requests" });
  await expect(alert).toBeVisible();
  mode = "up";
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toBeVisible();
});

test("an empty view says which list is empty and offers the way back to open work", async ({ page }) => {
  await page.goto("/#/prs/approved");
  await expect(page.getByText("No pull requests in this view.")).toBeVisible();
  await page.getByRole("link", { name: "Show open PRs" }).click();
  await expect(page).toHaveURL(/#\/prs$/);
  await expect(page.getByRole("row").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(1);

  await page.goto("/#/prs?q=nothing-matches");
  await expect(page.getByText("Try another keyword or clear the current filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/#\/prs$/);
});

// Inside the sheet the verbs are single keys, but a reminder menu open inside it owns the keyboard: `e` pressed there is not a request to mark the row handled behind the menu.
test("the sheet's verb keys stand down while its reminder menu is open", async ({ page }) => {
  const posts: { id: string; action: string }[] = [];
  page.on("request", (request) => {
    const match = /\/follow-ups\/(\d+)$/.exec(new URL(request.url()).pathname);
    if (match && request.method() === "POST") posts.push({ id: match[1], action: request.postDataJSON().action });
  });
  await page.goto("/#/prs");
  await page.locator("#pr-row-101").getByTestId("pr-activity").click();
  const dialog = page.getByRole("dialog", { name: "Comments · fixture/calendar #17" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => posts).toEqual([{ id: "1", action: "read" }]);
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /^3 days/ })).toBeVisible();
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  expect(posts.filter((post) => post.action === "handled")).toEqual([]);
});
