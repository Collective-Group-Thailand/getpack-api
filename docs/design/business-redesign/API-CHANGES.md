# business-redesign — API-CHANGES (A1: business Phase 0 + Phase 3b)

Repository `getpack-api`, branch `fix/uat-phase0`. Decision **D-435** (factory confidentiality on the storefront;
supersedes D-201 / D-264, amends D-309 and D-422). Copy this file into `getpack-web/docs/design/business-redesign/`
before the web session runs, then `pnpm gen:api` against the new `contract/openapi.json`.

**Breaking for the storefront** (fields and one endpoint removed). No new endpoint, no migration, no new env var.

---

## 1. Removed

| Operation | Path | Web action |
|---|---|---|
| `store.network.getStats` | `GET /v1/store/network/stats` | Delete the call. `/network` becomes static "มาตรฐานการผลิตของ getpack" copy (Phase 3b web). The URL now answers `404 http.not_found`. |

Removed with it (server side): `NetworkStatsService`, DTOs `NetworkStatsDto`, `NetworkFiguresDto`, `CoverageDto`,
`AuditCriterionDto` (alias), and the settings `trust.network_min_factories`, `trust.network_min_jobs`,
`trust.network_window_days`, `trust.audit_criteria` (no longer seeded or read; rows already in a database stay, unused).

## 2. Changed responses

| Operation(s) | Change | Before → after |
|---|---|---|
| `store.publicConfig.get` (`GET /v1/store/public-config`) | `factoryCount` removed | `{ …, "templateCount": 42, "factoryCount": null, "contact": … }` → `{ …, "templateCount": 42, "contact": … }` |
| `store.styles.get` (`GET /v1/store/styles/{code}`), `store.styles.compare` (`GET /v1/store/styles/compare`) | `StyleDetailDto.partnersCount` removed | field gone |
| same | `variants[].priceReasons` never contains `not_makeable` (enum `StylePriceReason` unchanged) | availability = `pricePath` (`instant` / `rfq`) only |
| `store.agent.me` (`GET /v1/store/agent`) | `totals.factories` removed (`AgentTotalsDto`) | staff keep it on `AdminAgentDto.totals` (`AdminAgentTotalsDto`) |
| `store.agent.commissions` (`GET /v1/store/agent/commissions`), `store.agent.statement` (`GET /v1/store/agent/statements/{statementId}`) | `AgentCommissionDto.factoryName` removed | staff keep it on `AdminAgentCommissionDto.factoryName` |
| `store.callOffs.request` / `list` / `get` / `cancel` (`/v1/store/call-off-agreements*`) | new schema **`StoreCallOffAgreementDto`** — no `factory`, no `buyUnitPrice` | partner/admin keep `CallOffAgreementDto` (now `extends StoreCallOffAgreementDto`, `factory` non-null) |
| `store.shipments.list` (`GET /v1/store/orders/{orderId}/shipments`) | `events[].location` is `null` unless the step is `out_for_delivery`, `delivered` or `failed` | pickup / in-transit / return locations no longer sent |
| `store.timeline.get` (`GET /v1/store/orders/{orderId}/timeline`) | shipment entries: `params.location` follows the same rule | |
| every response with a `ShipmentStatus` label, `store.statusLabels.list` | customer words for `picked_up`: `statusLabelTh` "ออกจากโรงงานแล้ว" → **"จัดส่งออกแล้ว"**, `labelEn` "Left the factory" → **"Dispatched"** | `statusLabelAdminTh` unchanged (staff) |

### Examples

`GET /v1/store/public-config` → `200`
```json
{
  "minOrderQty": { "custom": 500, "readyStock": 1 },
  "priceLockDays": 15,
  "claimWindowDays": 7,
  "proofSlaBusinessDays": null,
  "supportHours": null,
  "supportReplyMinutes": null,
  "templateCount": 42,
  "contact": { "phone": null, "lineOaId": null, "email": null }
}
```

`GET /v1/store/call-off-agreements/{agreementId}` → `200` (`StoreCallOffAgreementDto`)
```json
{
  "id": "0192f3a0-7c1e-7d2a-9b1f-0000000e7301",
  "status": "active",
  "quoteId": "0192f3a0-7c1e-7d2a-9b1f-0000000e7303",
  "quoteOptionId": "0192f3a0-7c1e-7d2a-9b1f-0000000e7304",
  "quoteCode": "QT-2610-00012",
  "productType": { "id": "0192f3a0-7c1e-7d2a-9b1f-0000000e7306", "code": "folding_carton", "nameTh": "กล่องกระดาษพับ", "nameEn": "Folding carton" },
  "unit": "piece",
  "unitPrice": "13.38",
  "committedQuantity": 10000,
  "releasedQuantity": 2000,
  "remainingQuantity": 8000,
  "minReleaseQuantity": 1000,
  "months": 6,
  "startsAt": "2026-10-04T09:00:00+07:00",
  "expiresAt": "2027-04-04T09:00:00+07:00",
  "declineReason": null,
  "lapsedQuantity": null,
  "releases": [],
  "createdAt": "2026-10-03T15:00:00+07:00"
}
```

`GET /v1/store/orders/{orderId}/shipments` → `200` (one shipment, steps only)
```json
[{
  "shipmentNo": "SH-2610-0001",
  "carrier": "getpack",
  "events": [
    { "occurredAt": "2026-10-20T08:00:00+07:00", "status": "picked_up", "statusLabelTh": "จัดส่งออกแล้ว", "location": null },
    { "occurredAt": "2026-10-20T15:00:00+07:00", "status": "in_transit", "statusLabelTh": "กำลังส่ง", "location": null },
    { "occurredAt": "2026-10-21T09:30:00+07:00", "status": "out_for_delivery", "statusLabelTh": "กำลังนำส่ง", "location": "ศูนย์กระจายสินค้าบางนา" }
  ]
}]
```

`GET /v1/store/agent` → `200`, `totals`
```json
{ "pending": "1250.00", "held": "0.00", "earned": "830.50", "statemented": "0.00", "paidThisYear": "4200.00", "activeLinks": 6, "openLeads": 3 }
```

## 3. DTOs

- New: `StoreCallOffAgreementDto` (store), `AdminAgentTotalsDto` (admin).
- Changed: `CallOffAgreementDto` (partner/admin; `factory` no longer nullable), `AgentTotalsDto`, `AgentCommissionDto`,
  `AdminAgentCommissionDto` (+ `factoryName`), `AdminAgentDto` (`totals: AdminAgentTotalsDto`), `StyleDetailDto`,
  `PublicConfigDto`, `StoreShipmentEventDto` (description).
- Removed: `NetworkStatsDto`, `NetworkFiguresDto`, `CoverageDto`.

## 4. Migrations · env vars

- Migrations: **none** (no schema change). `prisma migrate status` reports 124 migrations — `prisma/migrations` has
  124 migration folders plus `migration_lock.toml`, which a plain `ls | wc -l` counts as the 125th.
- Env vars: none added or removed.

## 5. Guard

`test/unit/storefront-factory-confidentiality.spec.ts` (runs in `pnpm test`): fails when any `/v1/store/*` response
schema, at any depth, or any success example has a key matching
`factory|factories|partner|machine|plant|minFactories|coverage`, or when `/v1/store/network/*` returns. Allow-list
(with reasons in the file): the agent programme's bounty terms `AgentPlanTermsDto.factoryBountyAmount`,
`factoryQualifyJobs`, `factoryQualifyDays` (a rule of the programme, no factory identity or count).

## 6. Web checklist (`getpack-web`)

1. `pnpm gen:api`; remove every use of `factoryCount`, `partnersCount`, `factoryName`, `totals.factories`,
   call-off `factory` / `buyUnitPrice`, and `store.network.getStats`.
2. `/network` → "มาตรฐานการผลิตของ getpack", footer label "มาตรฐานการผลิต" (static copy, Phase 3b).
3. Product availability only as instant price vs request a quote (`pricePath`), never coverage.
4. Shipment steps: show the location only when the API sends one.

## 7. Open questions (business / next phases)

See `PLAN.md` §2 (C11–C18, F1–F2) and §3. In short:
1. Staff/factory words (`statusLabelAdminTh`, `labelAdminTh`) still reach the storefront and include "โรงงาน"; plan a
   store-only label set (with A2 account Phase 0).
2. Store enum values that name factories or capacity (`pending_factory`, `factory_review`, `ClaimOwner.factory`,
   `no_active_factory`, `capacity_unavailable`) — rename for the store surface in a coordinated breaking change?
3. Carrier bookings send the factory's contact as sender (Flash / Deliveree, flags off today) — must change before a
   carrier is enabled.
4. `agents.lead_existing_factory` lets an agent test whether a company is a getpack factory — replace with one neutral
   refusal? (changes D-417/D-419 behaviour; needs a decision).
5. EXIF/GPS stripping of customer-visible photos; PDF `Producer`/`Creator` metadata.
6. Reference format: the pack asks CT-YYYY-#####; tickets today are `CS-YYMM-NNNNN`.
7. Clean up the unused `trust.*` setting rows in seeded databases (UAT) with a data migration, or leave them?
