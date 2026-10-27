# /styles redesign — API changes (C0, branch `design/styles-catalog-redesign`)

Additive only; the existing contract stays backward compatible. Identical copy in `getpack-web`.

## 1. Catalogue commercial fields (PROMPT-styles-redesign "API" block, item 2)
Migration `20261221000001_style_commercial_fields` (+ `down.sql`) on `style_bases`, all nullable / empty, nothing back-filled:
`fit_min/max_l/w/h_mm` (inside size range for the size search, mm), `moq_units`, `recyclable`, `plastic_free`,
`certifications text[]`. DB checks: min ≤ max, values > 0.

Not added, on purpose:
- `price_est_low/high/basis` — D-220 says "never an estimate"; needs the owner to amend D-220 (OPEN QUESTION).
- `lead_time_days_min/max` — the detail already derives `leadTime` from makeable partners (D-245).
- `name_en`, use cases — already exist. Dieline refs — the existing `dieline_svg` style asset is used.

## 2. Admin
`PATCH /v1/admin/styles/{styleId}` (`admin.styles.update`) takes `commercial` (replaces all fields; min > max → 422
`validation.failed`). `admin.styles.get` returns `commercial`. Audited as `style_base.curated` (fields list).
CSV import/export of these columns: **not done** (the owner's CSV is not ready).

## 3. Store
`GET /v1/store/styles` (`store.styles.list`):
- query `size=LxWxH` (product outside size, mm, one decimal allowed). Fit rule (DECISIONS-STAGE-A §4): inside = product
  + 5 mm per dimension; within the style's entered range; L/W may swap, H may not; any missing bound → no match.
  Facets count over the size-filtered set. Malformed → 422.
- `meta.sizeSearchStyles`: published styles with a complete range (the web offers the size tab only when > 0).
- card: `fitRange` (all six bounds or null), `moqUnits`, `dielineUrl` (the style's own `dieline_svg`, signed URL),
  `fit` (`insideL/W/HMm`, only with `size`).
`GET /v1/store/styles/{code}`: also `recyclable`, `plasticFree`, `certifications`.

## 4. Starting prices (D-220 / D-441) — verified, extended
`startingPrice` on cards = the cheapest linked catalogue product's cached hint = `StorePricingService` (the
configurator's own path) at the product's default spec and reference quantity — the method that gives ฿15.70 for
`uat-postal-box-b`. Refresh already ran on price lists, sell margins, VAT rates, quote mode, product edits (print model
versions included) and hourly. **Added:** `catalog.product_type.updated`, `catalog.import_applied`, and `setting.changed`
for `catalog.print_limits`, `pricing.margin_floor_pct`, `tax.rounding_mode`.

## Owner checks
`pnpm db:migrate` + `pnpm test:int` (migration written by hand: no DB / schema engine in the cloud run).
