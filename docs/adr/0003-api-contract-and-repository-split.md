# ADR-0003 — API contract & repository split

**Status:** Accepted (2026-09-23)
**Decision ids:** D-002 · contract: `docs/contract/api-conventions.md` §1–§3

## Context
Packio has two repositories: `packio-api` (this NestJS backend) and `packio-web` (one Next.js app with customer, admin and partner zones behind a BFF). They are built and released by different sessions, so they need one artefact that states exactly what the API offers and that both sides can check automatically.

## Decision
- **The backend owns the contract.** The OpenAPI 3.1 document is generated from code (`@nestjs/swagger` DTOs + CLI plugin) — never hand-written — by `pnpm contract:build`, which boots the app with fake integrations (no listening, lazy DB/Redis connections) and writes `contract/openapi.json`. The file is committed together with the code change that produced it (CLAUDE.md hard rule).
- **Deterministic output:** keys sorted recursively, no timestamps, version from `package.json`, operation ids `<Controller>_<method>`. Two builds of the same code are byte-identical (e2e test).
- **Rules enforced at build time** (`contractViolations`): every enum is a named component (`enumName`), and every operation tag is prefixed by its surface (`store.`, `admin.`, `partner.`, `auth.`, `webhooks.`, or `ops.` for health). Errors are documented as `application/problem+json` `ProblemDetails`.
- **Surfaces** are Nest modules mounted with `RouterModule` under `/v1/{auth|store|admin|partner}` (URI versioning) and `/webhooks` (unversioned). One bearer security scheme per audience: `customer`, `staff`, `partner` (ADR-0004).
- **CI gates:** contract drift (`pnpm contract:build && git diff --exit-code contract/openapi.json`) and `oasdiff breaking` against the base branch — a breaking change fails unless the PR carries the `contract:breaking` label and moves to a new version prefix or links a coordinated `packio-web` PR.
- **Distribution:** tag `vX.Y.Z` (must equal `package.json` version) publishes a GitHub release with `openapi.json` attached; `packio-web` pins that version in `contract.lock.json` and generates types with `openapi-typescript`. Local development reads the sibling checkout.
- `docs/contract/api-conventions.md` and `docs/decisions.md` are identical in both repositories and change only through same-day PRs to both. They are excluded from code formatters.

## Consequences
- The frontend never guesses shapes; it can mock from the same contract (MSW/Prism) and still must pass against the real backend.
- Every DTO needs explicit swagger metadata for anything the plugin cannot infer (nullable, `integer`, `enumName`); the build fails otherwise.
- Test-only controllers live under `test/` and never reach the contract.
