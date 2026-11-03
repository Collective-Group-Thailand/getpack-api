# P7 — QA, pilot and launch record (plan)

Branch `chore/agent-p7-launch` in both repos (from `main` with P0–P6 merged). Owner delegated every decision
(2026-11-04): leads decide, record, and keep everything conservative. Nothing here touches production, makes a real
payment, issues a real tax document, publishes the agent agreement or opens the programme to the public.

## API scope (`getpack-api`)

| # | Item | Output | Lead role |
|---|---|---|---|
| 0 | This plan | `plans/P7-PLAN.md` (copied to the web repo) | Tech lead |
| 1 | UAT seed for the agent portal | `prisma/seed/uat/uat-agents.ts`, run by `pnpm db:seed:uat` (guard `UAT_SEED_CONFIRM=uat-only`) | QA lead |
| 2 | Load test | `perf/k6/agent-portal.js` + README section; EXPLAIN ANALYZE of the hot queries on seeded data; index migration only if a plan shows a sequential scan on a growing table | Platform lead |
| 3 | Security review | `SECURITY-REVIEW-P7.md`; IDOR unit tests; throttles on `store.agentLeads.check` and `store.agentLeads.scanCard`; PII-in-logs sweep | Security lead |
| 4 | Runbook | `RUNBOOK.md` (Thai primary, English headings) | Finance / Ops lead |
| 5 | Pilot switch (API) | setting-backed pilot allow-list, per-user `applyOpen`, public waitlist + admin list / export | Sales lead + tech lead |
| 6 | Docs | `API-CHANGES-P7.md` (copied to web), PROGRESS row; no new decision unless one is taken | Tech lead |

### Item 1 — UAT seed design

- Runs inside `seedUat` after the existing rehearsal layers; one transaction; **idempotent by marker**: the freelance
  agent code `UATAGF01` exists → nothing is created (second run prints nothing for the agent layer).
- Data is obviously fake: names carry `[UAT]`, e-mails `@example.invalid`, tax ids start `0000` with a valid
  mod-11 check digit, phones in the reserved `+6620000xxxx` style for customers.
- People: freelance individual agent (verified payout profile, accepted ล.ย.01), freelance juristic VAT agent
  (verified profile, VAT), employee agent bound to a dedicated staff user with role `sales_rep`.
- History rows (commissions in every status, statements with withholding worked out, approvals in every state, deal
  registration, discount rounds, P&L cells) are **direct inserts**: they represent states that services only reach
  through months of events (orders completing, claim windows passing, payout runs). Amounts are computed in the seed
  with `decimal.js` from the same formula module (`agent-wht.ts`) so the statement figures match what the service
  would produce. No outbox events, no ledger postings, no vendor bills, no tax documents are created (UAT rule: no
  real tax documents). Documented in `docs/launch/UAT-DATA.md`.

### Item 2 — load test

- k6 is not installed and cannot be installed without approval in this workspace → scripts + README; the local run
  is **SKIPPED** (reason recorded). Indicative evidence = `EXPLAIN (ANALYZE, BUFFERS)` of each endpoint's main query
  on the seeded UAT database.

### Item 3 — security review

- Zone tokens (audience / client `agent` sessions), hand-off (single use, TTL setting, fingerprint), IDOR (every
  agent-scoped service method filters by the caller's agent → 404 `http.not_found`), throttles, PII in logs.
- Throttles are **technical limits** (not business values, same class as the login throttle): check 30/min, scanCard
  10/min, waitlist 5/min per IP — documented in the review.

### Item 5 — pilot switch

- The flag `agents.programme` stays the master public switch (OFF). A new effective-dated setting
  `agents.pilot` `{ enabled: false, userIds: [] }` (owner `sales_manager`, audited by the settings framework)
  lets listed customer accounts apply while the flag is off. The existing flag `userIds` rule also still works but
  needs `feature_flags.manage` (Superadmin only) — the setting gives Sales its own audited lever.
- `store.agentProgramme.public.applyOpen` stays false for every anonymous visitor unless the flag is fully on;
  signed-in `store.agentProgramme.get` gains `applyOpen` (pilot-aware); `submit` uses the same rule.
- Waitlist `store.agentProgramme.joinWaitlist` (anonymous, throttled, consent text version + evidence, neutral 202
  on duplicates) and `admin.agentWaitlist.list` / `.export` (Sales Manager; permission `agent_waitlist.read`).
- Migration with `down.sql`; contract + RBAC docs regenerated.

## Web scope (`getpack-web`, run after the API)

1. Responsive QA of landing, apply, agent zone, sales desk, approval desk, P&L planner at every width; fixes.
2. Lighthouse budgets for every new route; PWA install test notes (real devices are an owner task).
3. Pilot switch: landing reads `applyOpen`; when false shows "ลงทะเบียนรอเปิดรับ" with the waitlist form
   (`store.agentProgramme.joinWaitlist`); signed-in pilot users see apply.
4. `REPORT.md` and `report.html` (owner's one-page summary).

## Risks

| Risk | Mitigation |
|---|---|
| UAT seed drifts from service invariants | amounts via the shared formula module; seed spec checks counts; history documented as direct inserts |
| Pilot list leaks the programme publicly | anonymous `applyOpen` never reads the pilot list; default OFF; unit tests |
| Waitlist abused (spam / enumeration) | per-IP throttle, neutral 202 on duplicates, no echo of existing rows |
| No k6 / Docker here | recorded SKIPPED; EXPLAIN evidence; owner runs k6 on UAT (runbook in README) |
| Tax facts in the runbook | taken from D-465 / PLAN §5; anything else marked "ยืนยันกับ CPA" |
