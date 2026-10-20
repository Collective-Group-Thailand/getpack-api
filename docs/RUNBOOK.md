# RUNBOOK — getpack-api

> **Audience:** the on-call engineer and the tech lead. How to deploy, roll back the application release, respond to
> incidents and alerts, recover from disasters and run the routine operations. Alerts and dashboards:
> `docs/launch/MONITORING.md`; security and restore procedures: `docs/launch/SECURITY.md`.

## 1. The system in one page

- **One image, two services** (00-master-plan §2): `api` (`node dist/src/main.js`, HTTP) and `worker`
  (`node dist/src/worker.js`: outbox relay, event subscribers, scheduled jobs, PDFs, bank files, rollups, report files).
  Scale the API on CPU, the worker on queue depth. Scheduled jobs run once across replicas (BullMQ job schedulers).
- **Stores:** PostgreSQL 18 (`public` OLTP, `analytics` star model, `partitions` for monthly log partitions), Redis
  (BullMQ, idempotency fast path, session revocation markers — must never evict), S3 (private files, signed URLs).
- **Providers:** SCB, 2C2P, Slip2Go, ThaiBulkSMS, LINE, SES, Firebase, Flash Express, Deliveree
  (`docs/launch/INTEGRATIONS.md`). Each has a feature flag or an enable switch; with `INTEGRATIONS_MODE=fake` nothing
  leaves the system.
- **Health:** `GET /health` (Terminus: database, Redis, S3). **Signals:** `GET /v1/admin/ops/signals`.
- **Logs:** JSON (pino) with the request id; secrets and personal data are redacted. Search by `requestId`
  (returned in every problem response) or by the domain event id.

## 2. Deploy

1. **Before:** CI green on the release commit (lint, typecheck, unit, integration, e2e, contract drift and breaking
   check, Prisma drift, image scan). Tag `vX.Y.Z` = `package.json` version; the release workflow publishes
   `contract/openapi.json`; getpack-web pins the same version in `contract.lock.json`.
2. **Migrations first**, as a one-off job from the build stage (the runtime image has no Prisma CLI):
   `pnpm db:migrate` (= `prisma migrate deploy`) with the migrator database role. Migrations are **forward-only and
   expand-first**: a release's migrations must work with the previous image still running (add columns / tables /
   indexes; never drop or rename in the same release that stops using them).
3. **Reference seed** (idempotent, never overwrites a changed value): `pnpm db:seed` — adds new settings definitions,
   permissions, notification templates and routes of the release.
4. **Roll out** the worker, then the API (ECS rolling update, minimum healthy 100 %). Watch `/health`, the 5xx rate and
   `outbox_backlog_minutes` for 15 minutes.
5. **After:** check the release notes' feature flags (switch nothing on during the deploy itself); tell getpack-web to
   deploy the matching version.

## 3. Roll back the application release

- **Application:** redeploy the previous task definition (image `vX.Y.(Z-1)`) for worker and API. Safe because of the
  expand-first rule in §2.2 — the previous image runs on the new schema.
- **Schema:** never roll back a migration in production. If a migration itself is wrong, ship a forward fix. Only a data
  corruption goes to the point-in-time restore of §5.
- **Feature flags** are the fastest rollback for a provider or a feature (`admin.featureFlags`, Superadmin): switch the
  flag off, then investigate.
- **Settings:** a wrong business value is reverted by a new effective-dated version (audited, D-063); nothing is edited
  in place.

## 4. Incident response

**Severity:** SEV1 — customers cannot order or pay, money or books wrong, data exposed; SEV2 — a flow degraded for many
users (factory updates, notifications, documents); SEV3 — a single customer or back-office inconvenience.

1. Acknowledge the page; open an incident channel; name an incident lead (on-call) and a communicator (CS Lead for
   customers, Partner Manager for factories).
2. Stabilise first (flag off, scale out, roll back §3), then diagnose. Keep a timeline.
3. For a suspected data exposure: stop the leak, preserve logs, inform the DPO at once (PDPA: notification to the PDPC
   within 72 hours when required).
4. Close with a short incident note (cause, impact, fix, follow-ups) within one business day.

### 4.1 Error rate high
Check Sentry for the top new issue and its release; `GET /health`; recent deploys and flag changes. A provider outage
shows as `provider.unavailable` (503) problems: switch its flag off if customers are stuck, post a store banner (CMS).

### 4.2 Latency high
Database first (CPU, connections, slow queries in `pg_stat_statements`), then Redis, then the worker competing for the
database (large report exports, rollups — they run at 02:30 and every minute for backfills). Scale the API; if one query
dominates, see `docs/launch/PERFORMANCE.md` §3.

### 4.3 Queue depth / outbox backlog
Worker running? (`ecs describe-services`, task logs.) Redis reachable? A single failing subscriber retries with backoff
and then dead-letters (8 attempts) — it does not block the others. Scale the worker; if the relay itself stopped,
restart the worker service.

### 4.4 Dead letters and ledger posting failures
`GET /v1/admin/outbox?status=dead` shows the event and `last_error` (`<consumer>: <error>`). Fix the cause (data or
code), then `POST /v1/admin/outbox/{eventId}/actions/replay` — subscribers are idempotent, so consumers that already
succeeded skip it. A **ledger** dead letter means a journal is missing: Finance Manager is told the same day; the month
cannot close until it is replayed (the close checks reconcile sub-ledgers to the GL).

### 4.5 Webhook failures
`webhook_inbox` keeps every callback with its status. Payment callbacks: providers retry (SCB 3 × 12 s; 2C2P per its
policy); SCB payments are also confirmed by inquiry. After a fix, ask Finance to check the unidentified-receipts and
slip queues for payments that arrived while the webhook failed.

### 4.6 Payout / bank-file failures
Items the bank rejected are `failed` with the bank's reason; the run is `partially_failed`. Finance corrects the vendor
bank account (two-person change, D-169) and includes the items in the next run. Never edit a generated bank file.

### 4.7 SLA breaches
Owned by the business teams: overdue factory acceptance → Partner team (D-074 escalation); production at risk → CS
and Partner team; RFQ first response → CS; approvals → the approvers (delegations if someone is away); slips → Finance
(D-061). On-call only acts if the signal is `unknown` (source unreadable).

## 5. Disaster recovery

- **Point-in-time restore** (corruption, destructive bug): stop the worker (no more side effects), restore RDS to a
  new instance just before the incident, run the verification queries of `docs/launch/SECURITY.md` §5, switch
  `DATABASE_URL` in Secrets Manager, start API and worker. Payments and bookings made after the restore point are
  recovered from provider reports (settlement files, carrier bookings) — Finance and Logistics reconcile them.
- **Region outage:** restore the cross-region snapshot and S3 replica in the secondary region, deploy the same image,
  switch DNS; providers' callback URLs point at the DNS name, not at the region.
- **Lost Redis (SEV1):** while Redis is unreachable the API **refuses authenticated requests** (the auth guard fails
  closed on session-revocation checks) and the worker stops. Start a new cluster and switch `REDIS_URL`; idempotency
  falls back to the database meanwhile; BullMQ schedulers are re-registered at worker start and undelivered events
  are re-sent by the outbox relay (outbox messages stay `pending` until dispatched). Revocation markers are lost with the
  old cluster: an access token of a session revoked just before can be accepted until it expires (≤ 15 min); refresh
  tokens are always checked in the database.

## 6. On-call

- Weekly rota of two engineers (primary, secondary), hand-over every Monday 10:00 Asia/Bangkok with open incidents
  and pending replays.
- Escalation: primary (15 min) → secondary (15 min) → tech lead → C-Level for SEV1 business impact.
- Contacts (fill in before go-live): providers' support lines and account managers (SCB, 2C2P, Slip2Go, ThaiBulkSMS,
  LINE, carriers), AWS support plan, the launch factory's owner, DPO.

## 7. Routine operations

| Task | When | How |
|---|---|---|
| National holidays for next year (D-161) | Each December | An Admin with `calendars.manage` keys them in the national calendar (`admin.calendar.putHoliday`, or the Excel import with preview → confirm, D-170), marking who observes each day; factory closures and factory hours by the factory's Owner / Planner or the Partner Manager (D-209, D-292) |
| Change an approval matrix (D-063) | When a decision changes | `admin.approvalPolicies.proposeVersion` (draft, effective date) → approval by a Superadmin → applies from its effective date; never edit a seeded policy in the database |
| UAT rehearsal database | Before each UAT round | `docs/launch/UAT-DATA.md` (`pnpm db:seed:uat` + `pnpm uat:populate`, both refuse to run without their confirmation variable; never on production data) |
| Partitions ahead | Nightly (automatic) | `partitions.ensure`; check `partitions.*_default` stays empty |
| Analytics backfill | After a data fix | `POST /v1/admin/analytics/rollups {from, to}` (`analytics.manage`) |
| Replay dead letters | On alert | §4.4 |
| Month-end close | Monthly | `docs/accounting-design.md` §7; `admin.close` |
| Secrets rotation | Per `docs/launch/SECURITY.md` §3 | |
| Restore test | Quarterly | `docs/launch/SECURITY.md` §5 |
| Settings review | Before launch and when a decision changes | `pnpm launch:settings` → `docs/launch/SETTINGS-REVIEW.md` |

## 8. Platform environment variables

Provider accounts and their variables are in `docs/launch/INTEGRATIONS.md`; secrets and keys in
`docs/launch/SECURITY.md`. The platform variables below are validated at boot (`src/config/env.schema.ts`); a wrong
value stops the process before it serves anything.

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `production` refuses a `devOnly` feature flag that is on (D-296) and closes `/docs` unless `DOCS_ENABLED` |
| `INTEGRATIONS_MODE` | `real` | `fake` keeps every provider in memory (development, tests, the UAT rehearsal) |
| `OBJECT_STORAGE_MODE` | unset | `fake` / `real` overrides `INTEGRATIONS_MODE` for object storage only (development against a real bucket with fake SMS, LINE, payments and PDF); unset follows `INTEGRATIONS_MODE` |
| `AWS_REGION` | the deployment region (default `ap-southeast-1`) | |
| `AWS_ENDPOINT_URL` | unset | LocalStack in development only |
| `S3_BUCKET` | the private files bucket | |
| `S3_KEY_PREFIX` | unset | A folder inside a bucket shared with other apps, path segments ending in `/` (e.g. `getpack/`); every object key starts with it. Unset writes at the bucket root |
| `S3_FORCE_PATH_STYLE` | `false` | `true` for LocalStack only |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | `60` / `300` | per-IP request budget; sign-in endpoints have their own `AUTH_LOGIN_THROTTLE_LIMIT` |
| `LOG_LEVEL` | `info` | `debug` only for a time-boxed investigation (personal data stays redacted) |
| `LOG_PRETTY` | `false` | JSON logs for CloudWatch |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`–`0.1` | performance tracing sample; errors are always sent when `SENTRY_DSN` is set |
| `OTEL_SERVICE_NAME` | `getpack-api` (default) | trace and metric service name |
| `PDF_CHROMIUM_PATH` | the image's Chromium | set in the Dockerfile (Thai fonts embedded) |
| `FILE_SEARCH_EMBEDDINGS` | unset | D-427 content search by meaning: `local` (the e5 model in the process), `fake`, `off` (keyword only). Unset = `local` when the model files are in the image, else `off` (logged at start) |
| `FILE_SEARCH_MODEL_DIR` | `/app/models/multilingual-e5-small` | set in the Dockerfile; the model is downloaded at image build time, pinned to a revision with its SHA-256 (ADR-0013) |
| `FAKE_OBJECT_STORAGE_DIR` | unset | fake object storage only (development, UAT rehearsal): keeps objects on disk across restarts |
