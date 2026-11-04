# API changes — Phase 7 (`chore/agent-p7-launch`, QA, pilot and launch record)

What the web needs from P7: the **pilot switch** (who may apply, the public waiting list and its admin list), the new
**429** answers on four agent-zone calls, and the UAT seed identities for QA. Everything is **off by default**: the
flag `agents.programme` stays off and the setting `agents.pilot` is `{ enabled: false, userIds: [] }`. No new
decision row (P7 choices are recorded as assumptions in `docs/PROGRESS.md`). Run `pnpm gen:api`.

Migration (non-destructive, `down.sql`, rollback tested): `20270109000001_agent_p7_waitlist` — table
`sales_agent_waitlist`.

## 1 · Pilot switch — who may apply

- `store.agentProgramme.public` (`GET /v1/store/agent/programme/public`, anonymous, cached 5 min) — `applyOpen` is the
  flag only (an anonymous visitor is never on the pilot list) → **false** until the owner opens sign-up. New fields:
  - `waitlistOpen: boolean` — the waiting list takes sign-ups (`!applyOpen` and a consent text is published);
  - `waitlistConsent: AgentWaitlistConsentDto | null` — `{ versionNo, textTh, textEn, summaryTh, summaryEn }`, the
    text to show beside the form (purpose `agent_waitlist`); null → hide the form (409 `agents.waitlist_closed`).
- `store.agent.programme` (`GET /v1/store/agent/programme`, signed-in customer) — new **`applyOpen: boolean`**: true
  when the flag is on for this person **or** the pilot setting is enabled and lists their customer public id. The
  landing / account page shows **apply** when true, else **"ลงทะเบียนรอเปิดรับ"** (waiting list).
- `store.agent.apply` uses the same rule (else 409 `agents.programme_closed`, unchanged).
- Setting **`agents.pilot`** (json, effective-dated, audited, owner `sales_manager`):
  `{ enabled: boolean, userIds: string[] (customer public ids, uuid, ≤ 200, unique) }`. Edited in Admin → Settings
  (no new endpoint). The flag `agents.programme` is the master switch for the public opening (Superadmin).

## 2 · Waiting list

| operationId | Method + path | Auth | Request → response |
|---|---|---|---|
| `store.agentProgramme.joinWaitlist` | `POST /v1/store/agent/programme/waitlist` | **public** (no bearer), throttled **5 / min / IP** | `JoinAgentWaitlistDto { name (1–120), phone? (0XXXXXXXXX or E.164), email?, salesChannel? (AgentSalesChannel), consentVersionNo (int ≥ 1) }` — phone or e-mail required → **200 `AgentWaitlistReceiptDto { status: 'received' }`** always (same answer for a contact already listed). Errors: 422 `validation.failed` (no contact / bad field), 409 `agents.waitlist_closed` (no consent text), 409 `agents.waitlist_consent_outdated` (`params.versionNo` = current; re-read public programme), 429 `http.too_many_requests` |
| `admin.agentWaitlist.list` | `GET /v1/admin/agent-waitlist?page&perPage&q` | staff, `agent_waitlist.read` | → `{ data: AdminAgentWaitlistEntryDto[], meta }`; entry `{ id, name, phone (E.164) \| null, email \| null, salesChannel \| null, joinCount, createdAt, lastJoinedAt }` (newest first; `q` searches name / e-mail / phone) |
| `admin.agentWaitlist.export` | `POST /v1/admin/agent-waitlist/actions/export` | staff, `agent_waitlist.read` | → `AgentWaitlistExportDto { url (signed, 5 min), expiresAt, rows }` — CSV UTF-8 BOM, formula-safe, local phones; audited |

Permission **`agent_waitlist.read`** (sensitive): Sales Manager, C-Level, Superadmin. Menu: under Agents
(`/admin/agents/waitlist` suggested). PDPA: the form must show the consent text (`waitlistConsent`) and send its
`versionNo`; retention until 12 months after the public opening (proposed).

The web keeps its anonymous form behind its own BFF (forward the client IP — the throttle is per IP).

## 3 · New 429 answers (agent zone)

Per-agent technical limits (Redis, fixed window), answer **429 `agents.rate_limited`** with a `Retry-After` header
(seconds); show "ใช้งานบ่อยเกินไป กรุณารอสักครู่" and retry after the header:

| Operation | Limit |
|---|---|
| `store.agentLeads.check` + `store.agent.registerLead` (shared budget) | 30 / minute |
| `store.agentLeads.importPreview` | 20 / hour |
| `store.agentLeads.scanCard` | 10 / minute |

## 4 · Other changes

- `admin.agents.end` also **expires the agent's registered deals** (`agent_ended`) — description updated.
- Log redaction adds `fingerprint`, `accountNo`, `handoffCode`.
- New consent purpose `agent_waitlist` (identity seeded; legal counsel enters the text; UAT gets a `[UAT]` text). It is
  not listed in a signed-in person's consent centre (`store.me.consents`).

## 5 · UAT data for QA (`pnpm db:seed:uat`, docs/launch/UAT-DATA.md §6.3)

| Who | Sign-in | Zone |
|---|---|---|
| `UATFRE22` freelance individual | phone `0800000301` (fake-OTP test number: code `000000` on a fake-integration stack) | agent |
| `UATJUR22` freelance juristic VAT | phone `0800000302` | agent |
| `UATEMP22` employee agent | staff `uat-sales-rep@example.invalid`, password `UAT_SEED_PASSWORD` | admin (sales desk) |
| Agents' customers | phones `0800000311`, `0800000312`, `0800000313` | storefront |
| Sales Manager / Finance Manager / C-Level | `sales-manager@`, `finance-manager@`, `c-level@example.invalid`, password `UAT_SEED_PASSWORD` | admin |

To rehearse the pilot, put the public id of a UAT customer who is not an agent yet (e.g. one of `0800000101`–`116`
after `pnpm uat:populate`) in `agents.pilot.userIds` with `enabled: true`: that customer sees `applyOpen: true`;
everyone else, and every anonymous visitor, sees the waiting list.
