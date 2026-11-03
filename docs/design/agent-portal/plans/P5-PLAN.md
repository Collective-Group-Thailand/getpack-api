# P5 — automatic lead capture and scoring; dieline download stays free · plan (autorun)

Branch `feat/agent-p5-capture` (both repos). Decision **D-471** "Automatic lead capture and scoring; dieline download
stays free" (PROMPT Phase 5; builds on D-143 / D-144, D-203 / D-271, D-416 / D-417, D-440, D-458, D-466–D-470). The
owner delegated every decision and is not watching: assumptions are recorded here, in `docs/PROGRESS.md` and in the
D-471 row; the most conservative option is taken for consent (PDPA), attribution and money.

## Principles kept
- **Consent first (PDPA, D-144)**: a captured signal (studio idle, dieline download) enters the pool only when the
  person's latest choice for at least one marketing purpose (`marketing_email`, `marketing_line`, `marketing_sms`) is
  *granted*; the consent record relied on is kept on the item (`consent_record_id`, `consent_basis =
  marketing_consent`). Contact form / RFQ items keep the P4 basis (`enquiry`: the person asked to be contacted); staff
  entries `staff_entry`. Without consent nothing is captured; no new e-mail is sent (no saved-design service reminder
  exists in the notification rules — none is added).
- **Attribution precedence (D-417 first)**: active agent link / protected agent lead > rep assignment > unassigned
  pool. A contact attributed to a **freelance** agent never enters the company pool from any source (P4 subscribers
  included); a contact attributed to an **employee** agent (a rep) or with an open enquiry assigned to a rep goes to
  that rep (assignment mode `attribution`), never to the pool. Pure function + unit tests.
- **Dieline download stays free** (D-271): never a paywall, never a plan gate; the first download needs no sign-in,
  from the second a free sign-in is asked. Copy "ฟรี", never "฿0".
- **Score is a staff tool**: score 0–100 + top 3 reasons (reason enum + points) for staff; agents see the score only,
  on their own leads. No reasons, no rules, no inputs reach the store surface (confidentiality spec extended).
- Effective-dated, audited settings for every value; flags default **off**; values no decision gives are `proposed`.
- Every state change: one transaction + activity + outbox event (`recordAgentEvent`); scoring is a derived value
  (stored with the rules' setting version for traceability, no event per rescore).

## Scope (API)

### 1a · Studio idle capture (`studio_idle`, "ออกแบบแล้วยังไม่สั่ง")
Job `sales.capture_studio_idle` (hourly, idempotent). Flag `capture.studio_idle_enabled` (boolean, **false**).
Candidates: a customer's saved studio design (`design_documents`, not deleted, with a current version) whose last
change is ≥ `capture.studio_idle_days` (3) ago and after the flag's effective date (never back-captures designs from
before the switch-on; technical catch-up window 7 days), with no order for the design. Skipped: owner is staff / a
sales agent / inactive; owner has an active agent link, a protected agent lead or an open enquiry with a rep (route ≠
pool); no marketing consent; already an item for the design (unique `design_document_id`); an open `studio_idle` item
of the same owner (one at a time). Contact = the account's name, phone, e-mail; organisation = active company; need =
design title + style code. Then the P4 `autoAssign`.

### 1b · Dieline download (`dieline_download`)
- **Gate enforced server-side**. New `store.dielines.downloadFree` (`POST /v1/store/dielines/downloads/free`, public,
  throttled per IP): body = the download body + `deviceId` (UUID the web keeps in a first-party httpOnly cookie,
  set by its BFF). Only SHA-256 of the device id is stored (`dieline_downloads.device_hash`, `user_id` null). A device
  with `dielines.anonymous_free_downloads` (integer, seed **1**, Marketing) downloads already → 401
  `dielines.sign_in_required`; the web opens the sign-in sheet and then calls the signed-in `store.dielines.download`
  (unchanged rules and limits). Setting 0 = sign-in for every download (the pre-P5 behaviour).
  `DielineDownloadDto.nextNeedsSignIn` tells the web the next one needs sign-in. Limitation (recorded): clearing
  cookies gives another free first download — accepted, the download is free anyway; IP throttle limits abuse.
- **Capture**: subscriber `sales.inbound_from_dieline` of `dielines.downloaded` (signed-in, non-staff, flag
  `capture.dieline_download_enabled` **false**): a non-customer (no order group) with marketing consent and route pool
  / rep → create the item, or **refresh** the open `dieline_download` item of that user (`signal_count + 1`,
  `last_signal_at`, need, rescore; event `sales_inbound_lead.refreshed`). Agent-attributed → nothing.

### 1c · Contact form / RFQ (P4) respect attribution
`support.ticket_opened` (queue sales) and `rfq.submitted`: freelance-attributed contact → no item (the ticket stays in
the CS queue, the RFQ in the RFQ desk); rep-attributed → item assigned to that rep (`attribution`); else P4 behaviour.

### 2 · Lead score (`sales.scoring_rules`, json, effective-dated, Sales Manager, **proposed**)
Pure `scoreLead(rules, input)` → `{ score 0–100, reasons[] }` (top 3 by |points|, zero dropped). Rules: `base`,
points per inbound `source` and per lead `leadSource`, company e-mail domain vs free webmail (`freeEmailDomains`
list), tax id present (lead tax id or the contact's active company), quantity bands (RFQ max tier, contact-form
quantity, studio cart quantity), value bands (lead expected value, RFQ target × quantity, studio cart line), recency
bands (days since the last signal), repeat signals (dieline downloads / designs ≥ n). **Pricing-page visits: skipped**
— page views are collected under `analytics_cookies` consent for aggregate analytics; using them to score a person is
another purpose (PDPA purpose limitation) → no rule (recorded). Scored at intake and by job `sales.lead_scoring`
(hourly: open items / leads never scored, older than 6 h, or scored with an older rules version).
- `SalesInboundDto` + `score`, `scoreReasons: SalesScoreReasonDto[] { reason: SalesScoreReason, points }`,
  `scoredAt`, `consentBasis`, `signalCount`, `lastSignalAt`, `customerId`, `designId`.
- `AgentLeadDto` + `score` (agent: own leads only); `AdminAgentLeadDto` + `scoreReasons`, `scoredAt`.
- Lists: `admin.salesInbound.list` + `minScore`, `sort` (`due` default | `score` | `createdAt`), `order`;
  `AgentLeadSort` + `score` and `minScore` on `AgentLeadListQuery` (agent zone and admin pipeline).

### 3 · Attribution precedence — `capture-rules.ts` `routeCapture()` + `CaptureAttributionService` (unit tests).

### 4 · Docs — API-CHANGES-P5.md (copied to web), D-471 (both repos, identical), PROGRESS row; settings review
(`pnpm launch:settings`), `docs/rbac.md` (no new permission expected; `pnpm rbac:build` to confirm no drift).

## Migrations (each with `down.sql`; deploy → down → delete rows → redeploy → status clean)
- `20270107000001_sales_p5_capture_enums`: `sales_inbound_source` + `studio_idle`, `dieline_download`;
  `sales_inbound_assignment_mode` + `attribution` (own migration: new enum values cannot be used in the same
  transaction).
- `20270107000002_sales_p5_capture`: enum `sales_inbound_consent_basis`; `sales_inbound_leads` + `capture_user_id`,
  `design_document_id` (unique), `signal_count`, `last_signal_at`, `consent_basis` (backfilled), `consent_record_id`,
  `score` (0–100 check), `score_reasons`, `scored_at`, `score_setting_version_id`, partial unique open dieline item
  per user, score index; `sales_agent_leads` + score columns; `dieline_downloads.user_id` nullable + `device_hash`
  (check: user or device).

## Settings
| Key | Type | Seed | Owner |
|---|---|---|---|
| `capture.studio_idle_enabled` | boolean | false | sales_manager |
| `capture.studio_idle_days` | integer 1–30 | 3 | sales_manager |
| `capture.dieline_download_enabled` | boolean | false | sales_manager |
| `dielines.anonymous_free_downloads` | integer 0–5 | 1 (D-471) | marketing |
| `sales.scoring_rules` | json | proposed weights | sales_manager |

## Tests
Unit: `scoreLead` (bands, clamp, top-3 order, free vs company domain, missing inputs), `routeCapture` precedence matrix,
studio candidate filter (idle days, flag date, consent, attribution, one per design / one open per user), dieline gate
(anonymous count, setting 0, sign-in required, device hash only), dieline capture create / refresh / skip, P4 subscribers
skip freelance-attributed contacts, settings seeds, confidentiality (store: no `scoreReasons`, no `SalesScore*`
reason schema; agent leads carry `score`). e2e `sales-p5.e2e-spec.ts` written (SKIPPED-DOCKER).

## Web scope (getpack-web, after the API)
Adopt the contract (openapi, lock, gen:api, mocks, problem copy for `dielines.sign_in_required`). Dieline: first
download anonymous (BFF sets the httpOnly device cookie and injects `deviceId`), second → sign-in sheet (Google, Apple,
LINE first, then phone OTP), the download continues automatically after sign-in; copy "ฟรี". Studio: consent copy
explains the idle follow-up honestly where marketing consent is asked. Admin inbox / pipeline: score chip + reasons
popover (keyboard, focus, aria), filter by minimum score, sort by score, source icons (studio_idle, dieline_download,
contact_form, rfq, line_chat, manual) via `src/domain/status`. Agent zone: score chip on own leads (no reasons). MSW
stateful (+ a mock-only hook to run the studio idle job). e2e `agent-portal-p5.spec.ts`; screenshots `P5/p5-*`;
DESIGN-NOTES P5; PROGRESS row.

## Risks
- Device-id gate is a soft gate (cookie can be cleared) — by design, the file is free.
- Scoring weights are a proposal; Sales tunes them as a new effective-dated version.
- Capture volume once flags go on: one studio item per owner at a time, one open dieline item per user (refreshed).
