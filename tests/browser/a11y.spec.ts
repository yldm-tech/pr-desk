import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installFixtures, ROUTES } from "./fixtures";

// Every route in both themes against WCAG 2 A and AA. The token pairs are unit-tested in tokens.test.mjs; this is the check that the pages actually use them, and that names, roles, landmarks and headings hold together once everything is rendered.
for (const scheme of ["light", "dark"] as const) {
  for (const route of ROUTES) {
    test(`${scheme}: ${route} has no WCAG A or AA violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await installFixtures(page);
      await page.goto(route);
      await expect(page.locator("main").getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".react-loading-skeleton")).toHaveCount(0);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const report = results.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
      expect(report).toEqual([]);
      // A run that checked nothing would also report nothing.
      expect(results.passes.length).toBeGreaterThan(10);
    });
  }
}
