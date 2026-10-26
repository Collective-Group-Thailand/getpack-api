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
