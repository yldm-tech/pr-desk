# PR Desk

A local web dashboard for GitHub contributions, open pull requests, review activity and background synchronization.

## Repository layout

```text
apps/
  api/                  Go API, PostgreSQL models and tests
  web/                  React/Vite frontend and tests
  web/Dockerfile        Nginx image with the /api reverse proxy
docs/                   Development, operations and library decisions
scripts/                Backup and CI runner helpers
.github/workflows/      CI checks and gated image releases
```

Bun manages the JavaScript workspace from the root; Go dependencies remain in `apps/api/go.mod`. Both Docker builds use the repository root as their context.

## Commands

```sh
bun install --frozen-lockfile
bun run dev             # Web development server
make api                # API (export the required environment first)
make test               # Go tests, web tests, typecheck and production build
make production         # Local Docker Compose stack
```

Configure GitHub App authorization and `.env` before connecting. See [development and operations](docs/development.md) for setup, ports, database backups and background synchronization.

## CI and releases

PRs and main run web checks, Go race/integration tests with isolated PostgreSQL, and both production Docker builds on the organization's runners. Successful main CI publishes private GHCR images and a GitHub Release.

See [CI/CD](docs/ci-cd.md) for triggers, tags and image-based deployment, and [library decisions](docs/library-audit.md) for the implementation inventory.
