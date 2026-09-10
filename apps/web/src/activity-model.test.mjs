import { test } from "node:test";
import assert from "node:assert/strict";
import { safeGitHubLink, checkTone } from "./activity-model.ts";
test("only safe GitHub links are rendered", () => {
  assert.equal(safeGitHubLink("https://github.com/o/r/pull/1"), "https://github.com/o/r/pull/1");
  assert.equal(safeGitHubLink("javascript:alert(1)"), undefined);
  assert.equal(safeGitHubLink("https://github.com.evil.test/o/r"), undefined);
  assert.equal(safeGitHubLink("https://github.com/o/r?x=1"), "https://github.com/o/r?x=1");
});
test("check conclusions map to stable UI tones", () => {
  assert.equal(checkTone("completed", "success"), "success");
  assert.equal(checkTone("completed", "failure"), "failure");
  assert.equal(checkTone("in_progress", ""), "pending");
  assert.equal(checkTone("completed", "neutral"), "success");
});
