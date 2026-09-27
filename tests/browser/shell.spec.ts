import { expect, test } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

test("the sync dismiss button is not named after the activity panel", async ({ page }) => {
  await page.goto("/#/inbox");
  // Both buttons used to be announced as "Close activity".
  await expect(page.getByRole("button", { name: "Close activity" })).toHaveCount(0);
});

// A stale bookmark used to render a page under whatever address was typed, so the page and the URL disagreed and a reload landed somewhere else again. `replace` keeps the bad entry out of history, so Back still leaves the app rather than bouncing between the typo and the redirect.
test("an unknown route rewrites the address instead of quietly rendering a page", async ({ page }) => {
  await page.goto("/#/follow-ups");
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});

// A tab strip or a history list shows the title and nothing else, so it names the view as specifically as the page heading does. A page may add a count to its own name ("Inbox (4)"), so that part is optional here.
test("the document title names the page and the view", async ({ page }) => {
  for (const [route, title] of [
    ["/#/inbox", /^Inbox \(4\) · PR Desk$/],
    ["/#/prs", /^Pull requests( \(\d+\))? · PR Desk$/],
    ["/#/prs/blocked", /^Blocked( \(\d+\))? · Pull requests · PR Desk$/],
    ["/#/repos", /^Repositories( \(\d+\))? · PR Desk$/],
    ["/#/insights", /^Insights · PR Desk$/],
    ["/#/settings?tab=access", /^(Agent access · )?Settings · PR Desk$/],
    ["/#/about", /^About( PR Desk)? · PR Desk$/],
  ] as const) {
    await page.goto(route);
    await expect(page, route).toHaveTitle(title);
  }
});

// The navigation returns to where each destination was left, so moving between them does not throw away a filtered view. The links are real links: the remembered address is their href, so a middle click opens the same view in a new tab.
test("the navigation returns to the view and filters each destination was left on", async ({ page }) => {
  await page.goto("/#/prs/blocked?repo=fixture/reviewer");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const pulls = navigation.getByRole("link", { name: "Pull requests" });
  await expect(pulls).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(navigation.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
  await expect(pulls).not.toHaveAttribute("aria-current", "page");
  await expect(pulls).toHaveAttribute("href", "#/prs/blocked?repo=fixture/reviewer");
  await pulls.click();
  await expect(page).toHaveURL((url) => url.href.endsWith("/#/prs/blocked?repo=fixture/reviewer"));
  await expect(pulls).toHaveAttribute("aria-current", "page");
  // Settings is not a destination in the tab sense, but it is still a place with a current state: its sidebar link says so.
  await page.locator("aside").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.locator("aside").getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
});

// The badge is the Inbox's default view in one number: action rows by role plus every follow-up. It is a <b> inside the Inbox link, hidden while the count is loading rather than showing a zero it does not know yet.
test("the Inbox link carries the badge the default view counts", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // Registered after the fixture's catch-all, so it answers first; `fallback` then hands the request to the fixture once the test lets it go.
  await page.route("**/api/v1/follow-ups", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/#/prs");
  const badge = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Inbox/ }).locator("b");
  await expect(badge).toHaveCSS("visibility", "hidden");
  release();
  await expect(badge).toHaveText("4");
  await expect(badge).toHaveCSS("visibility", "visible");
});

// An installed window has no browser chrome, so it has no reload; a tab has one and does not need a second. The control is therefore conditional on the display mode, which is a fact no page-load sweep can observe: a headless Chromium is always a tab, and `Emulation.setEmulatedMedia` does not carry `display-mode` as a feature — it silently accepts the entry and the query still answers false, which is how this test first passed against a button that was not there. Standing in for the platform's answer is the only way to render the button at all, and rendering it is the only way to find out that what it does works.
test("the reload button belongs to the installed window and sweeps the caches it was given", async ({ page }) => {
  await page.goto("/#/inbox");
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
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { survived?: boolean }).survived), "the document was replaced").toBeUndefined();
  expect(await page.evaluate(() => caches.keys()), "the worker's caches are gone and nothing else is").toEqual(["unrelated"]);
});

// The branch that keeps a hard reload from being the worst thing a reader can do to an installed app. Offline, the shell cache is the only copy of PR Desk on the device and there is no network to refill it from, so the sweep is skipped and the reload is left to find it.
test("a reload with no network keeps the offline copy it would otherwise discard", async ({ page, context }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes("display-mode") ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as MediaQueryList) : real(query));
  });
  await page.goto("/#/inbox");
  await page.evaluate(() => caches.open("prdesk-shell-v0").then((cache) => cache.put("/stale", new Response("old"))));

  await context.setOffline(true);
  // The reload itself cannot succeed against a dev server that is now unreachable, and that is beside the point: what is asserted below is what the click did before it asked for the document. `dispatchEvent` rather than `click` because click waits out the navigation it triggers, and this one ends on the browser's own error page.
  const navigated = page.waitForEvent("framenavigated");
  await page.getByRole("button", { name: "Reload the app" }).dispatchEvent("click");
  await navigated;
  await context.setOffline(false);

  await page.goto("/#/inbox");
  expect(await page.evaluate(() => caches.keys()), "the only copy of the application on the device").toContain("prdesk-shell-v0");
  await page.evaluate(() => caches.delete("prdesk-shell-v0"));
});

// The pill answers "can I trust what is on screen" in a few words, and each answer is its own state: a recent completion is fresh, one more than an hour old is stale, and a paused session says so in the pill and in a banner that carries the way out.
test("the sync pill tells fresh, stale and paused apart", async ({ page }) => {
  const progress = (lastSynced: string) => ({ status: "complete", phase: "details", completed: 2, total: 2, retry_at: 0, last_synced_at: lastSynced });
  let body = progress(new Date(Date.now() - 4 * 60000).toISOString());
  await page.route("**/api/v1/sync/progress", (route) => route.fulfill({ json: body }));
  await page.goto("/#/inbox");
  const pill = page.locator("aside [data-health]");
  await expect(pill).toHaveAttribute("data-health", "fresh");
  await expect(pill).toHaveAccessibleName("Synced 4 min. ago");

  body = progress(new Date(Date.now() - 3 * 3600000).toISOString());
  await page.reload();
  await expect(pill).toHaveAttribute("data-health", "stale");
  await expect(pill).toHaveAccessibleName("Last sync 3 hr. ago");
  // No banner for a stale sync: the scheduler retries by itself, and the pill is where the reader looks for it.
  await expect(page.getByTestId("banners")).toHaveCount(0);

  await page.route("**/api/v1/auth/status", (route) => route.fulfill({ json: { connected: true, username: "fixture", sync_paused: true } }));
  await page.reload();
  await expect(pill).toHaveAttribute("data-health", "paused");
  await expect(pill).toHaveAccessibleName("Sync paused");
  const banner = page.getByTestId("banners");
  await expect(banner).toContainText("synchronization is paused");
  await expect(banner.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", /\/api\/v1\/auth\/github$/);
});

// Only the two failures a new authorization can fix earn a banner; everything else retries on its own and is reported in the pill.
test("a sync that needs a new authorization says so above the page", async ({ page }) => {
  await page.route("**/api/v1/sync/progress", (route) => route.fulfill({ json: { status: "failed", phase: "account", completed: 0, total: 0, retry_at: 0, error_code: "reconnect", last_synced_at: "2026-09-11T00:00:00Z" } }));
  await page.goto("/#/prs");
  await expect(page.locator("aside [data-health]")).toHaveAttribute("data-health", "failed");
  const banner = page.getByTestId("banners");
  await expect(banner).toContainText("Reconnect GitHub to sync.");
  await expect(banner.getByRole("link", { name: "Reconnect GitHub" })).toBeVisible();
});

// The first import is the one wait a new reader sits through, so it is shown in full above every page and cannot be dismissed. An incremental run only moves the pill.
test("the first sync shows its progress above the page", async ({ page }) => {
  let mode = "";
  await page.route("**/api/v1/sync/progress", (route) => route.fulfill({ json: { status: "running", mode, phase: "history", completed: 40, total: 120, retry_at: 0 } }));
  await page.goto("/#/repos");
  const banner = page.getByTestId("banners");
  await expect(banner.getByRole("list", { name: "Sync progress" })).toBeVisible();
  await expect(banner).toContainText("Fetching records: 40 / 120");
  await expect(page.locator("aside [data-health]")).toHaveAccessibleName("Syncing 40/120");
  mode = "incremental";
  await page.reload();
  await expect(page.locator("aside [data-health]")).toHaveAttribute("data-health", "syncing");
  await expect(page.getByTestId("banners")).toHaveCount(0);
});

// Sync now lives in the popover with the rest of the story. A refused request is an error the reader has to see, so it stays in the toast, announced assertively, until it is dismissed.
test("sync now starts a run from the popover and reports a refusal", async ({ page }) => {
  const posts: string[] = [];
  await page.route("**/api/v1/sync", (route) => {
    posts.push(route.request().method());
    return route.fulfill({ status: 409, json: { error: "sync already running" } });
  });
  await page.goto("/#/inbox");
  await page.locator("aside [data-health]").click();
  const popover = page.getByRole("dialog", { name: "Sync status" });
  await expect(popover).toContainText("Background sync");
  await popover.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => posts).toEqual(["POST"]);
  await expect(page.getByRole("alert").filter({ hasText: "A sync is already running" })).toBeAttached();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A sync is already running" })).toHaveCount(0);
});

// A cancelled GitHub authorization comes back as a real query parameter, outside the hash. It is said once, can be dismissed, and is stripped from the address so a reload does not say it again.
test("a cancelled authorization is reported once and can be dismissed", async ({ page }) => {
  await page.goto("/?oauth_error=access_denied#/inbox");
  const alert = page.getByRole("alert").filter({ hasText: "GitHub authorization was cancelled" });
  await expect(alert).toBeVisible();
  await expect(page).toHaveURL(/\/#\/inbox$/);
  await alert.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(alert).toHaveCount(0);
});

// Theme and language belong to the reader, not to a page, so they live in the account menu. The theme is a pressed-button group that writes the same key public/theme-init.js reads before the first paint; the language is a native select that i18n.ts mirrors into <html lang>.
test("the account menu switches the theme and the language", async ({ page }) => {
  await page.goto("/#/inbox");
  await page.getByRole("button", { name: /^Account: fixture/ }).click();
  const menu = page.getByRole("dialog", { name: "Profile" });
  await expect(menu.getByText("Fixture User")).toBeVisible();
  const theme = menu.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("prdesk-theme"))).toBe("dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 15, 18)");
  await theme.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  expect(await page.evaluate(() => localStorage.getItem("prdesk-theme"))).toBeNull();

  await menu.getByRole("combobox", { name: "Language" }).selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("navigation", { name: "メインナビゲーション" }).getByRole("link", { name: /受信トレイ/ })).toBeVisible();
  // The menu's other exits: About is not a destination in the navigation, so this is where it is reached from. The menu is named in the new language now, so it is found by what it holds.
  const translated = page.getByRole("dialog").filter({ hasText: "Fixture User" });
  await translated.getByRole("link", { name: "PR Desk について" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(translated).toHaveCount(0);
});

// Signed out, the shell is only the brand and the two reader preferences: there is nowhere to navigate to until GitHub is connected.
test("signed out, the shell drops the navigation and keeps the preferences", async ({ page }) => {
  await page.route("**/api/v1/auth/status", (route) => route.fulfill({ json: { connected: false } }));
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.getByRole("button", { name: "Tema: Sistema" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/#/about");
  await expect(page.getByRole("link", { name: "Conectar GitHub" }).first()).toBeVisible();
});

// The pill shows the failure, but a retry sent from it is still a run in flight: the button stays disabled until the server has answered, so a second press cannot post a run the server would refuse with a 409.
test("Sync now stays disabled while a run is in flight after a failed one", async ({ page }) => {
  const posts: string[] = [];
  await page.route("**/api/v1/sync/progress", (route) => route.fulfill({ json: { status: "failed", phase: "account", completed: 0, total: 0, retry_at: 0, error_code: "network", last_synced_at: "2026-09-11T00:00:00Z" } }));
  await page.route("**/api/v1/sync", async (route) => {
    posts.push(route.request().method());
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ json: { status: "queued" } });
  });
  await page.goto("/#/inbox");
  await page.locator("aside [data-health]").click();
  const popover = page.getByRole("dialog", { name: "Sync status" });
  await popover.getByRole("button", { name: "Sync now" }).click();
  await expect(popover.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  expect(posts).toEqual(["POST"]);
});

// An installed window whose session check fails is exactly the stale shell the reload exists for, so the reload and the reader's preferences stay on screen without a session.
test("without a session the installed shell still offers the reload and the language", async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes("display-mode") ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as MediaQueryList) : real(query));
  });
  await page.route("**/api/v1/auth/status", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/#/inbox");
  await expect(page.getByRole("alert").filter({ hasText: "API unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload the app" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveCount(1);
});
