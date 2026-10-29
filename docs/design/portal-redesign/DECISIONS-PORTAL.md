# Portal round — business decisions (หัวหน้าทีมธุรกิจ, 2026-10-28)

Decided by the head of the getpack business team on behalf of the product owner. Binding for
`PROMPT-portal-redesign.md`. Precedence: GLOBAL-RULES.md → DECISIONS-STAGE-A.md → this file → the prompt pack.
Items marked **needs sign-off** are business-decided but legally or financially sensitive. Implement them as config
with the value below, and keep them off production until the named person signs off.

---

## 1. Decided (implement as written)

| # | Topic | Decision | Phase |
|---|---|---|---|
| P-01 | Tax invoices for instalment orders (refined 2026-10-28 after the DB check) | One tax invoice/receipt per payment received. No full-amount "final" tax invoice. Duplicates already issued: accounting voids each one through the cancellation procedure and keeps a record. Code only reports them. If the accountant (S-02) wants to keep a final summary TR, it must carry VAT and WHT only on the remainder (0 when every instalment is taxed), reconcile net + VAT = gross, show amount due ฿0, and never be counted again in VAT or WHT reports; the customer sees it as "สรุปใบกำกับ (หักงวดก่อนแล้ว)". | 0, 5 |
| P-02 | Sales-agent commission | 5% on a new customer's first order and 3% on later orders for 12 months, both on goods before VAT, excluding shipping. **Cap ฿10,000 per order** (config `agent.maxCommissionPerOrderThb`). Paid on the 5th of each month once the order is complete, past the claim window and fully paid. Withholding tax per law; rate comes from config. No profit wording anywhere. | 0, 7 |
| P-03 | Factory referrals by agents | Removed from the agent programme. An agent who knows a factory uses the public `/partner-with-us` form. No reward and no status goes back to the agent. | 0, 7 |
| P-04 | Membership tiers (customer-facing) | สมาชิก ฿0 → x1.00 · ซิลเวอร์ ฿50,000 → x1.25 · โกลด์ ฿200,000 → x1.50 · แพลทินัม ฿1,000,000 → x2.00. Spend = goods before VAT, excluding shipping, rolling 12 months, counted when the order is complete. Points: ฿500 = 1 point × multiplier, 1 point = ฿2.50, valid 12 months. | 7 |
| P-05 | Message reply SLA | Team replies within **4 working hours**. Working hours are daily 09:00–18:00, the same as LINE. A message sent after 18:00 is due by 13:00 the next day. Customer copy: "ทีมตอบภายใน 4 ชั่วโมงในเวลาทำการ (ทุกวัน 09:00–18:00)". CS lead gets an alert when the SLA is breached. | 6, 9 |
| P-06 | RFQ waiting on the customer | Reminder after 2 working days, then after 5. The RFQ closes as "หมดอายุ" after 14 days with no reply, and the customer can request it again in one click. | 3, 6 |
| P-07 | RFQ response time | Instant-quote styles: none. RFQ: first answer or quote within 1 working day for standard types and 3 working days for custom structures. Use `rfq.sla_business_hours` where it is already set (decision 9.3). | 3 |
| P-08 | Quote list hygiene | Identical spec + quantity + price saved within 24 hours is kept once. Expired quotes stay visible for 90 days, then are archived. Ordered quotes always link to their order. | 3 |
| P-09 | Call-off agreements | Minimum per call-off = the product's MOQ (corrugated postal boxes: 500). Term runs from the team's confirmation. The team confirms within 1 working day. The price is locked for the term. Unused quantity at the end of the term expires with no charge. | 4 |
| P-10 | Structural design requests | First draft within 3 working days. 2 revision rounds included. A 3rd round or later goes back to a quote. A finished structure is added to the customer's own library. | 4 |
| P-11 | Samples | A sample is always quoted (quote path), never priced instantly. Sample status is shown in the portal. Approval or a change request comes with photos. | 4 |
| P-12 | Reorder reminder | On by default for customers with at least one completed order. Sent 10 days before the order-by date by LINE (if linked) and e-mail. The forecast uses order intervals once there are 2 or more orders; before that, the customer's own usage figure. | 4, 9 |
| P-13 | Documents to accounting | Optional accounting e-mail per buyer profile. Modes: every document, or a monthly ZIP on the 1st. Default off. | 5, 9 |
| P-14 | Billing statements and delivery notes | Both are listed in Documents. A delivery note is issued per shipment. A billing statement is available on request and monthly for credit accounts. | 5 |
| P-15 | Company workspace | Logged-in `/business/*` moves to `/account/company/*` with 308 redirects. Public `/business` stays the marketing page. Roles: ผู้ดูแลบริษัท, ผู้สั่งซื้อ, ผู้อนุมัติ, ฝ่ายบัญชี. Default approval threshold ฿10,000 incl. VAT. PO optional by default. Approval by LINE is on when the approver has LINE linked. | 8 |
| P-16 | Quote link for approvers | Read-only signed link, valid 15 days (same as the price lock), revocable. Prices are shown by default; the sender can hide them. The approver's name and e-mail are recorded. | 9 |
| P-17 | /track | As in the prompt context. The QR shows minimal status with no second factor. Order no. + phone/e-mail unlocks more detail. Lookup throttle: 5 per 10 min per IP and 10 per hour per order. | 1 |
| P-18 | Marketing consent | Every channel off by default. Sent only 09:00–20:00. LINE can be enabled only after LINE is linked. Asked again only when a document version changes. | 2 |
| P-19 | Quick replies (messages) | Order: "ตอนนี้งานถึงขั้นไหนแล้ว" · "ขอเลื่อนวันส่ง" · "ขอเอกสารเพิ่ม". RFQ: generated from the team's question (options from the CS template), plus "ขอคุยทางโทรศัพท์". General: "ขอใบเสนอราคา" · "ถามเรื่องวัสดุ". | 6 |
| P-20 | Customer storage | Customer files move to a getpack-owned bucket (`getpack-<env>-customer-files`), served through getpack's own domain or CDN with signed URLs. Nothing customer-facing uses `abbon-oic-documents`. | 0 |
| P-21 | Base URLs | Production `https://getpack.co` · dev `http://localhost:3001`. UAT uses its own host from infra. `.invalid` must never reach a customer. | 0 |

## 2. Decided by the business, waiting for sign-off

| # | Topic | Business position | Sign-off by | Until then |
|---|---|---|---|---|
| S-01 | Withholding-tax rates | Configurable per income type. Proposed: 3% on production/goods made to order (จ้างทำของ), 1% on transport lines, 3% on the design-service fee. | ผู้สอบบัญชี | The WHT amount is shown only when the rate is configured. The 50 ทวิ upload and the "awaiting certificate" status still work. |
| S-02 | Voiding UAT duplicates (UATTR-2610-00009, 00012) and the P-01 policy | P-01 | ผู้สอบบัญชี | Report only, no code changes to documents. |
| S-03 | Terms of service and privacy notice (full text) | Structure and summary points as in the prototype. The privacy notice is a notice, not something to accept. | ที่ปรึกษากฎหมาย | Neutral placeholder. Production refuses "[UAT]" text and blocks the consent step from going live. |
| S-04 | Agent WHT and agent agreement | P-02 | ผู้สอบบัญชี + ที่ปรึกษากฎหมาย | Agent sign-up stays behind `FEATURE_AGENT_PROGRAMME`. |
| S-05 | Tax-ID lookup source (DBD open data) | Use it as a prefill only. The customer confirms every field. | ที่ปรึกษากฎหมาย (terms of use) | Manual entry. |

## 3. Decided on 2026-10-28 (round 2)

| # | Topic | Decision |
|---|---|---|
| P-22 | Customer fonts in the Studio (D-284, was open) | **Allowed.** Accepted formats: TTF, OTF, WOFF, WOFF2, up to 10 MB each. Before upload the customer confirms they hold the licence. A font is private to its account or company and appears in that customer's Studio and brand kit. Text is converted to outlines in the print PDF, so production never receives the font file. Unlocks F7. |
| P-23 | Improvement recommendations | The owner accepts every recommendation in this pack (F1–F53). Each one ships behind its own flag in Phase 9, in the order listed. Later rounds keep proposing per-page improvements, and the business team answers business questions directly. |

## 4. Decided during the full audit (2026-10-28)

See AUDIT-PORTAL.md §4 for P-24 (reorder price = 15-day quote), P-25 (claims decided ≤ 5 working days, alert at 3),
P-26 (lead time from data with reason when > 5 working days), P-27 (agent sub-pages → join page), F28 (webhook UI),
brand-kit decisions and sign-off S-06 (font licence attestation + takedown, legal adviser).
