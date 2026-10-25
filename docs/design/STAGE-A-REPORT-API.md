# Stage A — API report (getpack-api, branch `fix/uat-phase0`)

Each step ran in a subagent with its `· ฝั่ง API` block from `STAGE-A-PROMPTS.md`, then passed the gate:
`pnpm lint` · `pnpm typecheck` · `pnpm test` (unit) · the factory-data contract test
(`test/unit/storefront-factory-confidentiality.spec.ts`) · a scan of the step's diff for secrets and for the seed's
factory names/codes/locations.

Environment: cloud VM, Node 24.22.1, pnpm 10.18.1, PostgreSQL 16 + pgvector 0.6.0 (with a VM-only `uuidv7()`
polyfill), Redis. No Docker, so `pnpm test:int` and `pnpm test:e2e` were not run here.

---

## A1 — business · Phase 0 + Phase 3b — PASS

Commits: `7fb3dcff` fix(store)!: strip factory data from storefront responses (D-435) ·
`3d5ec27d` docs(business-redesign): API-side PLAN and API-CHANGES for A1 (the subagent committed and pushed
these itself, so they are not in the `stage-a(A1): …` form; pushed history was not rewritten).

Gate: lint ✔ · typecheck ✔ · unit 166 suites / 1212 tests ✔ · contract test 5/5 ✔ · diff scan clean ✔ ·
live check: `GET /v1/store/network/stats` → 404; public-config, styles, catalogue products and stock products
return no factory/partner/machine/plant/coverage keys.

### What changed (breaking for the storefront contract; web must run `pnpm gen:api`)
- `GET /v1/store/network/stats` removed, with its service and the four `trust.*` settings it used.
  D-201 and D-264 are marked superseded by the new D-435 in `docs/decisions.md`.
- `GET /v1/store/public-config`: `factoryCount` removed.
- `GET /v1/store/styles/{code}` and `/styles/compare`: `partnersCount` removed; variants no longer return the
  `not_makeable` reason.
- Agent area: `factoryName` removed from `/agent/commissions` and `/agent/statements/{id}`; `totals.factories`
  removed from `/agent`. Admin endpoints keep them.
- `/v1/store/call-off-agreements*`: separate customer schema without `factory` and `buyUnitPrice`.
- `/v1/store/orders/{id}/shipments` and the order timeline (`store.timeline.get`): an event `location` is sent only
  for out-for-delivery, delivered and failed-delivery events; pickup, in-transit and returned events send `null`.
- Customer label for `picked_up`: "จัดส่งออกแล้ว / Dispatched" (was "ออกจากโรงงานแล้ว / Left the factory").
- No migration (no schema change). Existing `trust.*` setting rows in seeded databases stay, unused.
- New contract test `test/unit/storefront-factory-confidentiality.spec.ts`: fails if any `/v1/store/*` response
  schema or success example gains a key matching factory/factories/partner/machine/plant/coverage (three agent
  bounty-term fields allowed, reason in the file), or if `/v1/store/network` returns.

API-CHANGES: `docs/design/business-redesign/API-CHANGES.md` · Plan: `docs/design/business-redesign/PLAN.md`

### Other leaks found, not fixed (details in PLAN.md §2)
1. Store responses carry `statusLabelAdminTh` (staff wording, e.g. "รอโรงงานรับงาน", "โรงงานปฏิเสธงาน"); the public
   `/v1/store/status-labels` lists it.
2. Status/reason codes on store responses name factories or capacity: `CallOffStatus.pending_factory`,
   `ClaimStatus.factory_review`, `ClaimOwner.factory`, `ClaimAction.factory_deduction`,
   `QuotePathReason.no_active_factory`, `QuoteNoPriceReason.capacity_unavailable`.
3. Flash Express / Deliveree bookings send the factory as sender (both carriers are off today).
4. Error `agents.lead_existing_factory` tells an agent a phone/tax id belongs to a factory (D-417/D-419).
5. A factory's call-off `declineReason` reaches the customer verbatim.
6. Proof files keep their original file names.
7. EXIF/GPS not stripped from uploaded photos; PDFs keep Chromium Producer/Creator metadata.
8. Factories see recipient name/phone on production jobs before dispatch and the claim description verbatim.

### Tests to run locally (Docker)
- `pnpm test:e2e` — at least the edited specs in `test/e2e/`: agents, call-offs, claims, logistics,
  phase4-contract, style-network, timeline.
- `pnpm test:int` — no spec touched; run for the Definition of Done.

### 124 vs 125 migrations
`prisma/migrations` holds 124 migration folders plus `migration_lock.toml`; a plain directory count gives 125.

### Open questions — answered by the user
1. Staff wording and factory/capacity-named codes on store responses → rename now, as part of A2.
2. `agents.lead_existing_factory` → replace with one neutral refusal (done in A2).
3. Contact reference → keep `CS-YYMM-NNNNN`; store the topic as a separate field (done in A2).
4. Unused `trust.*` setting rows in UAT → leave them. **Follow-up for business Phase 4:** remove them.

---

## A2 — account · Phase 0 (+ A1 answers 1–3) — PASS

Commits (made and pushed by the subagent): `d8a10792` fix(store): one customer order status, overdue re-quote,
artwork owner (D-436..D-439) · `cb91413e` merge of `origin/fix/uat-phase0` (brought in `DECISIONS-STAGE-A.md`) ·
`3aa9365d` fix(store)!: customer words only on store responses; neutral agent refusal; ticket topic (D-440) ·
`f2f00666` test(e2e): store status words are the customer's (D-440).

Gate: lint ✔ · typecheck ✔ · unit 168 suites / 1229 tests ✔ · contract test 8/8 ✔ · diff scan clean ✔ ·
`prisma migrate status`: 125 migrations, up to date.

### What changed
- **One customer status** (D-436): every order carries `customerStatus` (Thai/English label) and `actionOwner`,
  derived server-side from payment, artwork, production, shipping, receipt and open claims. Delivered + open claim
  reads "ได้รับแล้ว · เคลมกำลังตรวจ": open claims listed, no auto-complete date, no "ยืนยันรับของ", no "หมดเวลาแจ้งเคลม".
  Unit test per transition.
- **Overdue payment: re-quote, never auto-cancel** (GLOBAL-RULES §6): job `orders.expire_unpaid` removed; overdue
  groups flagged (`paymentOverdue`, `payment.overdue`, `overdue` on the overview pay item); paying an overdue group →
  `409 order.requote_required`. New `POST /v1/store/order-groups/{id}/actions/requote` (reprices through the pricing
  service at today's price/lead time, shows the difference) and `.../actions/confirm-requote` (`Idempotency-Key` +
  expected total; sets a new deadline). No long-stop/archive rule (default off).
- **Artwork status split** (GLOBAL-RULES §6): `awaiting_template` = "รอทีมส่งแบบไดคัทให้" (team),
  `awaiting_upload` = "รอไฟล์จากคุณ" (customer); `artworkOwner` on orders; "ส่งไฟล์งาน" only while the customer owns
  the step. Migration `20261214000001_account_artwork_owner_split` (with `down.sql`; deploy → down → up tested).
- **Display data**: order `payment` has this order's share and the group total; unpaid orders
  `deliveryDateBasis = after_payment`; tier progress `spendBasisTh` + `spendNotYetCounted`; overview designs carry
  `thumbnailUrl`; production step "โรงงานรับงานแล้ว" → "รับงานเข้าผลิตแล้ว" (also in recorded timeline entries).
- Item 6 (error state): no API change — errors already carry `requestId` and `Retry-After`. Item 7: web only.
- **Customer words only on store responses** (D-440, A1 answer 1): an interceptor rewrites every `/v1/store/*`
  response — `*LabelAdminTh` fields carry customer words; `ClaimStatus.factory_review` → `under_review`,
  `ClaimOwner.factory` → `getpack`, `CallOffStatus.pending_factory` → `pending_confirmation`,
  `QuotePathReason.no_active_factory` and `QuoteNoPriceReason.capacity_unavailable` → `not_instant`;
  `ClaimAction.factory_deduction` never reaches customers. New store-only enums `StoreClaimStatus`,
  `StoreClaimOwner`, `StoreClaimAction`, `StoreCallOffStatus`, `StoreQuotePathReason`, `StoreQuoteNoPriceReason`.
  `/v1/store/status-labels` gives customer words only; staff use new `GET /v1/admin/status-labels`
  (`admin.statusLabels.list`). Contract test extended to enum values, store examples and error codes.
- **Agents** (A1 answer 2): `agents.lead_existing_factory` → `409 agents.lead_unavailable` (no reason given).
- **Contact reference** (A1 answer 3): `CS-YYMM-NNNNN` kept; topic already had its own column, now returned as
  `SupportTicketDto.topic` (no migration). Noted in `docs/design/business-redesign/API-CHANGES.md` §8.
- Breaking for the web: regenerate the API client.

API-CHANGES: `docs/design/account-redesign/API-CHANGES.md` (§9 lists every renamed code and label) ·
decisions D-436–D-440 in `docs/decisions.md`.

### Tests to run locally (Docker)
`pnpm test:e2e` (full; the subagent ran it once against a local PostgreSQL 16 database: all suites passed on a fresh
database) and `pnpm test:int`, both on PostgreSQL 18.

### Open questions
1. Own-file customers cannot upload until the team sends a dieline (drawing engine off or `templateAvailability =
   none` leaves the order on "รอทีมส่งแบบไดคัทให้"). Allow a customer with a print-ready file to upload straight away?
2. Hired design also reads "รอทีมส่งแบบไดคัทให้" — the owner is right, the words are not. Add a status value?
3. Orders with discounts, points or coupons get `order.requote_unavailable` (the team re-quotes). Accept, or carry
   discounts over?
4. No overdue notice replaces the old "order cancelled" e-mail. Add a one-time "เลยกำหนดชำระ — ตรวจราคาใหม่และชำระ"?
5. Confirm-receipt with an open claim is hidden but still accepted by the endpoint. Refuse it server-side too?
6. Tier wording: the API states the real rule ("completed orders"), not the pack's "นับยอดเมื่อได้รับของแล้ว". Confirm.

---

## A3 — pdp · Phase 0 (price reconciliation) — PASS

Commit (made and pushed by the subagent): `053a86a9` fix(pricing): one store pricing path, default spec and spec
label (D-441). Under autorun the "stop for approval, then implement" line was replaced by the gate, so the plan in
`PRICE-CONSISTENCY.md` was implemented.

Gate: lint ✔ · typecheck ✔ · unit 170 suites / 1237 tests ✔ · contract test 8/8 ✔ · diff scan clean ✔ ·
no calculator, formula or golden-test file changed.

### Findings (reproduced on a local copy of the UAT seed)
- Issues 1 and 6: one calculator, but two definitions of "default spec". The listing price was cached from the
  admin's reference configuration (size 00, KA125 B, CMYK, 300 pcs → ฿15.70 locally) by calling the engine directly
  (skipping store validation, taking the cheapest quantity); the configurator opened on the options flagged default
  (ดำ). ดำ also prices ฿15.70 locally, so the spec gap alone does not explain UAT's ฿17.26 (see open question 1).
  ฿14.79 in the Studio = 150 × 100 × 80, KA125 B, **unprinted**, 300 pcs: same calculator, different spec, and the
  response never said which spec.
- Issue 2 (flat 100/300/500, lower at 1,000): intended — digital print is cheapest up to 1,000 with a flat per-piece
  cost; the drop is the sell-margin band (1–999 at 35 %, 1,000+ at 25 %); flexo wins from 2,000.
- Issue 3: description is admin catalogue text — not changed.
- Issue 4: API spec lines wrote width first — fixed to ยาว × กว้าง × สูง.
- Issue 5: per-style, per-size dieline download already exists (`store.dielines.download`).

### What changed (additive for the web; no migration; no env vars)
- `StorePricingService`: one store pricing path for configurator calculate, homepage hero preview, Studio dock and
  the starting-price refresh. Starting price = the configurator's own price for its default spec at the reference
  quantity.
- Configurator read returns `defaultSpec` (the admin's reference configuration); option defaults, default size and
  quantity follow it; the product page marks options the same way. **D-441 (assumption):** where a reference
  configuration exists it overrides the admins' per-option default flags.
- Every store calculation returns spec lines plus one label string (sizes ยาว × กว้าง × สูง, "ไม่พิมพ์" when nothing
  prints); the same label on card, price-hint and style starting prices. Saved quotes keep their wording.
- Starting prices are also recomputed when a sell-margin table or VAT rate is approved.
- Configurator patterns list their published dieline variants; suggested web link `/templates?product=<slug>&size=<code>`.
- UAT seed (fake data): reference configurations follow each product's first options; products without an ink
  option are unprinted. After a re-seed the postal box's starting price is for ดำ.
- Tests: new e2e `price-consistency` (configurator price for the default spec = hint = card = product page, same
  label, for every instant product); Studio quote e2e checks its label; unit tests for label and default-spec
  helpers; size-order expectations updated in four e2e suites.

API-CHANGES: `docs/design/pdp-redesign/API-CHANGES.md` · findings/plan: `docs/design/pdp-redesign/PRICE-CONSISTENCY.md`

### Tests to run locally (Docker)
`pnpm test:e2e`, at least: price-consistency, price-hints, line-summary, spec-model, studio-quotes, rfqs,
storefront-cards, style-library, corrugate-quotes, folding-quotes (and checkout, which needs superuser rights the VM
role lacked). Then `pnpm test:int`.

### Open questions
1. Why ฿17.26 on UAT? UAT is ~9.9 % higher on every tier than a fresh seed, which looks like a stale cached starting
   price. Read-only check on UAT: `select computed_at, unit_price from catalog_price_hints h join catalog_products p
   on p.id = h.catalog_product_id where p.slug = 'uat-postal-box-b'`, and confirm the worker's hourly
   `pricing.price_hints_refresh` runs; run the refresh once after deploying.
2. D-441 assumption: should the reference configuration override admins' per-option default flags? And should the
   postal box open on ดำ or CMYK (admins set it through the reference-configuration endpoint)?
3. Merge equal tiers in the tier table (e.g. one row "100–500 ชิ้น")? Web display choice.
4. Copy fixes, not applied: "โลโก้ 1–2 สี" description; white mailer box claims logo printing but has no ink option;
   seed size names written width × length (e.g. "9.75×14×6 ซม.").
5. When a style has several published dieline variants, which one does "ดาวน์โหลดแบบกล่อง" use?

---

## A4 — configurator · Phase 0 — PASS (report only, no API changes)

Commits (made and pushed by the subagent): `24bd074d` docs(configurator): A4 Phase 0 findings ·
`51b08b54` docs(configurator): A4 API-CHANGES — no API changes.

Gate: lint ✔ · typecheck ✔ · unit 170 suites / 1237 tests ✔ · contract test 8/8 ✔ · diff scan clean ✔ ·
docs only (FINDINGS.md, API-CHANGES.md, PROGRESS.md); `contract/openapi.json` unchanged.

### Findings (measured on a local API with the UAT rehearsal seed; fake data)
- **Item 2:** ฿17.26 (and ฿14.96 at 1,000) is exactly size 00 priced with **two inks (ดำ + CMYK)**. In the rehearsal
  data ดำ and CMYK cost the same (฿9.50/m²) for every size, so switching between them never changes the price; only
  the number of inks does. Not a minimum charge and not a pricing bug: the web most likely sends the ink choice as
  multi-select (confirm by logging the calculate request body). This replaces A3's "stale cache" guess. A3 check
  passes: listing and configurator default both give ฿15.70 with the same spec label; ฿14.79 is the Studio size
  (150 × 100 × 80), unprinted, through the same pricing service.
- **Item 3:** flat 100/300/500 for sizes 00 and 0 is intended (digital print flat per piece; margin band 35 % → 25 %
  at 1,000; flexo cheaper from 2,000; the ฿500 minimum lot does not apply at ≥ 100 pcs).
- **Item 5 (VAT ฿338.58 vs ฿338.75):** computed in the API and copied into saved quote, cart, order and tax invoice.
  VAT is taken from the exact price (฿5,175.44) before the per-piece price is rounded up (17.2515 → 17.26); the total
  is 17.26 × 300 = ฿5,178 and the extra ฿2.56 carries no VAT. Always low, ~฿0.02–฿1 per line; shipping not involved.
  **Related, larger:** the design fee's VAT is missing from `vatAmount` (a ฿2,000 fee leaves VAT ฿130.98 short:
  307.99 instead of 438.97). Proposed fix, not applied: compute VAT in `QuoteEngineService` from the amount actually
  charged (per line, half-up), calculators and golden tests untouched.
- **Item 6:** size F at 100/200/250 pcs is `instant: false, reason: not_priceable` (too big for the digital sheet,
  flexo needs ≥ 300). The calculate response already carries `instant`, `reason`, `calculationId`, dimensions and
  `specLabel` for the web to switch to "ขอใบเสนอราคา" with the spec prefilled — no API change.
- **Items 1 and 4:** web only.

API-CHANGES: `docs/design/configurator-redesign/API-CHANGES.md` ("No API changes", with reasons) ·
findings: `docs/design/configurator-redesign/FINDINGS.md`

Note: the subagent's Write tool refused report `.md` files, so it wrote these two files through Bash.

### Tests to run locally (Docker)
None specific to A4 (no code change).

### Open questions
1. Approve the VAT fix and its rounding rule (VAT from the charged amount, per line, half-up, design fee included)?
   Needs an accounting decision; it would be the only A4 API change.
2. Mark a print choice such as ดำ / CMYK as "choose one" in the API and refuse a second ink?
3. Return the smallest quantity that gets an instant price (e.g. 300 for size F)?
4. Price ดำ below CMYK in the UAT seed so the choice shows a difference?
