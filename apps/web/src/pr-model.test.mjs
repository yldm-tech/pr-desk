import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parsePRList } from "./pr-model.ts";
const row = { id: 9, number: 81, repo: "https://api.github.com/repos/org/repo", title: "Example", state: "open" };

test("PR links reject executable and off-site URLs", () => {
  for (const url of ["javascript:alert(1)", "https://github.com.evil.test/o/r", "https://user:password@github.com/o/r", "data:text/html,test"]) {
    assert.equal(parsePRList({ data: [{ ...row, url }], total: 1 })[0].url, undefined);
  }
  assert.equal(parsePRList({ data: [{ ...row, url: "https://github.com/o/r/pull/1" }], total: 1 })[0].url, "https://github.com/o/r/pull/1");
});

test("empty nullable API collection is a valid empty list", () => {
  assert.deepEqual(parsePRList({ data: null, total: 0 }), []);
});
test("merged and closed states override an old approval", () => {
  const [merged, closed] = parsePRList({
    data: [
      { ...row, merged_at: "2026-01-01T00:00:00Z", review_status: "approved" },
      { ...row, state: "closed", review_status: "approved" },
    ],
    total: 2,
  });
  assert.equal(merged.status, "Merged");
  assert.equal(closed.status, "Closed");
});
test("database ID stays distinct from GitHub PR number", () => {
  const [pr] = parsePRList({ data: [row], total: 1 });
  assert.equal(pr.id, 9);
  assert.equal(pr.number, 81);
  assert.equal(pr.repo, "org/repo");
});
test("missing database ID is rejected rather than requesting activity for zero", () => {
  assert.throws(() => parsePRList({ data: [{ ...row, id: undefined }], total: 1 }));
});
test("unknown dates and absent counts have explicit fallbacks", () => {
  const [pr] = parsePRList({ data: [{ ...row, updated_at: "invalid" }], total: 1 });
  assert.equal(pr.updated, "Unknown");
  assert.equal(pr.comments, 0);
  assert.equal(pr.conflict, false);
});

test("pagination and filters are sent to the backend", async () => {
  const { listParameters, parsePRPage } = await import("./pr-model.ts");
  assert.equal(new URLSearchParams(listParameters("All", 1)).get("offset"), "50");
  assert.equal(new URLSearchParams(listParameters("Needs attention", 0)).get("attention"), "true");
  assert.equal(parsePRPage({ data: [row], total: 55 }).total, 55);
});

test("repository filtering composes with attention, search and pagination", async () => {
  const { listParameters } = await import("./pr-model.ts");
  const params = new URLSearchParams(listParameters("Needs attention", 2, "fix", "org/tool"));
  assert.equal(params.get("repo"), "org/tool");
  assert.equal(params.get("attention"), "true");
  assert.equal(params.get("search"), "fix");
  assert.equal(params.get("offset"), "100");
  assert.equal(new URLSearchParams(listParameters("All", 0)).has("repo"), false);
});
