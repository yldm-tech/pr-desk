# Project audit and improvements

Reviewed 2026-09-10. Scope: Go API/authentication, session boundaries, history and detail synchronization, queue/lock/retry behavior, overview/statistics, React routing/query state and links, build tooling and release workflows. Existing tests were inspected alongside implementation. This is a source-and-test review, not an independent penetration test or a guarantee that every defect is found.

The requested `ultracode` executable/skill was not available in the session. The review used direct source analysis, regression tests and local build checks; no UltraCode run is claimed. Work was isolated from an existing dirty checkout.

## Fixes in this PR

| Finding | User impact | Fix |
| --- | --- | --- |
| Synchronization used only legacy commit statuses | Failed GitHub Actions could be absent from Needs attention; checks-only repositories could appear pending forever | Fetch check runs and merge them with actual legacy statuses; ignore synthetic pending when no legacy statuses exist |
| Pending review requests were not represented in stored state | Review requested view could remain empty | Read requested reviewers/teams and preserve outstanding changes-requested decisions |
| Database errors while writing PR details/comments were ignored | Partial writes could advance the success checkpoint | Fetch a complete snapshot, write it transactionally, and propagate storage failures |
| GitHub issue and review comment numeric IDs shared a lookup key | Distinct comments could collide; edited comments stayed stale | Scope identity to session, PR and comment kind; update existing comment contents |
| Unknown mergeability overwrote a known conflict | A transient GitHub null could incorrectly clear a conflict | Preserve prior conflict state until mergeability is known |
| Detail writes refreshed the database UpdatedAt automatically | Polling changed apparent GitHub activity time and list ordering | Preserve the activity timestamp captured from GitHub |
| GitHub JSON helper discarded typed upstream errors | Permission/rate-limit/cancellation failures became generic upstream errors | Keep a typed cause behind a redacted error message |
| Activity lookup still accepted raw string IDs after detail-route hardening | GORM could interpret nonnumeric input as a query expression | Align activity lookup with the detail route's positive-ID parsing; regression-test both |
| Overview classification failure blocked the all-data view | Existing synchronized contributions became unavailable | Keep all-data reads local; add an explicit All contributions tab and error fallback, retaining the default public view |
| Logout ignored storage failures | UI could claim a disconnect despite a surviving connection | Return a retryable error and preserve cookies when deletion fails |
| Health database check had no application deadline | An unavailable database could hold health requests open | Add a two-second request-scoped ping deadline |
| PR links were rendered without the activity-link validator | Untrusted stored links could direct users to executable/off-site URLs | Apply the same GitHub-only URL validation to PR links |
| Frontend accepted years earlier than the API supports | Invalid URL state caused avoidable overview errors | Align the lower bound to 2008 |

## Verification

Regression coverage exercises Actions failures/success without legacy statuses, requested reviews, unknown mergeability, comment ID collisions and edits, transaction rollback, typed/redacted upstream errors, SQL-expression IDs, cached all-data overview, logout failure, and unsafe frontend links. Run the complete Go race suite with a local `TEST_DATABASE_URL`, plus frontend checks and build. Existing queue, pagination, isolation, OAuth, history and checkpoint tests remain part of the suite.

GitHub API responses in these tests are synthetic. They do not prove live OAuth permissions or account-level behavior. Container/embedded builds cover packaging; they do not substitute for a production rollout.

After rebasing onto the main branch containing PRs #8 and #9, verification passed: Go vet and full race suite with local PostgreSQL integration, 13 frontend tests, frontend formatting/lint/type checks, production web and Docker image builds, workflow lint, diff checks, and a redacted Git history scan. The existing large-bundle build warning remains a follow-up.

## Recommended next work

1. **Account lifecycle:** design account-wide deletion/export and retention, including reconnect caches and backups. Current disconnect semantics are narrower; do not silently turn logout into destructive account deletion.
2. **Durable background jobs:** track per-account job ownership/heartbeats and make concurrency limits explicit. Current session advisory locks prevent duplicate session work, but reconnecting creates new sessions and workers.
3. **Freshness and GitHub API budget:** incrementally backfill repository visibility, cache it with an expiry, and measure search/detail requests. Public/private filtering currently requires unknown visibility to be resolved.
4. **Daily workflow:** opt-in reminders for failed checks, outstanding reviews and stalled PRs. Validate retention before building team billing or a broad notification system.
5. **Actual review inbox:** the current product centers on authored PRs; a cross-repository inbox for reviews requested of the signed-in user requires a separate import/query model.
6. **Performance and observability:** measure first-import time, queue wait, API rate limits and bundle cost. The frontend build still warns about a large main bundle. Add browser-level regression tests before changing chart loading or splitting bundles.

The earlier public-release hardening work is documented separately in `docs/open-source-readiness.md`; this PR does not change repository visibility or licensing. Larger product decisions above are recommendations, not implemented features.
