import { expect, test } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
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
          waiting_since: "2026-09-01T00:00:00Z",
          archived_at: null,
          pr: { id: index + 1, repo: "fixture/calendar", number: index + 1, title: `Reason sample ${index + 1}`, url: `https://github.com/fixture/calendar/pull/${index + 1}` },
        })),
      },
    }),
  );
  await page.goto("/#/");
  const priority = page.locator(".followup-priority-reasons");
  await expect(priority.first().locator('[data-tone="blocked"]')).toHaveCount(2);
  await expect(priority.nth(1).locator('[data-tone="action"]')).toHaveCount(1);
  await expect(priority.nth(2).locator('[data-tone="waiting"]')).toHaveCount(1);
  await expect(priority.nth(3).locator('[data-tone="neutral"]')).toHaveCount(1);
  const colour = (tone: string) =>
    page
      .locator(`.followup-priority-reasons [data-tone="${tone}"]`)
      .first()
      .evaluate((node) => getComputedStyle(node).color);
  const tones = await Promise.all(["blocked", "action", "waiting", "neutral"].map(colour));
  expect(new Set(tones).size).toBe(4);
  await page.screenshot({ path: testInfo.outputPath("followup-reason-tones.png"), fullPage: true });
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

test("settings fit a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-settings.png"), fullPage: true });
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
  await expect(page.locator(".followup-card")).toHaveCount(1);
  await expect(page.locator(".followup-card")).toContainText("Review storage migration");
  await expect(page.locator(".followup-repository-chip")).toContainText("fixture/reviewer");
  // The chip clears the filter without leaving the view.
  await page.getByRole("button", { name: /fixture\/reviewer/ }).click();
  await expect(page.locator(".followup-card")).toHaveCount(2);
  await expect(page.locator(".followup-repository-chip")).toHaveCount(0);
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

test("the settings tabs are addressable and only render the open one", async ({ page }) => {
  await page.goto("/#/settings");
  // The first tab is the default and says so without a parameter of its own.
  await expect(page.getByRole("tab", { name: "Reminders" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI agent access (MCP)" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Agent access" }).click();
  await expect(page.getByRole("heading", { name: "AI agent access (MCP)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toHaveCount(0);
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

test("a card action is announced and does not strand the focus", async ({ page }) => {
  await page.goto("/#/attention?role=authored&status=action");
  const card = page.locator(".followup-card");
  await expect(card).toHaveCount(1);
  const handled = card.getByRole("button", { name: "Handled · wait for others", exact: true });
  await handled.focus();
  await handled.click();
  // The card is removed, so the button that had the focus is gone.
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Handle timezone boundaries" })).toBeAttached();
  // Focus must land somewhere in the workspace rather than on the body.
  const stranded = await page.evaluate(() => document.activeElement === document.body);
  expect(stranded).toBe(false);
});

test("the sync dismiss button is not named after the activity panel", async ({ page }) => {
  await page.goto("/#/attention");
  // Both buttons used to be announced as "Close activity".
  await expect(page.getByRole("button", { name: "Close activity" })).toHaveCount(0);
});
