import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The colour tokens are only as accessible as the pairs they are used in, and a hex nudged in style.css passes review by eye. These tests read the stylesheet itself, so a change that breaks a pair fails here with the ratio in the message.
const css = fs.readFileSync(new URL("./style.css", import.meta.url), "utf8");

// The body of the first rule whose selector text is exactly `selector`, braces matched. Token blocks hold no nested rules, so the first closing brace after the opening one ends it.
function block(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `style.css has no "${selector}" block`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}
function declarations(body) {
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const light = declarations(block(":root"));
const systemDark = declarations(block(':root:not([data-theme="light"])'));
const explicitDark = declarations(block(':root[data-theme="dark"]'));

test("the dark theme is written twice with identical bodies", () => {
  assert.ok(Object.keys(systemDark).length >= 30);
  assert.deepEqual(explicitDark, systemDark);
  assert.match(block(':root:not([data-theme="light"])'), /color-scheme:\s*dark/);
  assert.match(block(':root[data-theme="dark"]'), /color-scheme:\s*dark/);
  // The system block has to be the media-scoped one; unscoped, it would override an explicit light choice everywhere.
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
});

test("every colour token the light theme defines as a value is redefined for dark", () => {
  const themed = Object.keys(light).filter((name) => /^(#|rgb\(|url\()/.test(light[name]));
  for (const name of themed) assert.ok(systemDark[name] !== undefined, `${name} has no dark value`);
});

const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is not a six-digit hex colour`);
  const [r, g, b] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// Text pairs need 4.5:1 (WCAG AA body text); control borders and the focus ring are non-text and need 3:1. The grounds a pair is checked on are every surface that ink is actually painted on.
const grounds = ["--bg", "--bg-subtle", "--bg-muted", "--surface"];
const text = [
  ...["--fg", "--fg-muted", "--fg-subtle", "--accent-text", "--tone-blocked", "--tone-action", "--tone-waiting", "--tone-ready", "--tone-neutral"].flatMap((ink) => grounds.map((ground) => [ink, ground])),
  ["--accent-text", "--accent-subtle"],
  ["--accent-fg", "--accent"],
  ["--accent-fg", "--accent-hover"],
  ["--tone-blocked", "--tone-blocked-soft"],
  ["--tone-action", "--tone-action-soft"],
  ["--tone-ready", "--tone-ready-soft"],
  ...["--tone-blocked-soft", "--tone-action-soft", "--tone-waiting-soft", "--tone-ready-soft", "--info-soft", "--accent-subtle"].flatMap((soft) => [
    ["--fg", soft],
    ["--fg-muted", soft],
  ]),
];
// line-strong is deliberately not paired with bg-muted in light (2.93): bordered controls never sit on that fill.
const nonText = [
  ["--line-strong", "--bg"],
  ["--line-strong", "--bg-subtle"],
  ["--line-strong", "--surface"],
  ["--focus", "--bg"],
  ["--focus", "--bg-subtle"],
  ["--focus", "--surface"],
  ["--accent-text", "--info-soft"],
];

for (const [name, theme] of [
  ["light", light],
  ["dark", { ...light, ...systemDark }],
]) {
  test(`${name} text pairs meet 4.5:1`, () => {
    for (const [ink, ground] of text) {
      const ratio = contrast(theme[ink], theme[ground]);
      assert.ok(ratio >= 4.5, `${name}: ${ink} on ${ground} is ${ratio.toFixed(2)}:1`);
    }
  });
  test(`${name} control borders and the focus ring meet 3:1`, () => {
    for (const [ink, ground] of nonText) {
      const ratio = contrast(theme[ink], theme[ground]);
      assert.ok(ratio >= 3, `${name}: ${ink} against ${ground} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test("the canvas colours match the browser chrome colours", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(`name="theme-color" content="${light["--bg"]}" media="\\(prefers-color-scheme: light\\)"`, "i"));
  assert.match(html, new RegExp(`name="theme-color" content="${systemDark["--bg"]}" media="\\(prefers-color-scheme: dark\\)"`, "i"));
  // The pre-paint script must be a file (the API's CSP refuses inline scripts) and must come after the metas it rewrites.
  assert.ok(html.indexOf('src="/theme-init.js"') > html.lastIndexOf('name="theme-color"'));
});

test("the migration aliases the older pages read are gone, and nothing reads them", () => {
  const aliases = [
    "--canvas",
    "--surface-muted",
    "--foreground",
    "--muted",
    "--border",
    "--border-subtle",
    "--accent-soft",
    "--accent-border",
    "--success",
    "--success-soft",
    "--success-border",
    "--warning",
    "--warning-soft",
    "--warning-border",
    "--danger",
    "--danger-soft",
    "--info",
    "--hero",
    "--hero-muted",
    "--hero-text",
    "--hero-border",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--chart-other",
    "--select-chevron",
    "--skeleton-hero-base",
    "--skeleton-hero-highlight",
  ];
  aliases.push("--text-heading", "--shadow");
  // Every page is on the theme tokens now, so an alias that came back would be a second name for a colour, and a read of a deleted one would silently fall back to nothing.
  const sources = fs
    .readdirSync(new URL(".", import.meta.url))
    .filter((name) => /\.(ts|tsx|css)$/.test(name))
    .map((name) => [name, fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8")]);
  for (const alias of aliases) {
    assert.equal(light[alias], undefined, `${alias} is still declared in :root`);
    const reader = new RegExp(`var\\(${alias}\\)|\\(${alias}\\)`);
    for (const [name, text] of sources) assert.doesNotMatch(text, reader, `${name} still reads ${alias}`);
  }
});
