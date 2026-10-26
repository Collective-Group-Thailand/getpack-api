# Stage B — API changes (getpack-api)

## B-API-1 VAT

**Rule** (DECISIONS-STAGE-A §7, GLOBAL-RULES §5, pending accountant confirmation): one shared VAT calculation,
`src/common/money/vat.ts` (`computeVat`). Each taxable line is taken ex-VAT and rounded to 2 decimals
(VAT-inclusive goods and design fees: `amount × 100 / (100 + rate)`; shipping charged by getpack is already
ex-VAT); the lines are summed; **VAT = rate % of the sum, half-up to 2 decimals**. The rate is the approved
`vat_standard` tax-rate version referenced by the quote (`vatRateVersionId`), never a constant.
Fixes the Stage A bug where the design fee's VAT was missing from `vatAmount`.

**No schema change.** No field is added, removed or renamed; `contract/openapi.json` is unchanged. Only the
values of existing VAT fields change (by a few satang, or by the design fee's VAT where a fee applies).
Gross amounts (`grossAmount`, `unitPrice`, `productAmount`, `designFeeAmount`, `shippingAmount`) do not change.

### Changed values

| Where | Endpoints | Fields |
|---|---|---|
| Instant quote engine | `POST /v1/quotes/actions/calculate`, `POST /v1/quotes/actions/preview`, `POST /v1/cs/*/calculate` (instant steps) | `steps[].vatAmount` |
| Saved quotations (snapshot of the engine) | `POST /v1/quotes`, `GET /v1/quotes`, `GET /v1/quotes/{quoteId}`, `POST /v1/quotes/{quoteId}/actions/reprice`, quotation PDF | `options[].vatAmount`, `options[].netAmount` (= gross − VAT) |
| Carts (copy the quote option) | `GET /v1/cart`, `POST /v1/cart/items` (and `/v1/customers/{customerId}/cart…` for staff) | item `vatAmount`, `netAmount` |
| Checkout / orders | `POST /v1/checkout/actions/preview`, `POST /v1/checkout` (and `/v1/customers/{customerId}/checkout…` for staff), order views | order line `netAmount`/`vatAmount` (product, design fee, structure design fee, shipping), order totals |
| Customer documents | tax invoices / receipts / delivery documents **issued after this change** | line and header `vatAmount` (summed from the order lines) |

Order lines: inclusive lines (product, design fees) keep their gross; each fee and shipping line carries the VAT
of its own rounded net; the product line carries the remainder so the lines add up to `computeVat` exactly.
**Documents already issued are not recalculated**; their stored amounts stay as issued.

Unchanged: RFQ quotations, CS service pricing (`/v1/cs/service/actions/price`), design-service extra fees, calculators
and golden tests.

### Example

Goods ฿4,710.00 incl. VAT + design fee ฿2,000.00 incl. VAT, rate 7 %:

| Line | Gross | Net (2 dp) |
|---|---|---|
| Goods | 4,710.00 | 4,401.87 |
| Design fee | 2,000.00 | 1,869.16 |
| **Sum** | 6,710.00 | **6,271.03** |

VAT = 7 % × 6,271.03 = 438.9721 → **438.97** (`steps[].vatAmount: "438.97"`).
Goods only: ฿5,178.00 → VAT `"338.75"`; ฿4,710.00 → VAT `"308.13"`.
With ฿120.00 ex-VAT shipping on ฿13,380.00 goods: (12,504.67 + 120.00) × 7 % = `"883.73"`.

## B-API-2 Print model

**Decision** D-443 (product owner, replaces the single choice none / ดำ / CMYK / spot 1). Per side (outside =
`printFront`, inside = `printBack` of each corrugate part) the customer picks **one** method: `none` ไม่พิมพ์ ·
`spot` สีพิเศษ (1..N spot colours; ดำ is one spot colour) · `cmyk` พิมพ์ 4 สี (+ สีพิเศษ 0..M only when the add-on
is enabled). N, M, the allowed colours and the process ink are back-office data on the catalogue product.

### Where the inside default came from

Not admin data. On the local UAT-seed database every corrugated reference configuration (D-441 default spec) prints
`printFront` only (no `printBack`), and the admin's ink flags are `ดำ` = default, CMYK = not default. The configurator
read exposed **one side-less `ink_colour` group** whose `isDefault` (D-441: the ink the default spec selects, CMYK on
the local DB) carries no side, so a client that fills both sides from it prices outside CMYK + inside CMYK. The API now
states each side's default explicitly (`printModel.<side>.default`); inside is `none` unless the default spec prints
inside. Nothing for the product owner to change in the back office; for the real catalogue they only set the print
model (below).

### Endpoints

| Endpoint | Change |
|---|---|
| `PUT /v1/admin/catalog/catalog-products/{id}/print-model` — **new** `admin.catalogProducts.setPrintModel` | Body `SetPrintModelDto { printModel: PrintModelDto \| null }`; `catalog.manage`, `If-Match` (product ETag), audited (`catalog.catalog_product_updated`, fields `printModel`) + event `catalog.catalog_product.updated`; price hint recomputed. 422 `validation.failed` (ink not an active offered `ink_colour` of the right kind, N > colours listed, add-on without spot colours, non-corrugate product) or `pricing.print_combination_invalid` (the reference configuration is no longer a valid choice). `null` clears. |
| `GET /v1/admin/catalog/catalog-products…` (all `CatalogProductDto` answers) | New field `printModel: PrintModelDto \| null`. |
| `GET /v1/store/catalog/products/{slug}/configurator` (`store.catalog.getConfigurator`) | New field `printModel: StorePrintModelDto \| null` (null until an admin sets one, or for non-corrugate products). |
| `POST /v1/store/quotes/actions/calculate` (`store.quotes.calculate`) and every path through `assertStoreRules` (saved quotes, Studio dock, hero preview, quote levers, advisor, price hints) | New 422 `pricing.print_combination_invalid`, one `errors[]` entry per offending side: `path` `configuration.parts[i].printFront|printBack`, `code` ∈ `method_not_offered`, `cmyk_with_spot`, `process_repeated`, `spot_count`, `add_on_count`, `colour_repeated`, `colour_not_allowed`. Without a model only `cmyk_with_spot` (e.g. ดำ + CMYK as two inks) and `process_repeated` are refused. Corrugate only. |
| `PUT /v1/admin/catalog/catalog-products/{id}/reference-configuration` | May also answer `pricing.print_combination_invalid`. |

### Schemas and enums

- `PrintSideMethod` = `none` · `spot` · `cmyk`. `PrintSideField` = `printFront` · `printBack`.
- `PrintModelDto { outside, inside: PrintSideConfigDto }`; `PrintSideConfigDto { methods: PrintSideMethod[], spot: { maxColours (N ≥ 1), inkColourIds[] } | null, cmyk: { inkColourId, addOn: { enabled, maxColours (M) } } | null }`.
- `StorePrintModelDto { outside, inside: StorePrintSideDto }`; `StorePrintSideDto { field, methods, spot: { minColours: 1, maxColours, inkColourIds } | null, cmyk: { inkColourId, addOn: { enabled, minColours: 0, maxColours } } | null, default: { method, spotInkColourIds[], cmykAddOnInkColourIds[] } }`. Ink names and swatches stay in the `ink_colour` option group (same ids). Colours the product no longer offers are left out; N and M are capped at the colours left.

### Mapping to the engine (web builds the request)

Each side → one entry per ink in `parts[i].<field>` with the chosen print `area`: `none` → `[]`; `spot` →
`[{ inkColourId: spot1, area }, …]`; `cmyk` → `[{ inkColourId: cmyk.inkColourId, area }, …add-on colours]`.
Example (outside CMYK, inside ไม่พิมพ์ — the postal box default):

```json
{ "parts": [{ "printFront": [{ "inkColourId": "<cmyk.inkColourId>", "area": "top" }], "printBack": [] }] }
```

Refused (422):

```json
{ "code": "pricing.print_combination_invalid",
  "errors": [{ "path": "configuration.parts[0].printFront", "code": "cmyk_with_spot",
               "message": "CMYK and a spot colour on one side are not offered" }] }
```

### Combinations the engine cannot price yet

1. `spot` with 2+ colours on UAT/dev data: only one spot ink (`uat-black`) has price lines; another colour needs its
   own `ink_colours` row and `pl_corrugate_print_prices` / flexo ink lines (else `price_line_missing`). Digital
   prices each distinct ink once, so a second colour must be a different ink row.
2. Flexo counts entries: CMYK is one colour there (A4), CMYK + add-on k = 1 + k colours, limited by the print type's
   `max_colours` (3 on the seed) and the difficulty margins' highest colour count (`process_not_possible` above).
3. Inside print on digital uses `backPrintPricePerM2` when set (one rate whatever the method), else the inks' rates.
4. Folding, tag & sleeve (CMYK = 4 plate entries), label (`inkColourIds`) and pouch (`printColourId`) have no per-side
   model yet: `setPrintModel` refuses them and their requests are not checked.

### Migration

`20261216000001_catalog_print_model`: `ALTER TABLE catalog_products ADD COLUMN print_model jsonb` (nullable; `down.sql`
drops it). No data migration; existing products have no model (only never-valid sets are refused). UAT seed
(`prisma/seed/uat/uat-catalog.ts`, fake): corrugated products with inks get outside = inside = methods
`none` + `spot` (N = 1, `uat-black`) + `cmyk` (`dev-cmyk`, add-on off). Real values: business team in the back office.
