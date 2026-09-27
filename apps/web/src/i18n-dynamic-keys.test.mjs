import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import en from "./locales/en.json" with { type: "json" };
import { followupLocales } from "./followup-locales";
import { activityWarningKeys } from "./activity-model.ts";
import { followUpGroups, inboxRoles, inboxStatuses, reasonTones } from "./followup-view.ts";

// Keys built at runtime (`followup.${reason}`, `syncPhase_${phase}` …) are invisible to the used-key scan in locales.test.mjs, which only reads string literals, and a missing one renders the raw key on screen. Each family is enumerated here from the code list that feeds it, so adding a value to the code without its English word fails a test instead of a reader's eyes.
const followup = followupLocales.en;
const source = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const listIn = (text, pattern, label) => {
  const match = pattern.exec(text);
  assert.ok(match, `the ${label} list is where this test expects it`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
};
const has = (key, bundle) => assert.ok(typeof bundle[key] === "string" && bundle[key].length > 0, key);

test("every reason, group, status and role has its English word", () => {
  for (const reason of Object.keys(reasonTones)) has(reason, followup);
  for (const group of followUpGroups) has(group, followup);
  for (const status of inboxStatuses) has(status, followup);
  for (const role of inboxRoles) has(role, followup);
});

test("every notification channel has its label and its help text", () => {
  const channels = listIn(source("./FollowUpSettings.tsx"), /const channels = \[([^\]]+)\]/, "channel");
  assert.ok(channels.length >= 4);
  for (const kind of channels) {
    has(`${kind}Help`, followup);
    has(`channel${kind[0].toUpperCase()}${kind.slice(1)}`, followup);
  }
});

test("every sync phase has its label", () => {
  const phases = listIn(source("./SyncProgress.tsx"), /phase: z\.enum\(\[([^\]]+)\]\)/, "sync phase");
  assert.ok(phases.length >= 6);
  for (const phase of [...phases, "incremental"]) has(`syncPhase_${phase}`, en);
});

test("every check conclusion and running status the activity panel names has its word", () => {
  const model = source("./activity-model.ts");
  const conclusions = [...model.matchAll(/\[((?:"[a-z_]+",?\s*)+)\]\.includes\(conclusion\)/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));
  assert.ok(conclusions.length >= 9);
  // The panel looks a conclusion up as written and a status with its underscores removed ("in_progress" -> "inprogress").
  for (const conclusion of conclusions) has(conclusion, en);
  for (const status of ["queued", "in_progress", "pending"]) has(status.replaceAll("_", ""), en);
});

test("every partial-activity warning the API can send translates both halves", () => {
  // The five append sites in apps/api/activity.go, the same list activity-model.test.mjs pins.
  const warnings = [
    "Conversation: GitHub request unavailable",
    "Review comments: invalid GitHub request",
    "Review status: review thread status unavailable; check GitHub App permissions",
    "Review status: invalid GitHub pagination",
    "Review status: too many review threads",
    "Checks: too many check runs",
    "Checks: too many results; open GitHub for full activity",
  ];
  for (const warning of warnings) {
    const { sectionKey, reasonKey } = activityWarningKeys(warning);
    assert.ok(sectionKey && reasonKey, warning);
    has(sectionKey, en);
    has(reasonKey, en);
  }
});
