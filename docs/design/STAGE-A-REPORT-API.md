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
