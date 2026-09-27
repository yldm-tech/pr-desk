import { expect, test, type Page } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// Loaded means the follow-ups have arrived and the lazy palette chunk has registered its keys: the palette's only trace on a closed page is its binding, so the Inbox rows stand in for "the app is up" and the first ⌘K is retried until the chunk answers.
async function openInbox(page: Page, route = "/#/inbox") {
  await page.goto(route);
  await expect(page.locator("main h1")).toBeVisible();
  if (route.startsWith("/#/inbox")) await expect(page.getByTestId("follow-up-card").first()).toBeVisible();
}

async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  return palette;
}

// Every single-key shortcut goes through one guard, so a letter typed into a field is text: it neither walks the list nor starts a `g` sequence.
test("keys typed into the search field stay text", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("/");
  const search = page.locator("#pr-search");
  await expect(search).toBeFocused();
  await page.keyboard.type("j");
  await page.keyboard.type("g");
  await page.keyboard.type("p");
  await page.keyboard.type("?");
  await expect(search).toHaveValue("jgp?");
  await expect(page.locator("[data-testid=follow-up-card][data-active]")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// `g` then a letter jumps between destinations from anywhere outside a field; `n` is Insights because `i` is the Inbox.
test("g sequences move between destinations", async ({ page }) => {
  await openInbox(page);
  for (const [key, url] of [
    ["p", /#\/prs$/],
    ["r", /#\/repos$/],
    ["n", /#\/insights$/],
    ["s", /#\/settings$/],
    ["i", /#\/inbox$/],
  ] as const) {
    await expect(async () => {
      await page.keyboard.press("g");
      await page.keyboard.press(key);
      await expect(page, `g ${key}`).toHaveURL(url, { timeout: 500 });
    }).toPass();
  }
  // A lone second key is not a shortcut of its own.
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/#\/inbox$/);
});

test("? opens the shortcuts sheet, which lists the bindings and gives focus back on Escape", async ({ page }) => {
  await openInbox(page);
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(async () => {
    await page.keyboard.press("?");
    await expect(sheet).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(page.getByRole("button", { name: "Close keyboard shortcuts" })).toBeFocused();
  for (const section of ["Anywhere", "Lists", "Inbox", "Activity sheet"]) await expect(sheet.getByRole("heading", { level: 3, name: section })).toBeVisible();
  await expect(sheet.getByRole("term").filter({ hasText: "Go to Inbox" })).toBeVisible();
  await expect(sheet.getByRole("term").filter({ hasText: "Open the command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // A second `?` works once the sheet has gone: the key is ignored only while a dialog is open.
  await page.keyboard.press("?");
  await expect(sheet).toBeVisible();
  await page.getByRole("button", { name: "Close keyboard shortcuts" }).click();
  await expect(sheet).toBeHidden();
});

// The palette only navigates. Landing on a row through `?focus=` must never mark it read (spec D5), so no follow-up write may leave the page on the way.
test("⌘K finds a follow-up by number and lands on it in the Inbox without reading it", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/follow-ups\//.test(request.url())) writes.push(request.url());
  });
  await openInbox(page, "/#/prs");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("#35");
  const option = palette.getByRole("option", { name: /Rebase the storage migration/ });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(palette.getByRole("option", { name: /Handle timezone boundaries/ })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => url.href.endsWith("/#/inbox?focus=5"));
  await expect(palette).toBeHidden();
  await expect(page.getByTestId("follow-up-card").first()).toBeVisible();
  expect(writes).toEqual([]);
});

// ⌘K is the one shortcut that works inside a text field, so it reaches the palette from a focused search box; pressing it again closes the palette and the caret goes back where it was.
test("⌘K toggles the palette from inside a field and returns focus to it", async ({ page }) => {
  await openInbox(page);
  await page.locator("#pr-search").focus();
  await openPalette(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await expect(page.locator("#pr-search")).toBeFocused();
  await openPalette(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await expect(page.locator("#pr-search")).toBeFocused();
});

test("the palette reaches every destination and hands a query to the pull request search", async ({ page }) => {
  await openInbox(page);
  let palette = await openPalette(page);
  // Arrow keys walk the options; the first is selected on open.
  const options = palette.getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await palette.getByRole("combobox").fill("blocked");
  await palette.getByRole("option", { name: /Pull requests.*Blocked/ }).click();
  await expect(page).toHaveURL(/#\/prs\/blocked$/);

  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("github access");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/settings\?tab=github$/);

  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("storage");
  // Both storage follow-ups match as well; the pull request search is its own entry after them.
  await expect(palette.getByRole("option", { name: /Review storage migration/ })).toBeVisible();
  await palette.getByRole("option", { name: "Search pull requests for “storage”" }).click();
  await expect(page).toHaveURL((url) => url.href.endsWith("/#/prs?q=storage"));

  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("zzzz");
  // Nothing local matches, and the pull request search is still offered, as the only option and already selected.
  await expect(palette.getByRole("status")).toHaveText("No results for “zzzz”");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(palette.getByRole("option", { name: "Search pull requests for “zzzz”" })).toHaveAttribute("aria-selected", "true");
});

test("palette actions switch the theme and language, start a sync and open the shortcuts", async ({ page }) => {
  const syncs: string[] = [];
  await installFixtures(page, {
    overrides: {
      sync: (route) => {
        syncs.push(route.request().method());
        return route.fulfill({ json: { status: "queued" } });
      },
    },
  });
  await openInbox(page);
  let palette = await openPalette(page);
  await palette.getByRole("combobox").fill("dark");
  await expect(palette.getByRole("option", { name: /Dark/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("prdesk-theme"))).toBe("dark");

  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("theme");
  await expect(palette.getByRole("option", { name: /Dark.*\(current\)/ })).toBeVisible();
  await palette.getByRole("option", { name: /System/ }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(await page.evaluate(() => localStorage.getItem("prdesk-theme"))).toBeNull();

  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("sync");
  await palette.getByRole("option", { name: "Sync now" }).click();
  await expect.poll(() => syncs).toEqual(["POST"]);

  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("shortcuts");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  // A language is found by its name in the current language as well as by its own.
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("japanese");
  await palette.getByRole("option", { name: /日本語/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "コマンドパレット" }).getByRole("combobox")).toHaveAttribute("placeholder", "検索、または移動先を入力…");
});

// The follow-up results say when they are incomplete instead of looking like a full answer: an inventory still running, or a list that failed to load.
test("the palette says when follow-up results are partial or unavailable", async ({ page }) => {
  await installFixtures(page, {
    overrides: {
      "follow-ups": (route) =>
        route.fulfill({
          json: {
            baseline_complete: false,
            counts: { authored: 1, reviewer: 0, follow_up: 0 },
            data: [
              {
                id: 9,
                version: 1,
                role: "authored",
                state: "action",
                reasons: ["human_feedback"],
                unread: false,
                excerpt: "",
                waiting_since: "2026-09-01T00:00:00Z",
                archived_at: null,
                pr: { id: 109, repo: "fixture/partial", number: 9, title: "Partial inventory row", url: "https://github.com/fixture/partial/pull/9" },
              },
            ],
          },
        }),
    },
  });
  await openInbox(page);
  let palette = await openPalette(page);
  await palette.getByRole("combobox").fill("partial");
  await expect(palette.getByRole("status")).toHaveText("The first inventory is still running, so some follow-ups may be missing.");
  await expect(palette.getByRole("option", { name: /Partial inventory row/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await installFixtures(page, { overrides: { "follow-ups": (route) => route.fulfill({ status: 500, json: { error: "down" } }) } });
  await page.reload();
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("inbox");
  // The list query retries before it gives up, so the failure takes a few seconds to become final.
  await expect(palette.getByRole("status")).toHaveText("Follow-ups could not be loaded. Pages and actions still work.", { timeout: 15000 });
  await expect(palette.getByRole("option", { name: "Inbox", exact: true })).toBeVisible();
});
