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

## C1b — owner decisions after C1 (API + web `design/products-redesign`, 2026-10-28)

Run unattended in the cloud (mock backend; no UAT/DB/Docker). Decisions recorded as DECISIONS-STAGE-A §10 (both repos) and D-447 (`getpack-api/docs/decisions.md`). API changes: `docs/design/products-redesign/API-CHANGES.md` (C1b-API-1…6).
| Item | Status | Where |
|---|---|---|
| 1 `partial` = instant | PASS (kept; comment now cites §10.1) | `hub.ts` |
| 2 stock: cart + quote tray side by side (card and table) | PASS | `StockCartButton`, `HubCard`, `PriceTable` |
| 3 services: staff-curated ≤ 3 (`storefront.featured_services`, Marketing) else first 3 + "ดูบริการทั้งหมด" | PASS (mock has no service products: section hidden there) | API endpoint · `featuredServices()` |
| 4 "สินค้าหมด" from `STOCK_AVAILABILITY` (src/domain/status), no cart | PASS | status map + mock JAR-100 out of stock |
| 5 stock "เริ่มต้น ฿x/ชิ้น (สั่งขั้นต่ำ N)" from API (`stock_price_hints` at MOQ) | PASS | API `price-hints`, `catalogue.server.ts` |
| 6 ex-VAT figures from API + "ราคารวม VAT / ไม่รวม VAT" switch (default incl., drawn only when every price has both) | PASS | `HubVatSwitch`, `VatFigure`, `base.css` |
| 7 LINE hours 09:00–18:00: seeds (`fillIfUnset`) + UAT admin-API script `docs/design/products-redesign/set-support-hours.mjs` | PASS (script not run: UAT unreachable) | API seed |
| 8 tax-invoice FAQ company from settings (`PublicConfigDto.issuer`), FAQ JSON-LD too | PASS | `faqAnswer()` |
| 9 tray: guest = browser; signed in = draft basket pending lines; guest tray merges at sign-in; basket shows pending lines, send disabled until filled | PASS (behind `FEATURE_RFQ_PRODUCT_REF`; off → browser tray as before) | `quote-tray.tsx`, `BasketDraft`, RfqForm |
| 10 materials "หมายเหตุ" = approved description, empty cell otherwise | PASS | `MaterialsTable` |
Gates: API typecheck ✓, eslint changed ✓, unit 1433/1433 (full) ✓, contract:build + contract:lint ✓, SETTINGS-REVIEW regenerated. Web typecheck ✓, eslint changed ✓, `gen:api --check` ✓, `test:app` 1572/1572 ✓, e2e (mock, `FEATURE_RFQ_PRODUCT_REF=1`) `storefront-products` 9/9 (4 new: stock, VAT switch, signed-in tray, guest merge), `storefront-ux` 11/11 (after a dev-server OOM restart; basket test passes warm), `storefront-quote` + `storefront-home` ✓. `pnpm build` not run (OOM).
Screenshots `docs/design/screenshots/C1b/` (mock data): `after-{1440,1054}-light-stock`, `after-390-dark-stock`, `after-1440-light-{head-vat,stock-exvat,table-exvat,materials,faq}`.
Assumptions: featured-services owner role = Marketing · ex-VAT per piece = shared `exVat` of the rounded-up incl. figure (half-up) · addProduct/removeItem write no activity row (same as existing basket draft edits) · support-channels hours text is Thai only (one string setting) · out-of-stock still shows its MOQ price.
**Open questions:** (1) Marketing as owner of `storefront.featured_services` — or Admin? No back-office editor beyond the generic settings screen. (2) English hours text: `support_channels.hours` is one string; localise from `storefront.support_hours` instead? (3) Should a stock item that is out of stock hide its price? (4) `decisions.md` in web is synced from an API release — D-447 arrives with the next `docs:sync`.
**Local checks for the owner:** getpack-api `pnpm db:migrate` (`20261224000001_c1b_stock_hints_basket_pending`) + `pnpm db:seed` + `pnpm test:int` (basket addProduct/submit, stock hints) · on UAT: `API_URL=… UAT_SEED_PASSWORD=… node docs/design/products-redesign/set-support-hours.mjs` then `--confirm` · let `pricing.price_hints_refresh` run, check stock prices = cart price at MOQ · set `storefront.featured_services` in the back office · web `pnpm build` · e2e against the real API (`storefront-products`, `storefront-ux`) with `FEATURE_RFQ_PRODUCT_REF=1` · Lighthouse mobile `/products`.
