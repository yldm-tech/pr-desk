# Library adoption audit

Use maintained libraries for reusable infrastructure. Keep PR-specific decisions in application code; use platform implementations for browser and cryptographic primitives.

| Area | Implementation after audit | Evidence |
| --- | --- | --- |
| Translation, fallback, React updates | i18next + react-i18next, JSON resources | Five locales switched and persisted across reload in Playwright; key parity test |
| Language detection and persistence | i18next-browser-languagedetector | Browser reload verification |
| Navigation | React Router HashRouter, useLocation, useNavigate | Removed Zustand store, hashchange listener and history.replaceState; merged deep link/reload/back verified |
| HTTP client | Ky with credential inclusion, timeout and automatic non-success rejection | Production typecheck/build; auth and stats responses validated with Zod |
| Queries and mutations | TanStack Query, including sync and logout mutations | Existing query cache/invalidation; library pending/error state |
| CORS | gin-contrib/cors | Local API starts and serves UI requests; independent mutation-origin tests |
| OAuth | x/oauth2 shared Config, AuthCodeURL and Exchange | Authorization/state tests; explicit AuthStyleInParams prevents automatic credential-style probing; single-exchange failure regression |
| GitHub API | go-github search/status/user services and NewRequest/Do for activity payloads | Removed manual HTTP construction/authentication/JSON decoding; SDK retry/authentication and invalid-response tests |
| Retry execution | cenkalti/backoff/v5 | Library owns timer/cancellation/attempt limit; regression tests cover transport failures, cancellation and original status policies |
| Validation | Zod on frontend, Gin/GORM on backend | Existing data and PostgreSQL integration tests |
| Formatting | Prettier and gofmt | main.tsx expanded from compressed code; formatter installed as development dependency |
| Dialog focus/Escape | Native HTML dialog | Uses browser modal API; close label now translated |
| Dates | JavaScript Intl | Header and PR timestamps use selected locale |
| Encryption/random/session identifiers | Go crypto/aes, cipher, rand, encoding/base64 | Existing crypto tests; no custom crypto algorithm |
| Sync exclusion | PostgreSQL advisory locks, database/sql and sync.Once | PostgreSQL cross-pool/cancellation tests |

## Retained application policy

GET-only retries, a three-attempt cap, and refusing invalid or over-ten-second Retry-After values are intentional policy layered on backoff. GitHub pagination loops retain per-page and maximum-page budgets; the SDK executes requests and decodes results. The GraphQL review-thread selection is application data selection sent through the same SDK transport. PR status precedence, session scoping, comment persistence and origin checks are application rules rather than substitute implementations of a generic library.

## Verification

- `go test ./...` passed with `TEST_DATABASE_URL` set to the local PostgreSQL database, including integration tests (not skipped). Integration fixtures use isolated schemas/transactions.
- Added SDK transport/authentication/response validation, cancellation/transport retry, and no-retry OAuth exchange tests.
- Frontend typecheck, all nine tests and production build passed.
- Playwright verified all five locale selections persist across reload, merged-filter deep links survive refresh, and browser history navigation works.
- Rebuilt the local API container; `/health` reports API and database OK. Vite serves port 5174.

## Limits

Browser verification used an unauthenticated test browser. It did not initiate a new live GitHub OAuth login or sync the user's account. Production build retains a bundle-size warning (about 580 KB minified). Neither limitation is a claim that live account synchronization was tested.
