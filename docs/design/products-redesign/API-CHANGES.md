# /products redesign (C1) — API changes

Branch `design/products-redesign` (from `design/configurator-redesign`). Identical copy in `getpack-web`.
Run with: `pnpm db:migrate` (one hand-written migration) → `pnpm test:int` (not run in the cloud session: no DB).

| # | Change | Why | Contract |
|---|---|---|---|
| C1-API-1 | `QuoteStepDto.netAmount` = `grossAmount − vatAmount` (decimal maths in the API; null when either is null) on every store step (`calculate`, `calculate-batch`, tiers) | Calculator / configurator show "ก่อน VAT · VAT · รวม" without money arithmetic in the web | additive |
| C1-API-2 | `GET /v1/store/catalog/price-hints/{slug}/tiers` (`store.catalog.getPriceTiers`, public, `Cache-Control: max-age=60`) → `PriceTiersDto { key, productTypeCode, currency, basis, tiers: QuoteStepDto[], computedAt }` | Products R2 (approved, DECISIONS-STAGE-A §4): the quick calculator's tier bars. The default spec (D-441) priced at the configurator's quantity presets (≤ 10) through `StorePricingService` — the very path `calculate` uses — with **no calculate log** and a 60 s in-process cache. Empty `tiers` / null `basis` for RFQ products (D-181: never an estimate) | new endpoint |
| C1-API-3 | `SubmitRfqDto` / `RfqBasketItemInputDto`: `catalogProductSlug?` / `stockProductSku?` (an active product of the request's type, never both → 422 on the field). `rfqs.catalog_product_id` / `stock_product_id` (nullable FKs + check "not both"), migration `20261222000001_rfq_product_reference` (+ `down.sql`). `RfqDto.product`, `StaffRfqDto.product`, `RfqBasketItemDto.product`: `{ kind: PriceHintKind, key, nameTh, nameEn } \| null` | DECISIONS-STAGE-A §4: "basket lines must keep the product reference" (products R4). CS sees the product, not only its type | additive (request fields optional) |
| C1-API-4 | `StoreProductDetailDto.styles: { code, nameTh, nameEn, category }[]` (published styles of the product's patterns) and `StyleDetailDto.products: { slug, nameTh, nameEn, startingPrice: StylePriceDto \| null }[]` (active products of the style's pattern, cheapest first) | Products Phase 2: "แบบกล่องที่ใช้ได้" / "สินค้าที่ใช้แบบนี้". The mapping already exists (`style_bases.pattern_id → patterns → catalog_product_patterns`); nothing is inferred | additive |

Not changed (open): stock "starting from" prices (R1 — waits for `stock_product_price_summaries`), ex-VAT card/hint
figures (R3 — the VAT switch stays hidden until the API sends both figures), catalogue facets/sort by MOQ or lead time
(R5 — the web filters the merged ≤ 200 rows server-side), `store.catalog-materials` (404 on UAT).

Unit tests: `price-hints.service.spec.ts` (tiers), `store-step-fields.spec.ts` (netAmount), `rfq-product-ref.spec.ts`,
`style-products.spec.ts`. DB-backed checks for the owner: `test:int` for RFQ submit / basket submit with a product
reference, and one tiers call against UAT data (compare with `calculate` for the same default spec).
