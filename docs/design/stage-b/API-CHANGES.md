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

## B-API-3 Spec label

One helper owns every spec string (GLOBAL-RULES §5, D-441, D-443): `src/modules/quotes/spec-label.ts` —
`sizeText` / `sizeValue` (ยาว × กว้าง × สูง, mm, the basis in brackets: "(ด้านใน)" for inner dimensions; RFQ blanks
as "—"), `BASIS_TEXT`, `PRINT_SIDE_TEXT`, `printMethodText` / `printSideText` (method of a side from the per-side
model of B-API-2: `CMYK`, `สีพิเศษ n สี (…)`, `CMYK + สีพิเศษ n สี (…)`; an unprinted side gives nothing and is left
out), `specLabel` (one string) and `specLinesText` (quotation PDF). No endpoint, path or schema changes; only wording
of new values and the OpenAPI examples.

### Fields whose wording changes

| Field | Where | Change |
|---|---|---|
| `specs[].valueTh/valueEn` of `print_front`, `print_back`, `parts[n].print_*` | every calculation and new quote / cart / order line (folding, corrugate, tag & sleeve, label) | ink names → method of the side |
| `specLabel` / `label` (`th`, `en`) | store calculations, configurator default spec, cards, styles, price hints, Studio | each print value prefixed by its side: "พิมพ์ด้านนอก: …" / "พิมพ์ด้านใน: …" (flat items: "พิมพ์ด้านหน้า/หลัง: …") |
| quotation PDF `specification` | quote PDF rendered on issue | print lines as "พิมพ์ด้านนอก: …" (other lines unchanged: "label value") |
| order spec sheet sizes table | spec-sheet PDF | header "ยาว × กว้าง × สูง" in Thai (was "L × W × H"); values from the helper (same text) |
| designer PDF title (dieline downloads) | PDF metadata | `100×80×50 mm (inside)` → `100 × 80 × 50 mm (inside)` |

### Examples

Corrugate, CMYK outside, ดำ inside, inner dimensions:

```text
before  th: กล่องฝาชน · 140 × 97.5 × 60 มม. (ด้านใน) · KA125 ลอน B · CMYK · ดำ
after   th: กล่องฝาชน · 140 × 97.5 × 60 มม. (ด้านใน) · KA125 ลอน B · พิมพ์ด้านนอก: CMYK · พิมพ์ด้านใน: สีพิเศษ 1 สี (ดำ)
after   en: RSC · 140 × 97.5 × 60 mm (inside) · KA125 B-flute · Print (outside): CMYK · Print (inside): 1 spot colour (ดำ)
```

Spec line `print_front` with CMYK + add-on: before `{"valueTh":"CMYK, ทอง"}` → after
`{"valueTh":"CMYK + สีพิเศษ 1 สี (ทอง)","valueEn":"CMYK + 1 spot colour (ทอง)"}`. Outside only: no `print_back`
line and nothing about the inside in the label. Unprinted: `… · ไม่พิมพ์` (unchanged).

### History

Saved quotes, carts and orders read `quotes.spec_summary` as stored: their lines keep the words they were made with
(not rewritten). Issued PDFs are stored files and are not re-rendered. A label computed from stored lines (price hints)
shows old values with the side prefix ("พิมพ์ด้านนอก: ดำ").

### Not changed

- Pouch: size stays `กว้าง × สูง` (a pouch has no ยาว) and `print` keeps the colour-set name; open question.
- Preflight messages (artwork page / trim `w×h`) and dieline file names are not spec labels.
- Web-only labels: none found in this repo; `getpack-web` must show `specLabel` / `specs` as given.

### e2e specs to run locally (not changed: none asserts a print value)

`line-summary`, `price-consistency`, `studio-quotes`, `spec-model`, `rfqs`, `spec-sheet`, `dieline-downloads`,
`corrugate-quotes`.

## B-API-4 Own-file orders

An own-file order ("มีไฟล์งานแล้ว", `designOption = own_file`) with no accepted file reads **"รอไฟล์จากคุณ"**
(`artworkStatus = awaiting_upload`, `artworkOwner = customer`, `nextActions` offers `order.upload_artwork` /
"ส่งไฟล์งาน") — never "รอทีมส่งแบบไดคัทให้", whether or not a dieline was sent (GLOBAL-RULES §6, D-438). This
answers account-redesign API-CHANGES §8 open question 1: the customer can upload straight away; the dieline the team
sends after payment (`drawings.auto_send`, `admin.artwork.sendTemplate`) is still delivered as a help.

### Root cause

`initialArtworkStatus()` (checkout) started every non-online-design order at `awaiting_template`, so an own-file
order waited for the team until a dieline went out — never, with the drawing engine off or
`templateAvailability = none`.

### Changed behaviour

| What | Before → after |
|---|---|
| Checkout: initial `artworkStatus` of `own_file` | `awaiting_template` → **`awaiting_upload`** |
| Store/B2B/logistics `OrderDto` (`artworkStatus`, labels, `artworkOwner`, `customerStatus`/`actionOwner` facts) | an `own_file` order still stored at `awaiting_template` is read as `awaiting_upload` (`customerArtworkStatus()`) |
| `order.upload_artwork` (`nextActions`, launchpad `needsAction`) | own-file order without a file: hidden → **offered** (also before payment, as for online designs) |
| `OrderDto` example | `artworkStatus` `awaiting_upload`, `artworkOwner` `customer` (contract regenerated) |

Unchanged: `hired_design` and `free_design` start at `awaiting_template` (team); `online_designer` at
`awaiting_upload`; every later artwork status (`uploaded`, `in_review`, `proof_sent`, `changes_requested`,
`approved`) reads as stored. No new field, enum value, error code, setting or env var.

### Migration

`prisma/migrations/20261217000001_own_file_awaiting_upload/migration.sql` (data only): own-file orders at
`awaiting_template`, not cancelled, without an `accepted_for_proof` submission → `awaiting_upload`. No event or
activity row (pre-launch status correction, as A2 / D-425). Reversible: `down.sql` returns own-file orders at
`awaiting_upload` with no dieline delivery and no submission to `awaiting_template` (apply with `psql`, then remove the
row from `_prisma_migrations`). Not run here (no database in this VM).

### Factory confidentiality

No new field; `test/unit/storefront-factory-confidentiality.spec.ts` green.

### e2e specs to run locally

Changed: `launchpad` (own-file order offers the upload before and after payment, no manual status update).
Run unchanged: `artwork`, `designs`, `orders`, `payments`, `company-orders`.

### Open questions

1. Upload before payment is offered for own-file orders (same rule as online designs, `assertTakesArtwork` accepts
   `waiting_payment`). Should "ส่งไฟล์งาน" wait for payment instead? Kept as the existing rule.

## B-API-5 Customer file access

Decision **D-444** (`DECISIONS-STAGE-A.md` §7 "Customer file access"; closes A5 `upload-redesign/FINDINGS.md` G3,
refines D-442 (3) "readable by staff"). Not breaking for the storefront or partner zones; **breaking for staff
roles other than Prepress** (they now get 404 on customer artwork). One new admin endpoint, three new permissions,
one reversible migration, no new setting or env var.

### What counts as a customer file

| Kind (`CustomerFileKind`) | Which files | Staff access |
|---|---|---|
| `customer_original` | uploads of purpose `artwork` (also before they are in a submission) and every file of an artwork submission (`artwork_submission_files`) | **D-444 rule below** |
| `production_copy` | the metadata-stripped copy of an original (`artwork_production_copies.copy_file_id`, D-442) | **D-444 rule below** |
| `approved_proof_copy` | an approved proof's locked copy (`proofs.approved_file_id`) — staff-made | unchanged (`files.read`); downloads are logged |

A thumbnail follows its original (access and log, `purpose = thumbnail`). Every other file keeps its current rules.

### Access matrix (`GET /v1/{store|admin|partner}/files/{fileId}` and `…/download`)

| Who | Original | Production copy | Approved proof copy |
|---|---|---|---|
| Prepress (`customer_files.read`) | ✓ any order | ✓ | ✓ |
| CS, CS Lead (`customer_files.read_handled`) | ✓ only orders they **handle** | ✓ same | ✓ |
| Every other staff role, Superadmin included (`files.read` only) | ✗ 404 | ✗ 404 | ✓ |
| Uploader (e.g. CS uploading for a customer) | ✓ own upload | – | – |
| Factory user / machine client (production) | ✗ 404 (unchanged) | ✓ live jobs of its approved proof (unchanged) | ✓ live jobs (unchanged) |
| Order's customer, company members of a company-scoped upload | ✓ (unchanged) | ✗ (unchanged) | ✓ (unchanged) |

**"Handles an order"** = the user is `assigned_user_id` of a conversation with `subject_type = 'order'`,
`subject_id = <order>` and `status ≠ closed`. An upload not yet in a submission has no order: support gets no access.
`orders.prepress_assignee_id` is not used (Prepress already reads every order).

### Permissions (`src/modules/iam/permissions.catalog.ts`, `roles.catalog.ts`; `docs/rbac.md` regenerated)

| Permission | Granted to |
|---|---|
| `customer_files.read` | `prepress` |
| `customer_files.read_handled` | `cs`, `cs_lead` |
| `customer_file_access_logs.read` | `superadmin` only |

Superadmin keeps "every staff permission" **except** the two customer-file reads (`CUSTOMER_FILE_READ`). Existing
databases get the grants with the next `pnpm db:seed` (reference seed writes permissions and role grants).

### Access log

Table `customer_file_access_logs` (append-only: trigger `tg_customer_file_access_logs__append_only` →
`forbid_mutation()` refuses UPDATE / DELETE). One row per download URL issued for a customer file, written by
`FilesService.downloadUrl` in the same request **after** the URL is signed and **before** it is returned — if the
insert fails the request fails and no URL is returned. Columns: `public_id`, `occurred_at`, `actor_type`
(`user` / `api_client`, check `ck_customer_file_access_logs__actor`), `actor_user_id` / `actor_api_client_id`,
`file_object_id`, `file_kind`, `order_id` (null for an unsubmitted upload), `channel` (`store` / `admin` / `partner`),
`purpose` (`download` / `thumbnail`), `request_id`. **Never** the URL, a token, the storage key or the file name.
Metadata reads (`…/files/{fileId}`) issue no URL and are not logged.

### New endpoint

`GET /v1/admin/customer-file-access-logs` — `admin.customerFileAccessLogs.list`, `customer_file_access_logs.read`
(403 `auth.forbidden` otherwise), cursor-paginated (`cursor`, `limit` ≤ 100), newest first. Filters: `orderId`,
`fileId`, `userId` (user or API client public id), `from`, `to` (exclusive), all optional.

```json
{
  "data": [
    {
      "id": "0192f3a0-7c1e-7d2a-9b1f-00000000ac01",
      "occurredAt": "2026-10-26T10:15:00+07:00",
      "actor": { "type": "user", "id": "0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b", "name": "เตรียมพิมพ์ ทดสอบ" },
      "fileId": "0192f3a0-7c1e-7d2a-9b1f-0000000f1014",
      "fileKind": "customer_original",
      "order": { "id": "0192f3a0-7c1e-7d2a-9b1f-00000000a001", "orderCode": "DEVOR-2610-00001" },
      "channel": "admin",
      "purpose": "download",
      "requestId": "req-3f2a9c1d"
    }
  ],
  "meta": { "nextCursor": null }
}
```

Changed descriptions only: `{store,admin,partner}.files.get` and `.download` (D-444 rule and log; same schemas).

### Migration (reversible)

`prisma/migrations/20261218000001_customer_file_access_logs/` — enums `customer_file_kind`, `file_access_channel`,
`file_access_purpose`; table, indexes (time, order, file, actor), FKs, actor check, append-only trigger. `down.sql`
drops the trigger, table and enums (the log rows are lost: export first). Applied locally with
`pnpm prisma migrate deploy`; `down.sql` run inside a rolled-back transaction; UPDATE / DELETE refused by the trigger.

### Tests

Unit: `src/platform/files/customer-file-access.spec.ts` (allow / deny matrix over the real role grants: Prepress,
CS handling vs not, CS Lead, Admin, Finance, Logistics, Superadmin, factory user and machine client, customer and
stranger; thumbnails; uploader rule; one log row per URL with no URL / token; no row and no URL when denied; a failed
insert fails the request; the list endpoint requires `customer_file_access_logs.read`, held by Superadmin only).
`roles.catalog`, `rbac-doc`, `storefront-factory-confidentiality` green.

### e2e specs to run locally

Changed: `files` (CS 404, Prepress 200 + one log row), `artwork` (Prepress / CS / Superadmin on original and production
copy, CS while assigned to an open order conversation then closed, log endpoint 200 for Superadmin and 403 for
Prepress), `production-release` (factory download of the approved proof copy logged on `partner`).
Run unchanged (they download customer or proof files): `production-milestones`, `production-oversight`, `designs`,
`design-services`, `companies-store`, `conversations-v2`, `timeline`, `admin-platform`, `acceptance`.

### Open questions

1. **"Handles"** is taken from conversations only (assignee of an open conversation about the order). There is no
   other order owner for support (`support_tickets.order_ref` is free text, not resolved). Should support also read
   after the conversation closes, or via a ticket / an explicit order assignment?
2. **Superadmin** has no customer-file read (only the log). Confirm, or grant `customer_files.read` to Superadmin.
3. **Admin / CS Lead / Partner manager / Auditor** lost access to originals; production copies follow the same rule.
   Confirm no other role (e.g. Auditor for claims) needs them.
4. **Design-studio assets** (`design_asset` uploads, studio designs) and hired-design briefs are not classified as
   customer artwork yet (their own readers decide; staff still read them with `files.read`).
5. Approved proof copies stay readable by every staff role with `files.read` (staff-made proof); only logged.
