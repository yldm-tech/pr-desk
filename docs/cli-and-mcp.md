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
| `list_follow_ups` | read | Filter by state, role or repository |
| `get_follow_up_summary` | read | Counts per state, plus whether the first inventory finished |
| `list_pull_requests` | read | Search synchronized pull requests by repository or title |
| `list_repositories` | read | Per-repository open, attention and conflict counts |
| `mark_follow_up_read` | write | Does not mark the work handled |
| `mark_follow_up_handled` | write | Restarts the waiting clock |
| `snooze_follow_up` | write | Suppresses reminders for 1–365 days |

Every write tool takes the `version` returned by the listing. If new activity arrived in between, the call is refused rather than applied, so an agent cannot mark away something it never saw. Nothing in this surface posts to GitHub.

## Command line

Build it with `make cli`, which produces `dist/pr-desk-cli`.

```
pr-desk-cli login --host https://prdesk.example.com   # add --write to allow state changes
pr-desk-cli followups --state action --limit 20
pr-desk-cli followups --json | jq '.follow_ups[] | select(.waiting_days > 14)'
pr-desk-cli handled 41 7                              # id and version from the listing
```

`login` opens a browser against the consent page and receives the code on a loopback port it opens for the occasion (RFC 8252). The token is written to `credentials.json` under the user configuration directory with mode `0600`; `PR_DESK_CONFIG_DIR` overrides the location. `logout` deletes the local file, which does not end the grant. To stop a token that leaked, revoke it on the server: `GET /api/v1/api-tokens` lists the account's tokens and `DELETE /api/v1/api-tokens/{id}` revokes one, both with the browser session. A revoked token stops verifying on its next call. There is no UI for this yet.

The CLI is itself an MCP client: every command is a tool call against the endpoint above. A command that works in the terminal works for an agent, and there is no second transport to keep in step.

## Operating notes

- CORS is unchanged and still only names `WEB_ORIGIN`. The MCP endpoint is meant for a server-side or desktop client; a browser-based MCP client on another origin would need that list extended.
- Authorization codes are pruned an hour after expiry, and dynamically registered clients that never completed an authorization are pruned after a day. Registration itself is unauthenticated, as the MCP flow requires, and is not rate limited — put it behind your edge proxy's limits if the deployment is public.
- Dynamic registration accepts `https` redirects and loopback addresses only, and issues no secret.
