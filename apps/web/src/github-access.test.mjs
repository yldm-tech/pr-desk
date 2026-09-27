import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { accessFingerprint, createAccessWatcher, installHref, privateAccessMissing } from "./github-access.ts";

const calendar = { account: "fixture", repository_selection: "all", can_read_prs: true, settings_url: "https://github.com/settings/installations/1" };
const reviewer = { account: "acme", repository_selection: "selected", can_read_prs: false, settings_url: "https://github.com/organizations/acme/settings/installations/2" };

test("the fingerprint ignores order and settings links, and nothing else", () => {
  const base = { has_installations: true, can_read_private: true, installations: [calendar, reviewer] };
  assert.equal(accessFingerprint(base), accessFingerprint({ ...base, installations: [reviewer, calendar] }));
  assert.equal(accessFingerprint(base), accessFingerprint({ ...base, installations: [{ ...calendar, settings_url: "https://example.test/other" }, reviewer] }));
  assert.equal(accessFingerprint(base), accessFingerprint({ ...base, install_url: "https://github.com/apps/pr-desk/installations/new" }));
  assert.notEqual(accessFingerprint(base), accessFingerprint({ ...base, can_read_private: false }));
  assert.notEqual(accessFingerprint(base), accessFingerprint({ ...base, installations: [calendar, { ...reviewer, can_read_prs: true }] }));
  assert.notEqual(accessFingerprint(base), accessFingerprint({ ...base, installations: [calendar, { ...reviewer, repository_selection: "all" }] }));
  assert.notEqual(accessFingerprint(base), accessFingerprint({ ...base, installations: [calendar] }));
});

test("a missing permission flag and an empty list read the same as false and none", () => {
  assert.equal(accessFingerprint({ has_installations: false }), accessFingerprint({ has_installations: false, can_read_private: false, installations: [] }));
});

// Arriving on a page is not a grant, so the first answer only seeds the watcher.
test("the first answer never starts a sync, even when it can read private repositories", () => {
  const observe = createAccessWatcher();
  assert.equal(observe({ has_installations: true, can_read_private: true, installations: [calendar] }), false);
});

test("a grant fires once, however many pages read the same answer", () => {
  const observe = createAccessWatcher();
  const before = { has_installations: true, can_read_private: false, installations: [reviewer] };
  const after = { has_installations: true, can_read_private: true, installations: [{ ...reviewer, can_read_prs: true }] };
  assert.equal(observe(before), false);
  // Insights and Settings both mounted: each effect sees the new answer, and only the first one starts the full sync.
  assert.equal(observe(after), true);
  assert.equal(observe(after), false);
  // A refetch that only reorders or relinks is not a new grant.
  assert.equal(observe({ ...after, installations: [{ ...after.installations[0], settings_url: "https://example.test/moved" }] }), false);
});

test("a change that still cannot read private repositories starts nothing, and the grant after it still fires", () => {
  const observe = createAccessWatcher();
  assert.equal(observe({ has_installations: false, can_read_private: false, installations: [] }), false);
  assert.equal(observe({ has_installations: true, can_read_private: false, installations: [reviewer] }), false);
  assert.equal(observe({ has_installations: true, can_read_private: true, installations: [calendar, reviewer] }), true);
});

test("losing access and getting it back is a second grant", () => {
  const observe = createAccessWatcher();
  const readable = { has_installations: true, can_read_private: true, installations: [calendar] };
  assert.equal(observe(readable), false);
  assert.equal(observe({ has_installations: false, can_read_private: false, installations: [] }), false);
  assert.equal(observe(readable), true);
});

test("private access is missing only on an answer that says so", () => {
  assert.equal(privateAccessMissing(undefined), false);
  assert.equal(privateAccessMissing({ has_installations: false }), true);
  assert.equal(privateAccessMissing({ has_installations: true, can_read_private: false }), true);
  assert.equal(privateAccessMissing({ has_installations: true, can_read_private: true }), false);
  // An older server that does not report the permission flag is not treated as missing access.
  assert.equal(privateAccessMissing({ has_installations: true }), false);
});

test("the install link prefers the app's own page and falls back to GitHub's installation list", () => {
  assert.equal(installHref({ has_installations: false, install_url: "https://github.com/apps/pr-desk/installations/new" }), "https://github.com/apps/pr-desk/installations/new");
  assert.equal(installHref({ has_installations: false, install_url: "" }), "https://github.com/settings/installations");
  assert.match(installHref(undefined), /\/api\/v1\/repository-access\/install$/);
});
