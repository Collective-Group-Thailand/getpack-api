# P2 — agent zone `agent.getpack.co` · plan (autorun)

Branch `feat/agent-p2-zone` (both repos). Decision D-467 (PLAN A-08). Owner delegated all decisions; assumptions
are recorded here, in `docs/PROGRESS.md` and in D-467.

## Scope (API)
1. **Sign-in per surface.** The agent zone uses the existing customer identity and endpoints (phone OTP,
   LINE / LIFF, Google / Apple through Firebase). New optional body field `client` (`AuthClient`: `storefront` |
   `agent`, default `storefront`) on `auth.customer.verifyOtp` (new body `CustomerOtpVerifyDto`, which extends
   `OtpVerifyDto` so `store.agentPhone.confirm` keeps its body), `auth.customer.firebase` and `auth.customer.line`.
   The session records it (`auth_sessions.client`, default `storefront`, carried through rotation); an agent-zone
   sign-in is its own session family. Minimal `store.me.sessions` (`GET /v1/store/me/sessions`) and
   `store.me.revokeSessions` (`POST /v1/store/me/sessions/actions/revoke`, `{ client }`) so a person sees and ends
   the sessions of one surface (audited, evented).
2. **Hand-off** storefront → agent zone without a shared cookie: `auth.customer.handoff.create`
   (`POST /v1/auth/customer/handoff`, customer bearer; `{ target: agent, fingerprint }` → `{ code, expiresAt, target }`)
   and `auth.customer.handoff.redeem` (`POST /v1/auth/customer/handoff/actions/redeem`, public, throttled;
   `{ code, fingerprint }` → `TokenPairDto` of a NEW `agent` session). Code: 256-bit random, single use, lifetime
   setting `auth.handoff_code_ttl_seconds` (60, 30–120, technical/security limit, effective-dated). Only SHA-256 of
   the code and of the fingerprint are stored (`auth_handoff_codes`). Any failure (unknown, expired, used,
   fingerprint mismatch, account no longer active) → one neutral `auth.handoff_invalid`; a wrong fingerprint burns
   the code. Audited on create, redeem and refusal.
3. **Agent guard.** `AgentZoneGuard` on every `/v1/store/agent/*` controller: the caller must be a sales agent
   (`agents.not_agent`) whose status is active or suspended. Ended agents: read-only statements list / detail and
   50 ทวิ download for `agents.ended_record_access_years` (5, Finance Manager) after `endedAt`; everything else →
   `agents.ended` (403, neutral copy th/en). Handlers used before becoming an agent are marked
   `@AgentAccess('anyone')` (programme, programme/public, programme/example, application ×3, claims,
   phone-verification ×2). A unit test fails when a new `/v1/store/agent` handler has no explicit access level
   decision (default = agent active/suspended).
4. **Web push + notification preferences.** `store.agent.push.vapidPublicKey` / `.subscribe` / `.unsubscribe`
   under `/v1/store/agent/push/…` delegate to `WebPushSubscriptionsService` with `client = agent`
   (`web_push_subscriptions.client`). Agent events push only to agent-zone subscriptions; other events skip them.
   `store.agent.notificationPreferences.get/set` (`GET/PUT /v1/store/agent/notification-preferences`):
   event (`lead_converted`, `lead_protection_expiring`, `commission_earned`, `statement_ready`, `payout_paid`,
   `payout_profile_needed`) × channel (`web_push`, `line`, `email`) → enabled (default on; table
   `sales_agent_notification_preferences`, rows only for changes). The router mutes a disabled route for that
   recipient. E-mail of `statement_ready`, `payout_paid`, `payout_profile_needed` is **locked on** (D-144 finance
   messages; `locked: true`). Event map: lead_converted → `sales_agent_lead.converted`, lead_protection_expiring →
   NEW `sales_agent_lead.protection_expiring` (payload `daysLeft` 7 | 1, hourly job, once per lead per threshold via
   `sales_agent_leads.protection_reminded_7d_at / _1d_at`), commission_earned → `sales_agent_commission.earned`
   (payload gains `customerId`), statement_ready → `sales_agent_statement.approved` (amounts and withholding are
   final then), payout_paid → `sales_agent_statement.paid`, payout_profile_needed →
   `sales_agent_statement.payout_profile_needed`. Seeds: in-app / e-mail where missing, web push and LINE for all six
   (th/en). LINE goes through the existing LINE Messaging adapter to the person's linked LINE account.
5. **Hosts / docs.** The API has no CORS allow-list (the web calls it server-side through the zone BFF; no
   `PUBLIC_HOST` / `ADMIN_HOST` / `PARTNER_HOST` in this repo) → nothing to add; recorded. `API-CHANGES-P2.md`,
   D-467 in both repos, PROGRESS row.

## Scope (web) — summary of the 🟩 box (PROMPT lines 323–358)
Fourth zone `agent` in `src/lib/zones/*` (AGENT_HOST, BFF `/agent-zone/bff` allowing `/v1/store/agent` and
`/v1/auth/customer` only, noindex, CSP, ESLint boundaries for `src/features/agent/**`); sign-in page with OTP / LINE /
Google / Apple sending `client: "agent"`; "เปิด getpack Agent" on the storefront uses the hand-off (create on the
storefront server, redeem on the agent-zone server, fingerprint from the agent server's request); PWA manifest
"getpack Agent", service worker scoped to the agent host, install prompt, iOS guide; responsive shell (bottom tab /
rail / sidebar); pages moved from `/account/agent/*` (308 redirects); notification settings page (event × channel
toggles, locked e-mail rows shown as fixed); share sheet.

## Migration
`20270104000001_agent_p2_zone`: enums `auth_client`, `sales_agent_notification_event`; `auth_sessions.client`,
`web_push_subscriptions.client` (default `storefront`); `auth_handoff_codes`; `sales_agent_notification_preferences`;
`sales_agent_leads.protection_reminded_7d_at / _1d_at`. Rollback `down.sql` (tested).

## Tests
Unit: handoff service (hash only, single use, neutral error, fingerprint burn), agent guard (levels × statuses ×
retention), preference rules (locked e-mail, defaults), router mute, protection reminder thresholds, notification
matrix (seeds), factory-confidentiality covers the new `/v1/store/agent/*` responses. e2e (`agents.e2e-spec.ts`,
not runnable here): hand-off create/redeem/reuse, ended-agent guard.

## Risks
- `client` on staff / partner sessions keeps its default and means nothing there (documented).
- Agent-zone deep links in push / LINE messages: the store zone has no page for agent aggregates → `url: null`
  until the web zone defines agent routes (deferred).
- e2e and integration suites cannot run here (no Docker); CI runs them.
