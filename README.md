# PR Desk

A local web dashboard for GitHub contributions, open pull requests, review activity and background synchronization.

## Repository layout

```text
apps/
  api/                  Go API, PostgreSQL models and tests
  web/                  React/Vite frontend and tests
docs/                   Development, operations and library decisions
scripts/                Backup and CI runner helpers
.github/workflows/      CI checks and gated image releases
```

Bun manages the JavaScript workspace from the root; Go dependencies remain in `apps/api/go.mod`. The application Docker build uses the repository root as their context.

## Commands

```sh
bun install --frozen-lockfile
bun run dev             # Web development server
make api                # API (export the required environment first)
make test               # Go tests, web tests, typecheck and production build
make build              # dist/pr-desk binary with embedded web assets
make production         # One application container + PostgreSQL
```

Configure GitHub App authorization and `.env` before connecting. See [development and operations](docs/development.md) for setup, ports, database backups and background synchronization.

## CI and releases

PRs and main run web checks, Go race/integration tests with isolated PostgreSQL, and the embedded application Docker build on the organization's runners. Successful main CI publishes a GHCR application image and a GitHub Release.

See [CI/CD](docs/ci-cd.md) for triggers, tags and image-based deployment, and [library decisions](docs/library-audit.md) for the implementation inventory.
