import { expect, test, type Locator } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// The summary and the workspace share one page now, so the summary's link to "all" of them is a jump to the list directly below it, and the count it states has to be the list's count.
test("the inbox summary states the whole list and leads into it", async ({ page }, testInfo) => {
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
  await expect(page.getByTestId("priority-list")).toContainText("Handle timezone boundaries");
  await page.screenshot({ path: testInfo.outputPath("inbox.png"), fullPage: true });
  // The link used to read "View all follow-ups" whether there were five or forty, and it now states the total. Its destination is the workspace's default view, which is the badge's set — action plus follow_up — rather than every non-archived row, so four of the six fixtures land there.
  await page.getByRole("link", { name: "View all 4 follow-ups" }).click();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  // The fixture holds four, which the list shows in full, so the remainder must not be claimed. The link states the part that is not on screen; five of five has no such part.
  await expect(page.getByRole("link", { name: /more item/ })).toHaveCount(0);
});

test("follow-up reasons are coloured by what they ask for", async ({ page }, testInfo) => {
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
          // The priority list is sorted oldest-first inside the server's rank now, so identical timestamps would leave the nth() indices below at the mercy of sort stability. Ascending by index pins the reading order to the array order the tones are declared in.
          waiting_since: `2026-08-0${index + 1}T00:00:00Z`,
          archived_at: null,
          pr: { id: index + 1, repo: "fixture/calendar", number: index + 1, title: `Reason sample ${index + 1}`, url: `https://github.com/fixture/calendar/pull/${index + 1}` },
        })),
      },
    }),
  );
  await page.goto("/#/inbox");
  const priority = page.getByTestId("priority-reasons");
  await expect(priority.first().locator('[data-tone="blocked"]')).toHaveCount(2);
  await expect(priority.nth(1).locator('[data-tone="action"]')).toHaveCount(1);
  await expect(priority.nth(2).locator('[data-tone="waiting"]')).toHaveCount(1);
  // `author_updated` used to fall through to neutral because presentation() could never emit it: the confirmation reason was synthesized from the role. It is recorded now, and "the author answered you" asks the reader to look again, so it carries the action tone. The neutral fallback for a genuinely unknown reason is covered in followup-view.test.mjs.
  await expect(priority.nth(3).locator('[data-tone="action"]')).toHaveCount(1);
  const colour = (tone: string) =>
    page
      .getByTestId("priority-reasons")
      .locator(`[data-tone="${tone}"]`)
      .first()
      .evaluate((node) => getComputedStyle(node).color);
  const tones = await Promise.all(["blocked", "action", "waiting"].map(colour));
  expect(new Set(tones).size).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("followup-reason-tones.png"), fullPage: true });
});

// Every action button now carries an aria-label of the form "{label} — {repo} #{number}", which replaces the accessible name, so the old `exact: true` matches on the visible label no longer resolve. The label is the prefix, so a regex anchored at the start is the same assertion without pinning the repository into it. The card is addressed by title rather than by being the only one on the route: this filter holds two authored action items now, and it is the other one that proves Handled is withheld where it would do nothing.
test("read leaves task pending; explicit handling moves it to waiting", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const card = page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: /^Mark read/ }).click();
  await expect(card.getByRole("button", { name: /^Mark read/ })).toHaveCount(0);
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: /^Handled · wait for others/ }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("waiting");
  await expect(page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" })).toHaveCount(1);
});

// The hand-rolled 390x844 viewport and the document-level overflow check that used to live here are gone: this file runs in the `desktop` project only, and layout.spec.ts now walks this route at twenty-four viewports with a per-element sweep that also sees content clipped by an `overflow: hidden` ancestor, which `documentElement.scrollWidth` never could. What is left here is the behaviour, which is width-independent.
test("the reviewer filter narrows the list to review requests", async ({ page }, testInfo) => {
  await page.goto("/#/inbox?role=reviewer");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Review storage migration");
  // The most common card in the product, and the one the second chip row broke by construction: `factChips(pr, role)` could not see `item.reasons`, so a pending review state printed "Review requested" beside the reason that already said it, in the same amber, on every awaiting-review card.
  await expect(page.getByTestId("follow-up-card").getByText("Review requested", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("followups-reviewer.png"), fullPage: true });
});

test("the repository attention link keeps its repository filter", async ({ page }) => {
  await page.goto("/#/inbox?repo=fixture/reviewer");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Review storage migration");
  await expect(page.getByTestId("repository-chip")).toContainText("fixture/reviewer");
  // The chip clears the filter without leaving the view. Addressed by its own label rather than by the repository name, which every action button on a card from that repository now carries too.
  await page.getByRole("button", { name: "Clear the fixture/reviewer filter" }).click();
  // Clearing the repository leaves the default status filter, which is the badge's set rather than everything non-archived: four of the six fixtures.
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  await expect(page.getByTestId("repository-chip")).toHaveCount(0);
});

test("a card action is announced and does not strand the focus", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const card = page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" });
  await expect(card).toHaveCount(1);
  const handled = card.getByRole("button", { name: /^Handled · wait for others/ });
  await handled.focus();
  await handled.click();
  // The card is removed, so the button that had the focus is gone.
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Handle timezone boundaries" })).toBeAttached();
  // Not merely "somewhere other than the body": focus has to land on the card that took the acted-on one's place, because that is what makes clearing a queue linear. Asserting the weaker property is how this passed while focus was being handed to a disabled button and silently dropped — every card's controls are disabled for as long as the invalidated refetch is in flight.
  const landed = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const card = active?.closest("[data-testid='follow-up-card']") as HTMLElement | null;
    return { onBody: active === document.body, cardId: card?.id ?? null };
  });
  expect(landed.onBody).toBe(false);
  expect(landed.cardId).toBe(
    await page
      .getByTestId("follow-up-card")
      .first()
      .evaluate((el) => el.id),
  );
});

// The badge promised a small, finite amount of work and opened a page that showed the entire inventory, so the number it nagged with could not be cleared in one pass and nothing on screen said where the urgent items stopped. These two things are now the same set by construction on both sides — the server counts action and follow_up, the default filter selects action and follow_up — and this is the assertion that keeps them that way.
test("the default workspace shows exactly what the sidebar badge counts", async ({ page }) => {
  await page.goto("/#/inbox");
  const badge = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Needs attention/ })
    .locator("b");
  await expect(badge).toHaveText("4");
  // The group heading and the card title are both level 3, so the headings are picked out by the count only a group heading carries.
  const headings = page.getByRole("heading", { level: 3 }).filter({ hasText: /\(\d+\)$/ });
  await expect(headings).toHaveText(["Needs my action (3)", "Time to follow up (1)"]);
  const counts = (await headings.allTextContents()).map((text) => Number(/\((\d+)\)$/.exec(text)![1]));
  expect(
    counts.reduce((sum, count) => sum + count, 0),
    "the group counts have to sum to the badge",
  ).toBe(Number(await badge.textContent()));
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});

// A sighted user's only confirmation used to be a screen-reader-only live region, which is to say none. Both halves are asserted together on purpose: a visible strip that replaced the live region, or one that was not aria-hidden, would each be a regression — the first silences assistive technology, the second announces every action twice.
test("an action is confirmed once on screen and once to assistive technology", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  await expect(page.getByRole("heading", { name: "Needs my action (2)" })).toBeVisible();
  await page
    .getByTestId("follow-up-card")
    .filter({ hasText: "Handle timezone boundaries" })
    .getByRole("button", { name: /^Handled · wait for others/ })
    .click();

  const message = "Handled · wait for others: Handle timezone boundaries";
  // Exactly one element carries the sentence and nothing else, and it is the visible one: `sr-only` is a 1px box, so the width is what tells the two copies apart without reaching for a class name.
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
  // The strip's sentence is aria-hidden, so this is the only place a screen-reader user can be told an inverse exists at all — and the control itself sits many stops behind the card the focus effect has just moved to.
  expect(spoken.text).toContain("Undo is available.");
  // The heading count is the confirmation that survives a strip being missed or dismissed.
  await expect(page.getByRole("heading", { name: "Needs my action (1)" })).toBeVisible();
});

// Chips are laid out in rows by their parent, so counting the distinct parents of a card's chips counts the rows without naming a class. The card carried two of them, built by two functions, and the second could not see `item.reasons` — which is why the duplication was structural rather than a slip.
const chipRows = (card: Locator) => card.evaluate((node) => new Set(Array.from(node.querySelectorAll("[data-tone]"), (chip) => chip.parentElement)).size);

// One vocabulary, one row. The pull request below is conflicted, red and has changes requested, and every one of those was printed a second time from the PR row while the reason row was already saying what the server decided the reader has to do about it. What the card states now is `reasons`, which is the only list anything else in the product — the tone filter, the Blocked tile, `handledIsUseful` — agrees with. The second half is the other side of the same coin: `handled` only clears the confirmation, while a conflict and a red build are re-derived from GitHub on every read, so on that card the button posts successfully and changes nothing but the clock.
test("a card carries one chip row and withholds a verb that would do nothing", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const open = page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" });
  await expect(open.getByText("New comment to answer", { exact: true })).toHaveCount(1);
  await expect(open.getByText("Conflict", { exact: true })).toHaveCount(0);
  await expect(open.getByText("CI: Failure", { exact: true })).toHaveCount(0);
  await expect(open.getByText("Changes requested", { exact: true })).toHaveCount(0);
  expect(await chipRows(open), "the card lays its chips out in one row").toBe(1);
  await expect(open.getByRole("button", { name: /^Handled · wait for others/ })).toHaveCount(1);

  const blocked = page.getByTestId("follow-up-card").filter({ hasText: "Rebase the storage migration" });
  await expect(blocked).toContainText("Only a new push can clear this.");
  await expect(blocked.getByRole("button", { name: /^Handled · wait for others/ })).toHaveCount(0);
  // The deferral is still offered: it is the one verb that can move a card GitHub is holding.
  await expect(blocked.getByText("Remind me later")).toBeVisible();
  // Two reasons, still one row: this is the card the old fact row printed five chips on to say three things.
  expect(await chipRows(blocked), "two reasons are two chips in one row").toBe(1);
});

// "Ready to merge" is the conjunction of approved, green and conflict-free, and it used to render in a second row directly beside its own premises — a conclusion standing next to the three facts it was computed from tells the reader nothing the facts did not. The conclusion survives, in the reason row; the premises do not. The pull-request table's half of the same rule is in prs.spec.ts.
test("ready to merge is stated once on the card, without its premises", async ({ page }) => {
  await page.goto("/#/inbox");
  const ready = page.getByTestId("follow-up-card").filter({ hasText: "Ship the release notes" });
  await expect(ready.getByText("Ready to merge", { exact: true })).toHaveCount(1);
  await expect(ready.getByText("Approved", { exact: true })).toHaveCount(0);
  await expect(ready.getByText("CI: Success", { exact: true })).toHaveCount(0);
  expect(await chipRows(ready), "the conclusion joined the reason row rather than starting one").toBe(1);
});

// Snooze was write-only: the field was served, stripped by the client schema, rendered nowhere and cancellable by nothing, so a mis-tapped reminder buried a PR with no way back. `unsnooze` has been accepted by the API all along and the browser had never once sent it.
test("a muted follow-up shows its reminder and can have it cancelled", async ({ page }) => {
  await page.goto("/#/inbox?status=all");
  // The server reports a muted row as `waiting`; the group is the browser's finer reading of a state it agrees with, and it is collapsed because a deferred item is not what the reader came for.
  const group = page.locator("summary").filter({ hasText: "Muted (1)" });
  await expect(group).toBeVisible();
  await group.click();
  const card = page.getByTestId("follow-up-card").filter({ hasText: "Tune the query planner" });
  await expect(card).toContainText("Muted until");
  const posted = page.waitForRequest((request) => request.url().endsWith("/follow-ups/4") && request.method() === "POST");
  await card.getByRole("button", { name: /^Cancel reminder/ }).click();
  expect((await posted).postDataJSON()).toEqual({ action: "unsnooze", version: 1 });
  // Cancelling puts the row back among the ordinary waiting items, with no reminder left to see.
  await expect(page.getByTestId("follow-up-card").filter({ hasText: "Tune the query planner" })).not.toContainText("Muted until");
  await expect(page.locator("summary").filter({ hasText: /^Muted \(/ })).toHaveCount(0);
});

// The tile is the one navigational affordance the last pass added, and its number and its destination have to be the same predicate or it sends the reader somewhere that disagrees with what it counted. Acting on a row from here is gone: it was a second copy of the card's action block that dropped the caveat, dropped the inverse, and on its likeliest target — a conflicted pull request of your own, which sorts to the top by construction — offered a bare "3 days" with the card's explanation stripped out. The row links to the full card, which is the surface that gates Handled, explains the gate and offers the way back.
test("the inbox summary counts blocked work and opens what it counts", async ({ page }) => {
  await page.goto("/#/inbox");
  // Named after the rule it counts rather than after the word the PR table's differently-computed tile already uses: two tiles reading "Blocked" over two numbers is how a reader stops trusting either.
  const blocked = page.getByRole("link").filter({ hasText: "Needs a new push" }).first();
  await expect(blocked).toBeVisible();
  await expect(blocked).toHaveAttribute("href", /tone=blocked/);
  await expect(page.getByRole("link", { name: /Recently merged/ })).toBeVisible();
  // Every row is a link to its own card rather than a verb, so nothing on this page can change state.
  const row = page.getByTestId("priority-list").locator("li").filter({ hasText: "Handle timezone boundaries" });
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(row.getByRole("link")).toHaveAttribute("href", /#\/inbox\?focus=1$/);
});

// Two keys, and the cursor they move is simply where the focus is. Both halves matter: a ring that walks an order the screen does not render sends the reader to a row they cannot see, and a card that takes focus with no indicator — which is what `focus:outline-none` on a tabIndex -1 article bought — is a cursor nobody can find. The rest of the keyboard layer is gone: `x` could never receive a Shift (the key is "X" when it is held), and the panel that documented it was behind a `?` nothing advertised.
test("j and k walk the list and mark the row they land on", async ({ page }) => {
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
  // The ring and the focus are the same row, so Tab continues from where the reader is standing rather than from the top of the page.
  expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe(first);
  const marked = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("[data-active]");
    return card ? getComputedStyle(card).boxShadow : "none";
  });
  expect(marked, "the row under the cursor is drawn differently from the rows around it").not.toBe("none");
});

// `handled` overwrites the waiting clock and clears the confirmation, and until the server learned to snapshot that step a mis-tap destroyed the one number the whole product is built on. The inverse is offered where the confirmation already is — and asserted by what comes back, not by the sentence the client prints about itself: the server answers 200 for an undo with nothing left to restore, so a test that reads the message is green against an undo that does nothing at all.
test("an action can be taken back from the confirmation that reports it", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const card = page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" });
  const waited = await card.locator("time").first().innerText();
  await card.getByRole("button", { name: /^Handled · wait for others/ }).click();
  await expect(card).toHaveCount(0);
  const undo = page.getByRole("button", { name: /^Undo/ });
  // There is one undo slot for the whole workspace and every action reassigns it, so the control has to name the row it would put back.
  await expect(undo).toHaveAccessibleName(/fixture\/calendar #17/);
  await undo.click();
  await expect(card).toHaveCount(1);
  await expect(card.getByText("New comment to answer", { exact: true })).toHaveCount(1);
  // The clock is the point of the whole mechanism: `handled` had rewritten it to today, and this is the number the Blocked tile and the priority order are computed from.
  await expect(card.locator("time").first()).toHaveText(waited);
});

// Six seconds measured from the moment the action succeeded, on the only control that can put back a waiting clock — while the focus effect has just moved the reader to a different card, several hundred pixels and eleven Shift+Tabs away. A confirmation with nothing to take back is only a sentence and still clears itself.
test("a confirmation waits when it carries an undo and clears itself when it does not", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const card = page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" });
  const dismiss = page.getByRole("button", { name: "Dismiss this message" });
  await card.getByRole("button", { name: /^Mark read/ }).click();
  await expect(dismiss).toBeVisible();
  await expect(dismiss, "a confirmation with no inverse still expires").toHaveCount(0, { timeout: 9000 });

  await card.getByRole("button", { name: /^Handled · wait for others/ }).click();
  const undo = page.getByRole("button", { name: /^Undo/ });
  await expect(undo).toBeVisible();
  await page.waitForTimeout(7000);
  await expect(undo, "the route back from a destroyed waiting clock is still on screen after the old timer would have fired").toBeVisible();
});

// A reminder takes the row out of the default view the moment it is set, so the confirmation is the only evidence of which day was chosen: reading it back off the card costs the status select plus expanding a collapsed group, and the custom-date path had no other record of the value at all.
test("a reminder says which day it was set for", async ({ page }) => {
  await page.goto("/#/inbox?role=authored&status=action");
  const card = page.getByTestId("follow-up-card").filter({ hasText: "Handle timezone boundaries" });
  await card.locator("summary").click();
  await card.getByRole("button", { name: /^3 days/ }).click();
  const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(Date.now() + 3 * 86400000);
  await expect(page.getByRole("status").filter({ hasText: `Reminder set for ${day}` })).toBeAttached();
  // Muted rows are reported as waiting, so the card leaves a view filtered to `action` — which is exactly why the sentence has to carry the date.
  await expect(card).toHaveCount(0);
});

// The one filter nothing on the page admitted to. It is applied by clicking the landing page's Blocked tile, it had no control of its own in the filter row, and no other filter change cleared it — so the workspace could be left quietly showing two rows of the twelve there were, with the count in its heading agreeing.
test("the blocked tone filter says it is applied and can be cleared", async ({ page }) => {
  await page.goto("/#/inbox?status=todo&tone=blocked");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Rebase the storage migration");
  const chip = page.getByTestId("tone-chip");
  // Named after the rule it filters by, which is the same words the tile that applied it uses.
  await expect(chip).toContainText("Needs a new push");
  await chip.getByRole("button", { name: "Clear the Needs a new push filter" }).click();
  await expect(page.getByTestId("tone-chip")).toHaveCount(0);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});
