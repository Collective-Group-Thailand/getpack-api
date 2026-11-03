# Agent portal — security review (P7)

Reviewer: security lead role (owner delegated, 2026-11-04). Scope: the agent portal of D-464–D-472 in `getpack-api`
— agent zone (`/v1/store/agent/*`), hand-off, sales desk, discount approvals, P&L planner, and the P7 pilot switch.
Method: code reading of guards, services and controllers; unit tests added where a property had none; log sweep of
`src/modules/{agents,sales-desk,pnl,auth}`. No penetration test was run (no running stack here); the UAT team repeats
the checks marked **UAT** against the hosted UAT stack.

## 1. Findings

| Id | Area | Severity | Status | Evidence |
|---|---|---|---|---|
| SR-01 | Lead duplicate check `store.agentLeads.check` had only the global per-IP throttle: an agent could probe contacts at the global rate to learn who is already a customer / another agent's lead (the answer is neutral but `available` vs `unavailable` still leaks existence) | Medium | **Fixed** | `AgentRateLimiter` 30 calls / minute / agent (`agent-rate-limit.ts`), 429 `agents.rate_limited` + `Retry-After`; spec `agent-rate-limit.spec.ts` |
| SR-02 | `store.agent.registerLead` answers the same neutral `agents.lead_unavailable` and was an unthrottled second probe for SR-01 | Medium | **Fixed** | same budget as the check (`lead_check`), `agents.controller.ts` |
| SR-03 | `store.agentLeads.importPreview` runs up to 500 rows through the same check per call | Medium | **Fixed** | 20 previews / hour / agent (`lead_import_preview`) |
| SR-04 | `store.agentLeads.scanCard` (OCR, CPU heavy) had no per-agent limit | Low | **Fixed** | 10 / minute / agent (`card_scan`) |
| SR-05 | Per-agent limits fail open when Redis is down (consistent with the studio dock limiter) | Low | Accepted | the global per-IP `ThrottlerGuard` still applies; warning logged without input |
| SR-06 | The global throttler keeps counters in process memory (one counter set per API instance) | Low | Accepted (pre-existing) | `app.module.ts` `ThrottlerModule.forRootAsync` without storage; per-agent limits above use Redis and are shared |
| SR-07 | IDOR on agent-zone ids (lead, activity, quote, discount request / option, deal registration, statement, 50 ทวิ) | High if absent | **Verified, tests added** | every lookup compares `agentId` with the caller's agent and answers 404 `http.not_found` (same as unknown); `agent-idor.spec.ts` (17 cases incl. "no further read / write") |
| SR-08 | Payout profile and ล.ย.01 store endpoints | — | Verified | no id parameter: read / written by the caller's own agent id (`agent-payout-profiles.service.ts`, `agent-tax-declarations.service.ts`) |
| SR-09 | Admin-zone reps (`sales.pipeline.self`) reading another rep's leads | High if absent | Verified (existing tests) | `sales-scope.spec.ts`; freelance leads read-only for staff (`sales.lead_read_only`) |
| SR-10 | Zone tokens: audience separation | — | Verified | `AuthGuard.authenticate` refuses a token whose `aud` differs from the handler's audience (`auth.wrong_audience`, audited `auth.audience_rejected`); staff / partner / customer tokens never cross |
| SR-11 | A storefront-client customer token can call `/v1/store/agent/*` (the agent zone's client is not enforced per handler) | Info | Accepted (by design, D-467 §1) | one identity, one account; agent-zone sessions are their own session families (`auth_sessions.client`) that the customer can list and revoke (`store.me.revokeSessions`); data access is the same person's own |
| SR-12 | Hand-off replay | — | Verified | 256-bit code, single use (`updateMany … consumed_at IS NULL` claim), lifetime `auth.handoff_code_ttl_seconds` (60 s, 30–120), SHA-256 of code and fingerprint only, constant-time compare (`sameDigest`), wrong fingerprint burns the code, one neutral 401 `auth.handoff_invalid`, redeem behind `LOGIN_THROTTLE`; `handoff.service.spec.ts` |
| SR-13 | Ended agents | — | Verified | `AgentZoneGuard` + `agent-zone.guard.spec.ts`: ended → 403 `agents.ended` except `records` (statements, 50 ทวิ) for `agents.ended_record_access_years` (5) |
| SR-14 | PII in request logs | — | Verified | pino-http serialises method + path only (no body, no query string); `REDACTED_FIELDS` covers tokens, OTP, password, tax id, bank account |
| SR-15 | Defence in depth: device fingerprint, decrypted account numbers and hand-off codes were not in the redaction list | Low | **Fixed** | `fingerprint`, `accountNo`, `handoffCode` added to `src/common/logging/redaction.ts`; covered by `redaction.spec.ts` (iterates the list) |
| SR-16 | Logger calls in agents / sales-desk / pnl / auth | — | Verified | 11 calls, all ids, counts or error reasons; card-scan failures log the reason only, never the image or its text (`agent-card-scan.service.ts`, Tesseract stderr discarded) |
| SR-17 | Error messages of failed jobs may quote Prisma argument values in rare validation errors (`commission … not earned`, `statement … not generated`) | Low | Accepted | jobs handle ids and amounts, not contact data; revisit if a job starts handling contact fields |
| SR-18 | Factory confidentiality and margin wording on agent responses | — | Verified | `test/unit/storefront-factory-confidentiality.spec.ts` covers every `/v1/store/agent/*` operation; P7 adds the waitlist operation |
| SR-19 | Waitlist (P7 item 5) enumeration and spam | Medium if absent | **Fixed in item 5** | anonymous, per-IP throttle 5 / minute, neutral `202` whether new or already listed, nothing echoed |
| SR-20 | Forecast reads in-progress orders once per active link (N + 1) — a heavy agent could load the API | Low | Open (watch) | `agent-forecast.service.ts`; pilot volumes are small; `docs/launch/PERFORMANCE.md` watch item |
| SR-21 | Offboarding: ending an agent left its registered deals active, so for up to `agent.deal_protection_days` (90) they kept blocking other agents' check / registration and staff assignment of the customer | Medium | **Fixed** | `AgentsService.setStatus(ended)` expires them with `agent_ended`; `agent-offboarding.spec.ts` |

## 2. Limits (technical, not business values)

| Call | Limit | Key | Answer |
|---|---|---|---|
| `store.agentLeads.check` + `store.agent.registerLead` | 30 / minute | agent | 429 `agents.rate_limited`, `Retry-After` |
| `store.agentLeads.importPreview` | 20 / hour | agent | same |
| `store.agentLeads.scanCard` | 10 / minute | agent | same |
| `store.agentProgramme.joinWaitlist` | 5 / minute | IP | 429 (`http.too_many_requests`) |
| everything | `THROTTLE_LIMIT` / `THROTTLE_TTL_SECONDS` | IP | 429 |
| hand-off redeem, OTP verify, logins | `AUTH_LOGIN_THROTTLE_LIMIT` / minute | IP | 429 |

They protect the system (enumeration, OCR floods), no decision gives them a business owner, so they are code constants
like the login throttle; changing one is a code change reviewed by the tech lead.

## 3. For the UAT team (**UAT**)

1. Sign in as `UATFRE22`, take the id of a lead / quote / statement of `UATJUR22` from the database and call the
   agent endpoints with it: every answer is 404.
2. Call `POST /v1/store/agent/leads/actions/check` 31 times within a minute: the 31st answers 429 with `Retry-After`.
3. Create a hand-off code and redeem it twice, and once from another fingerprint: the second answer is 401
   `auth.handoff_invalid` both times; wait 61 s with a fresh code: 401.
4. Use a staff token on `/v1/store/agent/me`: 401 `auth.wrong_audience`.
5. Grep the API logs of the run for the seeded phones (`+668000003`), e-mails (`@example.invalid`) and tax ids
   (`0000100000`): no hit except in audit rows the auditors read.
