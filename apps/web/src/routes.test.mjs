import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { destinationOf, legacyRedirect, paths, prFilterOf, prViewFromPath, prViewPath, prViews } from "./routes.ts";

test("every PR view has one path and reads back from it", () => {
  assert.equal(prViewPath("open"), "/prs");
  assert.equal(prViewPath("blocked"), "/prs/blocked");
  for (const view of prViews) assert.equal(prViewFromPath(prViewPath(view)), view, view);
});

test("an address that is not a PR view is not read as one", () => {
  for (const pathname of ["/prs/open", "/prs/", "/prs/unknown", "/prs/blocked/extra", "/prsx", "/pull-requests", "/blocked", "/"]) assert.equal(prViewFromPath(pathname), null, pathname);
});

// pr-model's listParameters switches on these names, so they are the request contract and must not drift with the new addresses.
test("each view feeds the list request the filter name it always had", () => {
  assert.deepEqual(
    prViews.map((view) => prFilterOf(view)),
    ["All", "Review requested", "Changes requested", "Approved", "Blocked", "Merged"],
  );
});

test("every canonical path names its destination and nothing else does", () => {
  assert.equal(destinationOf("/inbox"), "inbox");
  assert.equal(destinationOf("/prs"), "prs");
  assert.equal(destinationOf("/prs/merged"), "prs");
  assert.equal(destinationOf("/repos"), "repos");
  assert.equal(destinationOf("/insights"), "insights");
  assert.equal(destinationOf("/settings"), "settings");
  assert.equal(destinationOf("/about"), "about");
  for (const pathname of ["/", "/attention", "/pull-requests", "/repositories", "/prs/nope", "/inbox/", "/follow-ups"]) assert.equal(destinationOf(pathname), null, pathname);
  for (const [destination, pathname] of Object.entries(paths)) assert.equal(destinationOf(pathname), destination);
});

test("canonical addresses are left alone", () => {
  for (const [pathname, search] of [
    ["/inbox", "?focus=3"],
    ["/prs", "?page=2&q=x"],
    ["/prs/approved", ""],
    ["/repos", "?scope=attention"],
    ["/insights", "?year=2025"],
    ["/settings", "?tab=access"],
    ["/settings", ""],
    ["/about", ""],
  ])
    assert.equal(legacyRedirect(pathname, search), null, pathname + search);
});

// Spec §3.3, row by row. `#/attention?focus=<id>` is what push notifications and digests link to, so it is permanent.
test("every legacy address lands on its new home with the query intact", () => {
  const cases = [
    ["/", "", "/inbox", ""],
    ["/", "?year=2025", "/insights", "?year=2025"],
    ["/", "?visibility=private&year=2024", "/insights", "?visibility=private&year=2024"],
    ["/", "?repo=fixture/calendar", "/insights", "?repo=fixture/calendar"],
    ["/attention", "", "/inbox", ""],
    ["/attention", "?focus=1", "/inbox", "?focus=1"],
    ["/attention", "?role=authored&status=action&repo=a/b&tone=blocked", "/inbox", "?role=authored&status=action&repo=a/b&tone=blocked"],
    ["/pull-requests", "?page=2&q=fix&repo=a/b", "/prs", "?page=2&q=fix&repo=a/b"],
    ["/review-requested", "?q=x", "/prs/review-requested", "?q=x"],
    ["/changes-requested", "", "/prs/changes-requested", ""],
    ["/approved", "", "/prs/approved", ""],
    ["/blocked", "?repo=fixture/calendar", "/prs/blocked", "?repo=fixture/calendar"],
    ["/merged", "", "/prs/merged", ""],
    ["/repositories", "?scope=conflicts&sort=name", "/repos", "?scope=conflicts&sort=name"],
    ["/settings", "?tab=schedule", "/settings", ""],
    ["/settings", "?tab=schedule&x=1", "/settings", "?x=1"],
    ["/prs/unknown", "?q=x", "/prs", "?q=x"],
    ["/prs/open", "", "/prs", ""],
    ["/follow-ups", "?role=reviewer", "/inbox", ""],
    ["/pull_requests", "", "/inbox", ""],
    ["/inbox/", "", "/inbox", ""],
  ];
  for (const [pathname, search, target, targetSearch] of cases) assert.deepEqual(legacyRedirect(pathname, search), { pathname: target, search: targetSearch }, pathname + search);
});

test("a redirect target is always canonical, so no address redirects twice", () => {
  for (const pathname of ["/", "/attention", "/pull-requests", "/repositories", "/blocked", "/merged", "/prs/nope", "/nowhere"]) {
    for (const search of ["", "?year=2025", "?tab=schedule"]) {
      const target = legacyRedirect(pathname, search);
      assert.ok(target, pathname + search);
      assert.equal(legacyRedirect(target.pathname, target.search), null, `${pathname}${search} -> ${target.pathname}${target.search}`);
    }
  }
});
