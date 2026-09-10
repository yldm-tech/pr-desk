# Development and operations

Local Web dashboard for GitHub pull requests, built with Go/Gin, GORM/PostgreSQL and React/Vite. The application is under development; it is not yet ready for a shared production deployment. Connections and PR storage are isolated by browser session.

## Local development

1. Copy `.env.example` to `.env`. Generate a unique encryption key with `openssl rand -hex 16` and set `TOKEN_ENCRYPTION_KEY` to the resulting 32 characters. Keep this key stable across restarts and out of version control.
2. Create a GitHub App with user authorization enabled and callback URL `http://localhost:8080/api/v1/auth/github/callback`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`.
3. Run `docker compose up -d --build` to start PostgreSQL and the API. Compose loads the environment values from `.env`.
4. Run `bun install --frozen-lockfile && bun run dev`. Open `http://localhost:5173` and connect GitHub.

To run the API outside Docker, start PostgreSQL with `docker compose up -d postgres` and export `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `WEB_ORIGIN` into the API process environment before running `cd apps/api && go run .`. The Go binary does not automatically load `.env` files. Use the database connection settings in `.env.example`. `PORT` defaults to `8080`.

If those ports are occupied, set `PORT=8081`, `WEB_ORIGIN=http://localhost:5174`, and `GITHUB_REDIRECT_URL=http://localhost:8081/api/v1/auth/github/callback` in `.env`. Register the same callback in GitHub, run `docker compose up -d --build api`, then start the frontend with `cd apps/web && VITE_API_URL=http://localhost:8081 bun run dev --port 5174`. The API container restarts automatically unless explicitly stopped. Check `curl http://localhost:8081/health` and `docker compose ps` when troubleshooting connectivity; open port 5174 for the dashboard.

For a containerized static frontend, run `make production` (or `WEB_PORT=5174 docker compose --profile production up -d --build web`) after configuring `.env`. The web container serves the SPA through Nginx, exposes `/health`, and restarts automatically. Stop it with `WEB_PORT=5174 docker compose --profile production down web`.

## Token storage

Tokens use AES-256-GCM with random nonces. Startup rejects missing, incorrectly sized, and example keys. Encryption, decryption, and database write failures do not produce successful connection responses. Existing AES-GCM records retain the same encoding. Legacy plaintext records and records encrypted with a different key require reconnecting GitHub; they are never sent to GitHub as bearer tokens.

Back up the encryption key separately from the database. Changing or losing it makes stored tokens unreadable. Key rotation with re-encryption is not implemented yet.

## Verification

`make test` runs Go unit tests, frontend data-model regression tests, strict TypeScript checking, and the Vite production build. Frontend tests run with Bun 1.3.4 or newer. Token tests cover round trips, nonce uniqueness, malformed ciphertext, tampering, wrong keys, and invalid configuration. These checks do not prove live OAuth behavior, database migrations, or browser flows; end-to-end coverage is still required.

Cookie-authenticated mutation requests must include an `Origin` header matching `WEB_ORIGIN` exactly (including the port). Browsers send this automatically. CLI integrations must supply it explicitly. Requests with absent, opaque, or foreign origins return 403 before executing the operation. OAuth callback GET requests remain supported.

## Search and pagination

The dashboard searches PR title and normalized repository (`owner/repo`) with server-side filtering. Results are paged at 50 rows; search and filter changes reset to page one. The API accepts `search`, `limit` (1–200), and `offset`, and returns the filtered `total`.

The API also exposes `GET /api/v1/repositories`, scoped to the active session, with per-repository total, open, conflict, and needs-attention counts.

## Concurrent synchronization

Synchronization reserves a PostgreSQL connection and holds a session advisory lock until the request finishes. API replicas using the same database reject concurrent syncs for the same browser session with HTTP 409; different sessions can sync concurrently. Database lock failures return HTTP 503. Cleanup uses an independent timeout after request cancellation and discards connections whose unlock cannot be confirmed. Each active sync consumes one additional database connection. Connect directly to PostgreSQL or use session pooling; transaction-mode connection proxies do not support these session locks.

Set `TEST_DATABASE_URL` to a test PostgreSQL database and run `cd apps/api && go test -race ./... -count=1` to exercise database integration tests, including independent connection pools, cancellation cleanup and concurrent HTTP sync requests. Without this variable the database tests are skipped. Tests use temporary transactional schemas and do not modify application tables.

## Database backup and restore

Install the PostgreSQL client tools, set `DATABASE_URL`, and run `./scripts/backup-postgres.sh /secure/path/pr-dashboard.dump`. The script writes a custom-format dump with restrictive file permissions. Restore into a new database with `createdb target_db` followed by `pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DATABASE_URL" /secure/path/pr-dashboard.dump`; verify `/health` and the dashboard before switching traffic. Keep encryption-key backups separate from database backups because stored OAuth tokens cannot be decrypted without the same key.

For a timestamped backup through the project entry point, run `make backup`; override the path with `BACKUP_FILE=/secure/path/pr-dashboard.dump make backup`.

## Historical PR synchronization

Sync reads the authenticated GitHub account creation date and fetches authored PRs across its history. Search intervals are split by creation timestamp whenever GitHub reports more than 1,000 matches or incomplete results. Each interval is paginated, deduplicated, and checked against the reported total; the SDK waits for primary rate-limit resets. The first full sync can take several minutes.

The overview offers every year from account creation through the current year, including years without PR activity. Yearly achievements use merge timestamps for merged PRs and creation timestamps for unmerged PRs (UTC). History completion is recorded only after the complete search snapshot is saved; partial caches are identified in the UI.

### Private repository authorization

GitHub login does not grant a GitHub App access to private repositories. Configure
the app's repository permissions (Pull requests: read, Checks: read, Commit
statuses: read), then install it on each relevant personal account or organization.
Choose all repositories or explicitly select the repositories to include. Existing
installations must approve permission changes.

Set `GITHUB_APP_SLUG` to the app's GitHub slug to enable its direct installation
link. The overview reports accessible accounts, selected/all repository access,
and missing PR permissions. Returning from authorization rechecks access; a
transition to readable access triggers a sync. Private results remain limited
to repositories accessible to both the signed-in user and the installed app.

JavaScript tooling uses Bun 1.3.4 or newer. Run `bun install --frozen-lockfile` from the repository root, `bun run build` for the frontend, and `bun run test` for backend tests plus frontend tests and build. The root `bun.lock` is the single dependency lockfile.

## Background synchronization

The API starts a `robfig/cron` worker automatically. Every 30 seconds it checks eligible connections and runs incremental syncs that are due, normally five minutes after the previous successful completion. The browser can be closed; the API and PostgreSQL must remain running. Failed runs wait at least 15 minutes, and first-time connections still import full history. Expired (30-day) and disconnected sessions are excluded.

Automatic and manual runs share `syncSession` and PostgreSQL advisory locks. The checkpoint is checked again under the lock, so replicas do not repeat freshly completed work. A scan skips overlapping invocations and processes sessions serially to limit GitHub search pressure. Each run has a 30-minute timeout; server shutdown cancels active worker requests. Checkpoints and failure cooldowns survive restarts. The frontend only polls progress and refreshes cached views.
