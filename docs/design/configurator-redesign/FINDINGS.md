# Configurator Phase 0 — findings (API side, step A4)

Repo `getpack-api`, branch `fix/uat-phase0`. Internal document (GLOBAL-RULES §1 allows factory references here).

Method: code paths traced, and every number reproduced against the **local** API (`store.quotes.calculate`,
`POST /v1/store/quotes/actions/calculate`) on a local database seeded with the UAT rehearsal seed
(`prisma/seed/uat`, fake data). UAT and production were not called. Prices were **not** changed (A3 owns them,
GLOBAL-RULES §5); this step only verifies A3 and reports.

Product: `uat-postal-box-b`, KA125 B, difficulty fixed by the product, no shipping postcode.

---

## Item 2 — "พิมพ์ 4 สี (CMYK)" did not change the price for size 00 (฿17.26), but did for size C

### 2.1 What a single ink costs (local, unit price ฿/ชิ้น)

| Size | Print | 100 | 300 | 500 | 1,000 | 2,000 |
|---|---|---|---|---|---|---|
| 00 | ไม่พิมพ์ | 12.83 | 12.83 | 12.83 | 11.12 | 11.12 |
| 00 | ดำ | 15.70 | 15.70 | 15.70 | 13.61 | 13.18 |
| 00 | CMYK | 15.70 | 15.70 | 15.70 | 13.61 | 13.18 |
| 0 | ดำ = CMYK | 19.06 | 19.06 | 19.06 | 16.52 | 15.03 |
| C | ไม่พิมพ์ | 41.17 | 41.17 | 38.99 | 32.09 | 28.61 |
| C | ดำ = CMYK | 52.21 | 48.81 | 40.11 | 33.95 | 30.27 |

For **every** size (00 … F), ดำ and CMYK give the same price. That is the seed's data, not the formula:
the corrugate digital price list (`pl_corrugate_print_prices`) has one row per ink at **฿9.50/m²** for both
`uat-black` and `dev-cmyk`, and the seed says so (`prisma/seed/uat/uat-catalog.ts`: "One spot colour beside the
process set … priced like CMYK here"). The flexo path counts colours, and one ink is one colour whichever it is.
So switching **ดำ ↔ CMYK** never changes the price on rehearsal data, for size 00 or size C.

### 2.2 Where ฿17.26 comes from: two inks in the request

| Size 00 · KA125 B · print on top | 100 | 300 | 500 | 1,000 | 2,000 |
|---|---|---|---|---|---|
| one ink (ดำ **or** CMYK) | 15.70 | 15.70 | 15.70 | 13.61 | 13.18 |
| **two inks (CMYK + ดำ)** | **17.26** | **17.26** | **17.26** | **14.96** | 13.60 |

**฿17.26 / ฿14.96 is exactly the UAT pair** that A3 could not reproduce (A3 `PRICE-CONSISTENCY.md` §1.2 guessed a
stale cache, "+9.9 % on every tier"). It is reproduced here exactly when the configuration carries **both** ink
colours in `configuration.parts[0].printFront`: the digital engine adds the per-m² price of every ink
(9.50 + 9.50). The same happens on other sizes (size 0: 19.06 → 21.02; size C at 300: 48.81 → 50.06).

Likely sequence on UAT (to confirm on the web side by logging the calculate request body): the configurator
treats the ink group as a multi-select list, so a request carried ดำ **and** CMYK. On size 00 the click left two
inks selected before and after (price stayed ฿17.26); on size C the click moved between one and two inks, so the
price changed. Either way the cause is **the number of inks sent — not the size and not a minimum charge**.
No minimum charge applies: the digital minimum lot (`min_lot_price` ฿500 at buy price) is not reached at 100 pcs
of size 00 (≈ ฿780 buy + fix cost), and the flexo minimum order (300 pcs) only matters for larger sizes (item 3).

**Verdict:** not a pricing bug. (a) Rehearsal data prices a 1-colour spot ink like 4-colour process (fake data;
the business team sets real print prices). (b) The web must send exactly one ink per side for the postal box's
"ดำ / พิมพ์ 4 สี (CMYK)" choice (radio group, hard rule 6), unless a product really sells multi-ink printing.

API gap (open question Q1): the configurator read does not say whether an `ink_colour` group is "choose one" or
"choose several", and `store.quotes.calculate` accepts any combination up to the print type's `max_colours` (3).

### 2.3 One pricing service, one spec label (A3 verification) — PASS

| Surface | Spec (response `specLabel.th`) | 300 pcs |
|---|---|---|
| Listing / product page (`startingPricePerPiece`) | กล่องฝาชน (RSC) · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · พิมพ์ 4 สี (CMYK) | ฿15.70 |
| Configurator default spec (`defaultSpec` → calculate) | same label | ฿15.70 |
| Studio size, unprinted (calculate) | กล่องฝาชน (RSC) · 150 × 100 × 80 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · ไม่พิมพ์ | ฿14.79 |
| Studio size, ดำ (calculate) | … · 150 × 100 × 80 มม. (ด้านใน) · … · ดำ | ฿18.23 |
| Configurator with two inks (00) | … · 140 × 97.5 × 60 มม. (ด้านใน) · … · two inks | ฿17.26 |

Listing = configurator default (same price, same label). ฿14.79 is a different spec (Studio size, unprinted) on
the same service. ฿17.26 is a two-ink spec (2.2). All go through `StorePricingService`; no change needed.
(The local database still holds the CMYK reference configuration; after a re-seed it is ดำ — same price.)

---

## Item 3 — flat 100 / 300 / 500 tier for small sizes (00, 0)

**Intended by the ported formula on the rehearsal data; not a bug and not a minimum charge.**

- Sizes 00 and 0 fit the digital sheet (40 × 60 in) and digital is the cheapest instant path below 1,000.
  Digital buy cost is linear per piece on the rehearsal terms (no set-up reaches the price; the ฿500 minimum lot
  is not binding at ≥ 100 pcs), so the per-piece price is flat.
- At 1,000 the **sell-margin band** changes (rehearsal table: 1–999 → 35 %, 1,000+ → 25 %): 15.70 → 13.61.
- From 2,000 flexo (minimum order 300, plates charged) becomes cheaper for printed boxes: 13.18.
- Bigger sizes drop earlier (0+4 at 500, C at 300) because flexo (min. 300 pcs) beats digital sooner.

Bands, minimum orders and lot minimums are price data owned by the business team (D-012); the values are fake.
Same conclusion as A3 §1.3. Merging equal tiers into one row ("100–500 ชิ้น") is a web display choice (A3 Q3).

---

## Item 5 — VAT ฿338.58 vs 5,178 × 7/107 = ฿338.75

**Computed in the API** (`steps[].vatAmount` of `store.quotes.calculate`; the same figure is copied into the saved
quote, the cart item, the order line and from there the tax documents). Reproduced exactly:
size 00 · KA125 B · ดำ + CMYK · 300 pcs → `grossAmount` 5178.00, `vatAmount` 338.58.

### Cause: VAT is taken from the exact price before the per-piece price is rounded up

`saleMargin()` (`src/modules/pricing/calculators/shared/sell.ts`, ported from legacy `Calculator::SaleMargin`):

1. exact VAT-inclusive lot price `G = (buy + fix cost) / (1 − margin) × 1.07` = **฿5,175.44**;
2. `vatPrice = G − G / 1.07` = **฿338.58** (VAT of the *unrounded* price);
3. per piece `convertTo2Decimal(G / qty)` = **ceil**(17.2515) = **฿17.26**; total = 17.26 × 300 = **฿5,178.00**.

Rounding each piece up to the satang adds ฿2.56 to the gross with no VAT on it, so VAT is ฿0.17 short of
5,178 × 7/107. It is not per-unit VAT rounding and **not shipping** (no shipping in that total; shipping VAT is
computed on its own net and added separately in `quote-engine.service.ts`).

Size of the gap (local): VAT always too low, ฿0.02 to ≈ ฿1 per line (00 · 1 ink · 1,000 pcs: 889.76 vs 890.37;
C · 2,000 pcs: 3,963.54 vs 3,964.55).

### Related, larger: design-fee VAT is missing from `vatAmount`

The graphic / structure design fee is VAT-inclusive and added to the total untouched (legacy behaviour, port maps
folding Q2 / corrugate C14), but the step VAT counts only product + plates/die-block VAT. Reproduced: 00 · ดำ ·
300 pcs with the ฿2,000 design fee → gross 6,710.00, VAT **307.99** (6,710 × 7/107 = **438.97**, ฿130.98 short).
The same pattern is likely in the folding, label and other calculators (not checked one by one).

### Proposed fix (NOT applied — needs approval; touches money, tax documents and accounting)

- Keep the calculators and their golden tests as they are (legacy port). In `QuoteEngineService` derive the
  customer-facing step VAT from what is charged:
  `vatAmount = round_half_up((grossAmount − shippingGross) × r / (100 + r)) + shippingVat`, with `r` the dated VAT
  rate already loaded; `netAmount = grossAmount − vatAmount`. → 5,178.00 → **338.75**; 6,710.00 → **438.97**.
- Needs an accounting decision (new D-###): line-level vs document-level rounding is a configuration per
  `accounting-design.md` §1.5; confirm line-level half-up on the VAT-inclusive line total. Quotes, carts and orders
  already priced keep their stored figures (no back-fill, D-005).
- The web shows `vatAmount` from the API through the shared price-display helper (styles Phase 1); no local VAT math.

---

## Item 6 — size F at 100 pcs: "สเปกนี้คำนวณราคาอัตโนมัติไม่ได้" only inside the tier table

API behaviour (local): size F (450 × 300 × 220) at 100 / 200 / 250 pcs → step `instant: false`,
`reason: "not_priceable"`; 300 pcs and up are instant (฿116.51 with one ink at 300). Cause on rehearsal data: the
RSC blank of size F (≈ 1.56 m long) does not fit the digital sheet (40 × 60 in ≈ 1.52 m), and the only other path,
flexo, has a 300-piece minimum order. So for size F the instant price starts at 300 pcs.

Everything the web needs to switch the main price area and the primary CTA to "ขอใบเสนอราคา" with the spec
prefilled is already in the calculate response — **no API change**:

- per step: `instant` / `reason` (store reasons `no_price_path`, `not_priceable`, `envelope_not_covered`,
  `not_instant`, `delivery_unavailable`, …): the selected quantity's step drives the main price area and CTA;
- `calculationId`: send as `routedFrom.calculationId` in `store.rfqs.submit`; the RFQ then links the full priced
  configuration for CS (D-102);
- `dimensions.entered` (L / W / H, mm), the quantities, and `specs` / `specLabel` to prefill `lengthMm` /
  `widthMm` / `heightMm`, `quantities` and `notes`. `store.rfqs.getForm('corrugated')` has no extra spec fields
  today (`fields: []`).

Optional, not done (Q3): "ราคาทันทีเริ่มที่ 300 ชิ้น" would need the API to return the smallest instant quantity for
a spec; today the web can only infer it from the tiers it asked for.

---

## Items 1 and 4

UI only (i18n key `configurator.quantity.target`; step status "ค่าเริ่มต้น"). Nothing in the API produces these
strings. Web session.

## Open questions

1. Ink selection: should the configurator read state per `ink_colour` group whether it is single-choice (and should
   `store.quotes.calculate` refuse a second ink for such products)? The postal box offers "ดำ" or "CMYK" as
   alternatives, but two inks are accepted and priced.
2. VAT (item 5 + design fee): approve the proposed fix and the rounding rule (line-level, half-up, on the charged
   VAT-inclusive amount)? It changes `vatAmount` / `netAmount` on new quotes, carts, orders and tax invoices.
3. Return the smallest instant quantity for a spec (size F: 300) so the web can say "ราคาทันทีเริ่มที่ 300 ชิ้น"?
4. Rehearsal data: price ดำ (1 spot colour) below CMYK in the UAT seed so the choice is visible? (Fake data; real
   prices come from the business team.)
