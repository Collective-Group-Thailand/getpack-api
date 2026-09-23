# B1 — Foundation

> อ่าน `CLAUDE.md`, `00-master-plan.md`, `docs/decisions.md`, `docs/contract/api-conventions.md` ก่อน · ทำทีละ Deliverable (1.1 → 1.3) ต่อ 1 session · Plan Mode ทุกครั้ง
> Deliverable 1.2 มี **review gate**: หยุดหลังเขียน `docs/schema-design.md` เพื่อให้ผู้ใช้ตรวจก่อนเขียน migration

---

You are a senior backend engineer building **`packio-api`**, the NestJS 12 backend of **Packio — Your Packaging Production Partner** (Collective Group (Thailand)). This prompt builds everything later modules depend on. No business modules yet.

## Repository layout (target)
```
packio-api/
├─ src/
│  ├─ main.ts  worker.ts  app.module.ts  worker.module.ts
│  ├─ common/        guards (audience, permission, scope, SoD), decorators (@CurrentActor, @Can, @Public, @Scope), problem-details filter,
│  │                 interceptors (request-id, logging, idempotency, etag), money (decimal.js), time (Bangkok, business days, holidays), pagination
│  ├─ config/        validated env schema, Secrets Manager loader
│  ├─ database/      PrismaService, `withTx`, soft-delete extension where needed
│  ├─ platform/      settings, feature-flags, approvals, files, audit, domain-events + outbox, notifications, realtime, web-push
│  ├─ modules/       auth, iam  (business modules arrive in B2–B6)
│  └─ integrations/  one folder per provider, each with a fake
├─ prisma/schema/*.prisma  prisma/migrations/  prisma/seed/ (roles, permissions, settings defaults from decisions, chart of accounts seed)
├─ contract/openapi.json
├─ test/             unit helpers, integration (Testcontainers), e2e, golden/
├─ docs/             prompts/ contract/ legacy/ adr/ decisions.md accounting-design.md schema-design.md rbac.md PROGRESS.md
├─ docker-compose.yml  postgres (pgvector/pgvector:pg18), redis, localstack (S3/SES/SQS), mailpit
├─ Dockerfile        multi-stage, non-root, one image for main + worker
└─ .github/workflows/ci.yml  lint · typecheck · unit · integration · e2e · contract drift + oasdiff · prisma drift · build · image scan
```

## Deliverable 1.1 — Scaffold, CI, contract pipeline, ADRs
1. NestJS 12 project (pnpm, Node 24, TS 6 strict), ESLint flat + Prettier, path aliases, validated env (fail fast), Secrets Manager loader, pino with a redaction list (`authorization`, `password`, `otp`, `token`, `refreshToken`, `cardNumber`, `idToken`, `bankAccount`, `taxId` when not needed), OpenTelemetry + Sentry, request id, Terminus `/health` (DB, Redis, S3).
2. URI versioning `/v1`; surface modules `AuthApi`, `StoreApi`, `AdminApi`, `PartnerApi`, `Webhooks`; global problem-details filter (RFC 9457, localised th/en); validation pipe; pagination helpers; `Idempotency-Key` interceptor (Redis + `idempotency_keys`); ETag/If-Match helper.
3. **Contract pipeline**: `pnpm contract:build` boots an app context with fake integrations, writes deterministic `contract/openapi.json` (OpenAPI 3.1, tags prefixed by surface, every enum a named component, security schemes per audience). CI: drift check + `oasdiff breaking` vs `main` (fail unless label `contract:breaking`); release workflow attaches `openapi.json` to tag `vX.Y.Z`.
4. `docker-compose.yml`, `.env.example` (every variable documented), Dockerfile, CI, `pnpm dev` runs HTTP with fakes, `pnpm dev:worker` runs the worker.
5. ADRs 0003 (contract & repo split), 0004 (auth audiences & tokens), 0005 (effective-dated configuration), 0006 (approval-matrix engine) from `00-master-plan.md` and `decisions.md`.
6. Acceptance: `docker compose up -d && pnpm i && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm contract:build` green; `/health`, `/docs` work; worker starts and idles; CI green.

## Deliverable 1.2 — Schema design (review gate), then core migrations
1. Read `docs/decisions.md` end to end, `docs/accounting-design.md`, `docs/legacy/00-domain-context.md` §3–§8 and `03-legacy-schema.txt` (inspiration only). Write **`docs/schema-design.md`**: bounded contexts, aggregates, tables with key columns, enums, relations, indexes, effective-dating pattern, snapshot pattern (quote → order → PO), multi-entity and multi-factory columns, and a table **decision → tables/columns** proving every D-### with data implications is covered. Include a Mermaid ER diagram per context. **Stop here and ask the user to review.**
2. After approval, implement the **platform and IAM** part of the schema now (other contexts are migrated in their own deliverables, following the approved design):
   - `0001_extensions` (`vector`, `pgcrypto`, `pg_trgm`, `citext`).
   - IAM: `users`, `auth_sessions`, `api_clients`, `roles`, `permissions`, `role_permissions`, `user_roles` (scope `platform | factory:{id} | company:{id}`), `sod_rules`.
   - Platform: `entities` (Collective Group (Thailand) seeded from env/settings, not hard-coded), `settings` + `setting_versions` (key, typed value jsonb, `effective_from`, `changed_by`, reason), `feature_flags`, `approval_policies` + `approval_steps` + `approval_requests` + `approval_actions`, `file_objects`, `attachments`, `audit_logs`, `domain_events`, `outbox_messages`, `notification_templates` (+ versions), `notification_preferences`, `notifications` (send log), `web_push_subscriptions`, `idempotency_keys`, `business_calendars` (Thai public holidays + factory closures), `product_embeddings` / `design_embeddings` (empty, ADR-0001).
3. Seeds: roles & permissions (D-140), SoD rules (`accounting-design.md` §8), **settings defaults from decisions** with the decision id in the description (margin floor 10 %, instalment threshold THB 20,000, CS discount limit 5 %, quote validity 15 days, factory acceptance SLA 1 business day, auto-complete 7 days, claim window 7 days, payout 30 % / retention 5 %, QC sampling rules, extra-revision fee rule, point value THB 2.50 / earn 1 per THB 500, tiers, referral rules, marketing quiet hours…), approval policies (discount memo tiers D-052, credit limit D-121, payout run D-022/D-057, price proposals D-040, factory bank-account change `accounting-design.md` §8). Dev seed with obviously fake users.

## Deliverable 1.3 — Auth, IAM/SoD, approvals, settings, outbox, notifications, files, audit
**Auth (contract §4)**: `POST /v1/auth/staff/login`; customer `POST /v1/auth/customer/otp/request|verify` (ThaiBulkSMS; 6 digits; rate & attempt limits), `/customer/firebase` (Google/Apple ID-token exchange), `/customer/line` (LINE Login & LIFF token verification, account linking); partner `POST /v1/auth/partner/login` (+ optional device PIN) and OAuth2 client-credentials `POST /v1/auth/token` (`api_clients`, factory-scoped); `refresh` (rotation + reuse detection revokes family), `logout`, JWKS. Passwords argon2id. `GET /v1/store/me`, `/v1/admin/me` (roles, permissions, **menu entitlements**, feature flags), `/v1/partner/me` (factory scope list).
**IAM**: permission catalogue (`resource.action`) in code → seeded; `@Can()` guard; repository-level scoping (`FactoryScoped`, `CompanyScoped`) with tests including ids in URLs, file keys and exports; SoD enforcement service used by approvals and finance; admin endpoints for users, role assignment (with scopes), deactivation; `docs/rbac.md` matrix generated from code (D-140, D-141, D-142).
**Settings**: typed accessors, `effective_from` resolution (`at(date)`), admin endpoints (list, history, propose change → approval where the policy requires, superadmin D-063), cache with invalidation on change event.
**Approvals engine** (ADR-0006): policies with ordered steps, conditions (amount, %, entity, role), SLA, delegation, expiry (e.g. discount memo valid with the quote, D-052), maker-checker (requester cannot approve), endpoints to create/approve/reject/withdraw, events `approval.*` — used by B2–B5.
**Outbox & events**: `DomainEvents.record(tx, event)` → `domain_events` + `outbox_messages` in the caller's transaction; worker relay → BullMQ topics with backoff, dead-letter, admin list/replay. Envelope: `id, type, aggregateType, aggregateId, entityId, actor, occurredAt, correlationId, causationId, payload`.
**Notifications**: templates (MJML/Handlebars, th/en, versioned, preview, test send), channels (SES email, ThaiBulkSMS, LINE Messaging push, web push, in-app, Teams adapter), routing matrix per event × audience × channel (D-143), preferences & PDPA consent, quiet hours for marketing (D-144), idempotent per `(event_id, recipient, channel)`, delivery log.
**Realtime & web push**: realtime auth endpoint per surface (payload = ids + type only); VAPID web push subscriptions per user/device.
**Files**: presign (single + multipart for large artwork), `file_objects` (sha256, mime, size, dimensions/pages, scan status, retention class), async virus-scan interface + fake, thumbnails, signed downloads.
**Audit**: security and finance-relevant actions (login, role change, permission denied, setting change, export, approval actions).
**Acceptance**: e2e — staff login → `/v1/admin/me` with menu; customer OTP login; LINE login linking; token of one audience rejected on other prefixes; refresh rotation & reuse revocation; setting change with future `effective_from` resolves correctly by date; approval policy with 2 steps blocks self-approval; a mutation writes audit + event + outbox atomically and a subscriber receives it exactly once; notification routed by matrix respects quiet hours.

After each deliverable: `docs/PROGRESS.md`, contract regenerated, commit.
