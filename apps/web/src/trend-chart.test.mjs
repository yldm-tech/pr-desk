import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fillMonths } from "./TrendChart.tsx";

const now = new Date("2026-09-27T12:00:00Z");

test("the current year is the thirteen months ending with this one, zero where nothing merged", () => {
  const months = fillMonths([{ month: "2026-09", merged: 10 }], 2026, now);
  assert.equal(months.length, 13);
  assert.deepEqual(months[0], { month: "2025-09", merged: 0 });
  assert.deepEqual(months.at(-1), { month: "2026-09", merged: 10 });
  assert.equal(
    months.reduce((sum, item) => sum + item.merged, 0),
    10,
  );
});

test("a past year is January to December", () => {
  const months = fillMonths([{ month: "2025-03", merged: 2 }], 2025, now);
  assert.deepEqual(
    months.map((item) => item.month),
    ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"],
  );
  assert.equal(months[2].merged, 2);
});

test("months the server sent outside the expected period are kept, in order, and none is doubled", () => {
  const months = fillMonths(
    [
      { month: "2024-12", merged: 1 },
      { month: "2025-01", merged: 3 },
    ],
    2025,
    now,
  );
  assert.equal(months.length, 13);
  assert.deepEqual(months.slice(0, 2), [
    { month: "2024-12", merged: 1 },
    { month: "2025-01", merged: 3 },
  ]);
});

test("the turn of the year is filled across the boundary", () => {
  const months = fillMonths([], 2027, new Date("2027-01-15T00:00:00Z"));
  assert.equal(months[0].month, "2026-01");
  assert.equal(months.at(-1).month, "2027-01");
  assert.equal(months.length, 13);
});
