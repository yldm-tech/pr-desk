# Project audit and improvements

## 2026-09-12 review

Reviewed 2026-09-12. Scope: the whole repository — authentication and session boundaries, the synchronization pipeline, concurrency and resource lifetime, the data model and its queries, the MCP server, notifications and follow-ups, the HTTP surface, the `prdesk` CLI, the React application, internationalisation, and build, packaging and operational tooling. Twelve area reviews produced 65 candidate findings; each was handed to an independent verifier whose brief was to refute it, and 57 survived. Everything recorded as fixed on 2026-09-10 was excluded from the search. This is a source-and-test review, not a penetration test, and not a guarantee that every defect is found.

The fixes below were then reviewed again as a diff, by five reviewers with the same refute-first verification. That pass found eleven regressions in the new code, including one this work introduced (a review with no prose no longer counted as human activity); all eleven are fixed here, each with a test that fails without its fix.

### Fixes in this pull request

#### Authentication and sessions

| Finding | User impact | Fix |
| --- | --- | --- |
| Disconnect ended only the calling browser's session | The account was disconnected everywhere, but a session left behind on another machine kept full account access for the rest of its thirty days, and reconnecting revived it | Delete every browser session belonging to the account inside the same transaction that clears the credential |
| A returning sign-in resolved a cache donor it could never use | Every login paid an extra GitHub round trip, inside the request, because the short-circuit tested a partition that is minted fresh on each sign-in | Probe for the existing account first and skip donor resolution when it is already known |

#### Synchronization

| Finding | User impact | Fix |
| --- | --- | --- |
| A resumed history walk stamped the time it resumed | Records that changed while the walk was interrupted fell out of reach of every later query, permanently | Remember when the walk began in `history_walk_started_at` and stamp the completed walk with that |
| The details phase ran on a context nothing could cancel | A rate limit on the first pull request still fired a request for every remaining one, extending GitHub's block | Cancel the siblings on the first rate limit only, and report that error rather than the cancellation |
| Review discovery was floored at the reviewer's own account creation date | Open pull requests older than the reviewer's GitHub account never appeared in the review inbox | Search review requests from the 2008 floor, which is what the authored walk uses the account date for |
| Shutdown did not wait for a sync goroutine to write its checkpoint | A deploy landing mid-sync left the account reporting "running", which suppressed its automatic sync for twenty minutes and disabled the manual one | Track syncs in a wait group and drain it within the existing ten-second shutdown budget |
| The prose submitted with a review was never stored | `get_follow_up` answered "here is the full thread" with nothing at all whenever the excerpt came from a review body | Store review bodies as a third comment kind, `summary`, beside inline and conversation comments |

#### Data and the HTTP surface

| Finding | User impact | Fix |
| --- | --- | --- |
| `POST /api/v1/pull-requests` bound a client-supplied primary key | A body carrying its own id inserted around the sequence, and the sync insert that later reached that value failed on a duplicate key; posting twice left two rows | Zero the id and upsert on the identity the sync path uses |
| `/pull-requests/:id/comments` handed the raw path parameter to Postgres | A mistyped URL answered 500 where its two sibling routes answer 404 | Parse the id before the query, as the siblings do |
| Cookie-authenticated API responses carried no `Cache-Control`, and nothing sent a `Content-Security-Policy` | A shared proxy was free to store one person's pull requests, and the SPA rendered repository-supplied text with no policy behind it | `no-store` on `/api`, and a policy on the document and its assets that admits GitHub avatars and leaves the OAuth consent page and the Swagger bundle alone |
| Swagger UI was mounted but could never load a spec | The page reported "failed to load API definition" on every deployment | Point the UI at the spec this server serves and embed it, rather than resolving a path against the working directory |
| `X-Request-ID` was returned to clients but never logged | The identifier somebody quotes from a failed request matched nothing an operator could search | Log it, and mint a fresh one unless the inbound header is short and alphanumeric |
| No connection pool limits while a sync pins a connection | A burst of first logins could exhaust PostgreSQL's `max_connections` and take `/health` down with it | Cap the pool at 25 open and 8 idle with a 30 minute lifetime, overridable through `DATABASE_MAX_OPEN_CONNS` |

#### Notifications and follow-ups

| Finding | User impact | Fix |
| --- | --- | --- |
| The delivery outcome was written through the cancellable worker context | A message the upstream had already accepted was sent again after a restart | Record the outcome on a handle shutdown cannot cancel, with its budget starting after the send rather than before it |
| Events of a follow-up the filter excludes were never retired | Deselecting a team parked its events until the day it was selected again, when they arrived as news | Retire the events this tick skipped, bounded to the rows it actually read |
| The "failing" badge was derived from delivery history | It could not clear until the history did, and the retention sweep below would have cleared it wrongly | Carry health on the destination, clear it on the first accepted message, and seed it on upgrade from the history that used to answer the question |
| Delivered notifications and dispatched events were never pruned | Two append-only tables grew without bound, and the outbox claim scanned all of one of them | Sweep both after thirty days, which is far beyond every dedupe key's lifetime, and add a partial index over the live backlog |
| No cap on notification destinations | One account's fan-out could hold up every other account's outbox | Ten destinations per account, counted only when adding one |

#### MCP and the command line

| Finding | User impact | Fix |
| --- | --- | --- |
| Neither list tool could page past 200 rows | The CLI told people to raise a limit the server refuses | An `offset` argument on both tools and an `--offset` flag on both listings, with a hint that names the offset of the next page |
| `list_pull_requests` returned an id from a different key space | An agent that passed it to a tool taking an id addressed the wrong record | Follow-up ids are now the only identifier the tool surface hands out |
| A lapsed GitHub authorization rejected the whole MCP surface | The `reconnect` error code the tools document could never be returned | Authenticate the token independently of the GitHub authorization state, while still rejecting a disconnected account |
| Write tools omitted their annotations | Clients prompted as if marking something read had touched GitHub | Set `destructiveHint` and `openWorldHint` truthfully on every tool |
| Flags after a positional argument were dropped | `prdesk show 41 --json` printed a table into a `jq` pipeline | Parse flags on either side of the identifier, and refuse a stray positional |
| GitHub titles and comment bodies were printed to the terminal verbatim | Another repository's text could repaint the screen over the verdict this tool exists to report | Replace control sequences at the terminal sink, sparing the indentation of a quoted comment body |
| `prdesk <command> --help` exited 1 on stderr | Any wrapper script running under `set -e` aborted on a help request | Help exits 0 on stdout |
| A revoked token was reported as "cannot reach the host" | The remedy on screen was the wrong one | Report a refused authorization as one |
| `PRDESK_RELEASE_BASE` was ignored when resolving the latest version | A mirrored install could not update | A separate `PRDESK_RELEASE_API`, honoured by both `prdesk update` and the installer |
| Existing credentials kept a loose file mode | A `credentials.json` written at 0644 by an older build stayed world-readable | Stage and rename, so the mode is set on every write |

#### Frontend

| Finding | User impact | Fix |
| --- | --- | --- |
| No error boundary anywhere | A failed lazy chunk unmounted the whole application to a blank page with no way back | A boundary at the root and around the overview, with a reload control and one automatic retry for a chunk a deploy replaced |
| A failed background refetch replaced the settings page | A half-filled destination form was thrown away by a refresh nobody asked for | Keep the last good data on screen with a staleness banner; the same for the follow-up list, the overview summary, the destinations and the issued tokens |
| Switching settings tabs discarded the open form | Everything typed into a panel was lost on a tab switch | Keep a visited panel mounted and hidden rather than unmounting it |
| Paging or filtering unmounted the table | The pagination controls disappeared from under the cursor | Keep the previous page on screen while the next one loads, and disable the controls only while a fetch is actually in flight |
| The `oauth_error` banner was never cleared | It stayed for the rest of the session, through every navigation and reload | Read it once and remove the flag from the URL |
| Sync progress was polled every five seconds forever | Including in a background tab with nothing syncing | Poll a run in flight at one second, an idle server at thirty, and stop polling a hidden idle tab |
| Every rejected destination blamed the bot token | The message was wrong for SMTP and webhooks | Report the reason the server gave, and refuse a host with a port in the form rather than at the API |
| The copy buttons did nothing on a plain-http deployment | The clipboard API is absent outside a secure context, and the button reported nothing | Report the failure and tell the reader to copy manually |
| Revoke and Remove confirmations stranded the keyboard focus | A screen reader announced nothing and the focus fell to the document | Move the focus to the confirmation and back, accept Escape, and announce the result |
| The dev server defaulted to API port 8081 | Every other default in the repository runs the API on 8080 | Default to 8080 |

#### Internationalisation

| Finding | User impact | Fix |
| --- | --- | --- |
| Six GitHub check conclusions had no translation | The checks list printed raw snake_case English in every language | Keys for all of them in all five locales |
| Counted strings had no plural forms | "Fetched 1 records", "View 1 open PRs" | i18next plurals with the categories each language actually uses |
| Numbers and dates followed the browser locale | The selected language did not reach the formatter | Format through the active language in the repository, overview and sync views |
| Server warning prose was rendered under a localised heading | English sentences inside a translated panel | Map the server's warnings onto keys in all five locales |
| The locale test compared only top-level keys | A missing nested key, a mismatched placeholder or a key used in code with no resource all passed | Four checks over the assembled bundles, including a scan of every `t()` call in the source |

#### Operations

| Finding | User impact | Fix |
| --- | --- | --- |
| Compose did not forward `NOTIFY_ALLOW_PRIVATE_HOSTS` | A documented opt-in was silently ignored in the deployment that needs it | Forward it, and `DATABASE_MAX_OPEN_CONNS` with it |
| `backup-postgres.sh` truncated the target before connecting | A failed run destroyed the previous backup and left bytes that looked like one | Stage beside the target, verify the archive is readable, then promote it; covered by `scripts/backup-postgres-test.sh`, which `make test` runs |
| `SYNC_MAX_PAGES` was documented but read by nothing | A knob that did nothing | Removed from `.env.example` |

### Deliberately not in this pull request

These findings were confirmed and are not fixed here, because each needs a design decision or a change too large to verify alongside the rest.

1. **Detail refresh budget.** Every sync re-reads the full details of every open pull request, so the REST budget scales with open-pull-request count times the five-minute cadence. Fixing it properly means conditional requests or a per-pull-request freshness rule, and measurement before and after.
2. **Outbox materialisation cost.** Every thirty seconds the materialiser reloads every follow-up and pull request for every account. The destination cap bounds the fan-out but not this.
3. **Verifying a destination.** A wrong bot token surfaces roughly six hours later as an unexplained badge. A "send a test message" control is the fix, and it is a feature.
4. **Paging the follow-up list.** `GET /api/v1/follow-ups` returns every follow-up ever created, unpaginated, polled every sixty seconds. Paging it changes the API contract and needs matching work in the workspace view.
5. **Unused locale keys.** Roughly thirty keys have no caller, so about 150 translated strings are dead weight. Deleting them is safe only with a check that nothing builds a key dynamically.
6. **Server error codes.** A rejected destination now shows the server's own English sentence, which is accurate but untranslated. Machine-readable error codes would let the frontend localise them.
7. **The main bundle is 902 kB.** Still the known follow-up from the previous round.

### Verification

Run from the branch, with a disposable PostgreSQL in `TEST_DATABASE_URL`: `go vet ./...` and `go test -race ./... -count=1` in `apps/api` (both packages pass), `vp check` (formatting, lint and types), `bun run test:web` (35 tests, up from 17), `bun run test:browser` (21 Playwright tests, up from 17), `bun run build`, `scripts/backup-postgres-test.sh`, `bash -n scripts/install-cli.sh` and `docker compose config`.

Every behaviour change carries a test. Several were confirmed to fail without their fix rather than assumed to: the bare-approval activity case, the slow-send outcome write, the empty-review excerpt tie, and the CLI page hint.

GitHub responses in these tests are synthetic. They do not prove live OAuth behaviour, and no container or production rollout was exercised beyond the image build the CI performs.

## 2026-09-10 review

Reviewed 2026-09-10. Scope: Go API/authentication, session boundaries, history and detail synchronization, queue/lock/retry behavior, overview/statistics, React routing/query state and links, build tooling and release workflows. Existing tests were inspected alongside implementation. This is a source-and-test review, not an independent penetration test or a guarantee that every defect is found.

The requested `ultracode` executable/skill was not available in the session. The review used direct source analysis, regression tests and local build checks; no UltraCode run is claimed. Work was isolated from an existing dirty checkout.

### Fixes in that pull request

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

### Verification

Regression coverage exercises Actions failures/success without legacy statuses, requested reviews, unknown mergeability, comment ID collisions and edits, transaction rollback, typed/redacted upstream errors, SQL-expression IDs, cached all-data overview, logout failure, and unsafe frontend links. Run the complete Go race suite with a local `TEST_DATABASE_URL`, plus frontend checks and build. Existing queue, pagination, isolation, OAuth, history and checkpoint tests remain part of the suite.

GitHub API responses in these tests are synthetic. They do not prove live OAuth permissions or account-level behavior. Container/embedded builds cover packaging; they do not substitute for a production rollout.

After rebasing onto the main branch containing PRs #8 and #9, verification passed: Go vet and full race suite with local PostgreSQL integration, 13 frontend tests, frontend formatting/lint/type checks, production web and Docker image builds, workflow lint, diff checks, and a redacted Git history scan. The existing large-bundle build warning remains a follow-up.

### Recommended next work

1. **Account lifecycle:** design account-wide deletion/export and retention, including reconnect caches and backups. Current disconnect semantics are narrower; do not silently turn logout into destructive account deletion.
2. **Durable background jobs:** track per-account job ownership/heartbeats and make concurrency limits explicit. Current session advisory locks prevent duplicate session work, but reconnecting creates new sessions and workers.
3. **Freshness and GitHub API budget:** incrementally backfill repository visibility, cache it with an expiry, and measure search/detail requests. Public/private filtering currently requires unknown visibility to be resolved.
4. **Daily workflow:** opt-in reminders for failed checks, outstanding reviews and stalled PRs. Validate retention before building team billing or a broad notification system.
5. **Actual review inbox:** the current product centers on authored PRs; a cross-repository inbox for reviews requested of the signed-in user requires a separate import/query model.
6. **Performance and observability:** measure first-import time, queue wait, API rate limits and bundle cost. The frontend build still warns about a large main bundle. Add browser-level regression tests before changing chart loading or splitting bundles.

The earlier public-release hardening work is documented separately in `docs/open-source-readiness.md`; this PR does not change repository visibility or licensing. Larger product decisions above are recommendations, not implemented features.
