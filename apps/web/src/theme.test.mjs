import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { THEME_STORAGE_KEY, parseThemePref, resolveTheme, themeColors } from "./theme.ts";

test("an explicit choice wins over the system theme", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("system follows the operating system", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("anything stored that is not light or dark means system", () => {
  assert.equal(parseThemePref("light"), "light");
  assert.equal(parseThemePref("dark"), "dark");
  for (const value of [null, undefined, "", "system", "Dark", "sepia", 1]) assert.equal(parseThemePref(value), "system");
});

// theme-init.js runs before the bundle and cannot import from it, so the key and the two colours are written out twice. This keeps the copies honest.
test("the pre-paint script agrees with theme.ts", () => {
  const script = fs.readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
  assert.ok(script.includes(`"${THEME_STORAGE_KEY}"`));
  assert.ok(script.includes(`"${themeColors.dark}"`));
  assert.ok(script.includes(`"${themeColors.light}"`));
  const css = fs.readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, new RegExp(`:root \\{[^}]*--bg: ${themeColors.light};`, "i"));
  assert.match(css, new RegExp(`:root\\[data-theme="dark"\\] \\{[^}]*--bg: ${themeColors.dark};`, "i"));
});

test("the service worker pre-caches the pre-paint script with the shell", () => {
  const worker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /const SHELL_CACHE = "prdesk-shell-v2"/);
  assert.match(worker, /THEME_INIT_URL = "\/theme-init.js"/);
  assert.match(worker, /addAll\(\[new Request\(SHELL_URL[^\]]*THEME_INIT_URL/);
});
