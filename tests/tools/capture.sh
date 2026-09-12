#!/usr/bin/env bash
# Runs the comparison harness and writes one merged JSON of every capture.
# Usage: tests/tools/capture.sh out.json
set -euo pipefail
out="${1:?usage: capture.sh out.json}"
tmp="$(mktemp)"
bunx playwright test -c playwright.tools.config.ts 2>/dev/null | sed -n 's/^SNAPSHOT //p' > "$tmp"
node -e '
const fs = require("node:fs");
const merged = {};
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) if (line.trim()) Object.assign(merged, JSON.parse(line));
fs.writeFileSync(process.argv[2], JSON.stringify(merged));
console.log(Object.keys(merged).length + " elements captured");
' "$tmp" "$out"
rm -f "$tmp"
