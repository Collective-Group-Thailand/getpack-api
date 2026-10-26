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
