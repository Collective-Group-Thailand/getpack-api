# Stage C — report (API)

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
