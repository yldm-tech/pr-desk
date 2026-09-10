# Contributing

Start with a focused issue or pull request describing the user-visible problem, intended behavior and verification. For larger changes, discuss scope first.

Follow the [development guide](docs/development.md). Install the pinned Vite+ and Bun toolchain, then run:

```sh
vp install --frozen-lockfile
vp check
bun run test:web
bun run build
cd apps/api
go vet ./...
go test -race ./...
```

Set `TEST_DATABASE_URL` to a disposable local PostgreSQL database to exercise integration tests; without it those tests skip. Never point tests at a hosted production database. Keep all locale files in sync when changing UI text. Use synthetic accounts, repositories and tokens in fixtures.

Do not submit `.env` files, keys, real PR data, database dumps or screenshots containing private information. Report security issues privately as described in [SECURITY.md](SECURITY.md).

The project license is pending. Do not assume permission to redistribute the project before a license is selected; maintainers must settle contribution licensing before accepting external contributions for public release.
