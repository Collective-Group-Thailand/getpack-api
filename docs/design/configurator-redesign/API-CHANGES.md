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
