# API changes — Phase 5 (`feat/agent-p5-capture`, D-471)

Automatic lead capture into the inbound pool (studio designs not ordered, dieline downloads by signed-in
non-customers), each behind its own flag and only with marketing consent; the free dieline download without sign-in
(first one) with a server-side sign-in gate from the second; the lead score 0–100 with its top 3 reasons for staff and
the score only for agents; attribution precedence agent > rep > pool across every inbound source. Money = decimal
strings; times `+07:00`. No new permission (docs/rbac.md gains the D-471 personal-data notes).

Migrations (non-destructive, each with `down.sql`, rollback tested): `20270107000001_sales_p5_capture_enums` (new enum
values, own transaction), `20270107000002_sales_p5_capture`, `20270107000003_sales_p5_scoring`.

## 1 · Dieline download stays free — first one without sign-in (store)

| Operation | Method + path | Request → response |
|---|---|---|
| **new** `store.dielines.downloadFree` (public, throttled per IP: 10 / min, 429 `http.too_many_requests`) | `POST /v1/store/dielines/downloads/free` | `DownloadDielineFreeDto` = `DownloadDielineDto` (variantCode, lengthMm, widthMm, heightMm, measurementBasis?, materialClass, format) + **`deviceId` (uuid)** → 201 `DielineDownloadDto` (`remainingToday: null`, `nextNeedsSignIn`). **401 `dielines.sign_in_required`** when this browser already took its `dielines.anonymous_free_downloads` (1) downloads — or the setting is 0. Other errors as `store.dielines.download`. |
| `store.dielines.download` (customer bearer, unchanged rules and D-203 limits) | `POST /v1/store/dielines/downloads` | `DielineDownloadDto` gains **`nextNeedsSignIn: boolean`** (always `false` when signed in). |

**How the gate is enforced (server-side).** The web keeps a random UUID per browser in a first-party **httpOnly**
cookie set by its BFF and sends it as `deviceId`; the API stores only `SHA-256("dieline-device:" + lower(deviceId))`
(`dieline_downloads.device_hash`, `user_id` null) and counts downloads per hash under an advisory lock. Flow on the
web: signed out → `downloadFree`; `201` → file; `401 dielines.sign_in_required` (or `nextNeedsSignIn` from the previous
answer) → the sign-in sheet (Google, Apple, LINE, then phone OTP) → on success call `store.dielines.download` with the
same body automatically. Copy says "ฟรี" — never "฿0", never a price or plan. A cleared cookie gets another free first
download (accepted; the file is free; the IP throttle stops floods). Event `dielines.downloaded` payload gains
`anonymous`.

## 2 · Lead score (staff: score + reasons; agents: score only)

`SalesScoreReasonDto { reason: SalesScoreReason (source | company_email_domain | free_email_domain | tax_id_present |
quantity_band | value_band | recency | repeat_signals), points: integer (negative = taken off) }` — top 3 by absolute
points, largest first.

| Schema | New fields |
|---|---|
| `SalesInboundDto` (admin) | `score: integer 0–100 \| null`, `scoreReasons: SalesScoreReasonDto[]`, `scoredAt`, `consentBasis: SalesInboundConsentBasis (enquiry \| staff_entry \| marketing_consent)`, `signalCount`, `lastSignalAt`, `customerId (uuid \| null)`, `designId (uuid \| null)`; `source` enum `SalesInboundSource` gains **`studio_idle`** ("ออกแบบแล้วยังไม่สั่ง") and **`dieline_download`**; `sourceRef` = the style code for `dieline_download` |
| `AdminAgentLeadDto` (admin pipeline, agents desk) | `score`, `scoreReasons`, `scoredAt` |
| `AgentLeadDto` (agent zone, own leads) | **`score` only** (no reasons — confidentiality spec) |

| Query | New params |
|---|---|
| `admin.salesInbound.list` | `minScore` (0–100; unscored left out), `sort` = `SalesInboundSort` (`due` default — soonest due, `order` ignored · `score` — unscored last · `createdAt`), `order` (`SortOrder`, default desc for score / createdAt) |
| `store.agentLeads.list`, `admin.salesLeads.list` | `AgentLeadSort` gains `score` (unscored last); `minScore` |

Rules: `sales.scoring_rules` (json, effective-dated, Sales Manager, **proposed**): `base` 10; `inboundSource` contact_form
15, rfq 20, line_chat 10, manual 10, studio_idle 10, dieline_download 5; `leadSource` manual 5, card_scan 10,
csv_import 0, link 15, staff 10; company e-mail domain +15, free webmail −5 (`freeEmailDomains` list); tax id present
+15 (lead tax id or the contact's active company); quantity bands ≥1,000 +5 / ≥5,000 +10 / ≥20,000 +15; value bands
≥฿20,000 +5 / ≥฿100,000 +10 / ≥฿500,000 +15; recency ≤1 day +15 / ≤7 +10 / ≤30 +5; repeat signals ≥3 +5; clamped 0–100.
Inputs: RFQ largest tier and target × tier; contact-form quantity; studio cart line; lead expected value. **Pricing-page
visits are not scored** (analytics consent ≠ sales scoring purpose). Scored at intake / refresh and by job
`sales.lead_scoring` (hourly: unscored, > 6 h old or older rules); leads also on `registered`, `updated`,
`stage_changed`. Rescoring never moves `updatedAt`.

## 3 · Capture sources (no new endpoint; they appear in `admin.salesInbound.*`)

- **`studio_idle`** — job `sales.capture_studio_idle` (hourly): a customer's saved studio design (current version,
  not deleted, no order) last changed ≥ `capture.studio_idle_days` (3) ago and after the flag's effective date (7-day
  catch-up). One item per design; one open studio item per person. Skips: staff / agent / inactive accounts, any
  attribution (agent or rep), no marketing consent. `need` = `“design title” · style code`; `designId` set.
- **`dieline_download`** — subscriber `sales.inbound_from_dieline` of `dielines.downloaded` (signed-in, not staff): a
  non-customer (no order group) with marketing consent → item (pool or the attributed rep); later downloads refresh
  the open item (`signalCount`, `lastSignalAt`, `need` = `dieline · codes…`, rescored; event
  `sales_inbound_lead.refreshed`).
- **Consent**: the latest record of `marketing_email` / `marketing_line` / `marketing_sms`, one granted → captured
  with `consentBasis = marketing_consent`; none → nothing captured, nothing sent.

## 4 · Attribution precedence (all sources, P4 subscribers included)

`routeCapture`: active agent link (customer or company) > protected / converted agent lead with the same phone, e-mail
or tax id (D-417) > an open item already assigned to a rep > the pool. **Freelance agent → no item at all** (contact
ticket stays in the CS queue, RFQ at the RFQ desk). **Employee agent (a rep) or a rep's open item → assigned straight
to that rep** — new `SalesInboundAssignmentMode` value `attribution` (pool if the rep has no active employee agent).
Contact-form and RFQ items now record `customerId` (the signed-in customer).

## Settings (effective-dated, audited)

| Key | Type | Seed | Owner |
|---|---|---|---|
| `capture.studio_idle_enabled` | boolean | **false** | sales_manager |
| `capture.studio_idle_days` | integer 1–30 | 3 (proposed) | sales_manager |
| `capture.dieline_download_enabled` | boolean | **false** | sales_manager |
| `dielines.anonymous_free_downloads` | integer 0–5 | 1 (D-471; 0 = sign in every time) | marketing |
| `sales.scoring_rules` | json | above (proposed) | sales_manager |

## Problems
`dielines.sign_in_required` (401): th "เข้าสู่ระบบเพื่อดาวน์โหลดต่อ (ฟรี)" / en "Sign in to keep downloading (free)".

## Events and jobs
New event `sales_inbound_lead.refreshed`; `sales_inbound_lead.created` payload + `score`; `dielines.downloaded` payload
+ `anonymous`. Jobs `sales.capture_studio_idle` (hourly), `sales.lead_scoring` (hourly). Subscribers
`sales.inbound_from_dieline`, `sales.lead_score_on_register`, `sales.lead_score_on_update`,
`sales.lead_score_on_stage`. No new notification.

## Web notes
- Dieline: device id in an httpOnly cookie set by the BFF (never JS-readable), injected into `downloadFree`; the sheet
  lists one-tap providers first; after sign-in the same download continues without another tap.
- Inbox / pipeline: score chip (0–100, tone by band in `src/domain/status`) with a reasons popover from
  `scoreReasons` (label per `SalesScoreReason`, signed points); filter "คะแนนตั้งแต่" (`minScore`), sort by score; a
  source icon per `SalesInboundSource`. Agent zone: the chip without the popover.
- Studio: where marketing consent is asked, say that a getpack sales person may contact them about a saved design
  they have not ordered (only with that consent).

## Deferred
Pricing-page visit scoring (needs its own consent purpose) · a saved-design service reminder e-mail (none exists in the
notification rules) · LINE chat source (P4) · e2e / integration (`test/e2e/sales-p5.e2e-spec.ts`,
`dieline-downloads.e2e-spec.ts` free case) run in CI (no Docker here).
