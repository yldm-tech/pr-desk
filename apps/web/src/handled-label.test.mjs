import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { followupLocales } from "./followup-locales";
import { inboxLocales } from "./inbox-locales";

// The Handled button shows a short label and keeps the long verb ("Handled · wait for others — repo #n") as its accessible name, because that is the CLI and MCP verb and the name the tests and screen readers address it by. WCAG 2.5.3 (label in name) requires the visible words to be where the name starts, so a speech user who says "click Handled" reaches it: the short label has to be the leading phrase of the long one, ending at a separator rather than in the middle of a word.
test("the visible Handled label is the leading phrase of its accessible name in every language", () => {
  for (const language of Object.keys(inboxLocales)) {
    const short = inboxLocales[language].handledShort;
    const long = followupLocales[language].handled;
    assert.ok(short, `${language} has a short label`);
    assert.ok(long.startsWith(short), `${language}: "${long}" starts with "${short}"`);
    const rest = long.slice(short.length);
    assert.ok(rest === "" || /^[\s·・，,、:：]/.test(rest), `${language}: "${short}" ends at a phrase boundary of "${long}"`);
  }
});
