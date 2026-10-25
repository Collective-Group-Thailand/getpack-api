# PDP Phase 0 — price consistency (API side, step A3)

Repo `getpack-api`, branch `fix/uat-phase0`. Owner of the price reconciliation (GLOBAL-RULES §5).
Decision recorded: **D-441** (`docs/decisions.md`). API contract changes: `API-CHANGES.md` in this folder.

Method: the code paths were traced, and every price below was reproduced on a **local** database
seeded with the UAT rehearsal seed (`prisma/seed/uat`). UAT itself was not called. The local
numbers match the reported ones exactly, except the ฿17.26 configurator figure (see §1.3).

---

## 1. Findings

### 1.1 Where each number comes from (before this step)

| Surface | Endpoint | How the price was computed | Spec it priced |
|---|---|---|---|
| `/products` card, category card | `store.catalog.listProducts` / `listProductTypes` → `CardFactsService` | reads the cache `catalog_price_hints` | the product's **reference configuration** (`catalog_products.reference_configuration`, D-220) |
| `/products/[slug]` + JSON-LD | `store.catalog.getProduct` → `CardFactsService` | same cache | same reference configuration |
| Price hints, style cards | `store.catalog.listPriceHints`, `store.styles.*` | same cache | same |
| Cache writer | `PriceHintsService.refresh` (hourly job + some events) | `QuoteEngineService.price(cfg)` **directly**: no store DTO validation, no store rules; it then took the **cheapest step** | reference configuration |
| `/configure/[slug]` | `store.quotes.calculate` | `validateConfiguration` → `assertStoreRules` → `QuoteEngineService.price` | what the web builds from the configurator read's **`isDefault` option flags**, `quantity.default` and the first standard size |
| Studio dock | `store.studio.quote` | its own copy of the calculate path | the design version's spec (box size, print found on the canvas) |

So there was **one engine**, but **three entry points** and **two independent definitions of "the default spec"**:
1. the admin's reference configuration, which feeds the starting price;
2. the admin's `isDefault` flags plus the quantity default, which the configurator opens on.

Nothing kept the two in step.

### 1.2 Issue 1: ฿15.70 on the listing vs ฿17.26 in the configurator (size 00, KA125 B, 300 pcs)

- **Spec gap (confirmed).** In the UAT seed, `uat-postal-box-b` has the reference configuration
  `00 · 140 × 97.5 × 60 · KA125 B · พิมพ์ 4 สี (CMYK) on top · 300 pcs`. Its ink options are `[ดำ, CMYK]`, and the
  first one (`ดำ`) is `isDefault`. The configurator therefore opens on `ดำ`, while the starting price is for CMYK.
  The seed built every reference with CMYK, even for products whose configurator offers no print option.
- **Local reproduction:** reference spec at 300 pcs = **฿15.70**, identical to the listing. On the
  rehearsal price data, `ดำ` and CMYK also both price at ฿15.70 (corrugate digital prints one colour on top at the same
  rate), so the spec gap alone does not produce ฿17.26.
- **The extra +9.9 % on UAT (not reproducible here, not verified).** UAT shows ฿17.26 / ฿14.96 where the fresh seed
  gives ฿15.70 / ฿13.61, which is the same +9.9 % on every tier. That pattern points to the **live** engine price having moved
  since the cached hint was computed. Possible causes are an approved price-list or sell-margin version, capacity used by the
  populate script that sends a quantity to the next option, or a stale cache. The hint was refreshed only hourly (if the
  worker runs) and on `price_list.version_approved`, `product_type.quote_mode_changed` and catalogue-product events. It
  was **not** refreshed on sell-margin or VAT approvals. **To check on UAT (read-only):**
  `select computed_at, unit_price from catalog_price_hints h join catalog_products p on p.id = h.catalog_product_id where p.slug = 'uat-postal-box-b'`,
  and whether the worker's `pricing.price_hints_refresh` job runs.
- **Fixed by:** a single default spec and a single pricing path (§2). Any drift that remains is a matter of cache age only,
  and the new event subscriptions shorten it.

### 1.3 Issue 2: the same unit price for 100 / 300 / 500 and a lower one at 1,000. Intended?

This is **intended by the ported formula on the current (fake) rehearsal data**, not a bug. Traced with the staff view
locally:

| Qty | Print path chosen (cheapest instant option) | Unit price |
|---|---|---|
| 100 / 300 / 500 | corrugate **digital** | 15.70 |
| 1,000 | corrugate digital | 13.61 |
| 2,000 | corrugate **flexo** (plates charged apart, ฿119) | 13.18 |

The digital buy price is linear per piece (no set-up), so the unit price stays flat until a band changes. At 1,000
pieces the **sell-margin band** changes: the rehearsal table has 1–999 at 35 % and 1,000+ at 25 %, and
15.70 ÷ 13.61 = 1.1536 ≈ 0.75 ÷ 0.65. At 2,000 the flexo path becomes cheaper. The band boundaries are price data that the
business team maintains (D-012), and the UAT values are fake. **Open question to the owner:** should the tier table
merge equal neighbouring tiers into one row ("100–500 ชิ้น ฿x")? That is a web display choice only.

### 1.4 Issue 6: the Studio shows ฿14.79 at 300 pcs for 150 × 100 × 80 KA125 B

Reproduced exactly: **150 × 100 × 80 mm, KA125 B, unprinted, 300 pcs = ฿14.79**. The Studio prices an empty draft
unprinted (Stage A decision), at the design's own box size. It used the same engine and the same rules, but on a
**different spec**, and the response did not say which spec. So the three numbers come from three different specs:

| Surface | Spec | Price at 300 |
|---|---|---|
| Listing / product page | 00 (140 × 97.5 × 60) · KA125 B · CMYK | ฿15.70 |
| Configurator | 00 (140 × 97.5 × 60) · KA125 B · ดำ | ฿15.70 locally (฿17.26 on UAT, see §1.2) |
| Studio | 150 × 100 × 80 · KA125 B · unprinted | ฿14.79 |

### 1.5 Issue 4: "กว้าง × ยาว × ลึก 97.5 × 140 × 60" vs "ยาว × กว้าง × สูง 140 × 97.5 × 60"

The API's spec-line helper (`boxSpecLines`) wrote `ขนาด (กว้าง × ยาว × ลึก)` with W × L × D values. Standard sizes,
the configurator and the product tables use L × W × H. The RFQ lines, the "priced size" line and the quote-PDF fallback
used W × L as well. GLOBAL-RULES §5 fixes the order as **ยาว × กว้าง × สูง, mm**.

### 1.6 Issue 3: "เลือกพิมพ์โลโก้ 1–2 สีได้" vs print options "ดำ · พิมพ์ 4 สี (CMYK)"

The description is catalogue content (`catalog_products.description_th`, admin-edited; seeded fake text in UAT). The ink
options are `uat-black` and `dev-cmyk`. Nothing in the API produces the sentence, and **no copy was changed** (business copy
needs approval).

### 1.7 Issue 5: "ดาวน์โหลดแบบกล่อง" goes to the generic `/templates`

The API already has a per-style, per-size dieline download (`POST /v1/store/dielines/downloads`, `store.dielines.download`,
D-271: `variantCode` + L/W/H + material class, signed in). The product and configurator reads did not say which style
variants a product's pattern can draw.

---

## 2. Plan (implemented in this step, D-441)

1. **One default spec.** The reference configuration (D-220, admin-maintained and audited) is the product's default
   spec. The configurator read returns it as `defaultSpec` (configuration, reference quantity, standard-size code, spec
   lines, label). The configurator's defaults follow it: option `isDefault` marks exactly what the spec selects, the
   matching standard size gets `isDefault`, and `quantity.default` is the reference quantity. The product-page read marks options the
   same way. Without a reference configuration nothing changes, and there is no starting price (D-220).
2. **One pricing path.** `StorePricingService.price()` = store DTO validation + store rules + `QuoteEngineService` + spec
   lines. `store.quotes.calculate`, the hero preview, the Studio dock and the price-hint refresh all call it. The starting
   price is now the configurator's own unit price for the default spec at the reference quantity, cached in
   `catalog_price_hints` and served unchanged to cards, category pages, style cards, the product page and its JSON-LD.
   The cache is also refreshed on `sell_margin_table.version_approved` and `tax_rate.version_approved`.
3. **One spec label.** `specLinesFor()` (one dispatcher) and `sizeText()` / `specLabel()` (`src/modules/quotes/spec-label.ts`)
   write sizes as **ยาว × กว้าง × สูง**. Every calculation, price-hint basis, card basis, style price and default spec carries
   the same one-string label, e.g.
   `กล่องฝาชน (RSC) · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · พิมพ์ 4 สี (CMYK)`. An unprinted spec says
   `ไม่พิมพ์`, so the Studio dock can show "฿14.79/ชิ้น · 150 × 100 × 80 มม. (ด้านใน) · … · ไม่พิมพ์".
4. **Template deep link (issue 5).** Configurator patterns carry `dielineVariantCodes`, the published variants of the style
   linked to the pattern. Proposal for the web: "ดาวน์โหลดแบบกล่อง" →
   `/templates?product=<slug>&size=<standardSizeCode>`. That page (or the product page directly) calls
   `store.dielines.download` with `variantCode = dielineVariantCodes[0]` and the standard size's L/W/H. When the list is
   empty, hide the link or keep the generic `/templates` with copy saying the file is prepared by the team
   (`templateAvailability = drawing`). The templates for the own-file products are still an open business item
   (`DECISIONS-STAGE-A.md` §5).
5. **Seed (fake data only).** The UAT seed builds each reference from the product's own first (default) options. The ink is the
   first offered ink (full colour prints four times, a spot colour once), or **unprinted when the product offers no ink**.
   After a re-seed, the postal box's default spec and starting price are for `ดำ`. Existing databases keep their stored
   reference until an admin changes it or the database is re-seeded.
6. **Tests.**
   - `test/e2e/price-consistency.e2e-spec.ts`: for **every** active instant product with a starting price,
     calculate(default spec) = hint = product card = product page, and the labels are equal.
   - The Studio e2e checks that the dock label equals the calculate label.
   - Unit tests: `spec-label.spec.ts` and `default-spec.spec.ts`.

### Copy fixes proposed (not applied; need the owner's approval)

| # | Where | Now | Proposed |
|---|---|---|---|
| 3 | `uat-postal-box-b` description (admin content) | "เลือกพิมพ์โลโก้ 1–2 สีได้" | either "พิมพ์โลโก้สีดำ หรือพิมพ์ 4 สี (CMYK)" (matches today's options), or add a second spot ink option if 2-colour logo printing is really sold |
| 3 | `uat-white-mailer-box` description | "พิมพ์โลโก้ได้คมชัด" but the product offers **no** ink option | add the ink options, or drop the print claim |
| 4 | Every size label | "กว้าง × ยาว × ลึก" | "ยาว × กว้าง × สูง" (done in the API's spec lines; the web must not re-order) |
| 4 | Standard-size names in the seed, e.g. "เบอร์ 00 (9.75×14×6 ซม.)" | W × L × H in cm | "เบอร์ 00 (14 × 9.75 × 6 ซม.)" (admin content; the web should show the spec label rather than the name) |

---

## 3. What the web must do (A3 web side)

- Product page, cards, category, JSON-LD: show `startingPricePerPiece` with `startingPriceAssumes.quantity` and
  `startingPriceAssumes.label.th` (or `/price-hints` `basis.label`). Do not build a spec string locally.
- Configurator: open on `defaultSpec` (or on the `isDefault` flags, `standardSizes[].isDefault` and `quantity.default`, which
  now agree). Show `calculation.specLabel` next to the price.
- Studio dock: show `calculation.specLabel` next to the unit price.
- Tier table: optionally merge equal neighbouring tiers (open question §1.3).
- "ดาวน์โหลดแบบกล่อง": the deep link in §2.4.

## 4. Open questions

1. UAT ฿17.26 vs ฿15.70 (+9.9 % on every tier): run the read-only query in §1.2 and check that the worker runs the hourly
   refresh. After deploying this branch, run `pricing.price_hints_refresh` once.
2. Which print should the postal box open on: `ดำ` (the configurator's current default, matches "โลโก้") or CMYK (the
   current UAT reference)? Admins set it with `PUT /v1/admin/catalog/catalog-products/{id}/reference-configuration`.
   The re-seeded UAT uses `ดำ`.
3. Merge equal tiers in the tier table (§1.3)?
4. Description and size-name copy (§2 table).
5. Dieline per product: which style variant when a pattern's style has several published variants (the API lists all,
   sorted by code)?
