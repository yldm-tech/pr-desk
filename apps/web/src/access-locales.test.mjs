import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { accessLocales } from "./access-locales";

test("access locales have matching keys and interpolation placeholders", () => {
  const expected = Object.keys(accessLocales.en).sort();
  for (const [locale, values] of Object.entries(accessLocales)) {
    assert.deepEqual(Object.keys(values).sort(), expected, locale);
    for (const key of expected) assert.deepEqual(values[key].match(/\{\{[^}]+\}\}/g), accessLocales.en[key].match(/\{\{[^}]+\}\}/g), `${locale}.${key}`);
  }
});
