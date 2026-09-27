import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// Every follow-up POST the page sends, so a test can assert what was (and was not) posted.
const recordPosts = (page: Page) => {
  const posts: { id: number; body: Record<string, unknown> }[] = [];
  page.on("request", (request: Request) => {
    const match = /\/follow-ups\/(\d+)$/.exec(new URL(request.url()).pathname);
    if (match && request.method() === "POST") posts.push({ id: Number(match[1]), body: request.postDataJSON() });
  });
  return posts;
};
const card = (page: Page, title: string) => page.getByTestId("follow-up-card").filter({ hasText: title });

// The Inbox is the home screen now: the header states the whole list, and each part of the sentence is a link to exactly the rows it counts. The old priority list and its "View all" link are gone, because the list they pointed at is directly below.
test("the inbox header states the whole list and leads into it", async ({ page }, testInfo) => {
  await page.goto("/#/inbox");
  const heading = page.getByRole("heading", { level: 1, name: "Inbox" });
  await expect(heading).toBeVisible();
  // The count sits beside the h1 rather than inside it, so the heading's name stays the page name; it is the badge's number.
  await expect(heading.locator("xpath=following-sibling::*[1]")).toHaveText("4");
  const summary = page.getByRole("navigation", { name: "Inbox summary" });
  await expect(summary).toContainText("4 to do");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  await expect(page.getByTestId("priority-list")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /more item/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("inbox.png"), fullPage: true });
  await summary.getByRole("link", { name: "To do 4" }).click();
  await expect(page).toHaveURL(/#\/inbox\?status=todo$/);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});

test("follow-up reasons are coloured by what they ask for, in both themes", async ({ page }, testInfo) => {
  const reasons = [["conflict", "checks_failed"], ["review_requested"], ["overdue"], ["author_updated"]];
  await page.route("**/api/v1/follow-ups", (route) =>
    route.fulfill({
      json: {
        baseline_complete: true,
        counts: { authored: 4, reviewer: 0, follow_up: 2, recent_merged: 0 },
        data: reasons.map((entries, index) => ({
          id: index + 1,
          version: 1,
          role: "authored",
          state: "action",
          reasons: entries,
          unread: false,
          excerpt: "",
          // Ascending by index, so the rows render in the order the tones are declared in: the Inbox sorts oldest first.
          waiting_since: `2026-08-0${index + 1}T00:00:00Z`,
          archived_at: null,
          pr: { id: index + 201, repo: "fixture/calendar", number: index + 1, title: `Reason sample ${index + 1}`, url: `https://github.com/fixture/calendar/pull/${index + 1}` },
        })),
      },
    }),
  );
  await page.goto("/#/inbox");
  const chips = page.getByTestId("follow-up-card").locator('[data-testid="reasons"]');
  await expect(chips.first().locator('[data-tone="blocked"]')).toHaveCount(2);
  await expect(chips.nth(1).locator('[data-tone="action"]')).toHaveCount(1);
  await expect(chips.nth(2).locator('[data-tone="waiting"]')).toHaveCount(1);
  // `author_updated` asks the reader to look again, so it carries the action tone. The neutral fallback for an unknown reason is covered in followup-view.test.mjs.
  await expect(chips.nth(3).locator('[data-tone="action"]')).toHaveCount(1);
  const colours = () =>
    Promise.all(
      ["blocked", "action", "waiting"].map((tone) =>
        chips
          .locator(`[data-tone="${tone}"]`)
          .first()
          .evaluate((node) => getComputedStyle(node).color),
      ),
    );
  expect(new Set(await colours()).size).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("followup-reason-tones.png"), fullPage: true });
  // The dark theme redefines every tone, and the three must still be told apart.
  await page.emulateMedia({ colorScheme: "dark" });
  expect(new Set(await colours()).size).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("followup-reason-tones-dark.png"), fullPage: true });
});

// Every action button's accessible name is "{verb} — {repo} #{number}", starting with the words on the button (the Handled button shows only "Handled", the leading phrase of its name).
test("read leaves task pending; explicit handling moves it to waiting", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const row = card(page, "Handle timezone boundaries");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /^Mark read/ }).click();
  await expect(row.getByRole("button", { name: /^Mark read/ })).toHaveCount(0);
  await expect(row).toHaveCount(1);
  const handled = row.getByRole("button", { name: /^Handled · wait for others/ });
  await expect(handled).toHaveText("Handled");
  await handled.click();
  await expect(row).toHaveCount(0);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("waiting");
  await expect(card(page, "Handle timezone boundaries")).toHaveCount(1);
});

test("the reviewer filter narrows the list to review requests", async ({ page }, testInfo) => {
  await page.goto("/#/inbox?role=reviewer");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Review storage migration");
  await expect(page.getByRole("group", { name: "Role" }).getByRole("button", { name: "My reviews" })).toHaveAttribute("aria-pressed", "true");
  // Said once: the reason chip, and no second "Review requested" from the PR's own review state.
  await expect(page.getByTestId("follow-up-card").getByText("Review requested", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("followups-reviewer.png"), fullPage: true });
});

test("the repository attention link keeps its repository filter", async ({ page }) => {
  await page.goto("/#/inbox?repo=fixture/reviewer");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Review storage migration");
  await expect(page.getByTestId("repository-chip")).toContainText("fixture/reviewer");
  await page.getByRole("button", { name: "Clear the fixture/reviewer filter" }).click();
  // The default status is the badge's set: four of the six fixtures.
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  await expect(page.getByTestId("repository-chip")).toHaveCount(0);
});

test("the repository on a row filters the list to that repository", async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  // Every row keeps its verbs: the summary no longer has rows of its own that only link.
  for (const row of await page.getByTestId("follow-up-card").all()) await expect(row.getByRole("button", { name: /^Show activity/ })).toHaveCount(1);
  await card(page, "Handle timezone boundaries").getByRole("button", { name: "Show only fixture/calendar" }).click();
  await expect(page).toHaveURL(/#\/inbox\?repo=fixture%2Fcalendar$/);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(3);
  await expect(page.getByTestId("repository-chip")).toContainText("fixture/calendar");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("a card action is announced and does not strand the focus", async ({ page }) => {
    await page.goto("/#/inbox?role=authored&status=action");
    const row = card(page, "Handle timezone boundaries");
    await expect(row).toHaveCount(1);
    const handled = row.getByRole("button", { name: /^Handled · wait for others/ });
    await handled.focus();
    await handled.click();
    await expect(row).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Handle timezone boundaries" })).toBeAttached();
    // Focus lands on the row that took the acted-on one's place, which is what makes clearing a queue linear.
    const successor = await page
      .getByTestId("follow-up-card")
      .first()
      .evaluate((el) => el.id);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return active?.closest("[data-testid='follow-up-card']")?.id ?? (active === document.body ? "body" : active?.tagName);
        }),
      )
      .toBe(successor);
  });
});

// The badge, the headline and the default view's group headings are one number by construction; this keeps them that way.
test("the default inbox shows exactly what the nav badge counts", async ({ page }) => {
  await page.goto("/#/inbox");
  const badge = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Inbox/ }).locator("b");
  await expect(badge).toHaveText("4");
  const headings = page.getByRole("heading", { level: 2 }).filter({ hasText: /\(\d+\)$/ });
  await expect(headings).toHaveText(["Needs my action (3)", "Time to follow up (1)"]);
  const counts = (await headings.allTextContents()).map((text) => Number(/\((\d+)\)$/.exec(text)![1]));
  expect(
    counts.reduce((sum, count) => sum + count, 0),
    "the group counts have to sum to the badge",
  ).toBe(Number(await badge.textContent()));
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" }).locator("xpath=following-sibling::*[1]")).toHaveText("4");
  await expect(page.getByRole("navigation", { name: "Inbox summary" })).toContainText("4 to do");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  await expect(page).toHaveTitle("Inbox (4) · PR Desk");
});

// A visible confirmation and an announced one, never the same node: the printed sentence is aria-hidden, and a separate sr-only status says it (with "Undo is available.") once.
test("an action is confirmed once on screen and once to assistive technology", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  await expect(page.getByRole("heading", { name: "Needs my action (2)" })).toBeVisible();
  await card(page, "Handle timezone boundaries")
    .getByRole("button", { name: /^Handled · wait for others/ })
    .click();

  const message = "Handled · wait for others: Handle timezone boundaries";
  const printed = page.getByText(message, { exact: true });
  await expect(printed).toHaveCount(1);
  const shape = await printed.evaluate((node) => ({ hidden: !!node.closest('[aria-hidden="true"]'), width: node.getBoundingClientRect().width }));
  expect(shape.hidden, "the printed sentence is hidden from the accessibility tree so it is not announced twice").toBe(true);
  expect(shape.width, "and it is the visible copy rather than a second sr-only one").toBeGreaterThan(40);

  const live = page.getByRole("status").filter({ hasText: message });
  await expect(live).toHaveCount(1);
  const spoken = await live.evaluate((node) => ({ hidden: !!node.closest('[aria-hidden="true"]'), width: node.getBoundingClientRect().width, text: node.textContent ?? "" }));
  expect(spoken.hidden, "the live region is the only route to assistive technology and must stay in the tree").toBe(false);
  expect(spoken.width, "and it is the sr-only copy, not a second visible one").toBeLessThanOrEqual(2);
  expect(spoken.text).toContain("Undo is available.");
  await expect(page.getByRole("heading", { name: "Needs my action (1)" })).toBeVisible();
});

// Chips are laid out in rows by their parent, so counting the distinct parents of a row's chips counts the chip rows without naming a class.
const chipRows = (row: Locator) => row.evaluate((node) => new Set(Array.from(node.querySelectorAll("[data-tone]"), (chip) => chip.parentElement)).size);

// One vocabulary, one row: the reasons, not the PR's review state a second time. On a row only GitHub can clear, Handled would post and change nothing but the clock, so the row says so and offers the way to GitHub instead.
test("a card carries one chip row and withholds a verb that would do nothing", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const open = card(page, "Handle timezone boundaries");
  await expect(open.getByText("New comment to answer", { exact: true })).toHaveCount(1);
  await expect(open.getByText("Conflict", { exact: true })).toHaveCount(0);
  await expect(open.getByText("CI: Failure", { exact: true })).toHaveCount(0);
  await expect(open.getByText("Changes requested", { exact: true })).toHaveCount(0);
  expect(await chipRows(open), "the card lays its chips out in one row").toBe(1);
  await expect(open.getByRole("button", { name: /^Handled · wait for others/ })).toHaveCount(1);

  const blocked = card(page, "Rebase the storage migration");
  await expect(blocked).toContainText("Only a new push can clear this.");
  await expect(blocked.getByRole("button", { name: /^Handled · wait for others/ })).toHaveCount(0);
  await expect(blocked.getByRole("link", { name: "Open on GitHub — fixture/calendar #35" })).toHaveAttribute("href", "https://github.com/fixture/calendar/pull/35");
  // The deferral is still offered: it is the one verb that can move a card GitHub is holding.
  await expect(blocked.getByRole("button", { name: /^Remind me later/ })).toBeVisible();
  expect(await chipRows(blocked), "two reasons are two chips in one row").toBe(1);
});

// "Ready to merge" is the conjunction of approved, green and conflict-free, so it is stated instead of its premises, and the row's first verb is the merge itself.
test("ready to merge is stated once on the card, without its premises", async ({ page }) => {
  await page.goto("/#/inbox");
  const ready = card(page, "Ship the release notes");
  await expect(ready.getByText("Ready to merge", { exact: true })).toHaveCount(1);
  await expect(ready.getByText("Approved", { exact: true })).toHaveCount(0);
  await expect(ready.getByText("CI: Success", { exact: true })).toHaveCount(0);
  expect(await chipRows(ready), "the conclusion joined the reason row rather than starting one").toBe(1);
  await expect(ready.getByRole("link", { name: "Merge on GitHub — fixture/calendar #31" })).toHaveAttribute("href", "https://github.com/fixture/calendar/pull/31");
});

test("a muted follow-up shows its reminder and can have it cancelled", async ({ page }) => {
  await page.goto("/#/inbox?status=all");
  const group = page.locator("summary").filter({ hasText: "Muted (1)" });
  await expect(group).toBeVisible();
  await group.click();
  const row = card(page, "Tune the query planner");
  await expect(row).toContainText("Muted until");
  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/4") && request.method() === "POST");
  await row.getByRole("button", { name: /^Cancel reminder/ }).click();
  expect((await posted).postDataJSON()).toEqual({ action: "unsnooze", version: 1 });
  await expect(card(page, "Tune the query planner")).not.toContainText("Muted until");
  await expect(page.locator("summary").filter({ hasText: /^Muted \(/ })).toHaveCount(0);
});

test("the inbox summary counts blocked and finished work and opens what it counts", async ({ page }) => {
  await page.goto("/#/inbox");
  const blocked = page.getByRole("link").filter({ hasText: "Needs a new push" }).first();
  await expect(blocked).toBeVisible();
  await expect(blocked).toHaveAccessibleName("Needs a new push 1");
  await expect(blocked).toHaveAttribute("href", /tone=blocked/);
  const merged = page.getByRole("link", { name: /Recently merged/ });
  await expect(merged).toBeVisible();
  await expect(merged).toHaveAttribute("href", /status=archived&merged=1/);
  await blocked.click();
  await expect(page).toHaveURL(/#\/inbox\?status=todo&tone=blocked$/);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Inbox summary" }).getByRole("link", { name: "Needs a new push 1" })).toHaveAttribute("aria-current", "true");
});

// The summary's "ready to merge" chip is a local filter (ready=1) that shows only shippable rows and says it is applied.
test("the ready-to-merge chip filters to shippable rows", async ({ page }) => {
  await page.goto("/#/inbox");
  await page.getByRole("link", { name: "Ready to merge 1" }).click();
  await expect(page).toHaveURL(/#\/inbox\?status=all&ready=1$/);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Ship the release notes");
  await expect(page.getByTestId("ready-chip")).toContainText("Ready to merge");
  await page.getByRole("button", { name: "Clear the Ready to merge filter" }).click();
  await expect(page.getByTestId("ready-chip")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/inbox\?status=all$/);
});

// j and k move the cursor, which is simply where the focus is; they never mark anything read. Enter is the explicit request to see a row, so it posts `read` and, on a wide screen, shows the row in the detail pane.
test("j and k walk the list; Enter opens the row they land on", async ({ page }) => {
  const posts = recordPosts(page);
  await page.goto("/#/inbox?status=all");
  await expect(page.getByTestId("follow-up-card").first()).toBeVisible();
  const active = () => page.evaluate(() => document.querySelector("[data-active]")?.id ?? null);
  await page.keyboard.press("j");
  const first = await active();
  expect(first).not.toBeNull();
  await page.keyboard.press("j");
  const second = await active();
  expect(second).not.toBe(first);
  await page.keyboard.press("k");
  expect(await active(), "k walks back to the row j came from").toBe(first);
  expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe(first);
  const marked = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>("[data-active]");
    return row ? getComputedStyle(row).boxShadow : "none";
  });
  expect(marked, "the row under the cursor is drawn differently from the rows around it").not.toBe("none");
  await page.waitForTimeout(400);
  expect(posts, "moving the cursor is not reading").toEqual([]);
  await page.keyboard.press("Enter");
  const pane = page.getByTestId("detail-pane");
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("heading", { level: 2 })).toContainText("Handle timezone boundaries");
  await expect.poll(() => posts).toEqual([{ id: 1, body: { action: "read", version: 1 } }]);
  // Beside the list the pane carries no verbs: the row next to it has them, and two buttons with one name would be one too many.
  await expect(pane.getByRole("button", { name: /^Handled/ })).toHaveCount(0);
  // Esc lets go of the row, and the pane goes back to asking for one.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-active]")).toHaveCount(0);
  await expect(pane).toHaveCount(0);
  await expect(page.getByText("Select an item to see its activity")).toBeVisible();
});

// The keys drive the same verbs as the buttons on the row under the cursor, and say why when a verb is not offered.
test("the verb keys act on the row under the cursor", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(2);
  await page.keyboard.press("j");
  await expect(card(page, "Handle timezone boundaries")).toHaveAttribute("data-active", "true");
  await page.keyboard.press("e");
  await expect(card(page, "Handle timezone boundaries")).toHaveCount(0);
  await expect(card(page, "Rebase the storage migration")).toHaveAttribute("data-active", "true");
  // Handled is withheld on a row only GitHub can clear, so `e` says why instead of posting.
  await expect(card(page, "Rebase the storage migration").getByRole("button", { name: /^Remind me later/ })).toBeEnabled();
  await page.keyboard.press("e");
  await expect(page.getByRole("status").filter({ hasText: "Only a new push can clear this." })).toBeAttached();
  await expect(card(page, "Rebase the storage migration")).toHaveCount(1);
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /^3 days/ })).toBeVisible();
  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/5") && request.method() === "POST");
  await page.keyboard.press("7");
  expect((await posted).postDataJSON()).toMatchObject({ action: "snooze", version: 1 });
});

// `handled` overwrites the waiting clock, so the inverse is offered where the confirmation is and asserted by what comes back: the row, with its old clock. `z` is the same undo from the keyboard.
test("an action can be taken back from the confirmation that reports it, or with z", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const row = card(page, "Handle timezone boundaries");
  const waited = await row.locator("time").first().innerText();
  await row.getByRole("button", { name: /^Handled · wait for others/ }).click();
  await expect(row).toHaveCount(0);
  const undo = page.getByRole("button", { name: /^Undo/ });
  // There is one undo slot for the whole app and every action reassigns it, so the control names the row it would put back.
  await expect(undo).toHaveAccessibleName(/fixture\/calendar #17/);
  await undo.click();
  await expect(row).toHaveCount(1);
  await expect(row.getByText("New comment to answer", { exact: true })).toHaveCount(1);
  await expect(row.locator("time").first()).toHaveText(waited);

  await row.getByRole("button", { name: /^Handled · wait for others/ }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();
  await page.keyboard.press("z");
  await expect(row).toHaveCount(1);
  await expect(row.locator("time").first()).toHaveText(waited);
});

// Six seconds for a confirmation with nothing to take back; one that carries an Undo waits for the reader. (Known flaky in CI; tracked separately, not retried here.)
test("a confirmation waits when it carries an undo and clears itself when it does not", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const row = card(page, "Handle timezone boundaries");
  const dismiss = page.getByRole("button", { name: "Dismiss this message" });
  await row.getByRole("button", { name: /^Mark read/ }).click();
  await expect(dismiss).toBeVisible();
  await expect(dismiss, "a confirmation with no inverse still expires").toHaveCount(0, { timeout: 9000 });

  await row.getByRole("button", { name: /^Handled · wait for others/ }).click();
  const undo = page.getByRole("button", { name: /^Undo/ });
  await expect(undo).toBeVisible();
  await page.waitForTimeout(7000);
  await expect(undo, "the route back from a destroyed waiting clock is still on screen after the old timer would have fired").toBeVisible();
});

// A reminder takes the row out of the default view the moment it is set, so the confirmation is the only record of the day chosen.
test("a reminder says which day it was set for", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const row = card(page, "Handle timezone boundaries");
  const trigger = row.getByRole("button", { name: /^Remind me later — fixture\/calendar #17/ });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /^3 days/ }).click();
  const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(Date.now() + 3 * 86400000);
  await expect(page.getByRole("status").filter({ hasText: `Reminder set for ${day}` })).toBeAttached();
  await expect(row).toHaveCount(0);
});

// "Tomorrow morning" is the next day at the reader's own digest time in their own timezone (the fixture's Asia/Tokyo, 09:00).
test("the tomorrow-morning reminder lands on the digest time in the reader's timezone", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const row = card(page, "Handle timezone boundaries");
  await row.getByRole("button", { name: /^Remind me later — fixture\/calendar #17/ }).click();
  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/1") && request.method() === "POST");
  await page.getByRole("button", { name: /^Tomorrow morning/ }).click();
  const body = (await posted).postDataJSON();
  expect(body.action).toBe("snooze");
  const tokyo = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
  const [date, time] = tokyo(Date.parse(body.until)).split(", ");
  expect(time).toBe("09:00");
  expect(date).toBe(tokyo(Date.now() + 86400000).split(", ")[0]);
});

test("the blocked tone filter says it is applied and can be cleared", async ({ page }) => {
  await page.goto("/#/inbox?status=todo&tone=blocked");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Rebase the storage migration");
  const chip = page.getByTestId("tone-chip");
  await expect(chip).toContainText("Needs a new push");
  await chip.getByRole("button", { name: "Clear the Needs a new push filter" }).click();
  await expect(page.getByTestId("tone-chip")).toHaveCount(0);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});

// A 409 means the row moved on under the reader. Retrying would act on a state they have not seen, so the row offers the fresh copy instead.
test("a stale version asks the reader to look at the latest before acting", async ({ page }) => {
  await page.route("**/api/v1/follow-ups/1", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 409, json: { error: "version mismatch" } }) : route.fallback()));
  await page.goto("/#/inbox?role=authored&status=action");
  const row = card(page, "Handle timezone boundaries");
  await row.getByRole("button", { name: /^Handled · wait for others/ }).click();
  const alert = row.getByRole("alert");
  await expect(alert).toContainText("New activity arrived. Review it before you act.");
  await expect(alert.getByRole("button", { name: "Retry" })).toHaveCount(0);
  const refetched = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/api/v1/follow-ups") && request.method() === "GET");
  await alert.getByRole("button", { name: "Show latest" }).click();
  await refetched;
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row.getByRole("alert")).toHaveCount(0);
});

// "All clear" is a claim about every pull request, so it is never made while the first inventory is still running.
test("an incomplete first inventory never claims the inbox is clear", async ({ page }) => {
  await page.route("**/api/v1/follow-ups", (route) => route.fulfill({ json: { baseline_complete: false, data: [], counts: {} } }));
  await page.goto("/#/inbox");
  await expect(page.getByText("The first inventory is still syncing.", { exact: false })).toBeVisible();
  await expect(page.getByText("Nothing yet — inventory in progress")).toBeVisible();
  await expect(page.getByText("You’re all caught up")).toHaveCount(0);
});

// ?focus=<id> is what every push notification links to. It points at a row; it is not a request to read it.
test("a focus link selects its row without marking it read", async ({ page }) => {
  const posts = recordPosts(page);
  await page.goto("/#/inbox?focus=1");
  const row = page.locator("#followup-1");
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row).toHaveAttribute("data-highlight", "true");
  await expect(page.getByTestId("detail-pane").getByRole("heading", { level: 2 })).toContainText("Handle timezone boundaries");
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

// The activity endpoint loads a PullRequest by its primary key, which is neither the PR number nor the follow-up id. The fixture keeps all three apart and answers any other id with a 404.
test("the detail pane asks for the pull request by its id, not its number", async ({ page }) => {
  await page.goto("/#/inbox");
  const requested = page.waitForRequest((request) => /\/pull-requests\/\d+\/activity$/.test(new URL(request.url()).pathname));
  await card(page, "Review storage migration")
    .getByRole("button", { name: /^Show activity/ })
    .click();
  expect(new URL((await requested).url()).pathname).toMatch(/\/pull-requests\/102\/activity$/);
  const pane = page.getByTestId("detail-pane");
  await expect(pane.getByText("This branch needs a test.")).toBeVisible();
  await expect(pane.getByRole("alert")).toHaveCount(0);
});

// Split view appears when the dashboard container's content box reaches the `table` container token (880px); below it, opening a row opens the modal sheet, which carries the verbs and marks the row read once. The widths straddle the flip; which side of it each one lands on is read from the layout rather than assumed, so the test holds for any shell gutter.
test("the detail is a pane beside the list from 880px of content, and a sheet below", async ({ page }) => {
  const posts = recordPosts(page);
  for (const width of [1000, 1135, 1136, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/inbox");
    await expect(page.getByTestId("follow-up-card").first()).toBeVisible();
    const content = await page.evaluate(() => {
      const box = Array.from(document.querySelectorAll<HTMLElement>("*")).find((element) => getComputedStyle(element).containerName.split(" ").includes("dashboard"))!;
      const style = getComputedStyle(box);
      return box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    const split = content >= 880;
    if (width === 1000) expect(split, "a 1000px window has no room for two panes").toBe(false);
    if (width === 1440) expect(split, "a 1440px window does").toBe(true);
    const opener = card(page, "Review storage migration").getByRole("button", { name: /^Show activity/ });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Comments · fixture/reviewer #24" });
    if (split) {
      await expect(page.getByTestId("detail-pane"), `${width}px: ${content}px of content`).toBeVisible();
      await expect(dialog).toHaveCount(0);
    } else {
      await expect(dialog, `${width}px: ${content}px of content`).toBeVisible();
      await expect(page.getByTestId("detail-pane")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: /^Handled · wait for others — fixture\/reviewer #24/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  }
  // Opened four times, read once: the first opening was the explicit request, and the row was no longer unread after it.
  expect(posts.filter((post) => post.id === 2 && post.body.action === "read")).toHaveLength(1);
});
