# 00 — Master Plan (backend): packio-api

> อ่านไฟล์นี้และ `docs/decisions.md` ก่อนทุก session แล้วเปิด prompt ของ deliverable ที่ได้รับมอบหมาย
> Repo นี้คือ backend อย่างเดียว · frontend คือ `packio-web` · ข้อตกลง API ร่วม: `docs/contract/api-conventions.md`

---

## 1. Product
**Packio — Your Packaging Production Partner**, operated by **Collective Group (Thailand)** (the seller of record, D-010, D-092). Packio sells made-to-order and stock packaging online and through CS, produces at **partner factories** (external suppliers onboarded under an agreement to be paid the agreed buy price, D-011, D-042), delivers through the factories' own fleets (D-013) and runs its own **full accounting** (D-031).

```
Partner onboarding (KYC, capability, price arrangement & tier, capacity, agreement, site visit) ─┐
Customer: discover → configure (7 instant types) or RFQ (all other types) → 3D/2D preview → design online
        → cart (multi-item, multi-address) → promotions/points/B2B terms → checkout → instalments
        → artwork upload/design service → preflight → proof (annotations) → approval
System: auto start production (D-073) → PO to factory → factory accepts ≤ 1 business day
Factory: milestones + photos → QC (+ Packio risk-based inspection) → pack → deliver (own fleet or carrier fallback) → POD
Customer: timeline & public tracking → receive → auto-complete 7 days → claim ≤ 7 days → reorder
Finance: documents (Collective Group) → automatic journals → payouts (30 % / balance / 5 % retention) → VAT/WHT → close
Growth: demand & unmet-demand analytics → partner prospectus to recruit more factories (D-102)
```
Legacy Locopack is a **logic reference only** (D-005): nothing is migrated, nothing is kept compatible.

## 2. System context
```
packio-web (Next.js 16, one app: customer / admin / partner zones, BFF with httpOnly cookies)
        │ Bearer JWT (audiences customer | staff | partner)
        ▼
packio-api (this repo, NestJS 12)
  HTTP process  src/main.ts     /v1/auth /v1/store /v1/admin /v1/partner /webhooks /health /docs
  Worker process src/worker.ts  outbox relay, BullMQ consumers, repeatable jobs, PDFs, preflight, bank files, analytics rollups
        │
PostgreSQL 18 + pgvector · Redis · S3 · SES · SQS (optional) · SCB · 2C2P · slip-verification provider · Flash Express · Deliveree
LINE Messaging API + LIFF + LINE Login · ThaiBulkSMS · Firebase Auth · Web Push (VAPID) · realtime (SSE or Pusher)
```
- Backend is cookie-agnostic: tokens in response bodies (contract §4). Page-shaped read endpoints under `/v1/store/*` reuse domain services.
- One Docker image, two processes. Scheduled work = BullMQ repeatable jobs in the worker (exactly-once across replicas).
- The only artefact shared with the frontend is `contract/openapi.json`. Exception: `@packio/dieline` (published by `packio-web`) is consumed by the drawing service (B4).

## 3. Platform baseline
Node 24 LTS · pnpm · TypeScript 6 strict · **NestJS 12** (follow its current official guidance for new projects) · ESLint flat + Prettier · **PostgreSQL 18 + pgvector** (ADR-0001) · Prisma (current major; `prisma.config.ts`, explicit client output, multi-file schema `prisma/schema/*.prisma`) · BullMQ + Redis · AWS SDK v3 · Puppeteer (PDF, embedded Thai fonts) · exceljs · sharp · class-validator + `@nestjs/swagger` DTOs (single validation approach) · pino + OpenTelemetry + Sentry · Terminus health · helmet + throttler · nestjs-i18n (th default, en) · Testcontainers (`pgvector/pgvector:pg18`) · supertest.

## 4. Module map (`src/modules/*`)
| Context | Modules | Prompt |
|---|---|---|
| Platform | `auth`, `iam` (roles, permissions, scopes, SoD), `settings` (typed, effective-dated, audited), `feature-flags`, `approvals` (generic approval matrix engine: discount memos, credit limits, payout runs, price proposals, bank-account changes), `files`, `audit`, `domain-events`/`outbox`, `notifications`, `realtime`, `web-push` | B1 |
| Catalogue & pricing | `catalog` (product types, patterns, materials, standard sizes, stock products, CMS content), `partners` (onboarding, KYC, capability, agreements, site visits, **price tables with ownership modes, tiers, proposals/acceptance & effective dates**, price suggestions (staff-only), capacity, tolerance), `pricing` (7 calculators), `shipping-rates` (customer rate card, factory payout rate card), `quotes`, `rfq` | B2 |
| Commerce | `carts`, `checkout`, `orders` (+ order groups), `payment-schedules`, `payments` (SCB, 2C2P, slip verification), `promotions` (coupons, automatic promotions, campaigns, referral), `loyalty` (points, tiers), `companies` (B2B, credit, approvals, statements), `discount-memos`, `customers` | B3 |
| Fulfilment | `artwork` (submissions, preflight, proofs, annotations), `design-services` (hired design, revision rounds), `designs` (documents, versions, drawing service), `production` (jobs, milestones, QC, inspections, scorecard), `logistics` (shipments, split, POD, carriers adapter, tracking), `claims`, `reorder`, `tracking` (public links), `line` (webhook, LIFF APIs) | B4 |
| Finance | `ledger`, `receivables`, `payables`, `payouts`, `banking`, `tax`, `fixed-assets`, `period-close`, `audit-support` — exactly per `accounting-design.md` | B5 |
| Growth & ops | `analytics` (events, funnel, demand, unmet demand, partner prospectus), `reports`, launch readiness | B6 |

Integrations (`src/integrations/*`, each with timeout, retry/backoff, circuit breaker and an in-memory fake used by tests and `pnpm dev`): s3, ses, sqs, secrets, firebase, scb, twoc2p, slip-verify (adapter; providers e.g. Slip2Go, SCB slip verify), thaibulksms, line-messaging, line-login, pusher-or-sse, web-push, bank-files (adapter per bank + generic CSV, D-093), carriers (`CarrierAdapter`: Flash Express, Deliveree, D-114), material-price-index (adapter: manual entry first, D-040).

## 5. Data-model principles
- Designed for Packio (legacy schema is inspiration only): snake_case, `bigint identity` PKs, `uuid` public ids, `timestamptz`, `numeric(14,2)` money, Postgres enums for closed sets, FKs + check constraints, `jsonb` for calculator inputs and quote snapshots, `created_by/updated_by`, soft delete only where a decision needs it.
- **Multi-entity ready**: `entity_id` on commercial and financial rows (one active entity: Collective Group (Thailand)).
- **Multi-factory ready, single-factory launch** (D-101): selection, reassignment and peer benchmarks activate automatically when enough active factories serve a product type.
- **Effective-dated configuration**: settings, price tables, rate cards, tolerance, payout policies, point values, approval matrices — versioned rows with `effective_from`, never updated in place; quotes and orders snapshot what they used.
- Domain events + transactional outbox from B1; every notification, ledger posting and analytics fact is a subscriber.

## 6. Run order (backend)
| Step | Prompt | Output |
|---|---|---|
| B1 | `B1-foundation.md` 1.1 → 1.3 | scaffold, CI, contract pipeline; schema design (review gate); auth, IAM/SoD, approvals engine, settings, outbox, notifications, files, audit |
| B2 | `B2-catalog-pricing.md` 2.1 → 2.5 | catalogue & CMS; partners & cost governance; 7 calculators (golden tests); shipping rate cards; quotes & RFQ |
| B3 | `B3-commerce.md` 3.1 → 3.5 | cart/checkout/orders/groups; payment schedules & payments; promotions/campaigns/referral/loyalty; B2B companies; discount memos |
| B4 | `B4-fulfilment.md` 4.1 → 4.6 | artwork/proofs/design services/designs & drawing; production & QC & scorecard; logistics & carriers & POD & tolerance; tracking & timeline; claims & reorder; LINE/LIFF & notification matrix |
| B5 | `B5-finance.md` 5.1 → 5.6 | ledger & posting engine; AR & customer documents; AP & payouts & banking; tax; fixed assets; period close & audit support |
| B6 | `B6-analytics-launch.md` 6.1 → 6.3 | analytics & partner prospectus; reports; launch readiness & UAT support |
B5.1 (ledger core) may start in parallel with B3 once B1 is done; every B3/B4 module then publishes events that B5 subscribes to.

## 7. Definition of Done (every deliverable)
- Lint, typecheck, unit, integration (Testcontainers), e2e green; ≥ 80 % coverage on services with business rules; golden tests for ported maths; property tests for money/tax rounding and ledger balance.
- Contract regenerated and committed; no unintended breaking diff.
- Every configurable value is a setting with effective date + audit + permission (decision id in a code comment).
- Events recorded for every state change; subscribers idempotent; ledger postings balanced (test).
- `docs/PROGRESS.md` entry: done, decisions implemented (D-###), deviations, open questions.

## 8. ADRs
0001 PostgreSQL 18 + pgvector · 0002 New build with legacy as logic reference · 0003 API contract & repository split · 0004 Auth audiences & tokens · 0005 Effective-dated configuration · 0006 Approval-matrix engine · 0007 Posting-rule engine. B1.1 writes 0003–0006; B5.1 writes 0007.
