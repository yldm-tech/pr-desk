# Command line and MCP access

PR Desk exposes the follow-up workspace to a terminal and to AI agents over the same authenticated surface. The GitHub credentials never leave the server: a client authorizes against PR Desk itself and receives a bearer token scoped to one account.

## Why a separate authentication path

The web app authenticates with the `pr_session` cookie, which only a browser that completed the GitHub sign-in can hold, and every write additionally requires an `Origin` header matching `WEB_ORIGIN`. Neither is available to a command line client or a remote MCP client, so those present a bearer token instead. A browser never attaches an `Authorization` header on its own, so bearer requests are not exposed to the request forgery the `Origin` check exists to prevent, and they are exempt from it.

## Authorization

PR Desk acts as its own OAuth 2.1 authorization server. Only the authorization code grant is supported, PKCE with S256 is mandatory, and no client secret is ever issued — every client here is public.

| Endpoint | Purpose |
|----------|---------|
| `/.well-known/oauth-protected-resource` | Points an MCP client at the authorization server (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Advertises the endpoints and supported flows (RFC 8414) |
| `/api/v1/oauth/register` | Dynamic client registration for MCP clients (RFC 7591) |
| `/api/v1/oauth/authorize` | Shows the consent page and issues a single-use code |
| `/api/v1/oauth/token` | Exchanges the code plus verifier for a token |

The authorize endpoint requires an authenticated browser session, so authorization always happens as a signed-in account holder looking at a consent page that names the client and the permissions. A code is valid for one minute, is stored only as a hash, and is consumed by the first redemption attempt — including a failed one, so a stolen code cannot be brute forced against the verifier.

Tokens are stored as SHA-256 hashes with a 90 day lifetime. A token stops working as soon as its account disconnects from GitHub, because the data behind it can no longer be refreshed.

### Scopes

| Scope | Grants |
|-------|--------|
| `followups:read` | Read pull requests, follow-ups, repositories and counts |
| `followups:write` | Mark follow-ups read or handled and snooze them. Implies `followups:read`, which the endpoint requires on every call |

Settings, notification destinations and the GitHub connection itself are deliberately outside both scopes. An agent holding a write token can change local handling state; it cannot reroute your notifications, read your credentials or act on GitHub.

## MCP

The endpoint is `POST /api/v1/mcp`, speaking the Streamable HTTP transport. An unauthenticated request answers `401` with a `WWW-Authenticate` header carrying the resource metadata URL, which is how a client discovers where to obtain a token.

| Tool | Scope | Notes |
|------|-------|-------|
| `list_follow_ups` | read | Filter by state, role, repository, reason, check state, conflict, unread or minimum waiting days; sort by longest wait |
| `get_follow_up` | read | One follow-up with its stored comment thread rather than the truncated excerpt |
| `get_follow_up_summary` | read | Counts per state, plus whether the first inventory finished |
| `get_sync_status` | read | How old the data is and how old that verdict is, so an empty result can be judged |
| `list_pull_requests` | read | Search synchronized pull requests by repository, title, state, role, check state or conflict |
| `list_repositories` | read | Per-repository open, attention, conflict and failing-check counts, all scoped to the follow-up workspace rather than to every synchronized pull request |
| `mark_follow_up_read` | write | Does not mark the work handled |
| `mark_follow_up_handled` | write | Restarts the waiting clock |
| `snooze_follow_up` | write | Suppresses reminders for 1–365 days |
| `unsnooze_follow_up` | write | Cancels a snooze without touching read or handled state |

Every write tool takes the `version` returned by the listing. If new activity arrived in between, the call is refused rather than applied, so an agent cannot mark away something it never saw. Nothing in this surface posts to GitHub, and there is deliberately no tool that starts a synchronization: an agent can see how stale the data is without being able to spend the account's GitHub rate limit.

### Reading the check state

`checks` is `success`, `failure`, `pending`, `inconclusive` or `unknown`, and `failing_checks` names whatever is behind anything that is not green, failures first.

GitHub reports through two APIs and both are read. Check runs are what GitHub Actions produces; commit statuses are the older mechanism still used by Vercel, Netlify, CircleCI and most external integrations. A pull request whose only failure is a commit status summarises as `failure` while contributing no check run at all, so a caller reading only check runs would see a red mark with nothing named behind it. Conclusions therefore come from either vocabulary: `failure`, `cancelled`, `stale`, `timed_out` and `action_required` from check runs, `failure`, `error` and `pending` from statuses.

`inconclusive` means every run that did not pass was cancelled or marked stale — superseded by a newer push, stopped by a concurrency group, or otherwise abandoned. GitHub renders those as a red cross and its own API reports them next to real failures, but they decided nothing about the code, so they do not raise a `checks_failed` follow-up. A genuine failure, a timeout, a startup failure or a run awaiting manual action all still count as `failure`.

### The reason and the state are not the same question

The `checks_failed` and `conflict` reasons are raised only on pull requests you authored, because a red branch on somebody else's pull request is not yours to fix and does not belong in your action queue. Filtering `list_follow_ups` by `reason` therefore answers "what is PR Desk asking me to do", and on an account that mostly reviews it can legitimately return nothing while plenty of branches are red.

To ask the other question — which branches are failing, whoever owns them — filter on the state instead. `checks` and `conflict` are accepted by both `list_follow_ups` and `list_pull_requests` and apply whatever your role is.

```
prdesk prs --state open --checks failure --url    # every red branch, whoever owns it
prdesk followups --reason checks_failed           # only the ones that are yours to fix
```

### Three places count failing checks, and none of them agree

`checks_failing` appears in `list_repositories` and in the browser's repositories table, and a red branch is also what `list_pull_requests --checks failure` returns. They are counted over three different populations, so do not expect the totals to reconcile. `list_pull_requests` is the only one that answers "every branch that is red".

| Surface | Counts over | Misses |
|---------|-------------|--------|
| `list_pull_requests --checks failure` | every synchronized pull request | nothing |
| `list_repositories` → `checks_failing` | the follow-up workspace | pull requests no follow-up tracks: a review requested through a team you have not selected, anything the inclusion rules drop |
| Browser repositories table | open pull requests you authored | every pull request you only review |

Observed on one account: 13 red branches from `list_pull_requests`, 9 when the tool's per-repository counts are added up, and one repository absent from the tool's output altogether because its only tracked pull request was requested through an unselected team. All three numbers are correct for the question their own surface asks.

The rest of the browser table is narrower again: its attention count is a query over stored columns, where the tool's is the follow-up state that read, handled and snooze all move. The page answers "how does my own work stand"; the tool answers "what is the follow-up workspace holding".

### Reading the sync status

Two clocks answer different questions, and confusing them has already cost an investigation.

`stale_minutes` is the age of the **data**: how long ago the last full synchronization finished. `reported_age_minutes` is the age of the **verdict**: how long ago that status was written.

The progress record is stored on the account and outlives the process that wrote it. A failure therefore survives a restart or a redeploy, and keeps being reported until the next run overwrites it. A `failed` status whose `reported_at` predates the current deployment belongs to a run that is already over; the next scheduled sync will replace it. Only a failure reported after the last restart is a live problem.

`completed` counts the items of the phase that actually landed, not the ones attempted, so on a failed run the shortfall against `total` is how much of that phase was lost. The bounded `error_code` names the layer; for a storage failure the server log additionally names the cause, which is where a constraint violation is told apart from a dropped connection.

`interrupted` is a status of its own and not a failure: the server stopped while the run was in flight, which a deployment does every time it rolls a pod. It carries no cooldown, so the next scheduled sync simply carries on. A failed run does cool down for fifteen minutes, because the point of that pause is to stop hammering an upstream that is refusing — and a restart tells you nothing about the upstream.

## Waiting time

`waiting_days` is the age of the waiting clock, which only human progress moves: a comment, a review, or a revision while you are waiting on an author. It is not the age of the pull request and not the time since PR Desk last polled. A `0` therefore means somebody acted today, not that the row just arrived.

## Command line

### Installing

```
curl -fsSL https://raw.githubusercontent.com/yldm-tech/pr-desk/main/scripts/install-cli.sh | sh
```

The script resolves the latest release, downloads the binary for the detected platform, verifies it against the release's `SHA256SUMS` and refuses to install on a mismatch, then places it in `~/.local/bin`. Nothing needs root. `PRDESK_VERSION` pins a release, `PRDESK_INSTALL_DIR` changes the destination and `PRDESK_REPO` points at a fork. Releases carry `prdesk-{darwin,linux}-{arm64,amd64}`; anything else has to be built from source.

`prdesk version` reports which release a binary came from, or `dev` for one built from a checkout.

From a checkout, `make cli` produces `dist/prdesk` and `make install-cli` additionally copies it to `~/.local/bin`. Both report `dev`, since no release produced them.

```
prdesk login --host https://prdesk.example.com   # add --write to allow state changes
prdesk followups --state action --sort waiting   # longest wait first
prdesk followups --reason checks_failed --url    # everything red, with links
prdesk followups --min-waiting 14 --unread       # stale and still unseen
prdesk prs --state open --checks failure         # every red branch, whoever owns it
prdesk repos                                     # per repository, including failing counts
prdesk show 41                                   # one row in full, with its comments
prdesk sync                                      # how old the answer is
prdesk handled 41 7                              # id and version from the listing
prdesk unsnooze 41 7                             # let a snoozed row surface again
```

`followups` and `prs` accept different filters, and a flag that does not apply to the command is refused locally rather than by the server's schema. `--json` prints the tool's structured output unchanged, which is the right input for `jq`.

`login` opens a browser against the consent page and receives the code on a loopback port it opens for the occasion (RFC 8252). The token is written to `credentials.json` under the user configuration directory with mode `0600`; `PR_DESK_CONFIG_DIR` overrides the location. `logout` deletes the local file, which does not end the grant. To stop a token that leaked, revoke it on the server: `GET /api/v1/api-tokens` lists the account's tokens and `DELETE /api/v1/api-tokens/{id}` revokes one, both with the browser session. A revoked token stops verifying on its next call. There is no UI for this yet.

The CLI is itself an MCP client: every command is a tool call against the endpoint above. A command that works in the terminal works for an agent, and there is no second transport to keep in step.

## Operating notes

- CORS is unchanged and still only names `WEB_ORIGIN`. The MCP endpoint is meant for a server-side or desktop client; a browser-based MCP client on another origin would need that list extended.
- Authorization codes are pruned an hour after expiry, and dynamically registered clients that never completed an authorization are pruned after a day. Registration itself is unauthenticated, as the MCP flow requires, and is not rate limited — put it behind your edge proxy's limits if the deployment is public.
- Dynamic registration accepts `https` redirects and loopback addresses only, and issues no secret.
