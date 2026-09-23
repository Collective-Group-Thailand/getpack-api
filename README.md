# packio-api

Backend of **Packio — Your Packaging Production Partner**, operated by Collective Group (Thailand).
NestJS 12 · Node 24 · TypeScript 6 · PostgreSQL 18 + pgvector · Redis/BullMQ · Prisma 7.
Frontend: `packio-web`. The only shared artefact is [`contract/openapi.json`](contract/openapi.json).

Start with [`CLAUDE.md`](CLAUDE.md), [`docs/prompts/00-master-plan.md`](docs/prompts/00-master-plan.md),
[`docs/decisions.md`](docs/decisions.md) and [`docs/contract/api-conventions.md`](docs/contract/api-conventions.md).

## Run locally
```bash
nvm use                      # Node 24 (.nvmrc)
corepack enable              # pnpm version from package.json
cp .env.example .env         # every variable is documented there
docker compose up -d         # postgres (pgvector pg18), redis, localstack (S3/SES/SQS/Secrets), mailpit
pnpm i                       # also generates the Prisma client
pnpm dev                     # HTTP API on :3000 with fake integrations — /health, /docs
pnpm dev:worker              # worker process (BullMQ); idles until queues exist
```
Mailpit UI: http://localhost:8025 · LocalStack: http://localhost:4566 (bucket `packio-dev`).

## Commands
| Command | What it does |
|---|---|
| `pnpm lint` · `pnpm format:check` · `pnpm typecheck` | ESLint (flat, type-checked), Prettier, `tsc --noEmit` |
| `pnpm test` | unit tests (no Docker) |
| `pnpm test:int` | integration tests with Testcontainers (`pgvector/pgvector:pg18`, `redis:7`) |
| `pnpm test:e2e` | full app against containers, fake third-party integrations |
| `pnpm contract:build` | regenerates `contract/openapi.json` — commit it with every endpoint change |
| `pnpm build` · `pnpm start` · `pnpm start:worker` | compile and run the API / worker from `dist/` |
| `pnpm db:migrate` | apply Prisma migrations (first migration arrives in B1.2) |

Testcontainers needs a running Docker. With Docker Desktop on macOS the tests find
`~/.docker/run/docker.sock` automatically when `DOCKER_HOST` is not set.

## Layout
```
src/main.ts            HTTP process          src/worker.ts   worker process
src/bootstrap.ts       HTTP pipeline shared by main, contract build and tests
src/config/            validated environment (fail fast), Secrets Manager loader
src/common/            problem details (RFC 9457, th/en), validation, pagination, idempotency, ETag, logging, OpenAPI
src/database/          PrismaService (withTx), Redis
src/platform/          health (settings, approvals, outbox, notifications… arrive in B1.3)
src/modules/surfaces/  /v1/auth · /v1/store · /v1/admin · /v1/partner · /webhooks
src/integrations/      one folder per provider, each with a fake (INTEGRATIONS_MODE=fake|real)
prisma/                prisma.config.ts, multi-file schema, migrations, seeds
test/                  unit (HTTP pipeline), integration, e2e, fixtures
```

## Docker
One image, two processes:
```bash
docker build -t packio-api .
docker run packio-api                          # API (default CMD)
docker run packio-api node dist/src/worker.js  # worker
```
