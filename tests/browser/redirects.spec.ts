import { expect, test } from "@playwright/test";
import { installFixtures, LEGACY_ROUTES } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// The page each canonical destination prints as its h1, so a redirect is checked for landing on the right page and not only on the right address.
const headings: [RegExp, string][] = [
  [/^\/#\/inbox/, "Inbox"],
  [/^\/#\/prs\/blocked/, "Pull requests"],
  [/^\/#\/prs/, "Pull requests"],
  [/^\/#\/repos/, "Repositories"],
  [/^\/#\/insights/, "Insights"],
  [/^\/#\/settings/, "Settings"],
  [/^\/#\/about/, "About PR Desk"],
];

// Every address the application has ever answered on is somebody's bookmark, and `#/attention?focus=<id>` is what every push notification and digest links to, so each one has to land on its new home with the query intact.
for (const { from, to } of LEGACY_ROUTES) {
  test(`${from} lands on ${to}`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL((url) => url.href.endsWith(to));
    const heading = headings.find(([pattern]) => pattern.test(to))![1];
    // Exactly one page heading, and it is the destination's own.
    await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveText(heading);
  });
}

// The two links the server itself sends and the one trend link the old home page carried are the ones no one can update, so they are named here as well as in the table.
test("the notification links and the old trend link keep their parameters", async ({ page }) => {
  await page.goto("/#/attention?focus=1");
  await expect(page).toHaveURL(/#\/inbox\?focus=1$/);
  await expect(page.locator("#followup-1")).toHaveAttribute("data-active", /.*/);
  await page.goto("/#/?year=2025");
  await expect(page).toHaveURL(/#\/insights\?year=2025$/);
  await expect(page.getByRole("tab", { name: "2025" })).toHaveAttribute("aria-selected", "true");
});

// Rewritten in place: Back from the rewritten address leaves the history entry that came before it rather than returning to the legacy one and redirecting again.
test("a redirect replaces the legacy entry in history", async ({ page }) => {
  await page.goto("/#/about");
  await page.goto("/#/attention?focus=1");
  await expect(page).toHaveURL(/#\/inbox\?focus=1$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/about$/);
});
