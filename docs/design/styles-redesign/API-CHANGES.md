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
- query `useCase` also takes groups for the wizard: `a,b;c` = (a or b) and c (≤ 5 groups); one value as before.
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

## C0b — owner decisions after C0 (DECISIONS-STAGE-A §9, 2026-10-28)

Additive. Migration `20261223000001_style_fit_range_source` (+ `down.sql`, hand-written): `style_bases.fit_range_source`
(`recipe` | `business`, check constraint); existing entered ranges are marked `business`.
- **Fit-range backfill (§9.1):** `POST /v1/admin/styles/actions/backfill-fit-ranges` (`admin.styles.backfillFitRanges`,
  `styles.curate`, body `{ dryRun? }`) → `{ considered, filled[], refreshed[], unchanged, keptBusiness[], noRecipeRange[] }`.
  Same service path as `admin.styles.update` (shared `curate`: validation, audit `style_base.curated` with before/after and
  source, event, publishability). Never over a business range; idempotent. CLI `pnpm styles:fit-ranges [--confirm]`; UAT
  seed step 4b. `admin.styles.get` returns `fitRangeSource`. A curation save that changes the range marks it `business`.
  Seed data (engine bundle `@getpack/dieline@0.1.0+ccc03fe8`): **81 of 122 filled**, 41 without a complete recipe range.
- **CSV size basis (§9.2):** the catalogue CSV's size columns are **inside dimensions in mm** — the future importer reads
  them so; since C1c (§11.3) the template's headers say so too (`length_min_mm` … `height_max_mm`); `price_est_*` columns are ignored (D-220).
- **Quote response (§9.3):** store style card/detail `quoteResponseBusinessDays` = `rfq.sla_business_hours` (product-type
  scope, platform fallback) ÷ 24, rounded up (RFQ due time counts every hour of a working day); null when unset.
  **Superseded by C1c (§11.2):** ÷ the hours of one business day from `calendar.business_hours`.
- **Style dielines (§9.4a):** `styles.render_assets` also renders each published style's own `dieline_svg` (no variant) at
  the approved recipe's default size → card `dielineUrl` and the quick view "แบบคลี่". 113 of 122 drawable on seed data
  (not: PK-LA-07, PK-PB-01…08 — no reference material for `shrink_film` / `flexible`).
- **Print beyond the instant price (§9.5):** `StorePrintSideDto.quote` `{ spotMaxColours, cmykAddOnMaxColours }` | null —
  colours a customer may still choose beyond the priced counts (up to the side's offered spot inks); `calculate` answers
  `rfq_required` for them (unchanged). `catalog.print_limits` untouched.

## C1c — owner decisions after C0b (2026-10-28, DECISIONS-STAGE-A §11, D-448)

Additive. Migration `20261225000001_c1c_fit_range_bounds` (+ `down.sql`, hand-written): `style_bases.fit_range_bounds`
(jsonb), `fit_range_source` check widened to `recipe | standard_sizes | production_envelope | combined | business`.
- **Fit-range fallback (§11.1):** `admin.styles.backfillFitRanges` / `pnpm styles:fit-ranges` / UAT seed 4b now take each
  bound from (a) the approved recipe range, (b) the standard sizes (catalogue products' `standard_sizes` of the style's
  pattern + the recipe's presets through the engine's `closedSize`), (c) the production envelope (pattern
  `constraints` size rules ∩ engine solver limits through `closedSize`). Result adds `incomplete[]` (missing bounds),
  `bySource`, `boundsBySource`, `changes[]` (dry-run preview); `noRecipeRange` deprecated (= `incomplete[].code`).
  `admin.styles.get` adds `fitRangeBounds` (per bound `{ source, basis[] }`). Engine port: `insideSizes(recipe)`.
  Seed data: **90 of 122** — recipe 81, combined (recipe + recipe presets) 9; bounds: recipe 512, standard sizes 28,
  production envelope 0; 32 stay empty (no inside L/W/H in any source: labels, bags, tags, cups, cylinders, flat folders).
- **Quote response (§11.2):** `quoteResponseBusinessDays = ceil(sla hours ÷ business-day hours)` (`calendar.business_hours`).
- **CSV (§11.3):** template headers `*_mm`.
- **Style library content (§11.5):** setting `storefront.style_library` (json, Marketing, unset);
  `GET /v1/store/style-library/settings` (`store.styleLibrary.getSettings`, public, 60 s cache — closes the web contract
  request `store.style-library.settings`; adds certificate `expiresOn`); `GET`/`PUT /v1/admin/style-library/settings`
  (`admin.styleLibrary.getSettings` `styles.read`, `updateSettings` `styles.curate`, versioned via the settings
  platform: validated, audited, evented). Logos carry a staff-only `permission`.
- **Superadmin (§11.6):** `admin.settings.changeValue` lets Superadmin change any setting (owner check), audited as them.

