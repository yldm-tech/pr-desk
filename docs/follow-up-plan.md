# PR follow-up workspace

Confirmed scope (implementation and verification checklist; unchecked means incomplete):

- [ ] Durable GitHub numeric account identity, independent browser sessions; migrate verified legacy caches, preserve workflow/preferences on reconnect; show paused authorization and last successful sync.
- [ ] Discover all authored PRs plus direct review requests and user-selected teams. Continue tracking previously requested reviews through response, revision, approval, closure and reopening. Keep contribution statistics authored-only.
- [ ] Durable per-account read and handled state. Human comments/reviews need confirmation; bots excluded. Open is read only. New actionable feedback reopens work. Conflicts and failed checks follow actual GitHub state.
- [ ] Review flow: pending stays pending; comments do not complete work; request changes waits for author then replies/new commits reopen; approved only reopens for revoked approval/new request, not ordinary commits.
- [ ] Waiting starts from meaningful human progress, not GitHub updated_at, bots, labels or CI reruns. Seven-day default; per-repository override. Followed-up resets timer. Snooze 3/7/custom days affects waiting reminders only. Draft PRs tracked but never proactively reminded; ready resumes normal flow.
- [ ] First import reconciles all open PRs with historical human comments unconfirmed; one inventory notification, no historical notification flood. Merge/close archives with recent outcomes.
- [ ] Per-user multiple enabled/disabled gonotify Telegram destinations with encrypted credentials. Durable delivery retries and per-target deduplication. No real test notifications without explicit authorization.
- [ ] Five-minute per-PR notification coalescing for new human feedback/review requests/conflicts/check failures; normal 5–10 minute objective, show degraded sync rather than imply no changes.
- [ ] Daily overdue/outcome summary at 09:00 user timezone, configurable time/timezone, empty skips; snooze honored. Notifications never imply read/handled.
- [ ] Overview remains home: four action/outcome counts and five priority PRs above existing charts. Global follow-up summary ignores historical-year/public-private chart filters. Dedicated authored/reviewer task views and settings.
- [ ] All GitHub mutations stay on GitHub; local handling/snooze/read/settings only.
- [ ] Locale parity, meaningful state-machine, authorization/isolation, migration, sync discovery, notification retry/dedup/DST tests; frontend and production build; browser validation with synthetic fixtures.
- [ ] Documentation, reviewed diff and PR delivery; completion report only after full audit.

Implementation order: identity/storage → event snapshots and workflow → discovery/reconciliation → outbox and gonotify → API/UI → end-to-end verification.

Open integration detail: user asked which specific gonotify repository/service to integrate; core work can proceed independently.

## Implementation checkpoint — 2026-09-11

Implemented on `feat/pr-follow-up-workspace` (not a completion claim):

- Stable numeric GitHub identity, opaque internal account partition, separate expiring browser credentials, credential suspension and reconnect without losing account data. Legacy caches are copied only after verifying numeric GitHub identity.
- Authored and requested-review discovery; previously tracked open reviews refresh even after disappearing from search. Reviewed-by discovery is filtered by evidence of a direct/selected-team request. Contribution queries remain authored-only.
- Snapshot/state model, read/handled optimistic concurrency, snooze, meaningful activity clocks, drafts, review decisions, archived outcomes, initial baseline marker, event persistence.
- Follow-up API, configurable team/timezone/digest/waiting periods, global Overview summary, role/state views, responsive cards and settings, five UI locales.
- Notification outbox domain, independent per-target retries, event coalescing, baseline summary, daily timezones/DST deduplication, long Unicode messages split. Transport is injectable in tests only; **production sending and destination management are not yet connected**.

Verified at this checkpoint:

- Full API tests with race detector against disposable PostgreSQL (`pr-desk-followup-tests-20260911`, loopback port 55439), plus `go vet`.
- 15 frontend tests and Vite+ format/lint/type checks.
- Four Playwright scenarios: global summary unaffected by chart year, read vs handled, reviewer filtering/mobile overflow, settings save. Synthetic screenshots inspected; mobile settings button changed to compact icon after detecting crowding.
- Production frontend build passed before the latest small presentation adjustments; repeat at final audit.

Remaining before the objective can be marked complete:

1. Identify the intended gonotify service/package. An asynchronous clarification is pending; several unrelated projects share this name, so no contract has been guessed.
2. Implement the actual Telegram adapter and encrypted destination API/UI, connect notification scheduling/delivery, verify failure responses/idempotency and target enable/disable behavior. Finish notification language preferences and paused-sync context.
3. Expand live API/browser fixtures for destinations, reopen/draft/team changes and account reconnect; check relevant endpoint authorization, migrations and settings validation.
4. Finish operating/privacy/setup documentation and required CI browser checks, repeat full tests/build, inspect final diff, create the completed PR and publish a completion report. No real Telegram message has been sent.

Reference semantics: GitHub's [search documentation](https://github.com/github/docs/blob/main/content/search-github/searching-on-github/searching-issues-and-pull-requests.md) states review-requested matches disappear after review; [issue events](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types) supply explicit request/ready events. These are why discovery and durable tracking are separate.

### Follow-up verification pass

- Corrected review snapshots that contain both a submitted change request and a later author reply: the later reply remains actionable. Initial inventories now also preserve pending comment-only reviews and revisions made after a change request. Draft-to-ready transitions emit previously suppressed actionable human feedback.
- Added PostgreSQL tests for settings input validation, forged/other-account sessions, checkpoint preservation when saving settings, and workflow/preferences retained after reconnect. Added a delivery test proving disabled targets do not send or retry already queued messages.
- Added the existing Playwright suite to the CI web job (Chromium and Linux dependencies installed explicitly).
- Re-ran full PostgreSQL API tests with race detector, `go vet`, Vite+ format/lint/type checks, and diff whitespace checks successfully.
- The gonotify clarification is still unanswered. No provider contract, destination form, or production sender has been invented. This goal remains active and incomplete.

### Runtime and documentation pass

- Embedded the IANA timezone database with `time/tzdata`; validated the existing Tokyo schedule and New York DST test in a network-disabled Linux `scratch` container containing only the compiled test binary. This proves schedule calculation works without OS timezone files.
- Updated data-handling and development documentation to distinguish durable accounts from browser sessions and documented verified legacy migration, reconnect, disconnection, read/handled states and current notification limitations. Added `follow-up-operations.md` and documented Chromium browser checks in CI.
- API tests and `go vet` passed. This was additional implementation progress; it does not resolve the pending gonotify integration or complete the goal.
