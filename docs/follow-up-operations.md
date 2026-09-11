# Follow-up workspace: development operations

Account storage, follow-up state, browser settings, destination management for Telegram, Lark, email and webhooks, and the production notification worker are implemented on this branch. The checklist in [follow-up-plan.md](follow-up-plan.md) remains the completion authority. Configure at least one destination before expecting delivery.

## Account upgrade

Keep `TOKEN_ENCRYPTION_KEY` unchanged and take a normal operator-managed database backup before upgrading. Startup migrations add account identity, browser sessions, follow-up settings/state, events and delivery tables; they do not erase existing PRs. New browser credentials are independent from the internal account storage key.

The next successful GitHub login verifies the numeric user ID and creates or reuses its durable account. An existing legacy cache is copied only if its saved token still proves the same numeric identity. If no old token can be verified, the new account imports its authorized history again; legacy rows remain untouched. Read/handled state and preferences created under the new account survive subsequent reconnects, browser changes and username changes. Old logged-in tabs do not automatically become the new account session; reconnect those tabs to use the shared follow-up workspace.

Browser sessions expire after 30 days. A valid browser session can still read cached work when GitHub authorization needs renewal, but the UI must indicate that synchronization is paused. Reconnect GitHub to resume. Disconnect preserves data while removing the stored access token for the account and the current browser session. See [data handling](privacy.md) for the distinction from deleting data or revoking the GitHub App.

## Discovery and states

Contributions remain based on PRs authored by the user. Direct review requests and selected team requests are tracked separately and never increase authored contribution totals. Discovery also looks at previously reviewed open PRs, but requires evidence of a direct or selected-team request before including them. Already tracked open reviews continue refreshing when they no longer appear in GitHub's review-requested search.

GitHub App permissions must allow reading the relevant PRs, check runs and status contexts. Team selection uses `/user/teams`; inaccessible organizations produce a visible error rather than inventing team membership. Selecting a team opts its requests into follow-ups; removing it hides team-only work while preserving history. Direct requests remain included independently.

The first completed synchronization establishes an inventory baseline after authored and reviewer discovery complete. Until then the UI identifies the inventory as incomplete. Existing human feedback requires confirmation, but baseline rows do not create one event notification per historical comment. A successful queue test is not a notification-delivery guarantee.

Reading a PR does not mark it handled. Handle or follow-up actions explicitly restart the waiting clock. Version checks reject stale actions when new activity arrives during handling. Conflict and failing-check reasons remain visible until the GitHub snapshot resolves them. Snooze changes the waiting reminder only; new human feedback or technical failures can still become actionable. Drafts remain tracked without proactive reminders.

The waiting period defaults to seven days and supports repository overrides. Labels, bots and CI reruns do not reset it. Human replies/reviews and relevant author revisions do. Review decisions distinguish comment-only reviews, request-changes, approval, revocation and explicit re-request; GitHub continues to own the actual review and merge operations.

## Local validation

Run the API test suite against a disposable PostgreSQL database using `TEST_DATABASE_URL`, including `go test -race ./...` and `go vet ./...` from `apps/api`. Integration tests create transaction-local schemas and roll them back. Never use a production database.

From the root, run `bun run check`, `bun run test:web`, `bunx playwright install chromium`, `bun run test:browser`, and `bun run build`. Browser tests start their own development server on loopback port 5189, stub API responses and use synthetic fixtures. Screenshots and test reports are ignored by Git. CI installs Chromium's Linux dependencies explicitly.

IANA timezone data is embedded into the Go executable with `time/tzdata`, so timezone validation and daily schedule calculations do not depend on the minimal production image containing an OS zoneinfo package.

## Notification delivery

The outbox implements five-minute event aggregation, per-destination delivery records/retries, a single initial inventory, daily local-time summaries and long-message splitting. Credentials are encrypted at rest with `TOKEN_ENCRYPTION_KEY`; sending never marks tasks read or handled. The worker runs on the background scheduler and retries failures with backoff. Do not send a live test message without explicit authorization.

## Notification channels

Each destination carries a channel that is fixed when it is created; rebuild the destination to move it to another provider. Destinations stored before channels existed have no channel recorded and are delivered as Telegram.

| Channel | Stored configuration | Notes |
|---------|----------------------|-------|
| Telegram | Bot token, numeric chat ID | Delivered through `github.com/nikoksr/notify`. The bot has to be a member of the chat. |
| Lark / Feishu | Custom bot webhook URL, optional signing secret | Posted directly so that signature verification is supported; the secret signs an empty message with `timestamp\nsecret` as the key. Rejections arrive as an error code inside an HTTP 200 body and are treated as failures. |
| Email | SMTP host, port, optional user and password, sender, up to twenty recipients | Spoken over SMTP directly. Port 465 uses implicit TLS, every other port upgrades with STARTTLS when the server offers it. Credentials are only presented over an encrypted connection, so a server without TLS has to accept unauthenticated submission. The first line of the notification becomes the subject. |
| Webhook | URL, optional signing secret | Receives `{destination, subject, text, sent_at}` as JSON. With a secret the request carries `X-PR-Desk-Signature: sha256=<hex>`, an HMAC-SHA256 of the exact body. |

Credentials are write-only. A field left empty when updating a destination keeps the stored value, which is how renaming, enabling and disabling avoid resending secrets.

### Outbound address policy

Destination URLs and SMTP hosts are dialled by the server, so they are restricted to public addresses: loopback, private, carrier-grade NAT, link-local and multicast ranges are refused, and webhook URLs have to use https. The check runs on the address the connection actually reaches, so a hostname that later resolves into the private network or a redirect towards it is refused as well; redirects are not followed.

Set `NOTIFY_ALLOW_PRIVATE_HOSTS=true` to reach an internal receiver. It also permits plain http, since internal endpoints rarely carry certificates. Enable it only when every account holder on the deployment is trusted to choose an outbound address: it allows anyone who can sign in to make the server issue requests inside your network.
