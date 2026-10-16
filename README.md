# getpack-api

Backend of **getpack — Your Packaging Production Partner**, operated by Collective Group (Thailand).
NestJS 12 · Node 24 · TypeScript 6 · PostgreSQL 18 + pgvector · Redis/BullMQ · Prisma 7.
Frontend: `getpack-web`. The only shared artefact is [`contract/openapi.json`](contract/openapi.json).

Start with [`CLAUDE.md`](CLAUDE.md), [`docs/prompts/00-master-plan.md`](docs/prompts/00-master-plan.md),
[`docs/decisions.md`](docs/decisions.md) and [`docs/contract/api-conventions.md`](docs/contract/api-conventions.md).

## Run locally
```bash
nvm use                      # Node 24 (.nvmrc)
corepack enable              # pnpm version from package.json
cp .env.example .env         # every variable is documented there
docker compose up -d         # postgres (pgvector pg18), redis, localstack (S3/SES/SQS/Secrets), mailpit
pnpm i                       # also generates the Prisma client
pnpm dev                     # HTTP API on :3000 with fake integrations — /health, /docs (Scalar), /docs/swagger
pnpm dev:worker              # worker process (BullMQ); idles until queues exist
```
API docs: http://localhost:3000/docs (Scalar) · `/docs/swagger` · `/docs-json` · `/docs.yaml`.
Mailpit UI: http://localhost:8025 · LocalStack: http://localhost:4566 (bucket `getpack-dev`).

**Before the rename (D-425)** the Compose project was `packio-api`, so an existing local database lives in the volume
`packio-api_postgres-data` (user, password and database `packio`). Keep it by copying it once into the new project's
volume before the first `docker compose up` — the `DATABASE_URL` in your `.env` keeps working — and point `S3_BUCKET` at
`getpack-dev`:

```bash
docker compose -p packio-api down
docker volume create getpack-api_postgres-data
docker run --rm -v packio-api_postgres-data:/from -v getpack-api_postgres-data:/to alpine cp -a /from/. /to/
docker compose up -d && pnpm db:migrate
```

## Documenting an endpoint
Use the decorators in `src/common/openapi/decorators.ts` (`@ApiEndpoint`, `@ApiSuccess`, `@ApiStandardErrors`,
`@Idempotent`, `@ApiConcurrency`, `@ApiPaginated`) on a controller decorated with `ApiSurface(surface, resource)`,
and register the tag in `src/common/openapi/tags.ts`. `test/fixtures/docs-example.controller.ts` shows every decorator.
Then run `pnpm contract:build && pnpm contract:lint` and commit `contract/openapi.json`.

## Commands
| Command | What it does |
|---|---|
| `pnpm lint` · `pnpm format:check` · `pnpm typecheck` | ESLint (flat, type-checked), Prettier, `tsc --noEmit` |
| `pnpm test` | unit tests (no Docker) |
| `pnpm test:int` | integration tests with Testcontainers (`pgvector/pgvector:pg18`, `redis:7`) |
| `pnpm test:e2e` | full app against containers, fake third-party integrations |
| `pnpm contract:build` | regenerates `contract/openapi.json` — commit it with every endpoint change |
| `pnpm contract:lint` | Spectral with the getpack ruleset (`contract/spectral/`): operationId, summary, decision id, security, full status-code set, examples, fake data only |
| `pnpm build` · `pnpm start` · `pnpm start:worker` | compile and run the API / worker from `dist/` |
| `pnpm build:fast` | SWC compile of `src`, `scripts` and `prisma/seed` into `dist/` without type-checking (~20 s); the seed and script commands below use it — `build` and `contract:build` keep `tsc` (the contract needs the Swagger plugin) |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:seed:dev` | apply migrations; reference data from decisions; fake dev users (`<role>@example.invalid`, password `DEV_SEED_PASSWORD`) |
| `pnpm rbac:build` | regenerates `docs/rbac.md` from the IAM catalogues (a unit test fails on drift) |

Testcontainers needs a running Docker. With Docker Desktop on macOS the tests find
`~/.docker/run/docker.sock` automatically when `DOCKER_HOST` is not set.

## Layout
```
src/main.ts            HTTP process          src/worker.ts   worker process
src/bootstrap.ts       HTTP pipeline shared by main, contract build and tests
src/config/            validated environment (fail fast), Secrets Manager loader
src/common/            problem details (RFC 9457, th/en), validation, pagination, idempotency, ETag, logging, OpenAPI,
                       request context (actor), auth decorators (@Public, @Can), money, Bangkok time & working days
src/database/          PrismaService (withTx), Redis
src/platform/          audit, activity, domain events + outbox relay, settings, feature flags, approvals,
                       notifications, realtime (SSE, web push), files, calendars, health
src/modules/auth/      sign-in (staff, partner, customer OTP/Firebase/LINE, client credentials), sessions, JWKS
src/modules/iam/       permissions, @Can guard, scoping (factory/company), SoD, user & role admin
src/modules/surfaces/  /v1/auth · /v1/store · /v1/admin · /v1/partner · /webhooks
src/integrations/      one folder per provider, each with a fake (INTEGRATIONS_MODE=fake|real)
prisma/                prisma.config.ts, multi-file schema, migrations, seeds
test/                  unit (HTTP pipeline), integration, e2e, fixtures
```

## Docker
One image, two processes:
```bash
docker build -t getpack-api .
docker run getpack-api                          # API (default CMD)
docker run getpack-api node dist/src/worker.js  # worker
```
