import { expect, test } from "@playwright/test";
import { installFixtures } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

const DARK_BG = "rgb(15, 15, 18)";
const LIGHT_BG = "rgb(255, 255, 255)";

const metas = (page: import("@playwright/test").Page) => page.locator('meta[name="theme-color"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content")));

// With no choice stored, the system scheme decides, and the window chrome keeps one colour per scheme.
test("a dark system scheme renders the dark canvas", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/#/inbox");
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_BG);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  expect(await metas(page)).toEqual(["#FFFFFF", "#0F0F12"]);
});

// public/theme-init.js runs before the bundle, so an explicit choice is on <html> before any stylesheet can paint the system theme. Sampled at DOMContentLoaded, which the dev server reaches before it has injected a single style.
test("a stored light choice wins over a dark system scheme before the first paint", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("prdesk-theme", "light");
    document.addEventListener("DOMContentLoaded", () => {
      const sample = { theme: document.documentElement.dataset.theme ?? null, metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((node) => node.getAttribute("content")) };
      (window as unknown as { __themeAtLoad: typeof sample }).__themeAtLoad = sample;
    });
  });
  await page.goto("/#/inbox");
  const atLoad = await page.evaluate(() => (window as unknown as { __themeAtLoad: { theme: string | null; metas: string[] } }).__themeAtLoad);
  expect(atLoad).toEqual({ theme: "light", metas: ["#FFFFFF", "#FFFFFF"] });
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT_BG);
});

// The theme-color metas colour the browser chrome above the sticky top bar, so they follow every change of choice: pinned to one colour for an explicit theme, and back to the pair for System.
test("changing the theme rewrites the theme-color metas", async ({ page }) => {
  await page.goto("/#/inbox");
  expect(await metas(page)).toEqual(["#FFFFFF", "#0F0F12"]);
  await page.getByRole("button", { name: /^Account: fixture/ }).click();
  const theme = page.getByRole("dialog", { name: "Profile" }).getByRole("group", { name: "Theme" });
  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_BG);
  await expect.poll(() => metas(page)).toEqual(["#0F0F12", "#0F0F12"]);
  await theme.getByRole("button", { name: "Light" }).click();
  await expect.poll(() => metas(page)).toEqual(["#FFFFFF", "#FFFFFF"]);
  await theme.getByRole("button", { name: "System" }).click();
  await expect.poll(() => metas(page)).toEqual(["#FFFFFF", "#0F0F12"]);
});

// A choice survives a reload: the key the account menu writes is the one the pre-paint script reads.
test("a dark choice survives a reload", async ({ page }) => {
  await page.goto("/#/inbox");
  await page.evaluate(() => localStorage.setItem("prdesk-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_BG);
  expect(await metas(page)).toEqual(["#0F0F12", "#0F0F12"]);
});

// Windows high contrast: the compiled rule has to reach the computed style, not just exist. A chip keeps the system text colour however light the theme the reader picked in the app, and a selected filter and the current page carry an outline, because the surface and shadow that mark them otherwise are flattened.
test("forced colours give chips the text colour and mark every selected state", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("prdesk-theme", "light"));
  await page.goto("/#/inbox?status=all");
  const chip = page.getByTestId("follow-up-card").locator("[data-tone]").first();
  await expect(chip).toBeVisible();
  const ink = await page.locator("body").evaluate((node) => getComputedStyle(node).color);
  await expect(chip).toHaveCSS("color", ink);
  const pressed = page.getByRole("group", { name: "Role" }).getByRole("button", { name: "All" });
  await expect(pressed).toHaveAttribute("aria-pressed", "true");
  await expect(pressed).toHaveCSS("outline-style", "solid");
  await expect(page.getByRole("group", { name: "Role" }).getByRole("button", { name: "My reviews" })).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Inbox/ })).toHaveCSS("outline-style", "solid");
});
