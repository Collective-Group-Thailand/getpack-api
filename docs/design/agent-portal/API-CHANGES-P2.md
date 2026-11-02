# API changes — Phase 2 (`feat/agent-p2-zone`, D-467)

Agent zone `agent.getpack.co`: sign-in per surface, storefront → agent zone hand-off, the agent guard, web push and
notification choices. Migrations (non-destructive; each has a `down.sql`, rollback tested):
`20270104000001_agent_p2_session_client`, `20270104000002_agent_p2_handoff_codes`,
`20270104000003_agent_p2_notifications`.

## Changed
| Where | Change |
|---|---|
| `auth.customer.verifyOtp` (`POST /v1/auth/customer/otp/verify`) | Body is now `CustomerOtpVerifyDto` = `challengeId`, `code` + optional `client` (`AuthClient`: `storefront` default, `agent`). `store.agentPhone.confirm` keeps `OtpVerifyDto` (no `client`). |
| `auth.customer.firebase` (`FirebaseLoginDto`), `auth.customer.line` (`LineLoginDto`) | Optional `client` (`AuthClient`). Send `client: "agent"` from the agent zone's sign-in page. |
| Sessions | `auth_sessions.client` recorded at sign-in, kept by `auth.tokens.refresh`; an agent-zone sign-in is its own session family (logout / reuse detection per surface). Token pair shape unchanged. |
| Every `/v1/store/agent/*` handler | `AgentZoneGuard` (see "Guard"). New 403 `agents.ended` documented on every agent handler. |
| `sales_agent_commission.earned` payload | + `customerId` (the agent's account) so the agent is notified. |
| Web push delivery | Agent events push only to agent-zone subscriptions; other events no longer reach agent-zone subscriptions (storefront / admin / partner unchanged). |

## New endpoints
| Operation | Method + path | Auth | Request → response |
|---|---|---|---|
| `auth.customerHandoff.create` | `POST /v1/auth/customer/handoff` | customer bearer (storefront session) | `CreateHandoffDto { target: HandoffTarget ("agent"), fingerprint: string 16–512 }` → **201** `HandoffCodeDto { code: string, expiresAt: date-time, target: "agent" }` |
| `auth.customerHandoff.redeem` | `POST /v1/auth/customer/handoff/actions/redeem` | public, login-throttled | `RedeemHandoffDto { code: string ≤128, fingerprint: string 16–512 }` → **200** `TokenPairDto` (session client `agent`); any failure **401** `auth.handoff_invalid` |
| `store.me.sessions` | `GET /v1/store/me/sessions` | customer | → `MySessionListDto { data: MySessionDto[] }`, `MySessionDto { id (session family uuid), client: AuthClient, loginMethod: LoginMethod, signedInAt, lastActiveAt, expiresAt, userAgent: string\|null, current: boolean }` |
| `store.me.revokeSessions` | `POST /v1/store/me/sessions/actions/revoke` | customer | `RevokeMySessionsDto { client: AuthClient, includeCurrent?: boolean (false) }` → `RevokedSessionsDto { revoked: integer }` |
| `store.agentPush.vapidPublicKey` | `GET /v1/store/agent/push/vapid-public-key` | agent (`agent.self`, active/suspended) | → `VapidKeyDto { vapidPublicKey: string\|null }` |
| `store.agentPush.subscribe` | `POST /v1/store/agent/push/subscriptions` | agent | `SubscribeWebPushDto { endpoint, keys: { p256dh, auth }, userAgent? }` → **201** `WebPushSubscriptionDto { id, vapidPublicKey }` |
| `store.agentPush.unsubscribe` | `DELETE /v1/store/agent/push/subscriptions/{subscriptionId}` | agent | → **204** (404 when not an agent-zone subscription of the caller) |
| `store.agentNotificationPreferences.get` | `GET /v1/store/agent/notification-preferences` | agent | → `AgentNotificationPreferencesDto { items: AgentNotificationPreferenceDto[18], reachable: AgentNotificationReachDto { webPush, line, email } }`; item = `{ event: AgentNotificationEvent, channel: PartnerNotificationChannel, enabled: boolean, locked: boolean }` |
| `store.agentNotificationPreferences.set` | `PUT /v1/store/agent/notification-preferences` | agent | `SetAgentNotificationPreferencesDto { items: { event, channel, enabled }[1–18] }` (only what changes) → `AgentNotificationPreferencesDto`; 422 `validation.failed` with error code `locked` (locked e-mail off) or `duplicate` |

Enums: `AuthClient` = `storefront | agent` · `HandoffTarget` = `agent` · `LoginMethod` = `password | phone_otp |
firebase_google | firebase_apple | line | line_liff | device_pin` · `AgentNotificationEvent` = `lead_converted |
lead_protection_expiring | commission_earned | statement_ready | payout_paid | payout_profile_needed` ·
channel component **`PartnerNotificationChannel`** = `web_push | line | email` (the same values as the partner zone's
channels; reused because the contract forbids two components of the same shape — in the agent zone label them
"แจ้งเตือนบนแอป (getpack Agent)", "LINE OA", "อีเมล").

Operation ids differ from the prompt's 4-part names (`auth.customer.handoff.create`, `store.agent.push.subscribe`,
`store.agent.notificationPreferences.get`) because the contract rule is `<surface>.<resource>.<action>`.

## Hand-off flow (web)
1. Storefront server (signed in): `POST /v1/auth/customer/handoff` `{ target: "agent", fingerprint }` → `code`.
   The fingerprint must be reproducible by the agent zone's server for the same device (e.g. SHA-256 of a device id
   cookie set on the parent flow + the user agent); the API stores only its SHA-256.
2. Redirect to `https://agent.getpack.co/<handoff route>` carrying the code (POST form or fragment — keep it out of
   server access logs); the agent zone's server calls `…/handoff/actions/redeem` within 60 s with the same fingerprint
   and sets its own host-only httpOnly cookies from the token pair.
3. Any refusal → `auth.handoff_invalid` (401): show the agent-zone sign-in page.

## Guard (`/v1/store/agent/*`)
| Access | Handlers | Who |
|---|---|---|
| `anyone` | `store.agent.programme`, `store.agentProgramme.public`, `store.agentProgramme.example`, `store.agent.getApplication`, `store.agent.apply`, `store.agent.withdrawApplication`, `store.agent.claimLink`, `store.agentPhone.request`, `store.agentPhone.confirm` | any signed-in customer (public where `@Public`) |
| `records` | `store.agent.statements`, `store.agent.statement`, `store.agent.whtCertificate` | active / suspended agent; an **ended** agent for `agents.ended_record_access_years` (5) after `endedAt` |
| `agent` (default) | everything else (me, customers, leads, commissions, ล.ย.01, payout profile, push, notification choices …) | active / suspended agent |

Not an agent → 403 `agents.not_agent` (or `auth.forbidden` where `agent.self` is required); ended → 403
`agents.ended` (neutral copy th/en).

## Notification events
| Choice key | Domain event | Channels (seeded routes, th/en) | Locked |
|---|---|---|---|
| `lead_converted` | `sales_agent_lead.converted` | in-app, e-mail, web push, LINE | — |
| `lead_protection_expiring` | **new** `sales_agent_lead.protection_expiring` (`daysLeft` 7 \| 1, `protectedUntil`, `protectedUntilDate`, `contactName`, `leadId`) | in-app, e-mail, web push, LINE | — |
| `commission_earned` | `sales_agent_commission.earned` (`amount`) | in-app, e-mail, web push, LINE | — |
| `statement_ready` | `sales_agent_statement.approved` | in-app, e-mail, web push, LINE | e-mail |
| `payout_paid` | `sales_agent_statement.paid` | in-app, e-mail, web push, LINE | e-mail |
| `payout_profile_needed` | `sales_agent_statement.payout_profile_needed` | in-app, e-mail, web push, LINE | e-mail |

In-app always stays. The reminder job `agents.protection_reminders` runs hourly. LINE OA messages go through the
existing LINE Messaging adapter to the person's linked LINE account (no channel configured here: env placeholders
`LINE_MESSAGING_*`). Web push payload: `{ title, body, type, eventId, url }` — `url` is null for agent events until
the web defines agent-zone deep links (deferred).

## Error codes
`auth.handoff_invalid` (401) · `agents.ended` (403)

## Settings
`auth.handoff_code_ttl_seconds` (integer 60, 30–120, proposed — technical/security limit) ·
`agents.ended_record_access_years` (integer 5, 5–10, Finance Manager)

## Env
None new in the API (VAPID keys already: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). The API has no
browser-origin allow-list (the web calls it server-side through each zone's BFF), so `AGENT_HOST` is a web env only.

## Web checklist
- [ ] `pnpm gen:api`
- [ ] sign-in page in the agent zone sends `client: "agent"` (OTP verify, Firebase, LINE)
- [ ] "เปิด getpack Agent": storefront server creates the code, agent-zone server redeems it (same fingerprint)
- [ ] handle `agents.ended` (statements / 50 ทวิ remain) and `agents.not_agent` (compact landing + apply)
- [ ] service worker: `store.agentPush.vapidPublicKey` → `PushManager.subscribe` → `store.agentPush.subscribe`
- [ ] การแจ้งเตือน: 6 × 3 toggles from `items`, locked rows fixed, hints from `reachable`
- [ ] optional "อุปกรณ์ที่เข้าสู่ระบบ" from `store.me.sessions` / `store.me.revokeSessions`
