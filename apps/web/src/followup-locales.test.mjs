import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { followupLocales } from "./followup-locales";

test("follow-up locales have matching keys and interpolation placeholders", () => {
  const expected = Object.keys(followupLocales.en).sort();
  for (const [locale, values] of Object.entries(followupLocales)) {
    assert.deepEqual(Object.keys(values).sort(), expected, locale);
    for (const key of expected) assert.deepEqual(values[key].match(/\{\{[^}]+\}\}/g), followupLocales.en[key].match(/\{\{[^}]+\}\}/g), `${locale}.${key}`);
  }
});
