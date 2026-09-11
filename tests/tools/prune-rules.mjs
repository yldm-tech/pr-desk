// Removes stylesheet rules for classes a component no longer uses, after its
// styles have moved into the markup. Selector groups that also name a class
// still in use keep those members. Usage:
//   node tests/tools/prune-rules.mjs drawer drawerclose            # report
//   node tests/tools/prune-rules.mjs drawer drawerclose --apply    # rewrite
import postcss from "postcss";
import { readFileSync, writeFileSync } from "node:fs";

const dead = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));
const apply = process.argv.includes("--apply");
const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

for (const file of ["apps/web/src/style.css", "apps/web/src/workspace.css"]) {
  const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
  root.walkRules((rule) => {
    const keep = [];
    const drop = [];
    for (const sel of rule.selectors) {
      const classes = classesOf(sel);
      (classes.length && classes.some((c) => dead.has(c)) ? drop : keep).push(sel);
    }
    if (!drop.length) return;
    console.log(`  ${keep.length ? "TRIM" : "DROP"} ${file}:${rule.source.start.line}  ${rule.selector.replace(/\s+/g, " ").slice(0, 72)}`);
    if (!apply) return;
    if (keep.length) rule.selectors = keep;
    else rule.remove();
  });
  root.walkAtRules((at) => {
    if (at.name === "layer" || !at.nodes || at.nodes.length) return;
    console.log(`  EMPTY ${file}:${at.source.start.line} @${at.name} ${at.params}`);
    if (apply) at.remove();
  });
  if (apply) writeFileSync(file, root.toString());
}
