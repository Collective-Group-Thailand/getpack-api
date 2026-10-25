# getpack — Account & Orders (/account, /account/orders, /account/orders/[id]) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/account-redesign/`
   - `PROMPT-account-orders.md` (ไฟล์นี้)
   - `account-orders-prototype.html`: ต้นแบบ คลิกการ์ดคำสั่งซื้อเพื่อดูรายละเอียด แล้วกด "ดูสิ่งที่เปลี่ยน"
2. ลำดับ: **Phase 0 → 1 → 2 → 3 → 3b → 4** คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง และหยุดรออนุมัติทุก Phase
3. Phase 0 เป็นบั๊กสถานะที่ลูกค้าเห็นผิด ควรทำก่อนงานออกแบบ

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`. Customer zone /account/*.

Current account navigation (19 items in 3 groups): ภาพรวม · คำสั่งซื้อ (คำสั่งซื้อ, งวดชำระ, เอกสารและใบกำกับภาษี,
ใบเสนอราคา, คำขอใบเสนอราคา, ข้อความ) · งานของฉัน (งานออกแบบ, ตัวอย่างสินค้า, คำขอออกแบบโครงสร้าง, สั่งซ้ำตามรอบ,
สัญญาเรียกของ) · บัญชี (ที่อยู่และใบกำกับภาษี, คะแนนสะสม, เครดิตร้านค้า, ชวนเพื่อน, ตัวแทนขาย, การแจ้งเตือน, ความเป็นส่วนตัว).

Observed in UAT (customer มาลี ทดสอบ):
- /account/orders is a table (สินค้า, สั่งเมื่อ, สถานะ, กำหนดส่ง, ยอดรวม, การดำเนินการ) that overflows at ~1050 px
  (action buttons cut); tabs กำลังดำเนินการ / เสร็จสิ้น / ยกเลิก; no search or filters.
- UATOR-2610-00016 (300 ชิ้น ฿4,302.86, สั่ง 15 ต.ค. 11:47, รอชำระเงิน, ไฟล์ "รอแบบไดคัท", กำหนดส่ง 20 ต.ค.) and
  UATOR-2610-00017 (300 ชิ้น ฿4,982.10, รอชำระ, "อัปโหลดไฟล์แล้ว", กำหนดส่ง 21 ต.ค.) share group payment
  UATOG-2610-00016 ฿9,284.96 "ภายใน 22 ต.ค. 2569 11:47 — เกินกำหนดระบบจะยกเลิกคำสั่งซื้อให้อัตโนมัติ". On 25 ต.ค. both
  are still "รอชำระเงิน" (auto-cancel did not run) and show past delivery dates. The order page shows the group amount
  as "ยอดงวด…ส่วนของคำสั่งซื้อนี้".
- UATOR-2610-00008 (3,000 ชิ้น ฿39,988.82, group UATOG-2610-00008): deposit 50% ฿19,994.41 + balance before delivery
  ฿19,994.41 (paid); shipment UATSH-2610-00003 "รถขนส่งของ getpack" 30 กล่อง; received 2,940 of 3,000 (within ± 5%),
  credit ฿792.29 (credit note UATCN-2610-00001); tax invoices/receipts UATTR-2610-00010/11/12; claim UATCL-2610-0001
  "ทีมงานกำลังตรวจสอบ"; auto-confirm receipt 19 ต.ค.; spec document TH/EN. Yet the header and list say
  "กำลังจัดส่ง" with "ยืนยันรับของ" and "หมดเวลาแจ้งเคลม".
- The order page has a section titled "ขั้นตอนที่โรงงาน" (โรงงานรับงานแล้ว, กำลังพิมพ์, กำลังขึ้นรูป, ตรวจคุณภาพ, พร้อมจัดส่ง)
  and copy "ชำระแล้วโรงงานจึงเริ่มผลิต".
- During an API outage the order page showed "เกิดข้อผิดพลาด" with code PK-200002 only.
- Overview: next step card, broken design thumbnail, tier "ยอดซื้อ 12 เดือน ฿0.00" while a ฿39,988.82 order exists.

Business decisions that apply here:
- Overdue payment (decided): do NOT auto-cancel. Show "เลยกำหนดชำระ" and a "ตรวจราคาใหม่และชำระ" action that re-prices
  with today's price and delivery date before payment. Replace the copy "เกินกำหนดระบบจะยกเลิกคำสั่งซื้อให้อัตโนมัติ".
- Artwork status "รอแบบไดคัท" (decided): it can mean either side is waiting → split into two statuses with an owner:
  "รอทีมส่งแบบไดคัทให้" (team action; customer sees what happens next, no upload button) and "รอไฟล์จากคุณ"
  (customer action; download dieline → place artwork → upload).
- Factory confidentiality: customers must never see anything that identifies or describes the producing factory.
- Features agreed earlier (other packs): production evidence (photos + ΔE report), reorder reminder, smart QR stats,
  company approvals/budgets/catalogue for business accounts.

Reference: docs/design/account-redesign/account-orders-prototype.html.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/account-redesign`. Small commits. Never merge to main, never force-push.
2. One source of truth for order status: a single derived "customer status" computed server-side from payments,
   artwork, production, shipments, receipt and claims; every surface (overview, list, detail, e-mails, LINE) uses it.
3. Do not change payment, credit, claim or cancellation rules — only fix states that contradict them and the UI.
4. Factory confidentiality: rename "ขั้นตอนที่โรงงาน" → "ขั้นตอนการผลิต", remove factory wording from customer copy
   ("ชำระแล้วจึงเริ่มผลิต"), never expose factory ids/names/locations in pages, APIs, PDFs, photos or messages.
5. NEVER ship sample data. Fake in the prototype: production photos, QC report numbers, message text, QR stats,
   reorder reminder, claim window copy ("7 วัน" only where not configured).
6. No horizontal page scroll at 360 px; list is cards, not a wide table; dark mode; keyboard access (cards are
   focusable links), aria-live for filters; analytics.
</hard_rules>
```

---

## Phase 0 — Fix status and payment bugs (no redesign yet)

```text
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Order status: implement/repair the derived customer status (รอชำระเงิน · รอไฟล์งาน · รออนุมัติแบบ · กำลังผลิต ·
   กำลังจัดส่ง · ได้รับแล้ว · เคลมกำลังตรวจ · เสร็จสิ้น · ยกเลิก). UATOR-2610-00008 must read "ได้รับแล้ว · เคลมกำลังตรวจ",
   no "ยืนยันรับของ", and the claim-window message must reflect the open claim. Add tests for each transition.
2. Payment deadline (decided: re-quote, no auto-cancel): disable/remove the auto-cancel job for overdue payments,
   change the copy, and add "ตรวจราคาใหม่และชำระ" → server re-prices the group (pricing service, current lead time),
   shows the difference, then proceeds to payment. Keep an admin-configurable long-stop (e.g. archive after N days)
   only if the business asks; default off.
2b. Artwork status split (decided): migrate "รอแบบไดคัท" into "รอทีมส่งแบบไดคัทให้" (owner team) and "รอไฟล์จากคุณ"
   (owner customer); show the owner and next step everywhere; only customer-owned states show "ส่งไฟล์งาน".
3. Delivery date: for unpaid orders show "คำนวณหลังชำระเงิน" (or recompute live) instead of a past date.
4. Group payments: on an order page show this order's share and the group total separately.
5. Overview: tier progress must state what counts (e.g. "นับยอดเมื่อได้รับของแล้ว"); fix the broken design thumbnail.
6. Error state: transient API errors show "ระบบขัดข้องชั่วคราว" with automatic retry and the reference code.
7. Rename "ขั้นตอนที่โรงงาน" and remove factory wording (hard rule 4).
8. Stop for approval with FINDINGS.md.
</task>
```

---

## Phase 1 — Account navigation (19 → 9)

```text
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. New nav: ภาพรวม · ซื้อ: คำสั่งซื้อ (badge = items needing action), ใบเสนอราคา (tabs: ใบเสนอราคา | คำขอใบเสนอราคา),
   งานออกแบบ (tabs: งานออกแบบ | ตัวอย่างสินค้า | คำขอออกแบบโครงสร้าง), สั่งซ้ำ (tabs: สั่งซ้ำตามรอบ | สัญญาเรียกของ) ·
   เอกสารและบัญชี: เอกสาร (ใบกำกับภาษี ใบเสร็จ ใบลดหนี้ ใบส่งของ), ข้อความ, คะแนนและสิทธิพิเศษ (คะแนน | เครดิตร้านค้า |
   ชวนเพื่อน | ตัวแทนขาย), ข้อมูลบัญชี (ที่อยู่และใบกำกับภาษี | การแจ้งเตือน | ความเป็นส่วนตัว | ทีมและผู้อนุมัติ — only when the checkout pack
   Phase 2 approval feature exists) · ออกจากระบบ. The header avatar menu (styles pack Phase 3) uses these same labels.
   งวดชำระ moves into each order and the "ต้องทำ" list.
2. Keep every old URL working (redirect to the new page + tab). Header block with name and points.
3. Mobile: horizontal scrolling nav bar under the header.
</task>
```

---

## Phase 2 — Orders list

```text
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Header: "คำสั่งซื้อ", ส่งออก (Excel/CSV of the filtered list), สั่งซื้อใหม่.
2. "ต้องทำตอนนี้" cards (only those that apply): ชำระ (amount, deadline, overdue badge) · ส่งไฟล์งาน (count, file
   status explained in plain words using the split statuses from Phase 0 item 2b: "รอทีมส่งแบบไดคัทให้" → no upload
   button, show what happens next; "รอไฟล์จากคุณ" → upload button) · ยืนยันรับของ · เคลมกำลังตรวจ.
3. Status tabs with counts: กำลังดำเนินการ · ต้องทำ · กำลังผลิต · กำลังจัดส่ง · เสร็จสิ้น · ยกเลิก. Search by order no.,
   product name, PO number (debounced, URL-synced). Business accounts: filters for branch and requester.
4. Order card: thumbnail, product, order no., qty, ordered date, status pill, file status when relevant, due/ETA line,
   total, ONE primary action for the current step (+ secondary), 6-step tracker (ชำระเงิน → ไฟล์งาน → อนุมัติแบบ → ผลิต →
   จัดส่ง → รับของ) with overdue in red. Whole card opens the detail.
5. Group payments: orders sharing a payment group render inside one frame with "ชำระรวม ฿…" and the deadline.
6. Empty states per tab; skeleton loading; pagination or infinite scroll for > 20 orders.
7. Analytics: orders_tab{tab}, orders_search, orders_action{action,status}, orders_export.
</task>
```

---

## Phase 3 — Order detail

```text
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Header: status pill, product, order no., ordered date, qty, group; primary action(s) for the current state.
2. Timeline (6 steps) with timestamps, plain-language descriptions and evidence: production sub-steps (รับงาน → พิมพ์ →
   ขึ้นรูป → ตรวจคุณภาพ → พร้อมจัดส่ง) under "ผลิต"; QC photos (product only) with lightbox and the ΔE/size/quantity
   report when available; proof-of-delivery photo under "รับของ".
3. Shipment: shipment no., carrier label "รถขนส่งของ getpack", boxes, ETA or delivered time, recipient, POD,
   confirm-receipt, report-a-problem (only inside the configured window; show the deadline date).
4. Claim card (when a claim exists): number, status, received vs ordered, credit issued + credit note, add photos /
   details, results posted in the order messages and notified by e-mail/LINE.
5. Spec & design: thumbnail/3D link, spec document TH/EN (view + PDF), approved file download.
6. Payment: totals with VAT included, instalments (deposit/balance) with status and due dates, group share vs group
   total, pay button; overdue → "ตรวจราคาใหม่และชำระ" (decided rule, Phase 0 item 2: re-quote, never auto-cancel).
7. Documents: quotation, invoice, tax invoices/receipts, credit notes, delivery note — all issued by getpack.
8. Reorder: same spec + approved file, today's price; reorder-reminder toggle (flagged until the feature ships).
9. Smart-QR stats card only when the order has a getpack QR (flagged). Order messages thread (ticket per order).
10. Analytics: order_view{status}, order_photo_open, order_doc_download{type}, order_claim_add, order_reorder,
    order_message_send.
</task>
```

---

## Phase 3b — Self-service features (each behind a flag)

```text
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Edit order before production: quantity (MOQ 100, step 50), delivery address, tax-invoice details; editable until
   proof approval (configurable cut-off); live price difference from the pricing service; after the cut-off show
   "ขอเปลี่ยนกับทีม" (opens the order thread). Group payments re-total automatically.
2. Proof approval in the order: rounds (รอบที่ 1, 2…), customer file vs proof with die-line side by side, team pins with
   notes, customer "อนุมัติแบบนี้" / "ขอแก้ (ปักหมุด)" with pins and comments, history kept; production starts only
   after approval (and payment rule).
3. Self-cancel: unpaid → free cancel with reason; shows effect on the payment group. Paid but not started → refund or
   store credit per policy (show amounts before confirming). After production start → "ขอยกเลิกกับทีม".
4. Delivery window: customer picks preferred slots (เช้า / บ่าย / วันไหนก็ได้) before shipping; team confirms date after
   production; LINE reminder the day before; ETA on the delivery day (when the delivery team supports it).
5. LINE linking: connect LINE OA from the orders page/notification settings (official LINE Login + OA messaging, PDPA
   consent); messages deep-link to the order; per-event preferences.
6. Spending & documents: monthly spend chart (paid minus credit notes), export Excel; "ดาวน์โหลดทั้งเดือน (ZIP)" of
   tax invoices/receipts/credit notes; optional automatic monthly e-mail to an accounting address.
7. Share order read-only: signed link (15-day expiry, revocable), toggle to hide prices/financial documents, no
   edit/pay actions, no factory information.
8. Analytics: order_edit{field}, proof_action{approve|changes,round}, order_cancel{paid,reason}, delivery_slot_pick,
   line_link, docs_zip_download, order_share{prices}.
</task>
```

---

## Phase 4 — Overview (/account)

```text
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Reuse the "ต้องทำตอนนี้" cards and the latest 3 order cards from Phase 2.
2. Continue designing (drafts with working thumbnails), quick reorder of the last produced items, open quotes with
   price-lock expiry, points/credit/tier with a clear rule of what counts.
3. Business accounts: pending approvals, budget usage, company catalogue shortcut (from the business pack).
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| นโยบายคืนเงิน/เครดิตเมื่อยกเลิกหลังชำระแต่ก่อนผลิต | Phase 3b |
| จุดตัดการแก้ไขคำสั่งซื้อ (ก่อนอนุมัติแบบ หรือจุดอื่น) | Phase 3b |
| บัญชี LINE OA และสิทธิ์ส่งข้อความ | Phase 3b |
| ความพร้อมของทีมขนส่งในการนัดช่วงเวลาและแจ้งเวลาถึง | Phase 3b |
| ระยะเวลาแจ้งปัญหาหลังรับของ และการยืนยันรับอัตโนมัติ | การจัดส่งและเคลม |
| เกณฑ์ระดับสมาชิก (นับยอดเมื่อไร) | ภาพรวม |
| รูปงานและรายงานคุณภาพที่ทีมจะแนบในคำสั่งซื้อ (เฉพาะชิ้นงาน ไม่เห็นสถานที่ผลิต) | ไทม์ไลน์ |
