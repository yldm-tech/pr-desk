import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parseOverrides } from "./FollowUpSettings";
import { checkRows, overridesDays, rowsFromDays, rowsToText, textToRows } from "./OverridesEditor";

const plain = (rows) => rows.map(({ repo, days }) => ({ repo, days }));

test("the text form reports the first line that does not parse", () => {
  assert.deepEqual(parseOverrides("fixture/calendar=14\n\n  fixture/reviewer=3  "), { days: { "fixture/calendar": 14, "fixture/reviewer": 3 } });
  assert.deepEqual(parseOverrides("fixture/calendar=14\nbroken-line"), { invalidLine: 2 });
  assert.deepEqual(parseOverrides("fixture/calendar=0"), { invalidLine: 1 });
  assert.deepEqual(parseOverrides("fixture/calendar=366"), { invalidLine: 1 });
  assert.deepEqual(parseOverrides(""), { days: {} });
});

test("rows and text carry the same repository_days both ways", () => {
  const stored = { "fixture/calendar": 14, "acme.io/api-server": 30 };
  const rows = rowsFromDays(stored);
  assert.deepEqual(plain(rows), [
    { repo: "fixture/calendar", days: "14" },
    { repo: "acme.io/api-server", days: "30" },
  ]);
  const text = rowsToText(rows);
  assert.equal(text, "fixture/calendar=14\nacme.io/api-server=30");
  assert.deepEqual(parseOverrides(text), { days: stored });
  const back = textToRows(text);
  assert.ok(Array.isArray(back));
  assert.deepEqual(plain(back), plain(rows));
  assert.deepEqual(checkRows(back), { days: stored });
  // Every row gets its own key, so React and the focus handling can tell a re-created row from the one it replaced.
  assert.equal(new Set([...rows, ...back].map((row) => row.key)).size, 4);
});

test("an empty row is dropped rather than written as a bare separator", () => {
  const rows = [...rowsFromDays({ "fixture/calendar": 14 }), { key: -1, repo: " ", days: "" }];
  assert.equal(rowsToText(rows), "fixture/calendar=14");
  assert.deepEqual(checkRows(rows), { days: { "fixture/calendar": 14 } });
  assert.deepEqual(rowsFromDays(null), []);
});

test("text that does not parse cannot become rows", () => {
  assert.deepEqual(textToRows("fixture/calendar=14\nnot a line"), { invalidLine: 2 });
});

test("each row is checked on its own and names the field that is wrong", () => {
  const rows = [
    { key: 1, repo: "fixture/calendar", days: "14" },
    { key: 2, repo: "not-a-repo", days: "7" },
    { key: 3, repo: "fixture/reviewer", days: "0" },
    { key: 4, repo: "Fixture/Calendar", days: "3" },
    { key: 5, repo: "fixture/other", days: "2.5" },
  ];
  assert.deepEqual(checkRows(rows), { problems: { 2: { repo: "settings.overrideRepoInvalid" }, 3: { days: "settings.overrideDaysInvalid" }, 4: { repo: "settings.overrideDuplicate" }, 5: { days: "settings.overrideDaysInvalid" } } });
});

test("the value saved comes from whichever view is open", () => {
  const rows = rowsFromDays({ "fixture/calendar": 14 });
  assert.deepEqual(overridesDays({ mode: "rows", rows, text: "" }), { days: { "fixture/calendar": 14 } });
  assert.deepEqual(overridesDays({ mode: "text", rows, text: "fixture/reviewer=5" }), { days: { "fixture/reviewer": 5 } });
  assert.deepEqual(overridesDays({ mode: "text", rows, text: "fixture/reviewer=5\nbad" }), { problems: { line: 2 } });
  assert.deepEqual(overridesDays({ mode: "rows", rows: [{ key: 9, repo: "bad", days: "5" }], text: "" }), { problems: { rows: { 9: { repo: "settings.overrideRepoInvalid" } } } });
});
