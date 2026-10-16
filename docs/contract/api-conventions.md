# getpack API Contract Conventions (v3) (shared by `getpack-api` and `getpack-web`)

> This file is **identical in both repositories** (`docs/contract/api-conventions.md`). Change it only by a PR to both repos on the same day. The backend owns the contract; the frontend consumes it.

## 1. Ownership & flow
- `getpack-api` is the **single source of truth** for every endpoint, DTO and enum. The OpenAPI 3.1 document is generated from code (`@nestjs/swagger`) by `pnpm contract:build` (boots the Nest app without listening, writes `contract/openapi.json`) and **committed** in the backend repo.
- Backend CI: regenerates the file and fails if it differs from the committed one (`contract drift`); runs `oasdiff breaking` against `main` — a breaking change fails CI unless the PR has label `contract:breaking` **and** the change goes to a new version prefix or is coordinated with a frontend PR (linked in the description).
- Each backend release tag `vX.Y.Z` publishes `contract/openapi.json` as a release asset.
- `getpack-web` runs `pnpm gen:api` which reads `API_CONTRACT_SOURCE` (default `../getpack-api/contract/openapi.json` for local sibling checkouts; CI uses the release asset URL of the pinned version in `contract.lock.json`) and writes `src/lib/api/schema.d.ts` with `openapi-typescript`. The generated file is committed. Frontend CI regenerates and fails on drift.
- Frontend can work ahead of the backend using a mock server generated from the same contract (MSW handlers from `openapi.json`, or Prism). A frontend feature is "done" only when it passes against the real backend in the integration environment.

## 2. Surfaces & prefixes
| Prefix | Consumer | Token audience |
|---|---|---|
| `/v1/auth/*` | all | issues tokens |
| `/v1/store/*` | customer zone of `getpack-web` (public + signed-in customer; includes BFF-shaped endpoints for pages) | `customer` (or anonymous where marked `@Public()`) |
| `/v1/admin/*` | admin zone of `getpack-web` (Admin, CS, Finance, Prepress, SEO, Logistics…) | `staff` |
| `/v1/partner/*` | partner-factory zone of `getpack-web` **and** machine clients (OAuth2 client-credentials) | `partner` |
| `/v1/b2b/*` | company machine clients of B2B accounts (OAuth2 client-credentials issued by the Company Admin, scopes `b2b_*`, D-291) | `b2b` |
| `/webhooks/*` | payment gateways, slip verification, carriers, LINE/Facebook — signature-verified | none |
| `/health`, `/docs`, `/docs-json` | ops | none (docs disabled in prod unless `DOCS_ENABLED`) |

A token issued for one audience is rejected on every other prefix (guard checks `aud`). OpenAPI tags are prefixed by surface (`store.orders`, `admin.orders`…) so generated types are easy to navigate.

## 3. Resource & payload rules
- JSON keys `camelCase`. Resource nouns, plural: `GET /v1/admin/orders`, `GET /v1/admin/orders/{orderId}`. Actions that are not CRUD: `POST /v1/admin/orders/{orderId}/actions/{action-name}`.
- **IDs**: only `uuid` public ids in URLs and payloads. Internal `bigint` ids never leave the API. Human business keys (`orderCode`, `userCode`, receipt numbers) are returned as separate fields and may be used for search, not as path ids (exception: `GET /v1/store/orders/by-code/{orderCode}` for customer links).
- **Money**: decimal **string** with exactly 2 decimals, e.g. `"1234.50"`, plus `currency: "THB"` at the object level where money appears. Never JSON numbers for money. The frontend never performs price arithmetic; it only formats values the API returns.
- **Quantities / dimensions**: numbers; dimensions in millimetres (`lengthMm`, `widthMm`, `heightMm`).
- **Date-times**: ISO 8601 with offset (`2026-09-22T14:05:00+07:00`), stored UTC, rendered by the API in `Asia/Bangkok` offset. Date-only fields `YYYY-MM-DD`. Business-day maths (lead time, expiry, SLA) is **backend-only**.
- **Enums**: string enums in `snake_case` (`waiting_payment`, `in_production`). Each enum is a named OpenAPI component (`OrderStatus`, `PaymentStatus`, `GraphicStatus`, …) so the frontend can import it by name.
- **Lists**: `GET ...?page=1&perPage=25&sort=createdAt&order=desc&q=...&<filters>` → `{ "data": [...], "meta": { "page": 1, "perPage": 25, "total": 1234 } }`. `perPage` max 100. Feeds/timelines use cursors: `?cursor=...&limit=50` → `{ "data": [...], "meta": { "nextCursor": "..." | null } }`.
- **Errors**: RFC 9457 problem details, `Content-Type: application/problem+json`:
  `{ "type": "https://errors.getpack/<code>", "title": "...", "status": 422, "code": "order.invalid_transition", "detail": "<Thai message>", "errors": [{ "path": "items[0].quantity", "code": "min", "message": "..." }], "requestId": "..." }`. `code` is stable and machine-readable; `detail`/`message` are localised by `Accept-Language` (`th` default, `en`).
- **Idempotency**: every irreversible `POST` (payments, refunds, credit notes, payout runs, bank files, checkout, milestone updates from partners) requires header `Idempotency-Key` (uuid). Replays within 24 h return the original response.
- **Concurrency**: editable aggregates return `ETag`; updates send `If-Match`; mismatch → `412` problem `concurrency.stale`.
- **Files**: `POST .../files/presign` → `{ uploadUrl, fileId, headers, expiresAt }`, client PUTs to S3, then references `fileId`. File downloads are short-lived signed URLs; never permanent public S3 URLs for private files.
- **Localisation**: `Accept-Language: th|en`. Server-generated documents (PDF, email, LINE) are Thai by default.
- **Versioning**: breaking changes → new prefix (`/v2/...`) for the affected surface only; `/v1` kept until the frontend has migrated (same release train, both repos deployed together).

## 4. Auth handshake (backend is cookie-agnostic)
- Login endpoints return tokens in the **body**: `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, subject: { id, type, roles, permissions, scopes } }`.
- Access token: JWT (EdDSA or RS256), 10–15 min, claims `sub`, `aud` (`customer|staff|partner`), `sid` (session id), `scp` (scopes such as `factory:<uuid>`, `company:<uuid>`). JWKS at `/v1/auth/.well-known/jwks.json`.
- Refresh token: opaque, rotating, single-use, stored hashed in `auth_sessions`; reuse of a rotated token revokes the whole session family.
- `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/{store|admin|partner}/me`.
- The frontend stores tokens in httpOnly cookies and forwards them as `Authorization: Bearer` from its server (BFF). Browsers never hold tokens in JS-readable storage.

## 5. Documentation requirements (Swagger + Scalar)
The generated OpenAPI document is the product, not a by-product: `getpack-web`, partner integrations and QA all read it. Documentation completeness is enforced in CI, not by review.

**Served UIs** (from the same document, in every environment except production unless `DOCS_ENABLED=true`, and then behind staff auth or an IP allow-list):
- `/docs` — **Scalar API reference** (`@scalar/nestjs-api-reference`), the primary developer UI: search, per-surface grouping, request/response examples, client snippets, "try it" pointed at the sandbox server.
- `/docs/swagger` — Swagger UI, kept for teams that expect it.
- `/docs-json` and `/docs.yaml` — the raw document; `contract/openapi.json` in the repo is the same file, committed.

**Every operation must carry**: a stable `operationId` (`<surface>.<resource>.<action>`, e.g. `admin.orders.approveSlip`), a one-line `summary` and a `description` that states the business rule and links the decision id (`D-###`) it implements, its surface tag, the security scheme for its audience, and `@ApiProperty` on every DTO field (type, format, nullable, enum as a named component, `example`, unit in the description, `deprecated` where relevant).

**Every operation must document all of its responses**, each with a schema **and at least one example**:
- success: `200` / `201` (+ `Location`) / `202` (async jobs, with the polling endpoint in the description) / `204`;
- errors as `application/problem+json` with the `code` values that operation can actually return — `400` malformed, `401` unauthenticated, `403` permission or audience/scope, `404` not found or not visible to this actor, `409` state conflict (e.g. `order.invalid_transition`), `412` `concurrency.stale`, `422` validation (with a field-level `errors[]` example), `429` rate limited (+ `Retry-After`), `500`, `503`;
- the shared error components are defined once and referenced, never re-declared per endpoint.

**Headers and parameters are documented too**: `Idempotency-Key` (required where §3 says so, with the replay behaviour described), `If-Match` / `ETag`, `Accept-Language`, `X-Request-Id`, rate-limit headers, pagination and filter/sort query parameters with their allowed values.

**Also in the document**: `servers` (local, integration, sandbox, production), a description per tag, OpenAPI 3.1 `webhooks` for every inbound provider callback (payload + signature header + expected response), file-upload flows (presign → PUT → reference) shown with examples, and money/date formats restated in the info description.

**CI gates** (`pnpm contract:lint`): Spectral with a getpack ruleset — fail when an operation lacks `operationId`, `summary`, tag, security, a documented `4xx`/`5xx` set, or an example on any request/response body; fail on inline enums, on `type: object` without properties, on duplicated schema shapes, and on any `example` containing real-looking personal data. `pnpm contract:build` writes the document deterministically; drift and breaking-change checks run as in §1.

## 6. Realtime
- Server-sent events or Pusher channels are authorised by the API (`POST /v1/{surface}/realtime/auth`). Event payloads carry ids + type only; the client refetches through the normal API (no business data in realtime payloads).
