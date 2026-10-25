# account-redesign — API-CHANGES (A2: account Phase 0)

Repository `getpack-api`, branch `fix/uat-phase0`. Decisions **D-436** (overdue payment: re-quote, never
auto-cancel; supersedes D-060's cancellation job), **D-437** (one customer status), **D-438** (artwork step owner,
"รอแบบไดคัท" split), **D-439** (order share of the group, delivery-date basis, tier spend basis, launchpad thumbnail,
customer step word) and **D-440** (store responses in the customer's words only — added to A2 by the user's
decisions; see §9). Copy this file into `getpack-web/docs/design/account-redesign/` before the web session runs,
then `pnpm gen:api` against the new `contract/openapi.json`.

**Breaking for the storefront in §9** (enum values and component names renamed on `/v1/store/*`); §1–§8 are
**additive** except two behaviour changes the web must handle: (1) a customer payment on an overdue
group answers `409 order.requote_required`; (2) `order.upload_artwork` and `order.confirm_receipt` are offered in fewer
states (see §3). One data migration, no new env var, no new setting.

---

## 1. Added endpoints

| Operation | Method / path | Auth | Notes |
|---|---|---|---|
| `store.orders.requoteGroup` | `POST /v1/store/order-groups/{groupId}/actions/requote` | customer | "ตรวจราคาใหม่และชำระ" step 1: prices the overdue group at today's price. Nothing on the order changes. `200 RequotePreviewDto`. Errors: `404`, `409 order.requote_not_due` (not unpaid-and-overdue), `409 order.requote_unavailable` (the team must quote — RFQ / sample quotation, reorder, discounts or add-on charges, slip being verified, part-paid). |
| `store.orders.confirmRequote` | `POST /v1/store/order-groups/{groupId}/actions/confirm-requote` | customer, **`Idempotency-Key` required** | Step 2: writes the preview. Body `ConfirmRequoteDto`. `200 OrderGroupDto` (new totals, new `expiresAt`, `paymentOverdue: false`). Errors: `409 order.requote_changed` (total or quotation differs from the preview — call step 1 again), `409 order.requote_not_due`, `409 order.requote_unavailable`, `409 concurrency.stale`, `409 order.reprice_below_paid`, `422 validation.failed` (orders list must be every non-cancelled order of the group, once). |

Then pay with the existing `store.payments.initiate` (`POST /v1/store/order-groups/{groupId}/payments`).

### Flow for the web
1. Group/order shows `paymentOverdue: true` (or `order.payment.overdue`, launchpad `overdue`) → badge "เลยกำหนดชำระ",
   primary button "ตรวจราคาใหม่และชำระ" (never the old "เกินกำหนดระบบจะยกเลิกคำสั่งซื้อให้อัตโนมัติ" copy).
2. Button → `requoteGroup` → show previous / new total, `differenceAmount` per order and for the group, new ship and
   delivery dates, `priceValidUntil`, new `paymentDueAt`.
3. Customer accepts → `confirmRequote` with the preview's quote ids and `expectedGrossAmount = newGrossAmount`.
4. → existing payment panel (`store.payments.initiate`).
5. `order.requote_unavailable` → "ติดต่อทีมงาน" (LINE / messages); `order.requote_changed` → repeat step 2.

### Example — `POST /v1/store/order-groups/{groupId}/actions/requote` → `200`
```json
{
  "groupId": "0192f3a0-7c1e-7d2a-9b1f-0000000d0001",
  "groupCode": "OG-2610-00016",
  "previousGrossAmount": "9284.96",
  "newGrossAmount": "9457.10",
  "differenceAmount": "172.14",
  "newCashAmount": "9457.10",
  "priceValidUntil": "2026-11-09T10:00:00+07:00",
  "paymentDueAt": "2026-11-01T10:00:00+07:00",
  "orders": [
    {
      "orderId": "0192f3a0-7c1e-7d2a-9b1f-0000000d0002",
      "orderCode": "OR-2610-00016",
      "quoteId": "0192f3a0-7c1e-7d2a-9b1f-0000000ca101",
      "quoteOptionId": "0192f3a0-7c1e-7d2a-9b1f-0000000ca102",
      "quantity": 300,
      "previousGrossAmount": "4302.86",
      "newGrossAmount": "4388.92",
      "differenceAmount": "86.06",
      "newUnitPrice": "14.629733",
      "leadTimeDays": 5,
      "promisedShipDate": "2026-11-03",
      "estimatedDeliveryDate": "2026-11-05"
    }
  ]
}
```
(The amounts above are the contract example, not UAT data.)

### Example — `POST …/actions/confirm-requote` (header `Idempotency-Key: <uuid>`)
```json
{
  "orders": [
    { "orderId": "0192f3a0-7c1e-7d2a-9b1f-0000000d0002", "quoteId": "0192f3a0-7c1e-7d2a-9b1f-0000000ca101", "quoteOptionId": "0192f3a0-7c1e-7d2a-9b1f-0000000ca102" }
  ],
  "expectedGrossAmount": "9457.10"
}
```
→ `200 OrderGroupDto` with the new totals and `expiresAt`. A replay with the same key returns the same body.

## 2. Changed responses (additive fields)

### `OrderDto` — every order in `store.orders.get`, `getByCode`, `listGroups`, `getGroup`, `cancelGroup`, checkout `place` (and the admin views, which extend it)

| Field | Type | Meaning |
|---|---|---|
| `customerStatus` | enum `CustomerOrderStatus`: `awaiting_payment` · `awaiting_artwork` · `awaiting_approval` · `in_production` · `shipping` · `received` · `claim_in_review` · `completed` · `cancelled` | **The** status to show the customer everywhere (overview, list, detail, e-mail/LINE links). Do not derive it from `status` / `artworkStatus` in the web. |
| `customerStatusLabelTh` / `customerStatusLabelAdminTh` | string | รอชำระเงิน · รอไฟล์งาน · รออนุมัติแบบ · กำลังผลิต · กำลังจัดส่ง · ได้รับแล้ว · **ได้รับแล้ว · เคลมกำลังตรวจ** · เสร็จสิ้น · ยกเลิก (also in `store.statusLabels.list` under `CustomerOrderStatus`, with English). |
| `actionOwner` | `team` \| `customer` \| null | Who acts next — for the "ต้องทำ" tab / badges. |
| `artworkOwner` | `team` \| `customer` \| null | Owner of the artwork step (D-438). `team` → show what happens next, **no upload button**; `customer` → show "ส่งไฟล์งาน". |
| `deliveryDateBasis` | `after_payment` \| `planned` | `after_payment` (unpaid): show **"คำนวณหลังชำระเงิน"** instead of `promisedShipDate` / `estimatedDeliveryDate` (they are the plan made at placement and may be in the past). |
| `payment` | `OrderPaymentShareDto` | `groupId`, `groupCode`, `groupOrderCount`, **`orderGrossAmount` / `orderCashAmount` (this order's share)**, **`groupGrossAmount` / `groupCashAmount` (whole group)**, `dueAt` (deadline while unpaid), `overdue`. Show "ยอดของคำสั่งซื้อนี้" and "ยอดชำระรวมทั้งกลุ่ม" separately. |
| `openClaims[]` | `{ id, claimNo, status, statusLabelTh, statusLabelAdminTh }` | Claims not final yet, oldest first. Drive the claim card and replace "หมดเวลาแจ้งเคลม" with the open claim. |
| `receipt.completionHeldByClaim` | boolean | Delivered, not completed, claim open: completion waits; `receipt.autoCompleteAt` is now **null** in that case (no "auto-confirm 19 ต.ค." date). |

Status mapping (first match wins; `src/modules/orders/customer-status.ts`):
cancelled → `cancelled` · delivered + open claim → `claim_in_review` (also after completion) · completed → `completed` ·
delivered → `received` · shipped → `shipping` · production started → `in_production` · not paid → `awaiting_payment` ·
paid + artwork `approved` → `in_production` · `proof_sent` / `uploaded` / `in_review` → `awaiting_approval` ·
otherwise → `awaiting_artwork`.

UATOR-2610-00008 (delivered, claim UATCL-2610-0001 under review, window passed) now reads
`customerStatus: claim_in_review` "ได้รับแล้ว · เคลมกำลังตรวจ", `openClaims: [{ claimNo: "UATCL-2610-0001", … }]`,
`receipt.completionHeldByClaim: true`, `receipt.autoCompleteAt: null`, `nextActions: [order.reorder]` (no
"ยืนยันรับของ", no "หมดเวลาแจ้งเคลม").

### Example — `GET /v1/store/orders/{orderId}` (unpaid, overdue, own-file) → `200` (new fields only)
```json
{
  "status": "waiting_payment",
  "customerStatus": "awaiting_payment",
  "customerStatusLabelTh": "รอชำระเงิน",
  "customerStatusLabelAdminTh": "รอชำระเงิน",
  "actionOwner": "customer",
  "artworkStatus": "awaiting_template",
  "artworkStatusLabelTh": "รอทีมส่งแบบไดคัทให้",
  "artworkOwner": "team",
  "promisedShipDate": "2026-10-20",
  "estimatedDeliveryDate": "2026-10-22",
  "deliveryDateBasis": "after_payment",
  "payment": {
    "groupId": "0192f3a0-7c1e-7d2a-9b1f-0000000d0001",
    "groupCode": "OG-2610-00016",
    "groupOrderCount": 2,
    "orderGrossAmount": "4302.86",
    "orderCashAmount": "4302.86",
    "groupGrossAmount": "9284.96",
    "groupCashAmount": "9284.96",
    "dueAt": "2026-10-22T11:47:00+07:00",
    "overdue": true
  },
  "openClaims": [],
  "receipt": { "deliveredAt": null, "completionHeldByClaim": false, "autoCompleteAt": null, "claimWindowEndsAt": null, "completedAt": null, "completionMode": null, "confirmedAt": null },
  "nextActions": []
}
```

### `OrderGroupDto`
| Field | Change |
|---|---|
| `paymentOverdue` (new) | `true` while `waiting_payment` and past `expiresAt` (D-436). |
| `expiresAt` | Same value; meaning is now **payment deadline** — the group is never cancelled when it passes. |

### `ArtworkStatus` words (enum values unchanged)
| Value | `labelTh` before → after | `en` | Owner |
|---|---|---|---|
| `awaiting_template` | รอแบบไดคัท → **รอทีมส่งแบบไดคัทให้** | Awaiting the dieline from our team | team |
| `awaiting_upload` | รอไฟล์งาน → **รอไฟล์จากคุณ** | Awaiting your file | customer |

Next-step copy suggestion for the web: team → "ทีมงานจะส่งแบบไดคัทให้ ได้รับแล้วจะแจ้งให้วางงานและส่งไฟล์"; customer →
"ดาวน์โหลดแบบไดคัท วางงาน แล้วอัปโหลด" (dielines: `store.artwork.listTemplates`).

### `LaunchpadDto` (`store.me.getLaunchpad`, `GET /v1/store/me/launchpad`)
| Field | Change |
|---|---|
| `designs[].thumbnailUrl` (new) | Signed URL (5 min) ready for `<img>`; null → product placeholder. Fixes the broken overview thumbnail (the web no longer resolves `thumbnailFileId` itself). |
| `needsAction[].overdue` (new) | `pay` item past its deadline → "เลยกำหนดชำระ" + "ตรวจราคาใหม่และชำระ". |
| `needsAction` | Uses the same action rules as §3 (no `upload_artwork` while the team owns the step; no `confirm_receipt` while a claim is open). |

### `LoyaltySummaryDto` (`store.loyalty.get`, `GET /v1/store/loyalty`)
| Field | Meaning |
|---|---|
| `spendBasisTh` (new) | "นับยอดเมื่อคำสั่งซื้อเสร็จสิ้นหลังได้รับของ · ยอดก่อน VAT ไม่รวมค่าส่ง · ย้อนหลัง 12 เดือน · อัปเดตวันละครั้ง" — show under the tier progress. |
| `spendBasisEn` (new) | English of the same. |
| `spendNotYetCounted` (new) | Paid orders not completed yet (same basis) — e.g. "อีก ฿37,372.73 จะนับเมื่อคำสั่งซื้อเสร็จสิ้น". Explains `spend12m: 0.00` while 00008 waits for its claim. |

### `StoreInstalmentDto` / `PaymentScheduleDto` — unchanged
Per-instalment order amounts stay staff-only (ADR-0008 `allocations`); the order page uses `OrderDto.payment`.

### Production step word (timeline, notifications)
`job_received` customer label "โรงงานรับงานแล้ว" → **"รับงานเข้าผลิตแล้ว"** (route data migrated; timeline rows recorded
earlier are rendered with the new words). Use "ขั้นตอนการผลิต" for the section title (web).

## 3. Changed behaviour

| What | Before → after |
|---|---|
| Job `orders.expire_unpaid` | Cancelled unpaid groups every minute past `expiresAt` → **removed**. Nothing cancels a group for being unpaid. Notification `order_group.expired` is no longer emitted. |
| `store.payments.initiate` on an overdue group | Allowed → **`409 order.requote_required`** (customer only; CS can still take a payment). |
| `order.upload_artwork` (store `nextActions`) | Any pre-approval state of an own-file / online-design order → only when `artworkOwner = customer` (`awaiting_upload`, `changes_requested`, `proof_sent`). |
| `order.confirm_receipt` | Delivered & not completed → also **not while a claim is open**. |
| `order.open_claim` | Window passed → disabled `claims.window_closed` → **hidden** while a claim is open (the claim is shown instead); unchanged otherwise. |
| Checkout: initial `artworkStatus` | Always `awaiting_template` → `awaiting_upload` for `designOption = online_designer` (no dieline comes from the team). |
| Admin `admin.orderOperations.reprice` | Unchanged behaviour (refactored into plan/apply so the re-quote reuses it); `order.repriced` payload gains `source` (`staff` / `customer_requote`). |
| Activity / events | New `order_group.requoted` (customer-visible: "ตรวจราคาใหม่แล้ว พร้อมชำระเงิน"). |

## 4. Error codes (new)

| Code | HTTP | th title |
|---|---|---|
| `order.requote_required` | 409 | เลยกำหนดชำระ ตรวจราคาใหม่ก่อนชำระ |
| `order.requote_not_due` | 409 | ยังไม่ต้องตรวจราคาใหม่ |
| `order.requote_unavailable` | 409 | ตรวจราคาใหม่เองไม่ได้ |
| `order.requote_changed` | 409 | ราคาเปลี่ยนแล้ว |

Transient errors (task item 6, web side): every problem response already carries `requestId` (show it as the reference
code) and `503 provider.unavailable` sends `Retry-After`; treat `429`, `502`, `503`, `504` and network failures as
"ระบบขัดข้องชั่วคราว" with automatic retry. No API change needed for this item.

## 5. Migration

`prisma/migrations/20261214000001_account_artwork_owner_split/migration.sql` (data only, no schema change):
1. Orders in `awaiting_template`, not cancelled, that are `online_designer` **or** already have a `dieline_deliveries`
   row → `awaiting_upload` ("รอไฟล์จากคุณ").
2. `milestone_route_steps.customer_label_th` "โรงงานรับงานแล้ว" → "รับงานเข้าผลิตแล้ว" for `job_received`, every route
   version (the decided-version guard trigger is disabled for that statement only, as the D-425 rebrand did).

Reversible: `down.sql` in the same folder (apply with `psql`, then remove the row from `_prisma_migrations`). Verified
locally: deploy → down → up on the dev database (26 route steps each way).

## 6. Env vars / settings
None added. `orders.unpaid_expiry_days` (7) is now the payment deadline used for the new deadline after a re-quote.
`quotes.validity_days` gives `priceValidUntil`.

## 7. Factory confidentiality
No new field carries a factory id, name, location or count. `OrderDto.payment`, `openClaims`, the re-quote DTOs and
the launchpad fields were checked against `test/unit/storefront-factory-confidentiality.spec.ts` (green). The re-quote
picks the factory server-side and keeps it in `selectedFactoryId` (staff-only `internal`).

## 8. Findings and open questions (for approval)

1. **Own-file orders wait for the team's dieline.** With the drawing engine flag off, or a catalogue product with
   `templateAvailability = none` (the drawing job skips those silently), nobody sends a dieline automatically, so an
   own-file order stays "รอทีมส่งแบบไดคัทให้" until Prepress sends one (`admin.artwork.sendTemplate`). Under D-438 the
   customer has no upload button meanwhile. Should an own-file customer who already has a print-ready file be able to
   upload straight away (start at "รอไฟล์จากคุณ")? Conservative choice kept: the team acts.
2. **Hired design** (`hired_design`) also starts at `awaiting_template`, whose word is now "รอทีมส่งแบบไดคัทให้" — the
   owner (team) is right but the words fit a designer's work poorly. A dedicated word ("ทีมงานกำลังออกแบบ") would need a
   new enum value; not done.
3. **Re-quote with discounts / points / coupons** is refused online (`order.requote_unavailable`) because the CS
   re-price refuses discounted orders; the team re-quotes those. Accept, or build discount carry-over?
4. **Long-stop** (archive an overdue group after N days): not built, default off, as the pack says "only if the business
   asks". Overdue groups keep reserved promotions and points until someone cancels them.
5. **No overdue notification.** The `order_group.expired` e-mail is no longer sent; nothing tells the customer the
   deadline passed. Add a one-time `order_group.payment_overdue` notice ("เลยกำหนดชำระ — ตรวจราคาใหม่และชำระ")?
6. **Confirm receipt while a claim is open** is hidden in `nextActions` but the endpoint still accepts it (claim rules
   unchanged, hard rule 3). Refuse it server-side too?
7. **Tier basis wording.** The pack suggests "นับยอดเมื่อได้รับของแล้ว"; the real rule is "completed orders" (after
   receipt confirmation or `orders.auto_complete_days`, held by open claims). The API states the real rule.
8. **Not verified end-to-end here.** `pnpm test:e2e` / `test:int` need Docker (not available in this VM). The edited
   e2e specs (`orders`, `payments`, `launchpad`, `production-milestones`) must run locally/CI.

---

## 9. Storefront words: renamed codes and labels (D-440, added to A2 by the user)

One server-side rule for **every `/v1/store/*` response** (`StoreWordsInterceptor`, `src/common/labels/store-words.ts`);
admin and partner responses are unchanged. The contract's store examples are generated in the same words.

### 9.1 Status words

| Where | Before | After |
|---|---|---|
| Every `<field>LabelAdminTh` on a store response (`statusLabelAdminTh`, `artworkStatusLabelAdminTh`, `customerStatusLabelAdminTh`, …) | staff / factory words | **the customer words — always equal to `<field>LabelTh`**. Render `…LabelTh`; treat `…LabelAdminTh` as deprecated on the store. |
| `store.statusLabels.list` (`GET /v1/store/status-labels`) | `labelAdminTh` = staff words; every enum value | `labelAdminTh` = `labelTh`; staff-only values left out (`ClaimStatus.factory_review`); new enum `CustomerOrderStatus` listed |
| New `admin.statusLabels.list` (`GET /v1/admin/status-labels`, staff token) | — | the full dictionary with staff words (for the admin zone, which used the store one) |

Staff words that no longer reach a customer: ProductionJobStatus `released` "รอโรงงานรับงาน", `accepted` "โรงงานรับงานแล้ว",
`rejected` "โรงงานปฏิเสธงาน"; ShipmentStatus `picked_up` "ออกจากโรงงานแล้ว"; ClaimStatus `factory_review` "รอโรงงานตรวจสอบ"
/ "Factory review"; ArtworkStatus `awaiting_template` "รอทีมส่งแบบไดคัทให้ลูกค้า"; and every "Proof" word (customers read
"แบบตัวอย่าง"). Customer step word for `job_received`: "รับงานเข้าผลิตแล้ว" (§2).

### 9.2 Enum values (store aliases) and component names

| Staff enum (admin / partner, unchanged) | Value | Store value | Store component | Store operations |
|---|---|---|---|---|
| `ClaimStatus` | `factory_review` | **`under_review`** | `StoreClaimStatus` | `store.claims.list/get/submit/respondInfo/getTimeline`, `OrderDto.openClaims[].status` |
| `ClaimOwner` | `factory` | **`getpack`** | `StoreClaimOwner` (`getpack`, `customer`, `none`) | `StoreClaimSlaDto.currentOwner` (claims, claim timeline) |
| `ClaimAction` | `factory_deduction`, `carrier_recovery` | never sent (already filtered) | `StoreClaimAction` | `StoreClaimResolutionDto.action` |
| `CallOffStatus` | `pending_factory` | **`pending_confirmation`** | `StoreCallOffStatus` | `store.callOffs.*` |
| `QuotePathReason` | `no_active_factory` | **`not_instant`** | `StoreQuotePathReason` | `store.catalog.resolveQuotePath` |
| `QuoteNoPriceReason` | `capacity_unavailable` | **`not_instant`** | `StoreQuoteNoPriceReason` | `store.quotes.calculate`, `store.studio.quote` (`steps[].reason`) |

New store DTO components: `StoreClaimSlaDto`, `StoreClaimResolutionDto` (the staff `ClaimSlaDto` / `ClaimResolutionDto`
extend them). Web: regenerate the client; map `not_instant` to "ขอใบเสนอราคา" copy, `pending_confirmation` to "รอยืนยัน".
No database change (values are mapped at the store boundary; stored data and staff APIs keep their values).

### 9.3 Agents (`store.agent.registerLead`)

| Before | After |
|---|---|
| `409 agents.lead_existing_factory` "เป็นโรงงานในระบบแล้ว — โรงงานนี้อยู่ในระบบ getpack แล้ว" | **`409 agents.lead_unavailable`** "ลงทะเบียนผู้มุ่งหวังรายนี้ไม่ได้ — ลงทะเบียนผู้มุ่งหวังรายนี้ไม่ได้ หากมีข้อสงสัยกรุณาติดต่อทีมงาน getpack" (no reason given) |

`agents.lead_existing_customer`, `agents.lead_taken`, `agents.lead_duplicate` are unchanged.

### 9.4 Contact reference
Unchanged `CS-YYMM-NNNNN`; the topic is the ticket's own field (already stored), now also returned as
`SupportTicketDto.topic` on `store.support.contact` / `handoff` — see `docs/design/business-redesign/API-CHANGES.md` §8.

### 9.5 Guard
`test/unit/storefront-factory-confidentiality.spec.ts` now also fails on: a factory- or capacity-named enum value
reachable from a store success response (except the agent programme's `AgentLeadKind` / `AgentCommissionKind`), a
"factory" / "capacity" / "โรงงาน" string in a store success example, and a store problem code naming either.
