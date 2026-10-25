# API changes: pdp Phase 0 (A3), one price and one spec label (D-441)

Repo `getpack-api`, branch `fix/uat-phase0`. Findings and plan: `PRICE-CONSISTENCY.md` (same folder).
Contract: `contract/openapi.json` (regenerate the web client with `pnpm gen:api`).

- **Additive only.** No endpoint was added or removed, and no request body changed.
- **No migration.** The fields are computed at read time, and the price-hint cache table is unchanged.
- **No new environment variables.**
- **No factory data** is added to any storefront response.
- **One wording change on existing data.** Spec lines now write sizes as **ยาว × กว้าง × สูง (L × W × H)**, so new quotes, carts and orders show `ขนาด (ยาว × กว้าง × สูง)`. Quotes saved earlier keep the lines frozen on them.

---

## 1. New shared shape: `LocalisedLabelDto` used as the spec label

```json
{ "th": "กล่องฝาชน (RSC) · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · ดำ",
  "en": "กล่องฝาชน (RSC) · 140 × 97.5 × 60 mm (inside) · Corrugated KA125 B-flute (3-ply) · ดำ" }
```

One string per spec: the values of the spec lines joined by `" · "`.

- The size is always ยาว × กว้าง × สูง in mm, with the measuring basis.
- `ไม่พิมพ์` / `Unprinted` is inserted when a printable spec prints nothing.
- The style code and the "priced inside size" line are left out.
- Some style or option names exist only in Thai in the catalogue, so `en` can contain Thai words.
- **Show this string next to every price. Never build a spec string in the web.**

## 2. Changed responses

### 2.1 `POST /v1/store/quotes/actions/calculate` (`store.quotes.calculate`)

The response (`QuoteCalculationDto`) gains two fields:

| Field | Type | Meaning |
|---|---|---|
| `specs` | `SpecLineDto[]` | the spec that was priced, from the same helper as quotations, carts, orders and starting prices |
| `specLabel` | `LocalisedLabelDto` | the same spec as one string |

`store.quotes.preview` (hero) and `store.studio.quote` return the same calculation object, so they get the same two
fields.

Example: the Studio's empty draft. It reproduces the ฿14.79 the Studio showed.

```http
POST /v1/store/quotes/actions/calculate
{ "productTypeCode": "corrugated",
  "configuration": { "catalogProductId": "…", "patternId": "…", "l": 150, "w": 100, "d": 80,
                     "materialId": "…KA125 B…", "difficultyLevelId": "…", "quantities": [300],
                     "parts": [{}], "design": { "graphic": false, "structure": false } } }
```

```json
{ "calculationId": "…", "calculatorVersion": "…",
  "steps": [{ "quantity": 300, "instant": true, "unitPrice": "14.79", "grossAmount": "4437.00", "…": "…" }],
  "dimensions": { "…": "…" }, "target": null,
  "specs": [
    { "key": "style", "labelTh": "แบบกล่อง", "labelEn": "Style", "valueTh": "กล่องฝาชน (RSC)", "valueEn": "กล่องฝาชน (RSC)" },
    { "key": "size", "labelTh": "ขนาด (ยาว × กว้าง × สูง)", "labelEn": "Size (L × W × H)",
      "valueTh": "150 × 100 × 80 มม. (ด้านใน)", "valueEn": "150 × 100 × 80 mm (inside)" },
    { "key": "material", "labelTh": "วัสดุ", "labelEn": "Material", "valueTh": "ลูกฟูก KA125 ลอน B (3 ชั้น)", "valueEn": "Corrugated KA125 B-flute (3-ply)" }
  ],
  "specLabel": { "th": "กล่องฝาชน (RSC) · 150 × 100 × 80 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · ไม่พิมพ์",
                 "en": "กล่องฝาชน (RSC) · 150 × 100 × 80 mm (inside) · Corrugated KA125 B-flute (3-ply) · Unprinted" } }
```

### 2.2 `GET /v1/store/catalog/products/{slug}/configurator` (`store.catalog.getConfigurator`)

| Field | Change |
|---|---|
| `defaultSpec` (new, nullable) | `{ configuration, quantity, standardSizeCode, specs, specLabel }`: the product's default spec (the admin reference configuration, D-220), which is the spec the starting price is for. `configuration` can be sent to `store.quotes.calculate` as is, or with the customer's quantities. `null` when the product has no reference configuration (then it has no starting price either). |
| `optionGroups[].options[].isDefault` | When `defaultSpec` is set, it is `true` exactly for the options the spec selects. A group the spec selects nothing in (for example no print) has no default. Without a default spec, the admin's flags stand. |
| `standardSizes[].isDefault` (new) | The size the spec is. Without a default spec, the first size. |
| `quantity.default` | The reference quantity when `defaultSpec` is set. |
| `patterns[].dielineVariantCodes` (new) | Published style variants of the style linked to the pattern, for "ดาวน์โหลดแบบกล่อง" through `store.dielines.download`. `[]` when there are none. |

Example (`uat-postal-box-b`, local rehearsal seed before a re-seed):

```json
{ "quantity": { "min": 100, "max": null, "default": 300, "presets": [100, 300, 500, 1000, 2000, 5000], "maxTiers": 10 },
  "standardSizes": [{ "code": "00", "name": "เบอร์ 00 (9.75×14×6 ซม.)", "lengthMm": 140, "widthMm": 97.5, "heightMm": 60, "isDefault": true }, "…"],
  "optionGroups": [
    { "kind": "material", "options": [{ "code": "dev-ka125-b", "isDefault": true, "…": "…" }, "…"] },
    { "kind": "ink_colour", "options": [{ "code": "uat-black", "isDefault": false }, { "code": "dev-cmyk", "isDefault": true }] } ],
  "patterns": [{ "code": "DEV-RSC", "dielineVariantCodes": [], "…": "…" }],
  "defaultSpec": {
    "configuration": { "catalogProductId": "…", "patternId": "…", "l": 140, "w": 97.5, "d": 60, "materialId": "…",
                       "difficultyLevelId": "…", "quantities": [300],
                       "parts": [{ "printFront": [{ "inkColourId": "…", "area": "top" }] }],
                       "design": { "graphic": false, "structure": false } },
    "quantity": 300, "standardSizeCode": "00",
    "specs": ["…"],
    "specLabel": { "th": "กล่องฝาชน (RSC) · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · พิมพ์ 4 สี (CMYK)", "en": "…" } } }
```

Calculating `defaultSpec.configuration` gives `300 → 15.70`. That is the same figure as `startingPricePerPiece` on the card, on the
product page and in `/price-hints`.

### 2.3 `GET /v1/store/catalog/products/{slug}` (`store.catalog.getProduct`)

- `optionGroups[].options[].isDefault` follows the default spec, as in §2.2.
- `startingPriceAssumes.label` (new): see §2.4.

### 2.4 Starting-price basis on every card and on the price hints

| Endpoint | New field |
|---|---|
| `store.catalog.listProducts`, `listProductTypes`, `getProduct` | `startingPriceAssumes.label` (`LocalisedLabelDto`) |
| `GET /v1/store/catalog/price-hints` | `basis.label` |
| `store.styles.*` style cards | `startingPrice.label` |

`startingPriceAssumes.specs` and `basis.specs` now describe the default spec with the new size order.

The **value** of `startingPricePerPiece` / `startingFromPerPiece` is now the configurator's own unit price for the
default spec at the reference quantity. It goes through the same `StorePricingService` path as `store.quotes.calculate`.
Use it unchanged in the JSON-LD `Offer` / `AggregateOffer`.

### 2.5 Spec lines everywhere: wording and order

The `size` line of box products reads `ขนาด (ยาว × กว้าง × สูง)` / `Size (L × W × H)` with values `L × W × H`. Flat items
(tags, sleeves, labels) read `ขนาด (ยาว × กว้าง)`. RFQ lines and the `priced_size` line use L × W × H. Pouches keep
`กว้าง × สูง`, because they have no length. Quotations, cart items and orders created **before** this change keep their
frozen W × L × D lines.

## 3. Behaviour (no contract change)

- Price hints are recomputed on `sell_margin_table.version_approved` and `tax_rate.version_approved`, in addition to the
  existing triggers (price lists, quote mode, product created or updated, the hourly job).
- Studio snapshots made before this change have no `specs`, so they are priced again instead of being served from the cache.
- UAT seed (fake data): reference configurations follow each product's own first options. When a product offers no ink, its
  reference is unprinted. After `pnpm db:seed:uat` the postal box's default spec is `ดำ`.

## 4. Web checklist (A3 web side)

1. Regenerate the client (`pnpm gen:api`).
2. Cards, category, product page and JSON-LD: price = `startingPricePerPiece`, quantity = `startingPriceAssumes.quantity`, spec text =
   `startingPriceAssumes.label.th`.
3. Configurator: initialise from `defaultSpec`, or from the `isDefault` flags, `standardSizes[].isDefault` and
   `quantity.default`, which now agree with it. Show `calculation.specLabel` with the price.
4. Studio dock: show `calculation.specLabel` with the unit price.
5. "ดาวน์โหลดแบบกล่อง": link to `/templates?product=<slug>&size=<standardSizeCode>`. That page, or the product page, calls
   `store.dielines.download` with `dielineVariantCodes[0]` and the size. When `dielineVariantCodes` is empty, keep the
   current fallback.
6. Never compute a size string or a price locally.

## 5. To verify locally (Docker)

- `pnpm test:e2e`, at least: `price-consistency`, `price-hints`, `line-summary`, `spec-model`, `studio-quotes`, `rfqs`,
  `storefront-cards`, `style-library`, `corrugate-quotes`, `folding-quotes`.
- `pnpm test:int`.

## 6. Open questions

Listed in `PRICE-CONSISTENCY.md` §4:

1. UAT ฿17.26 vs ฿15.70: check whether the hint is stale.
2. Default print of the postal box.
3. Merging equal tiers.
4. Description and size-name copy.
5. Which variant to use when a style has several published variants.
