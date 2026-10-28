# Stage C — report (API)

## C1 — products Phase 1 → 2 (branch `design/products-redesign`, from `design/configurator-redesign` `263584c6`)

| Item | Status | Commit |
|---|---|---|
| C1-API-1 `QuoteStepDto.netAmount` (gross − VAT, decimals) on every store step | PASS | `594bf7e5` |
| C1-API-2 `GET /v1/store/catalog/price-hints/{slug}/tiers` (products R2): default spec × configurator presets via StorePricingService, `log: false`, 60 s cache, empty for RFQ products | PASS | `594bf7e5` |
| C1-API-3 RFQ product reference: `catalogProductSlug?`/`stockProductSku?` on submit + basket items, `rfqs.catalog_product_id`/`stock_product_id` (+ check not both), `product` on RfqDto/StaffRfqDto/RfqBasketItemDto | PASS (no DB run) | `0fe53a9f` |
| C1-API-4 `StoreProductDetailDto.styles`, `StyleDetailDto.products` (existing pattern ↔ style mapping) | PASS | `eded7c55` |
Gates: typecheck ✓, eslint (changed) ✓, unit `pricing/hints`, `store-step-fields`, `rfq`, `styles`, `catalog/store` ✓, contract:build + contract:lint ✓ (RfqProductRef kind reuses `PriceHintKind` — spectral forbids a duplicate enum).
**Local checks for the owner:** `pnpm db:migrate` (`20261222000001_rfq_product_reference`, hand-written + `down.sql`) · `pnpm test:int` (RFQ/basket submit with a product reference; tiers equal `calculate` for the default spec on UAT data) · `pnpm test:e2e` · admin RFQ screen does not show `product` yet (web admin unchanged).
Details: `docs/design/products-redesign/API-CHANGES.md`; web side: getpack-web `docs/design/STAGE-C-REPORT.md` §C1.

## C0 — ข้อมูลที่ทำให้หน้าเต็ม (branch `design/styles-catalog-redesign`, from `design/configurator-redesign`)

| Item | Status | Commit |
|---|---|---|
| Starting prices: verified `startingPrice` = cheapest linked catalogue product's D-220/D-441 hint (StorePricingService at the default spec and reference quantity — the ฿15.70 method). Added refresh on `catalog.product_type.updated`, `catalog.import_applied`, `setting.changed` for `catalog.print_limits` / `pricing.margin_floor_pct` / `tax.rounding_mode` (print-model versions already refreshed via `catalog.catalog_product.updated`; future-dated versions by the hourly job) | PASS | `1582e1f` |
| Commercial fields on `style_bases` (fit range L/W/H mm, MOQ, recyclable, plastic-free, certifications), admin `commercial` on `admin.styles.update`, migration `20261221000001_style_commercial_fields` + `down.sql` | PASS (no DB) | `4de29d2` |
| `store.styles.list` `size=LxWxH` fit rule (+5 mm, L/W rotation, incomplete ranges never match), `meta.sizeSearchStyles`, card `fitRange`/`moqUnits`/`dielineUrl`/`fit`; detail `recyclable`/`plasticFree`/`certifications` | PASS | `4de29d2` |
| `useCase` groups `a,b;c` for the wizard | PASS | `0ae3725` |
| CSV import/export of the template columns | SKIPPED (owner: CSV not ready) | — |
| Estimate fields (`price_est_*`) | NOT ADDED — D-220 "never an estimate" (open question) | — |
VAT: `src/common/money/vat.spec.ts` has ฿5,178.00 → ฿338.75 and ฿4,710.00 → ฿308.13 (pass).
Gates: typecheck ✓, eslint (changed) ✓, unit `src/modules/styles`, `src/modules/pricing/hints`, `vat.spec` ✓, contract:build + contract:lint ✓. Not run: `test:int`, `test:e2e` (no Docker/DB).
**Local checks for the owner:** `pnpm db:migrate` (hand-written SQL) · `pnpm test:int` (style-library, price-hints) · `pnpm test:e2e` · PATCH a style's `commercial` and GET `/v1/store/styles?size=120x80x50`.

## C0b — owner decisions after C0 (API `design/styles-catalog-redesign`, 2026-10-28)

Commit `d03c9023` (DECISIONS-STAGE-A §9; details in `docs/design/styles-redesign/API-CHANGES.md` "C0b"):
- §9.1 fit-range backfill from approved recipes: shared `StylesAdminService.curate` (same path as `admin.styles.update`), `backfillFitRanges`, `POST /v1/admin/styles/actions/backfill-fit-ranges`,
  `pnpm styles:fit-ranges [--confirm]`, UAT seed step 4b; column `style_bases.fit_range_source` (migration `20261223000001_style_fit_range_source` + down.sql, hand-written).
  Seed data: 81 of 122 filled, 41 without a complete recipe range. Business values never overwritten; idempotent.
- §9.3 `quoteResponseBusinessDays` on store style cards/detail (`rfq.sla_business_hours`, null when unset).
- §9.4a base-level `dieline_svg` rendered by `styles.render_assets` at the default size (113 of 122 drawable).
- §9.5 `StorePrintSideDto.quote` (colours beyond the instant price → `rfq_required`); `catalog.print_limits` untouched.
- `docs/design/styles-redesign/TRUST-CONTENT-CHECKLIST.md`.
Gates: typecheck ✓, eslint changed ✓, unit 265 ✓ (styles, print-model, pricing), contract:build + contract:lint ✓. No DB here.
**Local checks:** `pnpm db:migrate`, `pnpm test:int`, `pnpm test:e2e` (incl. `dieline-downloads`), `pnpm styles:fit-ranges` dry run then `--confirm` on UAT, set `rfq.sla_business_hours`.
