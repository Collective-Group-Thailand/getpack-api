# Configurator Phase 0 (A4) — API changes

**No API changes.** Branch `fix/uat-phase0` of `getpack-api`. The web can run its A4 side against the contract
as it is after A3 (`docs/design/pdp-redesign/API-CHANGES.md`).

Why nothing changed:

| Item | API side |
|---|---|
| 1 · raw key `configurator.quantity.target` | Web i18n only; the API sends no such key. |
| 2 · CMYK on size 00 vs C, ฿14.79 / ฿15.70 / ฿17.26 | Report only (pricing is A3's, GLOBAL-RULES §5). One pricing service and one spec label verified. ฿17.26 = size 00 with **two** inks (ดำ + CMYK) in `printFront` — see `FINDINGS.md` §2. |
| 3 · flat 100 / 300 / 500 for 00, 0 | Report only: intended (digital linear cost + sell-margin band at 1,000). `FINDINGS.md` §3. |
| 4 · "เรียบร้อยแล้ว" → "ค่าเริ่มต้น" | Web only. |
| 5 · VAT ฿338.58 vs ฿338.75 | Computed in the API; cause found (VAT of the unrounded price; design-fee VAT also missing). **Fix proposed, not applied — waits for approval** (`FINDINGS.md` §5). |
| 6 · size F at 100 pcs → "ขอใบเสนอราคา" | Already supported: per-step `instant` / `reason`, `calculationId`, `dimensions`, `specs` / `specLabel` from `store.quotes.calculate`; RFQ via `store.rfqs.submit` with `routedFrom.calculationId`. |

Endpoints added / changed / removed: none. DTOs: none. Migrations: none. Env vars: none. `contract/openapi.json`
unchanged.

## How the web uses the existing contract (items 2, 5, 6)

### Calculate — one ink per side

`POST /v1/store/quotes/actions/calculate` (`store.quotes.calculate`). Send exactly the selected ink for a
"choose one" print option (the postal box: ดำ **or** CMYK), not every ink ever selected.

```json
{
  "productTypeCode": "corrugated",
  "configuration": {
    "catalogProductId": "01a173e6-0673-70de-9889-cd72c540c539",
    "patternId": "01a173e5-fd1b-7e93-932a-161e401a2efb",
    "materialId": "01a173e5-fd07-7709-b0f3-92ab43959ca2",
    "difficultyLevelId": "01a173e5-faba-743b-9ca2-f5aca13e41eb",
    "l": 450, "w": 300, "d": 220,
    "parts": [{ "printFront": [{ "area": "top", "inkColourId": "01a173e6-04c0-7c0e-b436-e94c76e7324c" }] }],
    "design": { "graphic": false, "structure": false },
    "quantities": [100, 300]
  }
}
```

Response (local rehearsal data, abridged; ids are local fakes):

```json
{
  "calculationId": "01a17506-b639-7532-b0e0-396291c29baf",
  "steps": [
    { "quantity": 100, "instant": false, "reason": "not_priceable", "unitPrice": null,
      "grossAmount": null, "vatAmount": null },
    { "quantity": 300, "instant": true, "reason": null, "unitPrice": "116.51",
      "grossAmount": "35088.00", "vatAmount": "2295.31", "toolingAmount": "135.00",
      "shippingPending": true, "shippingPendingReason": "no_postcode" }
  ],
  "dimensions": { "entered": { "l": 450, "w": 300, "d": 220 }, "basis": "internal" },
  "specLabel": { "th": "กล่องฝาชน (RSC) · 450 × 300 × 220 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · ดำ" }
}
```

- Item 6: when the selected quantity's step has `instant: false`, the main price area and the primary CTA switch
  to "ขอใบเสนอราคา" (not only the tier row).
- Item 5: show `vatAmount` as returned (shared price helper); do not recompute VAT in the browser.

### Request a quote with the spec prefilled

`POST /v1/store/rfqs` (`store.rfqs.submit`, signed-in customer):

```json
{
  "productTypeCode": "corrugated",
  "specSchemaVersion": 1,
  "spec": {},
  "lengthMm": 450, "widthMm": 300, "heightMm": 220,
  "measurementBasis": "internal",
  "quantities": [100],
  "deliveryPostcode": "10110",
  "notes": "กล่องฝาชน (RSC) · 450 × 300 × 220 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · ดำ",
  "routedFrom": { "calculationId": "01a17506-b639-7532-b0e0-396291c29baf" }
}
```

`routedFrom.calculationId` links the RFQ to the priced configuration for CS (D-102). `spec` stays `{}` because the
corrugated RFQ form has no extra fields (`GET /v1/store/rfq-forms/corrugated` → `fields: []`).

## Open questions (details in FINDINGS.md)

1. Should the configurator read mark an `ink_colour` group single-choice, and calculate refuse a second ink there?
2. Approve the VAT fix (VAT from the charged VAT-inclusive amount, line-level half-up, design fee included)? That
   would be the only API change of A4 and changes `vatAmount` / `netAmount` on new quotes, carts, orders, invoices.
3. Return the smallest instant quantity per spec (size F: 300)?
4. UAT seed: price ดำ below CMYK so the print choice shows a difference (fake data)?


---

# Stage C (C4-API) — API changes: calculate-batch

Branch `design/configurator-redesign` (from `fix/uat-phase0`). One additive endpoint; nothing else changes.

## `POST /v1/store/quotes/actions/calculate-batch` — `store.quotes.calculateBatch`

Prices up to 24 option variants (sizes, materials, print choices, quantities) of ONE product type in one request, so the
configurator shows a price on every option card without one `calculate` per card. Implements D-441, D-043 (+ D-100, D-050,
D-051, D-101).

- Auth: `@Public()`, actor handling identical to `calculate` (`@OptionalActor()`; a signed-in user id goes to the calculate log).
- Pricing path: the SAME one as `calculate` (GLOBAL-RULES §5, no second formula): the product-type gate
  (`StorePricingService.calculatorKeyOf`, extracted from `priceForStore` and now used by both) then
  `StorePricingService.price(calculatorKey, configuration, ctx)` per variant. `QuoteBatchService`
  (`src/modules/pricing/quotes/quote-batch.service.ts`) only loops, bounds concurrency and collects problems.
- DTOs (`quote-batch.dto.ts`): `CalculateQuoteBatchDto`, `QuoteBatchVariantDto`, `QuoteBatchCalculationDto`,
  `QuoteBatchResultDto`, `QuoteBatchProblemDto`. The polymorphic `configuration` schema is the one of `CalculateQuoteDto`
  (extracted to the exported constant `CONFIGURATION_SCHEMA` in `quote.dto.ts`, no duplicate); `calculation` is the existing `QuoteCalculationDto`.

### Request
```json
{ "productTypeCode": "folding_carton",
  "quantities": [1000],
  "variants": [ { "key": "size:s1", "configuration": { "...same as calculate..." } },
                { "key": "size:s2", "configuration": { "...": "..." } } ] }
```
- `variants`: 1..24, `key` 1..64 chars, unique within the request. `quantities` (optional, 1..10 ints, 1..10 000 000) replaces
  `configuration.quantities` of every variant. No `deliveryPostcode` / `targetPricePerUnit` (not requested; can be added additively).

### Response 200
```json
{ "results": [ { "key": "size:s1", "calculation": { "...QuoteCalculationDto...": 0 }, "problem": null },
               { "key": "size:s2", "calculation": null,
                 "problem": { "code": "validation.failed", "message": "..." } } ] }
```
`results` is in request order. `message` is the localised `detail` of the code (Accept-Language). A variant that
fails with the code `calculate` would raise (`validation.failed`, `pricing.print_combination_invalid`, `specs.unit_not_accepted`,
`pricing.vat_rate_missing`, ...) gets `calculation: null` + `problem`; an unexpected non-domain error becomes `internal.unexpected`
(logged). Note: as in `calculate`, a print combination the product does not offer is NOT an error: the steps answer
`instant:false, reason: rfq_required`.

### Request-level errors (whole request fails)
`http.bad_request`, `http.malformed_json`, `validation.failed` (0 or >24 variants, duplicate key, bad `quantities`/body shape),
`pricing.not_instant` (type inactive / not instant / no calculator), `http.too_many_requests` (429).

### Limits and throttle
- 24 variants per request; priced with bounded concurrency 4 (`BATCH_CONCURRENCY`).
- `@Throttle` 20 requests / minute / client, declared like `HERO_PREVIEW_THROTTLE` (`CALCULATE_BATCH_THROTTLE`,
  optional env `CALCULATE_BATCH_THROTTLE_LIMIT`, default 20; no env needed).

### What it writes (verified by reading the code)
Exactly what `calculate` writes, per priced variant: `QuoteEngineService.log` inserts one `calculate_logs` row
(best-effort, never fails the quote) and records the outbox event `quote.calculated` (analytics/unmet-demand subscribers)
in one `withTx`. Nothing else: no quote, cart, order, customer or file record. A variant that fails validation writes nothing.
A full batch of 24 can therefore write up to 24 `calculate_logs` rows and 24 events.

### Factory confidentiality
Response is `QuoteCalculationDto` (via `storeView`, `internal` stripped) and problem code/message only. No factory data.
`test/unit/storefront-factory-confidentiality.spec.ts` is green.

### Migration / env
Migration: none. Env: none required (optional `CALCULATE_BATCH_THROTTLE_LIMIT`).

### Tests
- New unit `src/modules/pricing/quotes/quote-batch.service.spec.ts` (StorePricingService mocked): order preserved, throwing
  variant becomes a problem, quantities override, >24 and duplicate keys refused with `validation.failed`, concurrency <= 4,
  `pricing.not_instant` fails the request.
- Run locally with docker (no DB here, not run): `pnpm test:e2e -- price-consistency studio-quotes target-price spec-model price-hints style-library`
  (they exercise `calculate`, whose gate/pricing path was refactored into `calculatorKeyOf`) and `phase4-contract`.
  Suggested follow-up: an e2e asserting batch result == calculate result for the same configuration.
- Contract: `contract/openapi.json` regenerated with `pnpm contract:build` (+527 lines, one path).

### Addendum: `baselineKey` price deltas (backwards-compatible)
- Optional request field `baselineKey` (1..64 chars; must equal one `variants[].key`, else 422 `validation.failed` at `baselineKey`).
- When sent, every result gets `deltas: [{ quantity, unitPriceDelta, totalDelta }] | null`, per quantity of that variant:
  `unitPrice` (incl. VAT, as in calculate) minus the baseline's `unitPrice` for the same quantity, and `productAmount`
  (pieces incl. VAT, excluding shipping/tooling, so it does not depend on postcode) minus the baseline's. Computed server-side
  with `MoneyDecimal`/`formatMoney`; signed 2-dp strings (`"-0.86"`, `"1.20"`, `"0.00"`).
- `null` delta values when either side is `instant:false` or the quantity is missing on the baseline. The baseline's own deltas are
  all `"0.00"`. `deltas` is `null` without `baselineKey`, or when the variant has no calculation (also when the baseline failed: all of that
  batch's instant deltas are then null per quantity).
- No new writes; same pricing path. Unit tests in `quote-batch.service.spec.ts`.

---

# C4-API-2 — store fields for `/configure` (additive, backwards-compatible)

Branch `design/configurator-redesign`. No new endpoint, no migration, no env. Only new response fields; nothing
existing changed or removed.

## 1. Design: `freeRevisions` — `GET /v1/store/catalog/products/{slug}/configurator` (`store.catalog.getConfigurator`)
- `design.freeRevisions: integer | null` — free revision rounds of `hired_design` ("แก้ฟรี {n} ครั้ง").
- Setting: **reuses the existing `design.free_revision_rounds`** (D-071, integer, seeded `3`, effective-dated and
  audited per ADR-0005, edited in the settings back office). It is the value the design service already charges extra
  rounds by (`design-services.service.ts`), so a second key `design.free_revisions` would be a second source of truth
  (GLOBAL-RULES §5) — none was added. Read: the version in force at request time; `null` only if the setting has no
  version (never a default in code).
- Example: `"design": { "options": ["own_file","online_designer","hired_design"], "default": "own_file", "freeRevisions": 3 }`

## 2–4. Per quantity tier — `store.quotes.calculate` and every `calculation` of `store.quotes.calculateBatch`
(both go through `StorePricingService.price` → `storeView`; also `store.quotes.preview` uses the same path, and staff
calculate views get the same fields.) New fields on each `steps[]` item (`QuoteStepDto`):

| Field | Type | Rule |
|---|---|---|
| `savingPercent` | integer \| null | (1 − `unitPrice` ÷ `unitPrice` of the smallest **priced** quantity of this calculation) × 100, rounded half-up to a whole number (decimal.js). `null` for that smallest tier, a tier with `instant:false` / no `unitPrice`, or a result ≤ 0. |
| `vatRate` | decimal string \| null | The approved `vat_standard` rate in force the engine used for `vatAmount` (same rate `computeVat` gets), as a fraction: `"0.07"`. `null` when `vatAmount` is `null`. |
| `zoneName` | `{ th, en }` \| null | Customer-facing names (`zones.name_th` / `name_en`) of the destination zone the customer rate card resolved from `deliveryPostcode`. `null` while shipping is not priced. Destination side only — no factory, origin or pickup location. |
| `arrival` | `{ from, to }` \| null | ISO dates, Asia/Bangkok. = the existing `earliestDeliveryDate`: earliest ship date + the zone's extra lead days or the carrier's transit days, counted with `WorkingDayCalendar.addWorkingDays` on the business calendar (national holidays from `th_public` + closures). `to` equals `from`: no maximum transit is recorded today (open question). `null` when the delivery date is unknown (no postcode / no transit). |

Example step (excerpt):
```json
{ "quantity": 1000, "instant": true, "unitPrice": "12.00", "vatAmount": "883.73", "vatRate": "0.07",
  "savingPercent": 10, "zoneName": { "th": "กรุงเทพฯ และปริมณฑล", "en": "Bangkok and vicinity" },
  "arrival": { "from": "2026-10-10", "to": "2026-10-10" }, "earliestDeliveryDate": "2026-10-10" }
```
Batch: the fields are inside `results[].calculation.steps[]`; `deltas` unchanged.

## 5. Materials description (confirmation only, nothing changed)
`materials.description_th` / `description_en` (Prisma `Material.descriptionTh/descriptionEn`, max 1000 chars) exist
and are editable in the back office: `PATCH /v1/admin/catalog/materials/{id}` (`admin.catalogMaterials.update`,
generic catalogue CRUD) and the Excel import kind `materials`. The configurator already returns them on each material
option (`optionGroups[].options[].descriptionTh/descriptionEn`).

## Implementation / tests
- `src/modules/pricing/quotes/store-step-fields.ts` (pure helper), `QuoteView.vatRatePct` / `shippingZone` from the
  engine, zone names added to the customer `RateResolution`; `StoreConfiguratorService.freeRevisions()`.
- Unit: `store-step-fields.spec.ts` (saving %, half-up, unpriced/≤0, vatRate, zone/arrival only where priced, no
  extra keys), `store-configurator.free-revisions.spec.ts` (value in force, new version, unset → null).
- Contract: `contract/openapi.json` regenerated (`QuoteArrivalDto`; `zoneName` reuses `LocalisedLabelDto`).
- e2e to run locally (docker DB): `pnpm test:e2e -- folding-quotes price-consistency studio-quotes target-price phase4-contract`
  (+ the configurator read e2e) — they assert existing step fields; new fields are additive.


---

# Stage C (C4-API-3) — API changes: arrival range from transit days per zone

Branch `design/configurator-redesign`. No endpoint, DTO shape or migration change; one new setting and a new meaning
for `arrival.to`.

## Setting `shipping.transit_days` (ADR-0005, effective-dated, audited)

- JSON, owner **Admin** (Logistics' figures entered by Admin — Logistics has no `settings.change`), `pending_business`
  until Logistics confirms. Value:
  ```json
  { "default": { "min": 3, "max": 5 },
    "zones": { "<shipping zone code>": { "min": 1, "max": 2 } } }
  ```
  Working days (integers 0–30). A zone not listed uses `default`; a `max` below `min` is read as `min`.
- Reference seed: `default` 3–5, no zones (zone codes are data Logistics enters). UAT seed adds a version with the
  rehearsal zones: `uat_bkk_metro` (กรุงเทพฯ และปริมณฑล) 1–2, `uat_central_east` (ภาคกลางและภาคตะวันออก) 2–3; the
  other zones use the default 3–5. Proposed values — **to be confirmed by Logistics**.
- Admin edits it like every setting: `PUT`/propose a new version in the back office (settings screen).

## `arrival` on calculate / calculate-batch steps

- `arrival.from` = ready date + `min`, `arrival.to` = ready date + `max` working days. Ready date = the step's
  `earliestShipDate`; working days of the national business calendar (`th_public`, weekends and holidays skipped).
- The zone is the destination zone of the customer rate card the shipping estimate used (needs a postcode). No priced
  shipping → `arrival: null` (unchanged).
- Without any version of the setting the C4-API-2 behaviour stays: `from = to = earliestDeliveryDate`.
- The setting version used is snapshotted in `configRefs.settingVersionIds['shipping.transit_days']`.
- `earliestDeliveryDate` is unchanged (factory/zone extra lead days); the web shows `arrival`.
- Code: `src/modules/pricing/quotes/transit-days.ts` (pure, unit-tested), `QuoteEngineService.arrivals`,
  `store-step-fields.ts`. Contract: descriptions and examples of `QuoteArrivalDto` / `arrival` only.

Gates: typecheck · lint · unit (`transit-days.spec.ts`, `store-step-fields.spec.ts`, seed data, settings review) ·
`contract:build` + `contract:lint`. Integration and e2e need Docker — run locally.
