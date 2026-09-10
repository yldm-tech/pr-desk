# Follow-up workspace: development operations

The implementation on this branch is incomplete. Account storage, follow-up state and the browser interface are available; actual gonotify sending, destination management and the production notification worker still need integration. The checklist in [follow-up-plan.md](follow-up-plan.md) is the completion authority. Do not deploy this branch as a finished notification service.

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

## Notification work still required

The outbox implements five-minute event aggregation, per-destination delivery records/retries, a single initial inventory, daily local-time summaries and long-message splitting. Sending never marks tasks read or handled. Before activation, finish the identified gonotify adapter, encrypted destination configuration/API/UI, language settings, paused-sync context, production worker wiring and adapter-level tests. No live test message should be sent without explicit authorization.
