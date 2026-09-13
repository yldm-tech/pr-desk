import { expect, test, type Locator } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

test("overview preserves global follow-ups when contribution year changes", async ({ page }, testInfo) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
  await expect(page.getByTestId("priority-list")).toContainText("Handle timezone boundaries");
  await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true });
  await page.getByRole("tab", { name: "2025", exact: true }).click();
  await expect(page.getByTestId("priority-list")).toContainText("Review storage migration");
  // The link used to read "View all follow-ups" whether there were five or forty, and it now states the total. Its destination is the workspace's default view, which is the badge's set — action plus follow_up — rather than every non-archived row, so four of the six fixtures land there.
  await page.getByRole("link", { name: "View all 4 follow-ups" }).click();
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
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
  await page.goto("/#/");
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
  await page.goto("/#/attention?role=authored&status=action");
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
  await page.goto("/#/attention?role=reviewer");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Review storage migration");
  // The most common card in the product, and the one the second chip row broke by construction: `factChips(pr, role)` could not see `item.reasons`, so a pending review state printed "Review requested" beside the reason that already said it, in the same amber, on every awaiting-review card.
  await expect(page.getByTestId("follow-up-card").getByText("Review requested", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("followups-reviewer.png"), fullPage: true });
});

test("settings save timezone and selected review teams", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/Madrid");
  await page.getByRole("checkbox", { name: /fixture\/reviewers/ }).check();
  const saved = page.waitForRequest((req) => req.url().endsWith("/follow-up-settings") && req.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ timezone: "Europe/Madrid", digest_time: "09:00", teams: ["fixture/reviewers"] });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByLabel("Follow up after (days)", { exact: true }).fill("9");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveCount(0);
});

test("repository waiting periods report the offending line instead of failing the save", async ({ page }) => {
  await page.goto("/#/settings");
  let posted = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/follow-up-settings") && request.method() === "POST") posted = true;
  });
  await page.getByLabel("Repository waiting periods", { exact: true }).fill("fixture/calendar=14\nbroken-line");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Line 2" })).toBeVisible();
  expect(posted).toBe(false);
});

// Same move as the reviewer test above: the width assertion belongs to the matrix, the reminder form rendering at all belongs here.
test("the reminder schedule renders on the default settings tab", async ({ page }, testInfo) => {
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-reminders.png"), fullPage: true });
});

test("telegram destination validates the chat ID before calling the API", async ({ page }, testInfo) => {
  await page.goto("/#/settings?tab=notifications");
  await expect(page.getByText("No destinations yet. Reminders stay inside the app.")).toBeVisible();
  let posted = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/notification-destinations") && request.method() === "POST") posted = true;
  });
  await page.getByLabel("Name", { exact: true }).fill("Team channel");
  await page.getByLabel("Bot token", { exact: true }).fill("fixture:token");
  await page.getByLabel("Chat ID", { exact: true }).fill("not-a-number");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Chat ID has to be a number." })).toBeVisible();
  expect(posted).toBe(false);
  await page.getByLabel("Chat ID", { exact: true }).fill("-1001234567890");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("destination")).toContainText("Team channel");
  await page.screenshot({ path: testInfo.outputPath("followup-settings.png"), fullPage: true });
});

test("channel selection swaps the destination fields and posts the channel", async ({ page }, testInfo) => {
  await page.goto("/#/settings?tab=notifications");
  const channel = page.getByLabel("Channel", { exact: true });
  await channel.selectOption("lark");
  await expect(page.getByLabel("Bot token", { exact: true })).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).fill("Feishu group");
  await page.getByLabel("Webhook URL", { exact: true }).fill("https://10.0.0.9/hook");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "private network" })).toBeVisible();
  await page.getByLabel("Webhook URL", { exact: true }).fill("https://open.feishu.cn/open-apis/bot/v2/hook/abc");
  await page.getByLabel("Signing secret", { exact: true }).fill("sign");
  const posted = page.waitForRequest((request) => request.url().endsWith("/notification-destinations") && request.method() === "POST");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await posted).postDataJSON()).toMatchObject({ kind: "lark", name: "Feishu group", url: "https://open.feishu.cn/open-apis/bot/v2/hook/abc", secret: "sign" });
  await expect(page.getByTestId("destination")).toContainText("Lark / Feishu");

  await channel.selectOption("email");
  await expect(page.getByLabel("Webhook URL", { exact: true })).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).fill("Inbox");
  await page.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com");
  await page.getByLabel("From address", { exact: true }).fill("desk@example.com");
  await page.getByLabel("Recipients", { exact: true }).fill("me@example.com, broken-address");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "valid email address" })).toBeVisible();
  await page.getByLabel("Recipients", { exact: true }).fill("me@example.com, team@example.com");
  const mailed = page.waitForRequest((request) => request.url().endsWith("/notification-destinations") && request.method() === "POST");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await mailed).postDataJSON()).toMatchObject({ kind: "email", host: "smtp.example.com", port: 587, from: "desk@example.com", to: ["me@example.com", "team@example.com"] });
  await page.screenshot({ path: testInfo.outputPath("followup-channels.png"), fullPage: true });
});

test("a display name is accepted in email addresses", async ({ page }) => {
  await page.goto("/#/settings?tab=notifications");
  await page.getByLabel("Channel", { exact: true }).selectOption("email");
  await page.getByLabel("Name", { exact: true }).fill("Inbox");
  await page.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com");
  await page.getByLabel("From address", { exact: true }).fill("PR Desk <desk@example.com>");
  await page.getByLabel("Recipients", { exact: true }).fill("Ops Team <ops@example.com>");
  const posted = page.waitForRequest((request) => request.url().endsWith("/notification-destinations") && request.method() === "POST");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await posted).postDataJSON()).toMatchObject({ from: "PR Desk <desk@example.com>", to: ["Ops Team <ops@example.com>"] });
});

test("private webhook addresses are allowed when the server opts in", async ({ page }) => {
  await page.route("**/api/v1/notification-destinations", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: [], allow_private_hosts: true } });
    return route.fulfill({ json: { id: 1, name: "internal", kind: "webhook", enabled: true } });
  });
  await page.goto("/#/settings?tab=notifications");
  await page.getByLabel("Channel", { exact: true }).selectOption("webhook");
  await page.getByLabel("Name", { exact: true }).fill("internal");
  await page.getByLabel("Webhook URL", { exact: true }).fill("http://10.0.0.9/hooks/pr-desk");
  const posted = page.waitForRequest((request) => request.url().endsWith("/notification-destinations") && request.method() === "POST");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await posted).postDataJSON()).toMatchObject({ kind: "webhook", url: "http://10.0.0.9/hooks/pr-desk" });
});

test("the repository attention link keeps its repository filter", async ({ page }) => {
  await page.goto("/#/attention?repo=fixture/reviewer");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Review storage migration");
  await expect(page.getByTestId("repository-chip")).toContainText("fixture/reviewer");
  // The chip clears the filter without leaving the view. Addressed by its own label rather than by the repository name, which every action button on a card from that repository now carries too.
  await page.getByRole("button", { name: "Clear the fixture/reviewer filter" }).click();
  // Clearing the repository leaves the default status filter, which is the badge's set rather than everything non-archived: four of the six fixtures.
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
  await expect(page.getByTestId("repository-chip")).toHaveCount(0);
});

test("a saved review team stays listed when GitHub no longer returns it", async ({ page }) => {
  await page.route("**/api/v1/review-teams", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/follow-up-settings", (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { saved: true } });
    return route.fulfill({ json: { timezone: "Asia/Tokyo", digest_time: "09:00", wait_days: 7, teams: ["acme/reviewers"], repository_days: {} } });
  });
  await page.goto("/#/settings");
  // Without the merge the checkbox disappears while the id is still posted back.
  const team = page.getByRole("checkbox", { name: /acme\/reviewers/ });
  await expect(team).toBeChecked();
  await team.uncheck();
  const saved = page.waitForRequest((request) => request.url().endsWith("/follow-up-settings") && request.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ teams: [] });
});

test("the settings page documents MCP and CLI access", async ({ page }, testInfo) => {
  await page.goto("/#/settings?tab=access");
  const endpoint = page.getByRole("group", { name: "Server URL" });
  // An absolute URL for this deployment, not a placeholder a user has to edit.
  const shown = ((await endpoint.locator("code").textContent()) || "").trim();
  expect(shown).toMatch(/^https?:\/\/\S+\/api\/v1\/mcp$/);
  await expect(page.getByRole("group", { name: "Client configuration" })).toContainText('"mcpServers"');
  await expect(page.getByRole("group", { name: "Sign in" })).toContainText("prdesk login --host");

  // An authorized client can be revoked without leaving the page.
  const token = page.getByTestId("issued-token").filter({ hasText: "PR Desk CLI" });
  await expect(token).toContainText("Read and write");
  const revoked = page.waitForRequest((request) => request.url().includes("/api-tokens/1") && request.method() === "DELETE");
  await token.getByRole("button", { name: "Revoke" }).click();
  await token.getByRole("button", { name: "Revoke" }).click();
  await revoked;
  await page.screenshot({ path: testInfo.outputPath("access-settings.png"), fullPage: true });
});

test("the settings tabs are addressable and only display the open one", async ({ page }) => {
  await page.goto("/#/settings");
  // The first tab is the default and says so without a parameter of its own.
  await expect(page.getByRole("tab", { name: "Reminders" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI agent access (MCP)" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Agent access" }).click();
  await expect(page.getByRole("heading", { name: "AI agent access (MCP)" })).toBeVisible();
  // The panel left behind keeps what was typed into it, so it stays mounted and hidden rather than being torn down.
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeHidden();
  await expect(page.locator('[role="tabpanel"][hidden]').locator("h2", { hasText: "Reminder schedule" })).toHaveCount(1);
  // Opening a tab has to survive a reload and be worth linking to.
  expect(new URL(page.url()).hash).toContain("tab=access");
  await page.reload();
  await expect(page.getByRole("heading", { name: "AI agent access (MCP)" })).toBeVisible();

  // A closed panel must not keep occupying space in the open one's layout.
  const gap = await page.evaluate(() => {
    const strip = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
    const open = document.querySelector('[role="tabpanel"]:not([hidden])')!.getBoundingClientRect();
    return Math.round(open.top - strip.bottom);
  });
  expect(gap).toBeLessThanOrEqual(24);
});

test("a half-filled destination survives a trip to another settings tab", async ({ page }) => {
  await page.goto("/#/settings?tab=notifications");
  await page.getByLabel("Channel", { exact: true }).selectOption("email");
  await page.getByLabel("Name", { exact: true }).fill("Inbox");
  await page.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com");
  await page.getByLabel("Password", { exact: true }).fill("fixture-secret");
  await page.getByRole("tab", { name: "Reminders" }).click();
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeVisible();
  await page.getByRole("tab", { name: "Notifications" }).click();
  // Everything typed, including the password the browser will not refill, is still there.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Inbox");
  await expect(page.getByLabel("SMTP host", { exact: true })).toHaveValue("smtp.example.com");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("fixture-secret");
});

test("a failed refresh keeps the settings on screen instead of replacing them", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("Asia/Tokyo");
  await page.route("**/api/v1/follow-up-settings", (route) => (route.request().method() === "GET" ? route.fulfill({ status: 502, json: { error: "bad gateway" } }) : route.fulfill({ json: { saved: true } })));
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/Madrid");
  // Saving refetches the settings, and that refetch is the one that fails here.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Update failed" })).toBeVisible();
  await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("Europe/Madrid");
  await expect(page.getByText("Follow-ups could not be loaded")).toHaveCount(0);
});

test("a rejected destination reports the field the server refused", async ({ page }) => {
  await page.route("**/api/v1/notification-destinations", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 400, json: { error: "The sender address is not a valid email address" } }) : route.fulfill({ json: { data: [] } })));
  await page.goto("/#/settings?tab=notifications");
  await page.getByLabel("Channel", { exact: true }).selectOption("email");
  await page.getByLabel("Name", { exact: true }).fill("Inbox");
  await page.getByLabel("From address", { exact: true }).fill("desk@example.com");
  await page.getByLabel("Recipients", { exact: true }).fill("ops@example.com");
  // A pasted host and port is refused by the server, so the form says which field it is.
  await page.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com:587");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter the host name on its own" })).toBeVisible();
  await page.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The sender address is not a valid email address" })).toBeVisible();
});

test("the revoke confirmation takes the focus and hands it back on Escape", async ({ page }) => {
  await page.goto("/#/settings?tab=access");
  const token = page.getByTestId("issued-token").filter({ hasText: "PR Desk CLI" });
  await token.getByRole("button", { name: "Revoke" }).click();
  // The button that had the focus is replaced, so the focus moves to the one that confirms.
  await expect(token.getByRole("button", { name: "Revoke" })).toBeFocused();
  await expect(token.getByRole("button", { name: "Revoke" })).toHaveAccessibleDescription("Revoke this access?");
  await page.keyboard.press("Escape");
  await expect(token.getByText("Revoke this access?")).toHaveCount(0);
  await expect(token.getByRole("button", { name: "Revoke" })).toBeFocused();
});

test("a card action is announced and does not strand the focus", async ({ page }) => {
  await page.goto("/#/attention?role=authored&status=action");
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
  await page.goto("/#/attention");
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
  await page.goto("/#/attention?role=authored&status=action");
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
  await page.goto("/#/attention?role=authored&status=action");
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

// "Ready to merge" is the conjunction of approved, green and conflict-free, and it used to render in a second row directly beside its own premises — a conclusion standing next to the three facts it was computed from tells the reader nothing the facts did not. The conclusion survives, in the reason row; the premises do not. The draft is the same cut from the other side: it says nothing on a card that is already under a "Drafts" heading, and everything in a table row that would otherwise inherit a review status nobody was asked for.
test("ready to merge is stated once, and only where it is not already implied", async ({ page }) => {
  await page.goto("/#/attention");
  const ready = page.getByTestId("follow-up-card").filter({ hasText: "Ship the release notes" });
  await expect(ready.getByText("Ready to merge", { exact: true })).toHaveCount(1);
  await expect(ready.getByText("Approved", { exact: true })).toHaveCount(0);
  await expect(ready.getByText("CI: Success", { exact: true })).toHaveCount(0);
  expect(await chipRows(ready), "the conclusion joined the reason row rather than starting one").toBe(1);

  await page.goto("/#/pull-requests");
  const row = page.getByRole("row").filter({ hasText: "Prototype the digest" });
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
  // A draft's "pending" only means nobody has reviewed something nobody was asked to review, and a repository without a pipeline has no check result to report.
  await expect(row).not.toContainText("Awaiting review");
  await expect(row).not.toContainText("CI:");
});

// Snooze was write-only: the field was served, stripped by the client schema, rendered nowhere and cancellable by nothing, so a mis-tapped reminder buried a PR with no way back. `unsnooze` has been accepted by the API all along and the browser had never once sent it.
test("a muted follow-up shows its reminder and can have it cancelled", async ({ page }) => {
  await page.goto("/#/attention?status=all");
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

// A merge conflict and a red build are the two states only the author can clear, and they were the only ones the table could not be filtered to, while listPRs has honoured `attention=true` since it was written. The tile and the pill are the same SQL predicate, so this asserts the number and its destination are the same question.
test("the blocked filter asks the list endpoint for the rows the tile counts", async ({ page }) => {
  const requested = page.waitForRequest((request) => request.url().includes("/api/v1/pull-requests?"));
  await page.goto("/#/blocked");
  expect(new URL((await requested).url()).searchParams.get("attention")).toBe("true");
  await expect(page.getByRole("button", { name: "Blocked", exact: true })).toHaveAttribute("aria-pressed", "true");

  // The third stat tile counts the same rows and is now a link to them; it used to be an inert "Conflicts" number with no view behind it.
  await page.goto("/#/pull-requests");
  await page.getByRole("link", { name: /^Blocked/ }).click();
  expect(page.url()).toContain("#/blocked");
});

// Two lists of the same pull requests with no bridge between them: the table could not say whether a row was already handled or already snoozed, and reading every comment on a PR left the workspace still insisting it was unread.
test("the table carries the follow-up state, and reading the thread records it", async ({ page }) => {
  await page.goto("/#/pull-requests");
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

test("the sync dismiss button is not named after the activity panel", async ({ page }) => {
  await page.goto("/#/attention");
  // Both buttons used to be announced as "Close activity".
  await expect(page.getByRole("button", { name: "Close activity" })).toHaveCount(0);
});

// A stale bookmark used to render the contribution overview under whatever address was typed, so the page and the URL disagreed and a reload landed somewhere else again. `replace` keeps the bad entry out of history, so Back still leaves the app rather than bouncing between the typo and the redirect.
test("an unknown route rewrites the address instead of quietly rendering the overview", async ({ page }) => {
  await page.goto("/#/follow-ups");
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
});

// "Show me just this repository" was a two-screen detour through Repositories even though the name was right there in the row. The title link one cell over still goes to GitHub.
test("the repository cell filters the list instead of leaving for github.com", async ({ page }) => {
  await page.goto("/#/pull-requests");
  const row = page.getByRole("row").filter({ hasText: "Handle timezone boundaries" });
  await row.getByRole("button", { name: "Show only fixture/calendar" }).click();
  await expect(page).toHaveURL(/repo=fixture%2Fcalendar/);
  await expect(page.getByRole("button", { name: "Clear the fixture/calendar filter" })).toBeVisible();
});

// The tile is the one navigational affordance the last pass added, and its number and its destination have to be the same predicate or it sends the reader somewhere that disagrees with what it counted. Acting on a row from here is gone: it was a second copy of the card's action block that dropped the caveat, dropped the inverse, and on its likeliest target — a conflicted pull request of your own, which sorts to the top by construction — offered a bare "3 days" with the card's explanation stripped out. The row links to the full card, which is the surface that gates Handled, explains the gate and offers the way back.
test("the landing page counts blocked work and opens what it counts", async ({ page }) => {
  await page.goto("/#/");
  // Named after the rule it counts rather than after the word the PR table's differently-computed tile already uses: two tiles reading "Blocked" over two numbers is how a reader stops trusting either.
  const blocked = page.getByRole("link").filter({ hasText: "Needs a new push" }).first();
  await expect(blocked).toBeVisible();
  await expect(blocked).toHaveAttribute("href", /tone=blocked/);
  await expect(page.getByRole("link", { name: /Recently merged/ })).toBeVisible();
  // Every row is a link to its own card rather than a verb, so nothing on this page can change state.
  const row = page.getByTestId("priority-list").locator("li").filter({ hasText: "Handle timezone boundaries" });
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(row.getByRole("link")).toHaveAttribute("href", /attention\?focus=1/);
});

// Two keys, and the cursor they move is simply where the focus is. Both halves matter: a ring that walks an order the screen does not render sends the reader to a row they cannot see, and a card that takes focus with no indicator — which is what `focus:outline-none` on a tabIndex -1 article bought — is a cursor nobody can find. The rest of the keyboard layer is gone: `x` could never receive a Shift (the key is "X" when it is held), and the panel that documented it was behind a `?` nothing advertised.
test("j and k walk the list and mark the row they land on", async ({ page }) => {
  await page.goto("/#/attention?status=all");
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
  await page.goto("/#/attention?role=authored&status=action");
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
  await page.goto("/#/attention?role=authored&status=action");
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
  await page.goto("/#/attention?role=authored&status=action");
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
  await page.goto("/#/attention?status=todo&tone=blocked");
  await expect(page.getByTestId("follow-up-card")).toHaveCount(1);
  await expect(page.getByTestId("follow-up-card")).toContainText("Rebase the storage migration");
  const chip = page.getByTestId("tone-chip");
  // Named after the rule it filters by, which is the same words the tile that applied it uses.
  await expect(chip).toContainText("Needs a new push");
  await chip.getByRole("button", { name: "Clear the Needs a new push filter" }).click();
  await expect(page.getByTestId("tone-chip")).toHaveCount(0);
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});

// "All pull requests" was open-and-unmerged, so nothing the reader had finished could be reached from the route named after all of them, while the same page advertised a merged count. The endpoint answered merged=true with a guaranteed-empty predicate; it now replaces the default rather than intersecting with it.
test("merged work is reachable from the list that claims to hold it", async ({ page }) => {
  await page.goto("/#/pull-requests");
  const merged = page.waitForRequest((request) => request.url().includes("/pull-requests?") && request.url().includes("merged=true"));
  await page.getByRole("button", { name: "Merged", exact: true }).click();
  await merged;
  await expect(page).toHaveURL(/#\/merged/);
});

// The first words on the landing route named the report at the bottom of it rather than the job, the priority list showed five of forty exactly as it showed five of five, and the outcome legend counted sets the interface had no way to open.
test("the landing page names the job, states the remainder and opens what it counts", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
  // The fixture holds four, which the list shows in full, so the remainder must not be claimed. The link states the part that is not on screen; five of five has no such part.
  await expect(page.getByRole("link", { name: /more item/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Merged", exact: true }).click();
  await expect(page).toHaveURL(/#\/merged/);
});

// An installed window has no browser chrome, so it has no reload; a tab has one and does not need a second. The control is therefore conditional on the display mode, which is a fact no page-load sweep can observe: a headless Chromium is always a tab, and `Emulation.setEmulatedMedia` does not carry `display-mode` as a feature — it silently accepts the entry and the query still answers false, which is how this test first passed against a button that was not there. Standing in for the platform's answer is the only way to render the button at all, and rendering it is the only way to find out that what it does works.
test("the reload button belongs to the installed window and sweeps the caches it was given", async ({ page }) => {
  await page.goto("/#/");
  const button = page.getByRole("button", { name: "Reload the app" });
  await expect(button, "a tab already has a reload").toHaveCount(0);

  // Only the display-mode queries are answered here; everything else — the pointer, hover and reduced-motion queries the shell and the charts ask — is left to the browser, so the page under test is the real one in every other respect. An init script survives the reload the button performs, which is what keeps the button on screen afterwards.
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes("display-mode") ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as MediaQueryList) : real(query));
  });
  await page.reload();
  await expect(button).toBeVisible();

  // Named the way public/sw.js names its caches: the sweep is by prefix, so a cache from an older deploy goes with the current ones and nothing else on the origin is touched.
  // The marker is what makes this a reload rather than a re-render: the route and the heading are the same on both sides of one, so neither can tell them apart.
  await page.evaluate(async () => {
    (window as Window & { survived?: boolean }).survived = true;
    await caches.open("prdesk-shell-v0").then((cache) => cache.put("/stale", new Response("old")));
    await caches.open("unrelated").then((cache) => cache.put("/keep", new Response("mine")));
  });
  // The sweep is awaited before the reload is asked for, so the click resolves well ahead of the navigation it ends in; waiting for the load event is what stops the assertions below from reading the document that is about to be replaced.
  const reloaded = page.waitForEvent("load");
  await button.click();
  await reloaded;
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { survived?: boolean }).survived), "the document was replaced").toBeUndefined();
  expect(await page.evaluate(() => caches.keys()), "the worker's caches are gone and nothing else is").toEqual(["unrelated"]);
});

// The branch that keeps a hard reload from being the worst thing a reader can do to an installed app. Offline, the shell cache is the only copy of PR Desk on the device and there is no network to refill it from, so the sweep is skipped and the reload is left to find it.
test("a reload with no network keeps the offline copy it would otherwise discard", async ({ page, context }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes("display-mode") ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as MediaQueryList) : real(query));
  });
  await page.goto("/#/");
  await page.evaluate(() => caches.open("prdesk-shell-v0").then((cache) => cache.put("/stale", new Response("old"))));

  await context.setOffline(true);
  // The reload itself cannot succeed against a dev server that is now unreachable, and that is beside the point: what is asserted below is what the click did before it asked for the document. `dispatchEvent` rather than `click` because click waits out the navigation it triggers, and this one ends on the browser's own error page.
  const navigated = page.waitForEvent("framenavigated");
  await page.getByRole("button", { name: "Reload the app" }).dispatchEvent("click");
  await navigated;
  await context.setOffline(false);

  await page.goto("/#/");
  expect(await page.evaluate(() => caches.keys()), "the only copy of the application on the device").toContain("prdesk-shell-v0");
  await page.evaluate(() => caches.delete("prdesk-shell-v0"));
});
