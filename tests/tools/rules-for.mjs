// Prints every stylesheet rule that can apply to the classes a component uses,
// with the media or container query it sits in and the file order that decides
// which of two equal-specificity rules wins. Usage:
//   node tests/tools/rules-for.mjs apps/web/src/UserMenu.tsx
import postcss from "postcss";
import { readFileSync } from "node:fs";

const files = ["apps/web/src/style.css", "apps/web/src/workspace.css"];
const source = readFileSync(process.argv[2], "utf8");
const used = new Set();
for (const m of source.matchAll(/className=\{?[`"]([^`"]+)[`"]/g)) for (const c of m[1].split(/\s+/)) if (c && !c.includes("{")) used.add(c);

const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
const context = (node) => {
  const parts = [];
  for (let p = node.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule" && p.name !== "layer") parts.unshift(`@${p.name} ${p.params}`);
  return parts.join(" / ");
};

console.log(`classes used by ${process.argv[2]}:\n  ${[...used].join(" ")}\n`);
let order = 0;
for (const file of files) {
  postcss.parse(readFileSync(file, "utf8"), { from: file }).walkRules((rule) => {
    if (!rule.selectors.some((s) => classesOf(s).some((c) => used.has(c)))) return;
    const ctx = context(rule);
    console.log(`/* #${++order}  ${file}:${rule.source.start.line}${ctx ? "  " + ctx : ""} */`);
    console.log(rule.toString().replace(/\n\s+/g, "\n  "), "\n");
  });
}
console.log(`${order} rules, listed in the order the browser sees them: a later one wins a tie.`);
