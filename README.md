# PR Desk

**English** · [简体中文](doc/README.zh-CN.md) · [日本語](doc/README.ja.md) · [한국어](doc/README.ko.md) · [Español](doc/README.es.md)

[![CI](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/yldm-tech/pr-desk/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/releases)
[![Go](https://img.shields.io/badge/Go-1.26.8-00ADD8?logo=go&logoColor=white)](apps/api/go.mod)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](apps/web/package.json)
[![Bun](https://img.shields.io/badge/Bun-1.3.4-000000?logo=bun&logoColor=white)](package.json)
[![Stars](https://img.shields.io/github/stars/yldm-tech/pr-desk?style=flat)](https://github.com/yldm-tech/pr-desk/stargazers)

A self-hostable GitHub PR dashboard for finding failed checks, requested changes and merge conflicts across your contributions, with historical activity and background synchronization.

## What you can do

- Open **Needs attention** to find your PRs with failed checks, changes requested or merge conflicts.
- Browse contributions across repositories, search PRs, and inspect review activity.
- Connect GitHub once to start importing history automatically; follow progress and the last successful sync time. Background updates continue after you close the page.
- Review private-repository access and install your GitHub App on the repositories you want to include.

PR Desk currently centers on your authored contributions. It is not a complete inbox of every PR where someone requests your review.

## First run

1. Copy `.env.example` to `.env` and set a unique `TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 16`.
2. Create a GitHub App and set its client ID, client secret and slug in `.env`. Register `http://localhost:8080/api/v1/auth/github/callback` as its callback. For a hosted instance, register that instance's exact HTTPS callback instead.
3. Run `docker compose up -d --build`, then open `http://localhost:8080` and connect GitHub. The first import may take several minutes.

Private PRs require installing the App on the relevant repositories with read access to pull requests, checks and commit statuses. See [setup and operations](docs/development.md), [data handling](docs/privacy.md), and [security guidance](SECURITY.md). The Compose database credentials are local development examples; both published ports bind to loopback.

## Repository layout

```text
apps/
  api/                  Go API, PostgreSQL models and tests
  web/                  React/Vite frontend and tests
doc/                    Translated README files
docs/                   Development, operations and library decisions
scripts/                Backup and CI runner helpers
.github/workflows/      CI checks and gated image releases
```

Vite+ (`vp`) provides development, build, test, format and lint commands. Bun manages the JavaScript workspace from the root; Go dependencies remain in `apps/api/go.mod`. The application Docker build uses the repository root as its context.

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

PRs and main run web checks, Go race/integration tests with isolated PostgreSQL, and the embedded application Docker build on GitHub-hosted runners. Successful main CI publishes a GHCR application image and a GitHub Release.

See [CI/CD](docs/ci-cd.md) for triggers, tags and image-based deployment, and [library decisions](docs/library-audit.md) for the implementation inventory.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local checks and pull request guidance. Please report vulnerabilities through the private channel described in [SECURITY.md](SECURITY.md).

[![Contributors](https://contrib.rocks/image?repo=yldm-tech/pr-desk)](https://github.com/yldm-tech/pr-desk/graphs/contributors)

[View all contributors](https://github.com/yldm-tech/pr-desk/graphs/contributors). Contributor avatars are provided by contrib.rocks and require a publicly accessible repository.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yldm-tech/pr-desk&type=Date)](https://star-history.com/#yldm-tech/pr-desk&Date)

The chart and public repository badges become available once the repository is public. [View stargazers on GitHub](https://github.com/yldm-tech/pr-desk/stargazers).

## License

PR Desk is licensed under the [Apache License, Version 2.0](LICENSE).
