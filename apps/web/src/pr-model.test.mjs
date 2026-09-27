import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { oauthBanner, parsePRList } from "./pr-model.ts";
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
  assert.equal(parsePRPage({ data: [row], total: 55 }).total, 55);
});

// The Blocked pill is the only route that reaches conflicted, changes-requested and failing PRs, and it reaches them through the attention parameter the API has always honoured. A review_status must not be sent with it, or the query narrows to one of the three.
test("the Blocked filter asks the server for the attention set", async () => {
  const { listParameters } = await import("./pr-model.ts");
  const params = new URLSearchParams(listParameters("Blocked", 0));
  assert.equal(params.get("attention"), "true");
  assert.equal(params.has("review_status"), false);
  assert.equal(new URLSearchParams(listParameters("Approved", 0)).has("attention"), false);
  assert.equal(new URLSearchParams(listParameters("Approved", 0)).get("review_status"), "approved");
});

test("a draft is labelled a draft rather than awaiting review", () => {
  const [draft, merged, closed] = parsePRList({
    data: [
      { ...row, draft: true, review_status: "pending" },
      { ...row, draft: true, merged_at: "2026-01-01T00:00:00Z" },
      { ...row, draft: true, state: "closed" },
    ],
    total: 3,
  });
  assert.equal(draft.status, "Draft");
  assert.equal(draft.draft, true);
  // An outcome outranks the draft flag: a draft that landed or was abandoned is not still a draft.
  assert.equal(merged.status, "Merged");
  assert.equal(closed.status, "Closed");
  assert.equal(parsePRList({ data: [{ ...row, review_status: "pending" }], total: 1 })[0].status, "Awaiting review");
});

test("a cancelled authorization is reported once and removed from the URL", () => {
  assert.deepEqual(oauthBanner("?oauth_error=access_denied"), { error: "access_denied", cleanedSearch: "" });
  assert.deepEqual(oauthBanner("?oauth_error=access_denied&repo=foo&page=2"), { error: "access_denied", cleanedSearch: "?repo=foo&page=2" });
  assert.deepEqual(oauthBanner("?connected=1"), { error: null, cleanedSearch: "" });
});
test("a search without OAuth flags is left exactly as it was", () => {
  assert.deepEqual(oauthBanner("?repo=foo&page=2"), { error: null, cleanedSearch: "?repo=foo&page=2" });
  assert.deepEqual(oauthBanner(""), { error: null, cleanedSearch: "" });
});

test("repository filtering composes with attention, search and pagination", async () => {
  const { listParameters } = await import("./pr-model.ts");
  const params = new URLSearchParams(listParameters("Blocked", 2, "fix", "org/tool"));
  assert.equal(params.get("repo"), "org/tool");
  assert.equal(params.get("attention"), "true");
  assert.equal(params.get("search"), "fix");
  assert.equal(params.get("offset"), "100");
  assert.equal(new URLSearchParams(listParameters("All", 0)).has("repo"), false);
});

test("a pull request's glyph puts outcomes first, then what only the author can clear", async () => {
  const { prTone } = await import("./pr-model.ts");
  const base = { merged_at: null, state: "open", draft: false, conflict: false, checks_status: "success", review_status: "pending" };
  assert.deepEqual(prTone({ ...base, merged_at: "2026-01-01T00:00:00Z", conflict: true }), { tone: "neutral", kind: "merged" });
  assert.deepEqual(prTone({ ...base, state: "closed", checks_status: "failure" }), { tone: "neutral", kind: "closed" });
  assert.deepEqual(prTone({ ...base, conflict: true, review_status: "approved" }), { tone: "blocked", kind: "blocked" });
  assert.deepEqual(prTone({ ...base, checks_status: "error" }), { tone: "blocked", kind: "blocked" });
  assert.deepEqual(prTone({ ...base, draft: true, checks_status: "failure" }), { tone: "blocked", kind: "blocked" });
  assert.deepEqual(prTone({ ...base, draft: true, review_status: "review_requested" }), { tone: "neutral", kind: "draft" });
  assert.deepEqual(prTone({ ...base, review_status: "changes_requested" }), { tone: "action", kind: "action" });
  assert.deepEqual(prTone({ ...base, review_status: "review_requested" }), { tone: "waiting", kind: "waiting" });
  assert.deepEqual(prTone({ ...base, review_status: "approved" }), { tone: "ready", kind: "ready" });
  // Only a failure withholds ready: a run still in progress is not a verdict against the change.
  assert.deepEqual(prTone({ ...base, review_status: "approved", checks_status: "pending" }), { tone: "ready", kind: "ready" });
  assert.deepEqual(prTone(base), { tone: "neutral", kind: "open" });
});

test("only a failing or running check earns a chip", async () => {
  const { checksChip } = await import("./pr-model.ts");
  assert.equal(checksChip("failure"), "failing");
  assert.equal(checksChip("error"), "failing");
  assert.equal(checksChip("pending"), "pending");
  for (const quiet of ["success", "inconclusive", "unknown", undefined]) assert.equal(checksChip(quiet), null);
});

test("every status label parsePRList produces has a translation key", async () => {
  const { statusKey } = await import("./pr-model.ts");
  const rows = [{}, { review_status: "review_requested" }, { review_status: "changes_requested" }, { review_status: "approved" }, { review_status: "pending" }, { draft: true }, { state: "closed" }, { merged_at: "2026-01-01T00:00:00Z" }];
  for (const extra of rows) {
    const [pr] = parsePRList({ data: [{ ...row, ...extra }], total: 1 });
    assert.notEqual(statusKey(pr.status), pr.status, pr.status);
  }
  assert.equal(statusKey("Something new"), "Something new");
});
