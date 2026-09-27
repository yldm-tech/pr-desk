import { expect, test } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

test("settings save timezone and selected review teams", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/Madrid");
  await page.getByRole("checkbox", { name: /fixture\/reviewers/ }).check();
  // The digest language is the server's, labelled apart from the app's own language.
  await page.getByLabel("Digest language", { exact: true }).selectOption("zh-CN");
  const saved = page.waitForRequest((req) => req.url().endsWith("/follow-up-settings") && req.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ timezone: "Europe/Madrid", digest_time: "09:00", language: "zh-CN", teams: ["fixture/reviewers"], repository_days: {} });
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
  await page.getByRole("button", { name: "Edit as text" }).click();
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
  await page.getByRole("button", { name: "Add destination" }).click();
  // Opening the form puts the focus on its first field.
  await expect(page.getByLabel("Channel", { exact: true })).toBeFocused();
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
  await page.getByRole("button", { name: "Add destination" }).click();
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
  await page.getByRole("button", { name: "Add destination" }).click();
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
  await page.getByRole("button", { name: "Add destination" }).click();
  await page.getByLabel("Channel", { exact: true }).selectOption("webhook");
  await page.getByLabel("Name", { exact: true }).fill("internal");
  await page.getByLabel("Webhook URL", { exact: true }).fill("http://10.0.0.9/hooks/pr-desk");
  const posted = page.waitForRequest((request) => request.url().endsWith("/notification-destinations") && request.method() === "POST");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await posted).postDataJSON()).toMatchObject({ kind: "webhook", url: "http://10.0.0.9/hooks/pr-desk" });
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
  await expect(page.getByRole("tab")).toHaveText(["Reminders", "Notifications", "GitHub access", "Agent access"]);
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

  // The GitHub App installation, which used to sit in the sidebar, has its own tab and address.
  await page.getByRole("tab", { name: "GitHub access" }).click();
  expect(new URL(page.url()).hash).toContain("tab=github");
  await expect(page.getByRole("heading", { name: "GitHub App access" })).toBeVisible();
  await expect(page.getByRole("tabpanel").getByRole("link", { name: /^Install GitHub App/ })).toBeVisible();
  // The default tab carries no parameter of its own.
  await page.getByRole("tab", { name: "Reminders" }).click();
  expect(new URL(page.url()).hash).toBe("#/settings");
});

test("a half-filled destination survives a trip to another settings tab", async ({ page }) => {
  await page.goto("/#/settings?tab=notifications");
  await page.getByRole("button", { name: "Add destination" }).click();
  await page.getByLabel("Channel", { exact: true }).selectOption("email");
  await page.getByLabel("Name", { exact: true }).fill("Inbox");
  await page.getByLabel("SMTP host", { exact: true }).fill("smtp.example.com");
  await page.getByLabel("Password", { exact: true }).fill("fixture-secret");
  await page.getByRole("tab", { name: "Reminders" }).click();
  await expect(page.getByRole("heading", { name: "Reminder schedule" })).toBeVisible();
  await page.getByRole("tab", { name: "Notifications" }).click();
  // The form is still open, and everything typed, including the password the browser will not refill, is still there.
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
  await expect(page.getByText("Settings could not be loaded")).toHaveCount(0);
  await expect(page.getByText("Follow-ups could not be loaded")).toHaveCount(0);
});

test("a rejected destination reports the field the server refused", async ({ page }) => {
  await page.route("**/api/v1/notification-destinations", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 400, json: { error: "The sender address is not a valid email address" } }) : route.fulfill({ json: { data: [] } })));
  await page.goto("/#/settings?tab=notifications");
  await page.getByRole("button", { name: "Add destination" }).click();
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

test("a repository waiting period is added as a row and saved as repository_days", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByText("No repository has its own waiting period yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add repository" }).click();
  // The new row takes the focus, with the default waiting period filled in.
  const repository = page.getByLabel("Repository", { exact: true });
  await expect(repository).toBeFocused();
  await expect(page.getByLabel("Days", { exact: true })).toHaveValue("7");
  await repository.fill("fixture/calendar");
  await page.getByLabel("Days", { exact: true }).fill("14");
  const saved = page.waitForRequest((request) => request.url().endsWith("/follow-up-settings") && request.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ repository_days: { "fixture/calendar": 14 } });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByRole("button", { name: "Remove fixture/calendar" }).click();
  await expect(page.getByRole("button", { name: "Add repository" })).toBeFocused();
});

test("a row that is not a repository is refused on the field, without a save", async ({ page }) => {
  await page.route("**/api/v1/follow-up-settings", (route) => (route.request().method() === "POST" ? route.fulfill({ json: { saved: true } }) : route.fulfill({ json: { timezone: "Asia/Tokyo", digest_time: "09:00", wait_days: 7, teams: [], repository_days: { "fixture/calendar": 14 } } })));
  await page.goto("/#/settings");
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue("fixture/calendar");
  let posted = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/follow-up-settings") && request.method() === "POST") posted = true;
  });
  await page.getByRole("button", { name: "Add repository" }).click();
  await page.getByLabel("Repository", { exact: true }).last().fill("calendar");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Use the form owner/repository." })).toBeVisible();
  // The focus lands on the field that stopped the save.
  await expect(page.getByLabel("Repository", { exact: true }).last()).toBeFocused();
  await expect(page.getByLabel("Repository", { exact: true }).last()).toHaveAttribute("aria-invalid", "true");
  expect(posted).toBe(false);
});

test("switching to text and back carries the waiting periods across", async ({ page }) => {
  await page.route("**/api/v1/follow-up-settings", (route) => (route.request().method() === "POST" ? route.fulfill({ json: { saved: true } }) : route.fulfill({ json: { timezone: "Asia/Tokyo", digest_time: "09:00", wait_days: 7, teams: [], repository_days: { "fixture/calendar": 14 } } })));
  await page.goto("/#/settings");
  const toggle = page.getByRole("button", { name: "Edit as text" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const text = page.getByLabel("Repository waiting periods", { exact: true });
  await expect(text).toHaveValue("fixture/calendar=14");
  // A line that does not parse keeps the text view open instead of being dropped on the way back.
  await text.fill("fixture/calendar=14\nfixture/reviewer=3\nnot a line");
  await toggle.click();
  await expect(page.getByRole("alert").filter({ hasText: "Line 3" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await text.fill("fixture/calendar=14\nfixture/reviewer=3");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Repository", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Repository", { exact: true }).last()).toHaveValue("fixture/reviewer");
  await expect(page.getByLabel("Days", { exact: true }).last()).toHaveValue("3");
  const saved = page.waitForRequest((request) => request.url().endsWith("/follow-up-settings") && request.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ repository_days: { "fixture/calendar": 14, "fixture/reviewer": 3 } });
});

// A server error is the server's to fix, so it is offered the retry alone: a reconnect there sent the reader through GitHub's OAuth for a failure a new session cannot cure. Only a 401, the API's answer for a connection it cannot act for, offers the reconnect.
test("settings that cannot be loaded offer a retry, a reconnect only when the connection is the cause, and leave the other tabs working", async ({ page }) => {
  let status = 500;
  await page.route("**/api/v1/follow-up-settings", (route) => route.fulfill({ status, json: { error: status === 401 ? "Reconnect GitHub to configure account follow-ups" : "boom" } }));
  await page.goto("/#/settings");
  const failure = page.getByRole("alert").filter({ hasText: "Settings could not be loaded" });
  await expect(failure).toBeVisible();
  await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(failure.getByRole("link", { name: "Reconnect GitHub" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Agent access" }).click();
  await expect(page.getByRole("heading", { name: "AI agent access (MCP)" })).toBeVisible();

  status = 401;
  await page.getByRole("tab", { name: "Reminders" }).click();
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(failure.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", /\/api\/v1\/auth\/github$/);
  await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("removing a destination asks once in place and says it is done", async ({ page }) => {
  await page.goto("/#/settings?tab=notifications");
  await page.getByRole("button", { name: "Add destination" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Team channel");
  await page.getByLabel("Bot token", { exact: true }).fill("fixture:token");
  await page.getByLabel("Chat ID", { exact: true }).fill("-100");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const row = page.getByTestId("destination").filter({ hasText: "Team channel" });
  await expect(row).toContainText("Enabled");
  await expect(page.getByRole("status").filter({ hasText: "Destination added." })).toBeAttached();
  // Cancel closes the form and hands the focus to the button that opened it.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Channel", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add destination" })).toBeFocused();

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row.getByRole("button", { name: "Remove" })).toBeFocused();
  await expect(row.getByRole("button", { name: "Remove" })).toHaveAccessibleDescription("Remove this destination?");
  await page.keyboard.press("Escape");
  await expect(row.getByText("Remove this destination?")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Remove" })).toBeFocused();
  await row.getByRole("button", { name: "Remove" }).click();
  const removed = page.waitForRequest((request) => request.url().endsWith("/notification-destinations/1") && request.method() === "DELETE");
  await row.getByRole("button", { name: "Remove" }).click();
  await removed;
  await expect(page.getByRole("status").filter({ hasText: "Destination removed." })).toBeAttached();
});

test("an out-of-range waiting period for a row is named on the row, not left to the browser", async ({ page }) => {
  await page.goto("/#/settings");
  let posted = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/follow-up-settings") && request.method() === "POST") posted = true;
  });
  await page.getByRole("button", { name: "Add repository" }).click();
  await page.getByLabel("Repository", { exact: true }).fill("fixture/calendar");
  await page.getByLabel("Days", { exact: true }).fill("400");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Use a whole number from 1 to 365." })).toBeVisible();
  await expect(page.getByLabel("Days", { exact: true })).toBeFocused();
  // The schedule's own fields keep the browser's range check, so a cleared default (which the field holds as 0) is never posted.
  await page.getByLabel("Days", { exact: true }).fill("30");
  await page.getByLabel("Follow up after (days)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.getByLabel("Follow up after (days)", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(posted).toBe(false);
});
