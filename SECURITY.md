# Security

## Reporting a vulnerability

Do not include tokens, private PR contents, cookies or database dumps in public issues. If private vulnerability reporting is enabled, use [GitHub's private report form](https://github.com/yldm-tech/pr-desk/security/advisories/new). If it is unavailable, ask a maintainer through an existing private contact for a secure reporting channel before sending details. Enabling and testing that channel is a prerequisite for public release.

Include affected versions, a minimal reproduction using synthetic data, expected behavior and potential impact. No response-time guarantee or dedicated security support is currently offered.

## Deployment

- Use HTTPS and set `WEB_ORIGIN` and `GITHUB_REDIRECT_URL` to the exact public origin and callback. Register the callback in the GitHub App before inviting users.
- Generate a stable 32-byte encryption key and unique database credentials. Keep keys outside source control and images, and protect backups. Development Compose credentials must not be used for internet-exposed databases.
- Keep untrusted pull requests off infrastructure runners. The supplied workflows use GitHub-hosted runners; also remove this repository's access to internal runner groups before making it public.
- Update images and dependencies; run `bun audit`, `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` from `apps/api`, and a redacted history scan before release.
- Keep proxy and platform logs from recording OAuth callback query strings or cookies. Application request logs use route templates; operators must configure surrounding proxies separately.

## Limits

This project is under development and has not received an independent penetration test. It stores private repository metadata when authorized. Application session checks do not replace an operator's access controls, retention policy, rate limits or abuse monitoring. Read [data handling](docs/privacy.md) before operating a shared instance.
