# UAT rehearsal data — `pnpm db:seed:uat` + `pnpm uat:populate`

> **Audience:** the QA lead and the UAT team (staff of every role, the launch factory's users, Finance and the CPA
> observer), and the engineer who prepares the UAT stack.
> This data set lets the team **rehearse** every scenario of `docs/launch/UAT.md` before the launch factory's real
> onboarding data exists, with a catalogue and customers that look like the market getpack sells to. It is not the
> UAT itself: the real UAT (D-113) runs on the launch factory's own data (UAT-01 step 3) and is signed by people.

## 1. What is in it

| Layer | Built by | Contents |
|---|---|---|
| Reference data | `pnpm db:seed:uat` (reference seed) | settings, roles, approval matrices, chart of accounts, posting rules, notification matrix, guarantee policy v1, payment schedule templates, feature flags (all integration flags off) |
| People | `pnpm db:seed:uat` | one staff user per D-140 role, a second Finance Manager and a second CS (maker-checker), the rehearsal factory's six users |
| Catalogue | `pnpm db:seed:uat` | **39 catalogue products** over all 14 product types and **101 ready-to-ship SKUs** with stock on hand (§3), 15 materials, finishes, die-cuts, folding box geometries (tuck end, crash-lock bottom) |
| Prices | `pnpm db:seed:uat` | the rehearsal factory's price lists for the 7 calculators (§4) — **rehearsal values, not prices** |
| Geography & shipping | `pnpm db:seed:uat` | 21 delivery areas in 15 provinces, four shipping zones, customer rates and factory payouts by weight band |
| Content | `pnpm db:seed:uat` | 11 FAQ drafts in 4 categories, each answer citing its decision; a `[UAT]` placeholder text for every consent purpose without one (fake, so consents can be granted — legal publishes the real texts) |
| Activity | `pnpm uat:populate` | 13 customers, a B2B company, a campaign with promotions and coupons, saved quotations, 14 orders parked at every stage, 7 RFQs in every state, a referral, conversations, a payout run (§5–§6) |
| Partner zone | `pnpm uat:populate` | the launch factory's profile, hours, closure, capacity override, change requests, site visit, price proposals, next month's payout card, partner knowledge base, scorecard; jobs with an issue, on the factory's own truck, a claim and a sample for the factory to act on, a call-off request; three new factories at each onboarding stage (§6.1) |

Everything is created **through the real code**: the seed writes master data like an admin would, and the populate
step calls the real HTTP API (the same endpoints the web app uses) with the worker's subscribers running, so every
order has its events, documents, journal entries and audit trail.

## 2. Building it

Needs getpack-api's `docker compose up -d` infrastructure. Never point these commands at production data: both
refuse to run without an explicit confirmation variable.

```sh
# 1. An empty database for the rehearsal, migrated
docker exec -i getpack-api-postgres-1 psql -U getpack -d postgres -c "CREATE DATABASE getpack_uat OWNER getpack"
DATABASE_URL=postgresql://…/getpack_uat npx prisma migrate deploy

# 2. Master data (catalogue, prices, geography, people)
DATABASE_URL=postgresql://…/getpack_uat UAT_SEED_CONFIRM=uat-only UAT_SEED_PASSWORD=<choose one> pnpm db:seed:uat

# 3. Activity through the API (fake integrations; runs once on a fresh seed)
UAT_DATABASE_URL=postgresql://…/getpack_uat UAT_POPULATE_CONFIRM=uat-only UAT_SEED_PASSWORD=<same> pnpm uat:populate
```

| Variable | Meaning |
|---|---|
| `UAT_SEED_PASSWORD` | password of every seeded staff and factory user (argon2id in the database; never written in a document) |
| `SEED_ENTITY_*` | when set, the issuing entity is the real Collective Group (Thailand) data (UAT.md §0, D-092); otherwise an obviously fake "UAT rehearsal entity" |
| `UAT_INSTANT_TYPES` | `all` switches every type with a calculator to instant for a **pricing rehearsal**, or a list such as `corrugated,standard_product` (ready-to-ship items priced online); default: only types whose validation document is signed (A-16) — today **corrugated** only |

`pnpm uat:populate` prints one line per step (`✓` / `✗`) and writes `.uat-populate-report.json`. A failed step does
not stop the others. Run the API on the same database afterwards (`DATABASE_URL=…/getpack_uat pnpm dev` and
`pnpm dev:worker`) and point getpack-web at it.

Document numbers carry the prefix **`UAT`** (`UATOG-2610-00001`, `UATOR-…`, `UATRFQ-…`, `UATJOB-…`, `UATIV-…`):
real in form and numbering rules, never mistaken for production ones (UAT.md §0, D-210).

## 3. Accounts

| Who | Sign-in | Notes |
|---|---|---|
| Staff, one per role | `<role-with-dashes>@example.invalid` (e.g. `cs-lead@example.invalid`, `finance-manager@example.invalid`, `c-level@example.invalid`) | password `UAT_SEED_PASSWORD` |
| Second maker-checker staff | `finance-manager-2@example.invalid`, `cs-2@example.invalid` | for the close (two Finance Managers, UAT-19) and four-eyes checks |
| Rehearsal factory (F9001) | `factory-owner@uat.example.invalid`, `factory-planner@…`, `factory-operator@…`, `factory-qc@…`, `factory-shipping@…`, `factory-accountant@…` | partner zone |
| New factories onboarding (UAT-01) | `applicant-owner@uat.example.invalid` (applied, empty application), `review-owner@uat.example.invalid` (application submitted, under review), `trial-owner@uat.example.invalid` (assisted, on trial) | partner zone, password `UAT_SEED_PASSWORD`; §6.1 |
| Customers | phone OTP; in a fake-integration stack the code is in the API log / fake SMS sender | phones `0800000101` – `0800000113` (§5) |

## 4. Catalogue and prices

### Products (39) and ready-to-ship SKUs (101)
| Product type | Products (sizes) | Materials / options |
|---|---|---|
| Folding carton (10) | serum / skincare box (30 ml, 50 ml, 50 g jar), bar-soap box, supplement box (30 / 60 capsules, 10 sachets), lipstick box, drip-coffee box (10 bags), candle box with crash-lock bottom (180 g, 300 g), sauce / honey bottle box (250 / 500 ml), bakery & cookie box (food grade), tea-bag box, thank-you / insert card (name-card, A6) | art card C2S 300 / 350 / 400 gsm, ivory FBB 350 (food grade), duplex grey-back 350, kraft 350; matt OPP, gloss OPP, aqueous varnish, soft-touch; reverse / straight tuck end, crash-lock bottom, flat |
| Corrugated (5) | postal box RSC 3-ply in the usual Thai sizes **00, 0, 0+4, A, 2A, B, C, C+8, D, E, F**, white corrugated mailer (S, M), 5-ply moving carton BC (M, L), telescope fruit box body + lid (4 kg, 10 kg), open-top produce tray | KA125 / KT125 / KA185 / KI230 B-flute, KA125 / KA185 BC-flute; flexo and digital |
| Labels (5) | round logo sticker Ø 3–6 cm, rounded-rectangle product label (5×3 – 10×7 cm), wrap-around bottle label, clear cosmetic label, box-seal sticker | white PP, clear PP, semi-gloss art paper, kraft paper, silver PP; circle / rounded-rectangle / oval / custom die-cut |
| Tags & sleeves (2) | clothing hang tag (4×7, 5×9, 5.5×8.5 cm, punched hole, optional gold foil), paper sleeve for food boxes | art card 350 / 400, kraft 350 |
| Flexible pouch (3) | printed stand-up zip pouch (doypack, 12×20 – 20×30 cm), foil coffee pouch (250 g, 500 g), 3-side-seal snack pouch | PET/LLDPE clear, PET/AL/LLDPE foil, MOPP/VMPET/LLDPE, kraft/PET/LLDPE; zipper, tear notch |
| Ready-to-ship / standard products (101 SKUs, §3.1) | unprinted postal boxes, bottles, sprays and pumps, glass, jars, tubes, cups / lids / straws, food containers, paper bags, plastic bags and zip pouches, mailers, packing supplies | sold by the piece, the pouch or the tube, each with its own minimum order; stock on hand at the launch factory |
| Services (1 + 3 renamed) | structural / dieline design, packaging graphic design, offset print plates, die-cut block, physical sample (mockup) | |
| RFQ types (11) | rigid gift box (lid & base, magnetic, drawer), rope-handle and twisted-handle paper bags, printed paper cup, printed food box, paper tube, printed OPP tape, counter display, floor display stand, printed tissue paper | no calculator (D-100): quoted by CS within the SLA |

### 3.1 Ready-to-ship (สินค้าพร้อมส่ง)
Every SKU carries a store category (stock attribute `type`) plus material, colour, cap, shape or size where they
apply, its capacity / dimensions, a food-grade flag, a minimum order, and **stock on hand at the launch factory**
(200 × the minimum order, received once as an opening-stock movement) — so the store shows it as in stock.

| Category | SKUs | Examples |
|---|---|---|
| กล่องไปรษณีย์พร้อมส่ง | 9 | unprinted RSC postal boxes 00, 0, A, 2A, B, C, D, E, F — packs of 20 |
| ขวดพลาสติก | 10 | PET 60 ml flip-top – 1.5 l, square 150 ml, HDPE 1 l and 3.8 l gallon |
| ขวดสเปรย์และขวดปั๊ม | 6 | mist sprays 30 / 100 ml, pumps 250 / 500 ml, foam pump, airless 30 ml |
| ขวดและโหลแก้ว | 10 | amber droppers 10 – 100 ml, jars 100 – 500 ml, juice bottle, candle glass, bird's-nest bottle |
| กระปุกครีมและโหล | 6 | PP jars 30 / 50 g, double-wall acrylic, PET jars 250 ml – 1 l |
| หลอดเครื่องสำอาง | 3 | lip-balm tube, squeeze tubes 50 / 100 ml |
| แก้วเครื่องดื่มและฝา | 12 | paper cups 4 – 22 oz, PET cups, U-shape cup, dome / flat / sip lids, paper straws |
| กล่องและภาชนะอาหาร | 13 | kraft boxes 500 – 1,400 ml, paper bowls, bagasse box and plate, PP containers, bakery box, cake box, window snack box |
| ถุงกระดาษ | 5 | flat-bottom and twisted-handle kraft bags, white paper bag |
| ถุงพลาสติกและซองซิป | 10 | T-shirt bag, clear zip bags, foil and kraft stand-up zip pouches, OPP adhesive bags, vacuum bags |
| ซองไปรษณีย์ | 10 | plastic mailing bags 17×30 – 38×52 cm (white, black), bubble mailers, kraft A4 envelope |
| อุปกรณ์แพ็กสินค้า | 7 | OPP tape clear / brown, fragile tape, bubble wrap roll, stretch film, paper filler, air-column bags |

**Stock states to test:** three SKUs are **out of stock** (`UAT-POSTBOX-F`, `UAT-GLS-CANDLE-180`,
`UAT-BUBBLE-ROLL-65`) and one is **low** (`UAT-AIRLESS-30`, 150 on hand). Ready-to-ship items price online only when
`standard_product` is instant (`UAT_INSTANT_TYPES=corrugated,standard_product`); otherwise they route to RFQ (A-16).
Rehearsal prices copy the dev bottle's fake tiers scaled by the SKU's weight (or the dev stock pouch's tiers for
items sold by the pouch or tube) — not market prices (§4).

Every made-to-order product has standard sizes, a quantity range with presets and a **reference configuration** for
its "starting from" price (D-220, D-307): 5 cards show a starting price in the default rehearsal, 24 with
`UAT_INSTANT_TYPES=all`.

### Prices are rehearsal values — read this before judging a price
No price in this data set was invented for it (CLAUDE.md: never invent prices). The rehearsal factory's lines are
the **dev seed's fake lines** copied onto the rehearsal materials and options, values unchanged: an art card
400 gsm line is the dev art card line (same THB per kg — so it costs more per box because it is heavier); a BC board
copies the dev B board; stock SKUs scale the dev bottle's fake tiers by weight. The resulting customer prices are
**not market prices** — a postal box size D comes out around THB 46 a piece, several times the market. Judge the
**mechanics** in a rehearsal (quantity breaks, VAT, shipping, deposit rules, discounts, margin floor, documents and
postings), never the level. The launch factory's signed price lists replace these lines in UAT-01 step 3 and are
compared with the calculator validation documents in UAT-03.

Shipping is fake too: customer THB 80 – 750 and factory payout THB 60 – 580 by zone (Bangkok metropolitan, central /
east, north / northeast, south) and weight band (from 0, 5 kg, 20 kg).

## 5. Customers (13)

| Key | Name | Business | Area | Notes |
|---|---|---|---|---|
| C01 | มาลี ทดสอบ | online skincare brand | บางรัก กรุงเทพฯ 10500 | referrer; O1, O8 (claim) |
| C02 | วิชัย ทดสอบ | coffee roaster | เมืองเชียงใหม่ 50200 | O2, R1, conversation |
| C03 | นภา ทดสอบ | home bakery | เมืองนนทบุรี 11000 | O3, R2 |
| C04 | ธนา ทดสอบ | online clothing shop | ปากเกร็ด นนทบุรี 11120 | O4, R3 |
| C05 | สุดา ทดสอบ | honey & community products | เมืองขอนแก่น 40000 | O5, R4, expired quotation |
| C06 | อนันต์ ทดสอบ | fruit exporter | เมืองภูเก็ต 83000 | O6, conversation |
| C07 | ปรีชา ทดสอบ — บริษัท ทดสอบ เฮลท์แคร์ จำกัด | supplement maker, **juristic, withholds tax** | ลาดกระบัง กรุงเทพฯ 10520 | O7 (delivered, reviewed), R5 |
| C08 | ปริญญา ทดสอบ | new visitor | จตุจักร กรุงเทพฯ 10900 | abandoned cart (O9) |
| C09 | กมล ทดสอบ | Company Admin of บริษัท ทดสอบ รีเทล จำกัด | ปทุมวัน กรุงเทพฯ 10330 | B2B |
| C10 | ศิริ ทดสอบ | company buyer | ปทุมวัน | B2B order waiting for approval |
| C11 | วรรณา ทดสอบ | company approver | ปทุมวัน | approves / rejects in UAT-09 |
| C12 | ชัยวัฒน์ ทดสอบ | delivery restaurant | บางละมุง ชลบุรี 20150 | O10 (slip in the Finance queue) |
| C13 | อรุณี ทดสอบ | referred by C01 | บางพลี สมุทรปราการ 10540 | referral attributed |

All names carry `ทดสอบ`, phones are `08000001xx`, tax ids are all-zero with a valid check digit (PDPA: no real
person's data in UAT).

## 6. Records by stage — and which scenario uses them

| Record | State after populate | Use it in |
|---|---|---|
| Campaign `uat-launch` (THB 50,000 budget) with an automatic 10 % on postal boxes (ends in 30 days) and coupon `UATWELCOME10` + 20 unique `UAT…` codes | active | UAT-07, UAT-26 (badge and reference price on the postal-box card) |
| Saved quotations (C04 white mailer, C06 fruit box and tray, C07 postal box D, C08 moving carton; all 17 with `UAT_INSTANT_TYPES=all`) and 10 ready-to-ship quotations (cups, lids, food boxes, postal box C, mailing bags, airless and dropper bottles, bakery box, foil pouches, glass jar) when standard products are instant | live 15 days | UAT-03, UAT-23 |
| Expired quotation (C05 postal box B) | validity in the past | UAT-03 step 4 (re-priced, D-051) |
| **O1** C01 postal box C × 1,000 | waiting for payment | UAT-05 (expiry, D-060), UAT-06 |
| **O2** C02 postal box B × 500 | paid by QR, waiting for artwork | UAT-11 step 1 |
| **O3** C03 white mailer M × 300 | artwork uploaded, waiting for Prepress | UAT-11 step 2 |
| **O4** C04 postal box A × 2,000 | proof approved, job released, waiting for the factory | UAT-12 (accept within 1 business day / let it go overdue) |
| **O5** C05 fruit box 4 kg × 500 | accepted, two milestones done | UAT-13 |
| **O6** C06 moving carton BC × 300 | produced, inspected, packed and ready | UAT-14 (POD, tracking) |
| **O7** C07 postal box D × 5,000 (≥ THB 20,000: 50 / 50, withholding) | delivered, receipt confirmed, 5-star review; billing statement confirmed | UAT-05 step 3, UAT-15, UAT-17, UAT-18 |
| **O8** C01 postal box 0 × 3,000 | delivered 2,940 (within ± 5 %), print-defect claim under review | UAT-14 step 2, UAT-25 (severity, remedy, SLA clock) |
| **O9** C08 moving carton L × 300 | in the cart, never checked out | UAT-20 (funnel / abandoned) |
| **O10** C12 postal box E × 300 | slip whose amount does not match, in the Finance slip queue | UAT-06 step 2 (4-business-hour SLA, D-061) |
| **R1** C02 rigid magnetic gift box | submitted, waiting for CS | UAT-04 |
| **R2** C03 rope-handle paper bag | factory consulted and answered, quotation sent | UAT-04 (customer accepts) |
| **R3** C04 printed paper cups | accepted → ordered, waiting for payment | UAT-04, UAT-05 |
| **R4** C05 floor display stand | declined `capability_missing` | UAT-20 (unmet demand) |
| **R5** C07 printed OPP tape | CS asked for information | UAT-04 |
| **R6** C01 serum box (folding cartons on RFQ until signed) | submitted | UAT-03 step 2 |
| **RB1** C01 RFQ basket `UATRB-…-00001`: rigid gift box, rope-handle bag, printed tape | submitted; box and bag quoted (2 quantities each), tape waiting for CS | UAT-04 (basket, D-301): `/account/rfq-baskets/[id]`, accept items into the cart |
| **RB2** C01 draft basket: paper tube, kraft food box | draft, no delivery postcode yet | `/rfq/basket` (set delivery, submit) |
| **RB3** C06 RFQ basket `UATRB-…-00002`: twisted-handle bag, counter display | submitted, every item quoted | UAT-04: accept both into the cart |
| **S1** C01 standalone sample with print | requested, waiting for CS Lead to quote | UAT-24 (D-254): `/account/samples/[id]`; admin quotes it |
| **S2** C01 standalone sample without print | quoted (sample quotation, THB 450 net input) | UAT-24: buy it like a quotation |
| **S3** C06 standalone sample with print | quoted, bought and paid by QR | UAT-24: the factory makes it next |
| **SD1** C01 structural request (2-bottle serum carton) | submitted | D-273: `/account/structural-requests/[id]`; CS assigns |
| **SD2** C01 structural request (6-bottle shipper) | assigned to Prepress | D-273: Prepress delivers a dieline |
| **SD3** C07 structural request (hanging supplement box) | assigned, quoted by a service RFQ (design fee THB 3,500) | D-273: the customer accepts the fee |
| **SD4** C01 structural request (lipstick box) | declined with a reason | D-273: the customer reads the reason |
| B2B บริษัท ทดสอบ รีเทล จำกัด, threshold THB 10,000; C10's order C+8 × 2,000 | pending company approval | UAT-09 |
| Referral code of C01, attributed by C13 | attributed, reward after the claim window | UAT-07 step 4 |
| Two support conversations (C02, C06) | open, first-response clock running | UAT-16, ops signal `conversation_first_response_overdue` |
| Payout run for the factory's eligible payables (30 % advances) | proposed by Finance, approved by C-Level | UAT-18 (generate the bank file, confirm, 50 ทวิ) |

### 6.1 Partner zone — what each factory user finds

Sign in at the partner zone as the rehearsal factory's users (§3). Records are those of F9001 unless the row says
otherwise.

| Record | State after populate | Who acts | Use it in |
|---|---|---|---|
| **O4** job (postal box A × 2,000) | released, waiting for acceptance | Owner / Planner: accept, or reject with a reason; let it pass 1 business day for the overdue alert (D-074) | UAT-12 |
| **O5** job (fruit box) | accepted, two milestones done | Operator, QC: next milestones with photos and QC (D-076) | UAT-13 |
| **O11** job (postal box C × 1,000) | accepted, first milestone done, **open material-shortage issue** raised by the operator | Owner: resolve the issue; Partner Manager / CS Lead sees it in admin | UAT-13 |
| **O6** shipment | packed, ready | Shipping: dispatch on the own truck, then POD | UAT-14 |
| **O12** shipment (postal box 2A × 500) | dispatched by the factory's own fleet, **in transit** | Shipping: out for delivery, POD with signature and photos | UAT-14 |
| **O13** claim (postal box 0+4, damaged cartons, 40 pcs) | **sent to the factory**, waiting for its answer (first response SLA, D-199) | Owner: accept or dispute with evidence | UAT-25 |
| **O8** claim | under CS review (not yet with the factory) | CS first; send it to the factory to rehearse a second response | UAT-25 |
| **O14** sample job (white mailer S, attached mockup) | released with the bulk order held until the sample is approved (D-256) | Owner: accept; record measured size, material and photo before shipping (D-255) | UAT-24 |
| **R2** consultation | answered with buy prices per tier | — (history) | UAT-04 |
| **R7** consultation (counter display) | **requested**, not answered | Owner: answer a buy price per tier, or decline | UAT-04 |
| Call-off request (C07, postal box D × 10,000, 6 months) | requested, waiting for the factory | Owner: accept or decline (D-290) | — (post-launch, D-219) |
| Billing statements | one confirmed (O7), one sent | Accountant: dispute or confirm the sent one; record the factory's tax invoice on the confirmed one (D-090) | UAT-18 |
| Payout run | approved by C-Level, bank file not generated | Finance generates and confirms; the Accountant then sees the payout, its documents and the 50 ทวิ | UAT-18 |
| Profile | 3 addresses, 3 contacts, 3 verified KYC documents; the **factory licence expires in 25 days** | read-only for the factory once active (D-171); changes go through a change request | UAT-01 |
| Weekly hours | Mon–Fri 08:00–17:00, Sat 08:00–12:00, from tomorrow (D-292) | Owner / Planner | UAT-12 (SLA clock) |
| Closure and capacity override | one closed day and **half the corrugated capacity** in the week three weeks ahead | Owner / Planner: see the capacity calendar; reopen the day | UAT-12 |
| Change requests | one **open** (more corrugated capacity), one site-visit request **in progress** | Partner Manager answers; the factory reads the answer | UAT-01 |
| Site visit | passed, a month ago (date and result only, D-041) | — | UAT-01 |
| Price proposals | own-list mode (`factory_price_list`); a **draft** for corrugated (current lines, values unchanged — edit and submit), a **submitted** label proposal asking to stop one line, with a document | Owner: edit and submit the draft; Partner Manager reviews, counters or approves the submitted one (maker-checker) | UAT-02 |
| Shipping payout card | next month's version **sent**, amounts copied from the current card | Owner: accept or counter per line; Partner Manager answers counters | UAT-02 |
| Agreements | partner agreement and price-data confidentiality **accepted** — rehearsal placeholder texts | — | UAT-01 |
| Knowledge base | 5 published partner articles, one per category (draft texts restating D-022, D-074, D-076, D-090, D-186) | every factory role reads them | — (post-launch, D-219) |
| Scorecard | current month recomputed (month to date) | Owner reads it (D-075) | UAT-13 |
| **N1** new factory (self-service) | `applied`, nothing filled | `applicant-owner@…`: fill the company data, addresses, contacts, KYC, accept the agreements, propose the bank account, submit | UAT-01 |
| **N2** new factory (self-service) | `under_review`: profile, 2 addresses, a contact, 3 KYC documents, agreements accepted, a bank account **waiting for Finance's two approvals and the call-back** | Partner Manager: review KYC, start the trial; Finance: approve the bank account | UAT-01 |
| **N3** new factory (assisted) | `trial`, data entered by the Partner team | Partner Manager: capabilities, site visit, activation request (D-041); `trial-owner@…`: sign off the data getpack entered | UAT-01 |

Rehearsal inputs, not business values: the capacity override (half the agreed capacity), the sample's buy amount
(THB 600, typed by CS as for any sample), the agreement texts (placeholders until counsel's text, UAT-01) and the
knowledge-base texts (drafts; the Partner team writes the final ones). The price-proposal and payout-card lines are
the current lines with their values unchanged.

### 6.2 Top-up of a database populated before RB / S / SD existed

The RB, S and SD rows are created by `pnpm uat:populate` since 2026-10-28. A database populated earlier gets only
them with the top-up (refuses to run if a basket already exists):

```sh
UAT_DATABASE_URL=postgresql://…/getpack_uat UAT_TOPUP_CONFIRM=uat-only UAT_SEED_PASSWORD=<same> \
  pnpm uat:populate test/uat/top-up-design-requests
```

## 7. Shortcuts and limits of the rehearsal

- **Fake integrations.** `uat:populate` runs with `INTEGRATIONS_MODE=fake`: OTP codes come from the fake SMS sender,
  QR payments settle through the fake SCB callback, slips are read by the fake verifier. Files uploaded during the
  run (artwork, proofs, photos, slips) live in the fake in-memory storage of that process: the records exist, the
  file contents cannot be opened later. On the real UAT stack (sandbox accounts, S3) the team uploads real files.
- **Written directly, as the e2e suites do** (each has its own UAT scenario where people do it properly): the B2B
  company's KYC approval (UAT-09 step 1), the company and factory bank accounts (dual approval, D-169 — UAT-18).
- **One launch factory** (D-101): the dev engine-B factory F9002 is suspended; folding engine B stays off (D-233).
- **Instant types follow the sign-offs** (A-16): only corrugated is instant by default; the others route to RFQ until
  their validation documents and the factory's price lists are signed. Use `UAT_INSTANT_TYPES=all` only to rehearse
  pricing screens.
- **Geography** uses real names and postcodes for 21 areas so addresses read naturally; production geography is
  keyed in by admins through the Excel import (D-161, D-170).
- **FAQ texts** are drafts that restate decisions; the CS Lead writes the production content (D-221).
- **Product photos** are not seeded (Marketing uploads them).
- **Not seeded on purpose:** post-launch features (D-219) — styles library publication, studio templates, samples
  beyond the attached sample, assistant.

## 8. Starting over
Drop and recreate `getpack_uat`, then repeat §2. Both commands refuse to touch a database that already holds their
data (`db:seed:uat` is idempotent; `uat:populate` stops when orders exist).
