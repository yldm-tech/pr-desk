import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { safeGitHubLink, checkTone, activityWarningKeys } from "./activity-model.ts";
// Every warning the API can produce, from the five append sites in apps/api/activity.go.
const serverWarnings = [
  "Conversation: GitHub request unavailable",
  "Review comments: invalid GitHub request",
  "Review status: review thread status unavailable; check GitHub App permissions",
  "Review status: invalid GitHub pagination",
  "Review status: too many review threads",
  "Checks: too many check runs",
  "Checks: too many results; open GitHub for full activity",
];
test("only safe GitHub links are rendered", () => {
  assert.equal(safeGitHubLink("https://github.com/o/r/pull/1"), "https://github.com/o/r/pull/1");
  assert.equal(safeGitHubLink("javascript:alert(1)"), undefined);
  assert.equal(safeGitHubLink("https://github.com.evil.test/o/r"), undefined);
  assert.equal(safeGitHubLink("https://github.com/o/r?x=1"), "https://github.com/o/r?x=1");
});
test("every server warning becomes a translated section and reason", () => {
  const english = JSON.parse(fs.readFileSync(new URL("./locales/en.json", import.meta.url)));
  for (const warning of serverWarnings) {
    const { sectionKey, reasonKey } = activityWarningKeys(warning);
    assert.ok(sectionKey && english[sectionKey], warning);
    assert.ok(reasonKey && english[reasonKey], warning);
  }
  assert.equal(activityWarningKeys("Checks: too many check runs").reasonKey, "activityWarningReason_too_many_checks");
});
test("an unrecognised warning is shown exactly as the server sent it", () => {
  assert.deepEqual(activityWarningKeys("Some review threads could not be read."), { sectionKey: undefined, reasonKey: undefined, section: "", reason: "Some review threads could not be read." });
  assert.equal(activityWarningKeys("Checks: something new").section, "Checks");
  assert.equal(activityWarningKeys("Checks: something new").reasonKey, undefined);
});
test("check conclusions map to stable UI tones", () => {
  assert.equal(checkTone("completed", "success"), "success");
  assert.equal(checkTone("completed", "failure"), "failure");
  assert.equal(checkTone("in_progress", ""), "pending");
  assert.equal(checkTone("completed", "neutral"), "success");
});
