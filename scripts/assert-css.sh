#!/usr/bin/env bash
# Asserts that the responsive system reached the compiled stylesheet.
#
# This exists because of one property of Tailwind v4: a variant name it does not recognise produces no rule and NO error. A typo in `pointer-coarse:`, or a token renamed in the @theme block, leaves source that looks right, a build that succeeds, and a stylesheet in which the rule is simply absent. Source-level greps cannot see that; only the output can.
#
# What is asserted is the escaped CLASS SELECTOR for each variant, not the media query it wraps. That distinction is the whole point and was learned the hard way: asserting `@media (width>=1200px)` passed even after `--breakpoint-wide` was renamed away, because Tailwind's own `.container` utility emits one media query per breakpoint whatever the token is called. `.wide\:` can only be emitted by a working variant named `wide`.
set -uo pipefail

css=(apps/web/dist/assets/*.css)
if [ ! -f "${css[0]}" ]; then
  echo "assert:css: no built stylesheet under apps/web/dist/assets — run the build first"
  exit 1
fi

fail=0
# require <description> <extended-regex>
require() {
  if ! grep -Eqs -- "$2" "${css[@]}"; then
    echo "assert:css: $1"
    fail=1
  fi
}
# refuse <description> <extended-regex>
refuse() {
  if grep -Eqs -- "$2" "${css[@]}"; then
    echo "assert:css: $1"
    fail=1
  fi
}

# Viewport variants. `roomy` is deliberately absent: every use in the source is the `max-roomy:` upper bound, so requiring a bare `roomy:` selector would fail on correct code.
require "no .shell\\: utilities — the 900px breakpoint compiled to nothing and the sidebar can never appear" '\.shell\\:'
require "no .wide\\: utilities — the 1200px breakpoint compiled to nothing" '\.wide\\:'
require "no .max-roomy\\: utilities — the phone-only branch of the top bar compiled to nothing" '\.max-roomy\\:'

# Container variants, each checked with its container name attached, because a name-query whose container is not declared matches nothing at runtime and still compiles happily.
require "no @split/ container utilities — the 480px container token compiled to nothing" '\\@split\\/'
require "no @pair/ container utilities — the 560px container token compiled to nothing" '\\@pair\\/'
require "no @row/ container utilities — the 640px container token compiled to nothing" '\\@row\\/'
require "no @table/ container utilities — the 880px container token compiled to nothing" '\\@table\\/'
require "no @max-split/ container utilities — the narrow branch of the panels compiled to nothing" '\\@max-split\\/'
require "no dashboard container declared, so every @container dashboard query has no ancestor to measure and silently matches nothing" 'container(-name)?: ?dashboard'
require "no chart container declared, so the @pair/chart queries measure nothing" 'container(-name)?: ?chart'
require "no overview container declared, so the @row/overview queries measure nothing" 'container(-name)?: ?overview'

# Capability variants carry the touch and landscape work. If one compiles away the desktop value simply stays in place, which no viewport matrix can detect.
require "no .pointer-coarse\\: utilities — every 44px tap-target floor compiled to nothing" '\.pointer-coarse\\:'
require "no .short\\: utilities — the landscape-phone variant compiled to nothing" '\.short\\:'
require "no .hoverable\\: utilities — hover-only affordances stay permanently hidden on touch" '\.hoverable\\:'
require "no (pointer: coarse) media rule — the global 16px control font that stops iOS focus-zoom is missing" '@media \(pointer: ?coarse\)'

# Safe-area insets are what make viewport-fit=cover in index.html safe rather than harmful. If these vanish while the meta stays, content moves under the notch.
require "no safe-area inset in the output while index.html asks for viewport-fit=cover — content would sit under the notch" 'env\(safe-area-inset-'

# Negative checks: shapes the migration removed, which must not come back.
refuse "a .02 container threshold is back; those were the non-monotonic bounds the named scale replaced" '(760|480|800)\.02'
refuse "a maximum-scale or user-scalable lock reached the output; pinch-zoom is the only text-scaling lever this app offers on mobile Safari" 'user-scalable|maximum-scale'

if [ "$fail" -ne 0 ]; then
  echo "assert:css: the source may look correct — in Tailwind v4 an unrecognised variant emits no rule and no error, which is exactly what this check exists to catch"
  exit 1
fi
