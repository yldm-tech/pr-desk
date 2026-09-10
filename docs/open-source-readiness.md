# Open-source readiness review

Reviewed 2026-09-10. This is an engineering review of the repository and local builds, not a guarantee that every vulnerability, provenance issue or external artifact has been found. The repository remains private; no visibility or organization security settings were changed.

## Addressed in this change

| Finding | Change |
| --- | --- |
| Pull-request code ran on internal infrastructure runners | All supplied workflows now use GitHub-hosted Ubuntu runners. Organization runner access still needs review before publication. |
| Mutable action tags and persisted checkout credentials in PR jobs | Resolve the existing action versions to full commit SHAs; disable persisted credentials for CI checkouts. Release retains the credentials it needs to create tags. |
| Known vulnerabilities reachable through the old Go toolchain and dependencies | Upgrade Go from 1.25.5 to 1.26.8 in the module and image, and update affected x/* and quic-go dependencies. |
| Default request logging included OAuth callback queries and could reveal private search text | Log method, matched route template and status only. Recovery omits raw requests. Parameterize SQL logs and replace raw database errors in API responses. Surrounding proxy logs still require operator review. |
| PR detail lookup accepted raw string IDs in GORM's variadic lookup | Parse positive numeric IDs before database access; regression tests reject SQL expressions and oversized IDs. |
| Example PostgreSQL port bound all host interfaces | Bind the Compose database port to loopback. Example credentials remain explicitly development-only. |
| Image defaulted to root | Set the application runtime user to UID/GID 10001. |
| New users could see an unexplained empty view; fast syncs could finish between UI polls | Add first-import guidance, last-successful-sync time, and refresh data when a new completion is observed. |

## Scan results and limits

- Verification passed: frontend formatting/lint/type checks, 12 frontend tests, production web build, Go vet and race tests with local PostgreSQL integration enabled, workflow lint and image build. The final image is also smoke-tested with a disposable database, a read-only filesystem and UID 10001; these tests do not exercise real GitHub OAuth authorization.
- Gitleaks 8.30.1 scanned reachable local Git history across fetched refs with redaction and reported no findings. Tracked historical paths contain example env files and application icons, not tracked `.env` credentials or database dumps. This is not proof that unreachable commits, old CI logs, release artifacts, backups or external repositories are clean.
- `bun audit` reported no known vulnerabilities in the installed frontend dependency set.
- Govulncheck v1.8.0 with Go 1.26.8 reports no reachable or imported-package vulnerabilities after updates. It retains one module-only advisory, [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932), for the unmaintained `golang.org/x/crypto/openpgp` package. This application does not import that package; there is no fixed version for the advisory. Do not add OpenPGP usage from that module.
- License discovery using `go-licenses` found MIT, BSD-3-Clause and Apache-2.0 in the loaded Go dependency packages. It warns that assembly/non-Go code cannot be fully inspected and correctly reports the application itself as unlicensed.
- Metadata from 215 installed JavaScript package/version entries (including the workspace package and macOS optional packages) includes MIT, Apache-2.0, BSD-3-Clause, ISC, Unlicense, 0BSD and MPL-2.0. The workspace has no license. Lightning CSS and its platform packages carry MPL-2.0 and are build tooling. This metadata inspection is not a complete review of every upstream license text, Linux optional package or bundled component.
- Private vulnerability reporting could not be confirmed: its API returned 404. A repository runner query returned zero directly listed runners, which does not establish that organization runner groups are inaccessible.

## Decisions before public source release

1. Choose a project LICENSE and confirm the rights to publish all contributions, copied internal helper code and icon assets. Source inspection and an original-looking icon do not prove ownership. [Public visibility does not substitute for a license](https://choosealicense.com/no-permission/).
2. Remove the repository from internal runner groups or otherwise enforce that public forks cannot select infrastructure runners. Changing the supplied YAML alone is insufficient because a contributor can propose different workflow code. [GitHub's runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
3. Enable and test private vulnerability reporting or establish a real private reporting contact. `SECURITY.md` documents the conditional channel without claiming it is already enabled.
4. Review old Actions logs, release assets, container layers and Git author metadata before exposing them. This review did not erase history, revoke credentials, inspect every historic image or change account settings.
5. Complete third-party attribution packaging for distributable binaries/images and confirm asset provenance. Keep upstream notices and examine the exact artifacts being shipped. [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains its file-level obligations; MPL tooling does not automatically require relicensing the whole application.

## Before offering a shared hosted service

Agree on retention, deletion/export and GitHub revocation behavior. Disconnect currently removes the current connection, not all stored PR/comment rows or backups. The app is not a complete team review inbox and has not undergone an independent penetration test. Authentication hardening, tenant isolation and abuse limits need ongoing verification. See [data handling](privacy.md) and [security guidance](../SECURITY.md).

## Reproduce the checks

```sh
gitleaks git --redact --no-banner --log-opts=--all .
bun audit
vp check
bun run test:web
bun run build
actionlint
cd apps/api
go vet ./...
go test -race ./... # set TEST_DATABASE_URL for isolated local PostgreSQL tests
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -show verbose ./...
go run github.com/google/go-licenses/v2@v2.0.1 report ./...
```

CI now includes redacted history scanning and dependency audits to catch regressions. Scan findings are time-dependent and must be revisited at release time.
