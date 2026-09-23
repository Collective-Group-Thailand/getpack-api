# ADR-0003 — API contract & repository split

**Status:** Accepted (2026-09-23)
**Decision ids:** D-002 · contract: `docs/contract/api-conventions.md` §1–§3, §5

## Context
Packio has two repositories: `packio-api` (this NestJS backend) and `packio-web` (one Next.js app with customer, admin and partner zones behind a BFF). They are built and released by different sessions, so they need one artefact that states exactly what the API offers and that both sides can check automatically.

## Decision
- **The backend owns the contract.** The OpenAPI 3.1 document is generated from code (`@nestjs/swagger` DTOs + CLI plugin) — never hand-written — by `pnpm contract:build`, which boots the app with fake integrations (no listening, lazy DB/Redis connections) and writes `contract/openapi.json`. The file is committed together with the code change that produced it (CLAUDE.md hard rule).
- **Deterministic output:** keys sorted recursively, no timestamps, version from `package.json`, operation ids `<Controller>_<method>`. Two builds of the same code are byte-identical (e2e test).
- **Rules enforced at build time** (`contractViolations`): every enum is a named component (`enumName`), and every operation tag is prefixed by its surface (`store.`, `admin.`, `partner.`, `auth.`, `webhooks.`, or `ops.` for health). Errors are documented as `application/problem+json` `ProblemDetails`.
- **Surfaces** are Nest modules mounted with `RouterModule` under `/v1/{auth|store|admin|partner}` (URI versioning) and `/webhooks` (unversioned). One bearer security scheme per audience: `customer`, `staff`, `partner` (ADR-0004).
- **Documentation is part of the contract** (§5). Operations are documented with the decorators in `src/common/openapi/decorators.ts`:
  - `@ApiEndpoint`: operationId `<surface>.<resource>.<action>`, summary, and a description citing `D-###`/`ADR-####`;
  - `@ApiSuccess`: a schema plus a mandatory example;
  - `@ApiStandardErrors(...codes)`, `@ApiIdempotent` (via `@Idempotent`), `@ApiConcurrency`, `@ApiPaginated`, `@ApiPublic`, and `ApiSurface()`, which adds the bearer scheme and 401/403.

  The decorators record intent in `x-packio-*` extensions. One enrichment pass turns those into references to shared components that are defined once: a problem example per error code, `Accept-Language` / `Idempotency-Key` / `If-Match` parameters, and `X-Request-Id` / `ETag` / `Location` / rate-limit / `Retry-After` headers. Contributions from several decorators are merged per status, never overwritten, and unused shared components are pruned. The document also carries `servers` (local plus integration, sandbox and production with placeholder hosts until they are confirmed), a description per tag (`src/common/openapi/tags.ts`), and the money/date/error/pagination formats in `info.description`.
- **Served docs:** Scalar at `/docs` (self-hosted pinned bundle, per-request CSP nonce, no telemetry/fonts/proxy/MCP), Swagger UI at `/docs/swagger`, and raw `/docs-json` and `/docs.yaml`. Development/test: open. Production: nothing is served unless `DOCS_ENABLED=true`, and then only to callers inside `DOCS_ALLOWED_CIDRS` (`TRUST_PROXY` sets how many proxy hops to trust); everyone else gets 404. Staff-token access is added with auth in B1.3.
- **`pnpm contract:lint`:** Spectral with the Packio ruleset in `contract/spectral/` (rules and fake-data conventions in its README). It fails on any warning.
 contract drift (`pnpm contract:build && git diff --exit-code contract/openapi.json`) and `oasdiff breaking` against the base branch — a breaking change fails unless the PR carries the `contract:breaking` label and moves to a new version prefix or links a coordinated `packio-web` PR.
- **Distribution:** tag `vX.Y.Z` (must equal `package.json` version) publishes a GitHub release with `openapi.json` attached; `packio-web` pins that version in `contract.lock.json` and generates types with `openapi-typescript`. Local development reads the sibling checkout.
- `docs/contract/api-conventions.md` and `docs/decisions.md` are identical in both repositories and change only through same-day PRs to both. They are excluded from code formatters.

## Consequences
- The frontend never guesses shapes; it can mock from the same contract (MSW/Prism) and still must pass against the real backend.
- Every DTO needs explicit swagger metadata for anything the plugin cannot infer (nullable, `integer`, `enumName`); the build fails otherwise.
- Test-only controllers live under `test/` and never reach the contract.
