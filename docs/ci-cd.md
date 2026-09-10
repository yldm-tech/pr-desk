# CI/CD

The workflows follow `yldm-tech/glean`: organization self-hosted runners (`yldm-backend-runners`), PR cancellation, independent main CI runs, and release gated by a successful `CI` workflow on main. Runner proxy forwarding comes from Glean's existing helper; Docker base images and CI PostgreSQL use `mirror.gcr.io` for this runner network.

## Checks

- Web: Bun version from root `packageManager`, frozen lockfile, unit tests, TypeScript and Vite build.
- API: Go version from `apps/api/go.mod`, with local runner caches (no duplicate remote cache upload), `go vet`, and `go test -race ./... -count=1` against PostgreSQL 16. Every run gets a unique container and loopback port; cleanup runs on failure too.
- Containers: build both root-context Dockerfiles without pushing.
- `workflow_dispatch` can rerun CI when needed. Main runs are not cancelled by later pushes.

## Release

A successful main push or manual CI run starts Release. Failed, cancelled, PR and foreign-repository runs cannot publish. Release checks out the exact tested SHA and runs serially.

Images:

- `ghcr.io/yldm-tech/pr-desk-api`
- `ghcr.io/yldm-tech/pr-desk-web`

Each receives `0.1.<CI run number>` and `sha-<full tested SHA>` tags. The same run's retry reuses its version. The git tag is reserved against the tested SHA before publishing; a mismatching tag fails the release. Both images are built before either is pushed, and a GitHub Release is published after both pushes succeed. A failed run may leave a reserved tag or one uploaded image; rerunning that Release completes the same version.

`latest` is updated only when the tested SHA is still main's tip, so late older runs do not replace newer source with older source. Deployments should select an explicit version for both images rather than mixing moving `latest` tags. No version-bump commits are needed; gaps in the version sequence are expected because PR CI runs consume run numbers.

Publishing uses the repository `GITHUB_TOKEN` with `packages: write` and `contents: write`, without separate registry credentials. New GHCR packages are private; repository access is linked by OCI source labels. The API and web images have revision and version labels.

## Running the images

Configure application secrets in the deployment environment, never in build arguments. The API listens on `PORT` (default 8080). Web serves port 80 and forwards `/api/` to `API_UPSTREAM` (default `api:8080`). Set `WEB_ORIGIN` to the browser-facing web URL and register its `/api/v1/auth/github/callback` as the GitHub App callback. The API and PostgreSQL must be reachable on the deployment network.

The production frontend uses same-origin `/api` requests, so one image works at different hostnames. `VITE_API_URL` can override this at build time for a custom build; local development defaults to `http://localhost:8081`. Compose automatically sets `API_UPSTREAM` to the configured API port.

Unlike Glean's existing application, this repository has no ArgoCD application or target environment yet. This pipeline publishes deployable images; it does not modify `yldm-platform` or deploy to a cluster. A deployment can consume the explicit image versions once its target is configured.
