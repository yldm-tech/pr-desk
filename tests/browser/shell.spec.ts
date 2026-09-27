import { expect, test } from "@playwright/test";
import { installFixtures, LEGACY_ROUTES } from "./fixtures";

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
  await expect(page.getByRole("heading", { level: 1, name: "Needs attention" })).toBeVisible();
  await expect(page.getByTestId("follow-up-card")).toHaveCount(4);
});

// Every address the application has ever answered on is somebody's bookmark, and `#/attention?focus=<id>` is what every push notification and digest links to, so each one has to land on its new home with the query intact and without leaving the old address in history.
test("every legacy address lands on its new home with the query intact", async ({ page }) => {
  for (const { from, to } of LEGACY_ROUTES) {
    await page.goto(from);
    await expect(page, from).toHaveURL((url) => url.href.endsWith(to));
    await expect(page.locator("main h1"), from).toBeVisible();
  }
  // Rewritten in place: Back from the rewritten address leaves the history entry that came before it rather than returning to the legacy one and redirecting again.
  await page.goto("/#/about");
  await page.goto("/#/attention?focus=1");
  await expect(page).toHaveURL(/#\/inbox\?focus=1$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/about$/);
});

// A tab strip or a history list shows the title and nothing else, so it names the view as specifically as the page heading does.
test("the document title names the page and the view", async ({ page }) => {
  for (const [route, title] of [
    ["/#/inbox", "Needs attention · PR Desk"],
    ["/#/prs", "My pull requests · PR Desk"],
    ["/#/prs/blocked", "Blocked · My pull requests · PR Desk"],
    ["/#/repos", "Repositories · PR Desk"],
    ["/#/insights", "Overview · PR Desk"],
    ["/#/settings?tab=access", "Settings · PR Desk"],
    ["/#/about", "About · PR Desk"],
  ]) {
    await page.goto(route);
    await expect(page, route).toHaveTitle(title);
  }
});

// The navigation returns to where each destination was left, so moving between them does not throw away a filtered view.
test("the navigation returns to the view and filters each destination was left on", async ({ page }) => {
  await page.goto("/#/prs/blocked?repo=fixture/reviewer");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: /Needs attention/ }).click();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(navigation.getByRole("button", { name: /Needs attention/ })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("button", { name: "My pull requests" }).click();
  await expect(page).toHaveURL((url) => url.href.endsWith("/#/prs/blocked?repo=fixture/reviewer"));
  await expect(navigation.getByRole("button", { name: "My pull requests" })).toHaveAttribute("aria-current", "page");
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
  await expect(page.getByRole("heading", { level: 1, name: "Needs attention" })).toBeVisible();
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
