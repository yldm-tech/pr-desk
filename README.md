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

Vite+ (`vp`) provides development, build, test, format and lint commands. Bun manages the JavaScript workspace from the root; Go dependencies remain in `apps/api/go.mod`. The application Docker build uses the repository root as their context.

## Commands

```sh
vp install --frozen-lockfile
vp run dev              # Web development server
make api                # API (export the required environment first)
vp check                # Format, lint and type checks
vp run test             # Go tests, web tests and production build
make build              # dist/pr-desk binary with embedded web assets
make production         # One application container + PostgreSQL
```

Install the global `vp` CLI using the [official Vite+ setup](https://viteplus.dev/guide/). Tool versions are pinned in `package.json` and `.node-version`; formatter/linter settings live in root `vite.config.ts`. Run `vp fmt` to format; line width uses Oxfmt’s maximum of 320.

Configure GitHub App authorization and `.env` before connecting. See [development and operations](docs/development.md) for setup, ports, database backups and background synchronization.

## CI and releases

PRs and main run web checks, Go race/integration tests with isolated PostgreSQL, and the embedded application Docker build on the organization's runners. Successful main CI publishes a GHCR application image and a GitHub Release.

See [CI/CD](docs/ci-cd.md) for triggers, tags and image-based deployment, and [library decisions](docs/library-audit.md) for the implementation inventory.
