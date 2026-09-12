import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { followupLocales } from "./followup-locales";
import { accessLocales } from "./access-locales";
const dir = new URL("./locales/", import.meta.url);
const src = new URL("./", import.meta.url);
const languages = ["en", "zh-CN", "ja", "ko", "es"];
const others = languages.filter((language) => language !== "en");
const plural = /_(zero|one|two|few|many|other)$/;
// Mirror the bundles i18n.ts assembles so the nested follow-up and access namespaces are covered by the same checks as the flat files.
const flatten = (value, prefix = "") => Object.entries(value).flatMap(([key, item]) => (item && typeof item === "object" ? flatten(item, `${prefix}${key}.`) : [[`${prefix}${key}`, item]]));
const bundles = Object.fromEntries(languages.map((language) => [language, Object.fromEntries(flatten({ ...JSON.parse(fs.readFileSync(new URL(`${language}.json`, dir))), followup: followupLocales[language], access: accessLocales[language] }))]));
// Plural suffixes are per language, so compare the stems: English "record"/"records" is one Japanese form and three Spanish ones.
const stems = (language) => [...new Set(Object.keys(bundles[language]).map((key) => key.replace(plural, "")))].sort();
const placeholders = (value) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort();
test("all locale resources match the English key set", () => {
  for (const language of others) assert.deepEqual(stems(language), stems("en"), language);
});
test("counted strings carry the plural categories their language uses", () => {
  const counted = stems("en").filter((stem) => bundles.en[`${stem}_other`] !== undefined);
  assert.ok(counted.length >= 5);
  for (const language of languages) {
    const expected = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
    for (const stem of counted) {
      assert.deepEqual(
        Object.keys(bundles[language])
          .filter((key) => plural.test(key) && key.replace(plural, "") === stem)
          .sort(),
        expected.map((category) => `${stem}_${category}`).sort(),
        `${language}.${stem}`,
      );
      assert.equal(bundles[language][stem], undefined, `${language}.${stem} must not keep a count-less variant`);
    }
  }
  for (const stem of counted) assert.notEqual(bundles.en[`${stem}_one`], bundles.en[`${stem}_other`], stem);
});
test("all locale resources keep the placeholders English interpolates", () => {
  for (const language of others) {
    for (const [key, value] of Object.entries(bundles[language])) {
      const english = bundles.en[key] ?? bundles.en[key.replace(plural, "_other")];
      assert.deepEqual(placeholders(value), placeholders(english), `${language}.${key}`);
    }
  }
});
// A t("key") with no resource renders the key itself: i18next only falls back to English when the key exists there, and tsc never sees these string literals.
test("every translation key used in code is defined", () => {
  const used = new Set();
  for (const file of fs.readdirSync(src).filter((name) => /\.tsx?$/.test(name))) {
    for (const [, key] of fs.readFileSync(new URL(file, src), "utf8").matchAll(/\b(?:t|tr)\(\s*["']([^"']+)["']/g)) used.add(key);
  }
  assert.ok(used.size >= 250);
  const categories = new Intl.PluralRules("en").resolvedOptions().pluralCategories;
  for (const key of used) assert.ok(bundles.en[key] !== undefined || categories.some((category) => bundles.en[`${key}_${category}`] !== undefined), key);
});
// Numbers and dates must follow the language picked in the UI; a bare toLocale*() silently formats with the browser's locale instead. Only components are scanned: pr-model.ts formats a date while parsing a response, where no hook is in reach, and moving that into the component is a change of its own.
test("every component formats numbers and dates through the active language", () => {
  const components = fs.readdirSync(src).filter((name) => name.endsWith(".tsx"));
  assert.ok(components.length >= 15);
  for (const file of components) {
    assert.equal(fs.readFileSync(new URL(file, src), "utf8").match(/\.toLocale(String|TimeString|DateString)\(\s*\)/g), null, file);
  }
});
