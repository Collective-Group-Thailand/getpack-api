# B3 — Commerce: cart, checkout, orders, payment schedules, payments, promotions, loyalty, B2B, discount memos

> อ่าน `CLAUDE.md`, `00-master-plan.md`, `docs/decisions.md` (D-010, D-020, D-050…D-053, D-060, D-061, D-120…D-136), `docs/accounting-design.md` §2 และ §5, `docs/schema-design.md` ก่อน · ต้องมี B2 (quotes) แล้ว
> ทำทีละ Deliverable (3.1 → 3.5) · ทุกเหตุการณ์ที่เกี่ยวกับเงินต้องส่ง event ให้ ledger (B5) — ห้ามลงบัญชีตรงจาก module นี้

---

You are a senior backend engineer on **`packio-api`**. The seller of record on every document is **Collective Group (Thailand)** (D-010, D-092).

## Deliverable 3.1 — Cart, checkout, orders, order groups
- `carts` / `cart_items`: each item is one configuration (instant quote snapshot or accepted RFQ snapshot), design reference, quantity, per-item delivery destination(s) and split quantities, per-item design option (own file / online designer / hired design / free design where offered), mockup add-on (D-072). Quote validity and price lock enforced (D-051); expired items re-priced with a diff the client must confirm.
- Checkout creates **one order group** (group code, customer or company, totals, payment schedule) and **one order per cart item** (legacy rule: one configuration per order). Server re-prices everything; delivery addresses (multi-destination), tax profile (individual / juristic / government; head office/branch; customer WHT flag — `accounting-design.md` §2), PO number (B2B, D-125), promotion codes, points redemption, discount memo reference.
- Order status machine inspired by legacy semantics (`waiting_payment → paid_for_production → artwork_approved → in_production → shipping → completed`, `cancelled` with reason) but **driven by facts**: instalments paid, artwork approved, jobs, shipments. Invalid transitions → `409 order.invalid_transition`. Every mutation: transaction + activity + event.
- Unpaid-order expiry: extract the legacy `expired_at` computation (`Api/OrderAPIController@storev2` and related) and record it in `docs/decisions.md` D-060; fallback 7 days; repeatable job every minute cancels expired unpaid orders/groups (D-060).
- CS create-order on behalf of a customer (find or create customer), change customer, edit & re-price (before production), cancel with reason (credit-note flow handled by B5), CS remarks, cc emails, UTM capture.
- Store endpoints for cart/checkout/orders/group view; admin endpoints for queues ("รอชำระ", "รอตรวจไฟล์", "รอเริ่มผลิต", "ใกล้ครบกำหนดส่ง", "ล่าช้า").

## Deliverable 3.2 — Payment schedules & payments (D-020, D-061)
- `payment_schedule_templates` (effective-dated rules: order value threshold **THB 20,000** → 100 % vs 50 % deposit + 50 % before shipping; any number of instalments with `due_trigger` (`at_checkout`, `before_production`, `before_shipping`, `on_delivery`, `days_after_delivery`), `required_before` flags; B2B credit term). Override with permission + reason. Group-level schedule allocated to child orders (allocation rule documented in an ADR).
- Gates: start production requires instalments flagged *before production*; shipping blocked while *before shipping* instalments are unpaid.
- Methods: SCB QR (PromptPay/QR30, QR cross-bank), 2C2P card & online banking (redirect + callback), bank transfer with slip upload → **slip-verification adapter** (receiver account, amount, date, duplicate transaction reference) → auto-accept or Finance queue with 4-business-hour SLA; payment fees per method from settings. R2: 2C2P IPP, SCB direct debit (adapters stubbed, disabled by flag).
- Webhooks `/webhooks/scb`, `/webhooks/2c2p/*`, `/webhooks/slip-verify` — signature-verified, idempotent on provider transaction id (never double-accept, never double-award points).
- Refund initiation (SCB/2C2P) with approval; unidentified receipts queue.
- Events: `payment.received`, `payment.verified`, `payment.failed`, `refund.*`, `instalment.due|overdue` (→ notifications D-143, ledger P01–P05, P22).

## Deliverable 3.3 — Promotions, campaigns, referral (D-053, D-136)
Implement the engine exactly as D-053 describes: types (single/bulk-unique/per-customer coupon codes, automatic promotions, campaigns with THB budgets and 80 % alert + auto-stop D-154, referral), conditions (window, channel, segment, product type/category/product, quantity tiers, order value, first order, payment method, zone, usage limits, combinability), benefits (%, fixed, tiered, free shipping, free design/revision rounds, free mockup, points multiplier, bonus points, per-piece override), stacking & priority (exclusive / stack / best-of), **margin guard** (never below the floor; cap and report the capped amount), abuse controls (rate limits, identity matching). Evaluation is a pure function over the cart snapshot; results are stored per line for accounting (P09) and analytics. Referral: codes/links, attribution, rewards per D-136 after the referee's first order passes the claim window, fraud rules, Marketing review queue.

## Deliverable 3.4 — Loyalty points & tiers (D-130…D-135)
Earn **1 point per THB 500** (before VAT, excluding shipping) × tier multiplier; point value **THB 2.50**; credited after completion + claim window; reversed on claims/refunds; expiry 12 months per earning with 30-day reminder; redemption min THB 10 equivalent, max 20 % of order value, margin guard; tiers by 12-month spend (Member ×1, Silver ≥ 50,000 ×1.25, Gold ≥ 200,000 ×1.5) recalculated nightly; activity rewards (sign-up, LINE linking, review) in baht value converted at the current point value. All numbers are settings. Ledger events for issue/redeem/expire (P10–P12).

## Deliverable 3.5 — B2B companies (D-120…D-125) & discount memos (D-052)
- Companies: KYC documents, review, members & company roles (Company Admin, Buyer, Approver, Accountant), branches & addresses (tax invoice per branch), shared brand assets/designs/addresses, PO number policy, **company approval threshold** (orders above → approver must approve before placement, D-123), company-level discount % via discount memo (D-124).
- Credit: prepaid by default; eligibility after 3 paid orders or financial review; credit limits ≤ 100,000 by Finance, above by C-Level (approvals engine); terms 15/30/45/60; available credit = limit − open AR; reminders 7 days before / on due date; > 7 days overdue blocks credit orders (D-122); monthly statements (D-125).
- **Discount memos**: CS discount ≤ 5 % without memo; above → memo (reason, customer, order value, requested %, resulting margin, evidence attachment) routed by the approval matrix (proposed tiers: > 5–10 % Director, > 10–15 % VP, > 15 % or below floor C-Level; tier values are settings); approval valid for the quote validity; applied discount recorded with memo id.

Quality: property tests for promotion stacking + margin guard; concurrency tests for coupon usage limits; e2e: cart with 2 items to 2 addresses, coupon + points, 50/50 schedule → deposit by QR → artwork approved → production gate opens; slip duplicate rejected; B2B order over company threshold waits for approver; credit order blocked when overdue.
