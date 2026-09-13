import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { followupLocales } from "./followup-locales";
import { reasonTones } from "./followup-view.ts";

// A counted string does not have the same key in every language: i18next resolves `key` plus the plural category the count falls into, and the set of categories is a property of the language. So parity is compared on stems, and the categories themselves are checked against Intl rather than against English. This mirrors the rule locales.test.mjs already applies to the flat bundles.
const plural = /_(zero|one|two|few|many|other)$/;
const stems = (values) => [...new Set(Object.keys(values).map((key) => key.replace(plural, "")))].sort();
const placeholders = (value) => value.match(/\{\{[^}]+\}\}/g);

test("follow-up locales have matching keys and interpolation placeholders", () => {
  const expected = stems(followupLocales.en);
  for (const [locale, values] of Object.entries(followupLocales)) {
    assert.deepEqual(stems(values), expected, locale);
    for (const [key, value] of Object.entries(values)) {
      // A translated plural variant is compared against the English variant of the same category when there is one, and against English's _other otherwise: es has a `many` category English does not.
      const english = followupLocales.en[key] ?? followupLocales.en[key.replace(plural, "_other")];
      assert.ok(english !== undefined, `${locale}.${key} has no English counterpart`);
      assert.deepEqual(placeholders(value), placeholders(english), `${locale}.${key}`);
    }
  }
});

// The parity test above compares the five languages against each other, so a key missing from all five is parity-clean — which is exactly how `changes_requested` shipped rendering as the literal "followup.changes_requested" on the card. Reason chips are looked up as `followup.${reason}`, and `reasonTones` is the one enumeration of the reasons the server can actually raise, so tying the vocabulary to it is the only assertion that can fail on a word no language has.
test("every reason the server can raise has an English word", () => {
  const missing = Object.keys(reasonTones).filter((reason) => followupLocales.en[reason] === undefined);
  assert.deepEqual(missing, []);
});

test("counted follow-up strings carry the plural categories their language uses", () => {
  const counted = stems(followupLocales.en).filter((stem) => followupLocales.en[`${stem}_other`] !== undefined);
  // Guards against the rule silently covering nothing if the suffixes are ever dropped.
  assert.ok(counted.length >= 1);
  for (const [locale, values] of Object.entries(followupLocales)) {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const stem of counted) {
      assert.deepEqual(
        Object.keys(values)
          .filter((key) => plural.test(key) && key.replace(plural, "") === stem)
          .sort(),
        categories.map((category) => `${stem}_${category}`).sort(),
        `${locale}.${stem}`,
      );
      // A bare stem alongside the suffixed set would win for some counts and reintroduce the ungrammatical form the suffixes exist to remove.
      assert.equal(values[stem], undefined, `${locale}.${stem} must not keep a count-less variant`);
    }
  }
  // If these were identical the suffixes would be decoration; "Waiting 1 days" is the bug they were added for.
  for (const stem of counted) assert.notEqual(followupLocales.en[`${stem}_one`], followupLocales.en[`${stem}_other`], stem);
});
