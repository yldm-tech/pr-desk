import { expect, test } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

// The contribution overview moved from the landing page to its own route. Changing the year is a parameter of that route, so it survives a reload and a shared link.
test("insights switches the contribution year from its tab", async ({ page }, testInfo) => {
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
  await page.getByRole("tab", { name: "2025", exact: true }).click();
  await expect(page).toHaveURL(/#\/insights\?year=2025$/);
  await expect(page.getByRole("tab", { name: "2025", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("insights.png"), fullPage: true });
});

// The outcome legend counted sets the interface had no way to open; each count it can open is a link to the list that holds it.
test("insights names its report and opens what it counts", async ({ page }) => {
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contribution overview" })).toBeVisible();
  await page.getByRole("link", { name: "Merged", exact: true }).click();
  await expect(page).toHaveURL(/#\/prs\/merged$/);
});
