# getpack — Cart & Checkout Redesign · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอกไฟล์นี้และ `checkout-prototype.html` ไปไว้ที่ `getpack-web/docs/design/checkout-redesign/` แล้วเปิดต้นแบบในเบราว์เซอร์ (กด "ดูสิ่งที่เปลี่ยน")
2. รันหลัง Phase 0 ของหน้าสินค้าและหน้าปรับแต่ง (ราคาตรงกันทุกหน้า) เพราะตะกร้าใช้ราคาชุดเดียวกัน
3. ลำดับ: **Phase 0 → Phase 1 → Phase 2 → Phase 3** คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Pages in scope: `/cart` and the checkout flow after "ดำเนินการชำระเงิน".
Current cart (observed): per-item spec text, price lock date ("ราคาคงที่ถึง …"), unit price × qty, design option
(มีไฟล์งานแล้ว / …, "เปลี่ยนแล้วราคาจะคำนวณใหม่"), per-item shipping allocation across one or more addresses
(must total the item quantity), remove; summary with goods total (VAT incl.), note "ส่วนลด คะแนน และการแบ่งชำระ
คำนวณในขั้นชำระเงิน", discount codes (max 3, automatic promotions), blocker list, "ดำเนินการชำระเงิน".
Payment methods sitewide: โอนผ่านธนาคาร · พร้อมเพย์ QR · บัตรเครดิต/เดบิต · ผ่อนชำระ. Tax invoices are issued by
Collective Group (Thailand) under the getpack brand. Deposits/instalments are supported by the business model.

Reference: docs/design/checkout-redesign/checkout-prototype.html (cart + 4-step checkout) and the shared components/tokens of the other redesigns.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/checkout-redesign`. Small commits. Never merge to main, never force-push.
2. Do NOT change pricing, shipping, discount, points, tax or payment logic; only the flow and presentation. All
   numbers come from the existing services (the same ones the configurator uses).
3. NEVER ship sample data. Fake in the prototype: shipping amounts and zones, the 5% discount from any code,
   province autofill table, deposit/milestone payment terms.
4. Payments: never store card data in getpack; use the existing payment provider's hosted/tokenised fields.
5. PDPA: collect only what is needed; addresses saved to the account only with the customer's action; tax ID masked
   in UI after entry.
6. Accessibility (form labels, error messages linked to fields, focus to first error, step navigation), perf, analytics.
</hard_rules>
```

---

## Phase 0 — Discovery (no code)

```text
First read docs/design/checkout-redesign/PROMPT-checkout-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map the current cart and checkout routes, components, state, APIs (cart, addresses, shipping quote, discounts,
   points, tax invoice, payment provider, instalment, deposit), and every validation that blocks checkout.
2. Note inconsistencies: the cart spec says "ขนาด (กว้าง × ยาว × ลึก) 97.5 × 140 × 60 มม." while other pages use
   ยาว × กว้าง × สูง; shipping and VAT lines are missing from the cart summary.
3. Write docs/design/checkout-redesign/PLAN.md mapping the prototype's 4 steps to existing APIs; list gaps
   (e.g. postcode → province/district lookup, multi-item quote PDF, approver share link). Stop for approval.
</task>
```

---

## Phase 1 — Cart + 4-step checkout

```text
First read docs/design/checkout-redesign/PROMPT-checkout-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Stepper on all steps: ตะกร้า → ที่อยู่และการจัดส่ง → ใบกำกับภาษีและชำระเงิน → ทบทวนและยืนยัน
   (go back freely; forward only when the step is valid). Sticky summary on the right; mobile bottom bar.
2. Cart (step 1):
   - Item card: thumbnail, name, spec chips (size code, inside dims "ยาว × กว้าง × สูง", material, print outside/inside),
     price-lock badge, quantity stepper (step 50, min = MOQ), design option select, line total + unit price.
   - Tier hint from the pricing service: "สั่ง {next tier} ชิ้น ราคาต่อชิ้นเหลือ ฿x" + one-click change.
   - Links: แก้ไขสเปก (configurator with this item's spec), บันทึกไว้ทีหลัง (move to account), นำออก (with undo).
   - Shipping is NOT required here: show "ที่อยู่จัดส่งเลือกในขั้นถัดไป" + optional postcode for an estimate.
3. Address & shipping (step 2): saved addresses as selectable cards (if any) or a new-address form (name, phone,
   address, postcode → province/district autofill, note). Default single destination; toggle "แบ่งส่งหลายที่อยู่"
   reveals the per-destination allocation table with a live "รวม x จาก y ชิ้น" check (reuse the existing allocation
   logic). Shipping line + arrival estimate update live.
4. Tax invoice & payment (step 3): toggle "ขอใบกำกับภาษีเต็มรูปแบบ" (นิติบุคคล/บุคคลธรรมดา, name, 13-digit tax ID,
   branch, same-as-shipping address); payment method cards (4 existing methods); payment plan (full / deposit /
   milestone) only if the backend supports it for this order; points redemption if available.
5. Review (step 4): read-only summary with edit links, design next-step explanation, tolerances, terms checkbox
   linking /legal/terms and /guarantee; primary "ยืนยันคำสั่งซื้อและชำระเงิน" → existing order creation + payment.
6. Summary (all steps): goods (VAT incl.), discount codes (max 3, removable chips, automatic promotions listed),
   shipping (estimate before step 2), VAT amount included, total ("ยังไม่รวมค่าจัดส่ง" when unknown), blockers list,
   primary CTA, cart-only secondary actions "ใบเสนอราคา PDF" and "ส่งให้ผู้อนุมัติ" (reuse saved-quote/share link),
   trust lines (ready date, warranty/tolerance, payment methods).
7. Analytics: checkout_step_view{step}, checkout_qty_change, checkout_tier_hint_accept, checkout_save_for_later,
   checkout_split_toggle, checkout_tax_invoice_toggle, checkout_payment_select{method,plan}, checkout_code_apply{result},
   checkout_blocked{reason}, checkout_confirm.
</task>

<acceptance>
- A single-address order can go from cart to payment without touching the allocation UI.
- Totals in every step equal the backend order total at creation (test). Discount max 3 enforced server-side.
- All form errors are announced and focus moves to the first invalid field. Lint/typecheck/tests pass.
</acceptance>
```

---

## Phase 2 — Approval & purchase-order support (B2B)

```text
First read docs/design/checkout-redesign/PROMPT-checkout-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. "ส่งให้ผู้อนุมัติ": share a read-only cart/quote link with team approvers (reuse business-account roles);
   approver can approve → requester gets notified and can pay; or approver pays directly.
2. Multi-item quote PDF from the cart (same template as the configurator quote), price locked 15 days.
3. Optional PO number and cost-centre fields on the review step, printed on the tax invoice.
</task>
```

---

## Phase 3 — Recover carts and remove payment friction

```text
First read docs/design/checkout-redesign/PROMPT-checkout-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Each item behind its own feature flag.
1. Price-lock reminder (abandoned cart):
   - Cart toggle "เตือนฉันก่อนราคาหมดอายุ" (default off; channel LINE or email; unsubscribe anytime) shown under the
     "ราคาคงที่ถึง …" badge.
   - Scheduled job: N days (config, default 2) before the price-lock date, send one reminder with a signed link back to
     the same cart. Never send if the cart was ordered, emptied, or the customer opted out. Max one reminder per lock
     period. Respect PDPA consent and LINE OA messaging rules.
   - Analytics: cart_reminder_optin{channel}, cart_reminder_sent, cart_reminder_click, cart_reminder_order.
2. Automatic payment confirmation:
   - PromptPay QR and bank transfer confirmed automatically via the payment provider/bank (webhook), so the order moves
     to file check immediately; remove "แนบสลิป" when auto-confirm is active (keep slip upload as fallback only).
   - Show live status on the payment page ("รอการชำระเงิน → ได้รับเงินแล้ว") and notify the customer.
   - Write docs/design/checkout-redesign/PAYMENT-PROVIDERS.md comparing providers that support auto-confirmation
     (fees, settlement time, webhooks, refunds) for business decision before any integration. Stop after the doc.
3. Guest checkout check: report whether ordering without an account is possible today. If not, propose
   (do not build yet) guest checkout with "สร้างบัญชีจากคำสั่งซื้อนี้" after payment.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| เงื่อนไขมัดจำ / แบ่งชำระตามขั้นงาน (ใช้กับคำสั่งแบบไหน กี่เปอร์เซ็นต์) | ขั้นชำระเงิน |
| ฐานข้อมูลรหัสไปรษณีย์ → จังหวัด/อำเภอ | เติมที่อยู่อัตโนมัติ |
| การใช้คะแนนสะสม | สรุปและขั้นชำระเงิน |
| บทบาทผู้อนุมัติในบัญชีธุรกิจ | Phase 2 |
| จำนวนวันก่อนราคาหมดอายุที่จะเตือน และข้อความเตือน (LINE/อีเมล) | Phase 3 |
| เลือกผู้ให้บริการชำระเงินที่ยืนยันยอดอัตโนมัติ (พร้อมเพย์/โอน) | Phase 3 |
| เปิดให้สั่งโดยไม่ต้องสมัครสมาชิกหรือไม่ | Phase 3 |
