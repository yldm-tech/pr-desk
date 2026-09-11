// Compares two captures from computed-styles.spec.ts and prints what changed.
// Usage: node tests/tools/compare.mjs before.json after.json [--all]
//
// Differences that cannot reach a pixel are filtered out, because Tailwind
// reaches the same rendering by a different route than the stylesheets did:
//   - its shadow utility keeps transparent ring layers where the CSS said none
//   - its border utilities set a style and colour on edges that have no width
//   - offsets survive on an element the layout has made static
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const showAll = process.argv.includes("--all");
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));

const transparent = /^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/;
const paintedShadow = (value) =>
  value
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter((s) => !transparent.test(s))
    .join(", ") || "none";

const SIDES = ["Top", "Right", "Bottom", "Left"];
const invisible = (prop, a, b, rowA, rowB) => {
  if (prop === "boxShadow") return paintedShadow(a) === paintedShadow(b);
  for (const side of SIDES) {
    if (prop === `border${side}Style` || prop === `border${side}Color`) {
      return rowA[`border${side}Width`] === "0px" && rowB[`border${side}Width`] === "0px";
    }
  }
  if (["top", "right", "bottom", "left"].includes(prop)) return rowA.position === "static" && rowB.position === "static";
  if (prop.startsWith("outline") && prop !== "outlineStyle") return rowA.outlineStyle === "none" && rowB.outlineStyle === "none";
  return false;
};

let changed = 0;
let missing = 0;
let added = 0;
const byProp = new Map();

for (const key of Object.keys(before)) {
  if (!after[key]) {
    missing++;
    if (showAll) console.log(`GONE  ${key}`);
    continue;
  }
  for (const prop of Object.keys(before[key])) {
    const a = before[key][prop];
    const b = after[key][prop];
    if (a === b || invisible(prop, a, b, before[key], after[key])) continue;
    changed++;
    if (!byProp.has(prop)) byProp.set(prop, []);
    byProp.get(prop).push(`${key}\n      ${a}\n   -> ${b}`);
  }
}
for (const key of Object.keys(after)) if (!before[key]) added++;

console.log(`elements: ${Object.keys(before).length} before, ${Object.keys(after).length} after`);
if (missing) console.log(`${missing} elements no longer present`);
if (added) console.log(`${added} elements newly present`);
for (const [prop, entries] of [...byProp].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${prop}  (${entries.length})`);
  for (const entry of entries.slice(0, showAll ? entries.length : 6)) console.log(`  ${entry}`);
  if (!showAll && entries.length > 6) console.log(`  ... ${entries.length - 6} more`);
}
if (!changed && !missing && !added) console.log("no visible computed-style differences");
