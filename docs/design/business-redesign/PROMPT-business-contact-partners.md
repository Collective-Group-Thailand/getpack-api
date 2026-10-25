# getpack — /business · /contact · /partner-with-us · /network · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/business-redesign/`
   - `PROMPT-business-contact-partners.md` (ไฟล์นี้)
   - `business-contact-partners-prototype.html`: ต้นแบบ 3 หน้า สลับหน้าได้จากแถบบนสุด กด "ดูสิ่งที่เปลี่ยน"
2. ลำดับ: **Phase 0 → 1 → 2 → 3 → 3b → 4** คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง และหยุดรออนุมัติทุก Phase
3. Phase 1 (/business) และ Phase 2 (/contact) ทำคู่กันได้ Phase 3 (/partner-with-us) ใช้ข้อมูลจากพอร์ทัลโรงงาน

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`. Collective Group (Thailand)
operates getpack and issues tax invoices under the getpack brand. getpack also runs a partner (factory) portal with
6 roles (เจ้าของ, วางแผนการผลิต, พนักงานคุมเครื่อง, QC, จัดส่ง, บัญชี) that is growing into a full factory ERP.

Pages in scope:
- /business — today: H1 "สั่งบรรจุภัณฑ์ในนามบริษัท ทั้งทีม ทุกสาขา", CTAs เปิดบัญชีบริษัท (/business/apply) and
  คุยกับทีมขาย (/contact), 6 features (ทั้งทีมในบัญชีเดียว: ผู้ดูแล ผู้สั่งซื้อ ผู้อนุมัติ ฝ่ายบัญชี · อนุมัติก่อนสั่ง
  เมื่อเกินยอดที่บริษัทกำหนด · เครดิตเทอม 15–60 วันหลังสั่งครบ 3 ครั้งหรือแนบงบการเงิน · ใบกำกับภาษีและใบแจ้งยอดรายเดือน ·
  หลายสาขา · สั่งซ้ำด้วย CSV เลขคำสั่งซื้อและจำนวน), 3 steps to open (ข้อมูลบริษัท · เอกสาร หนังสือรับรอง ≤ 6 เดือน, ภ.พ.20,
  บัตรผู้มีอำนาจลงนาม · ทีมตรวจ 1–2 วันทำการ ระหว่างนี้สั่งแบบชำระก่อนได้). /business/apply: KYC form, files ≤ 20 MB.
- /contact — today: links ติดตามคำสั่งซื้อ (/track), ศูนย์ช่วยเหลือ (/help), คำถามที่พบบ่อย (/faq); one form
  (ชื่อ*, เบอร์มือถือ +66 / อีเมล at least one, เรื่อง: คำสั่งซื้อ · ใบเสนอราคา · ไฟล์และแบบตัวอย่าง · การชำระเงิน ·
  การจัดส่ง · บัญชีธุรกิจ · ร่วมเป็นโรงงานพาร์ตเนอร์ · อื่น ๆ, เลขคำสั่งซื้อ e.g. PK-2569-00100, ข้อความ*). No e-mail,
  phone, address or hours on the page; LINE "ทุกวัน 09:00–18:00 น." only in the footer.
- /partner-with-us (footer "ร่วมเป็นโรงงานพาร์ตเนอร์") — becomes the getpack Factory page.
- /network (footer "เครือข่ายโรงงาน") — today says it does not disclose factory names, but lists 14 product types with
  "มีโรงงานรับ / ยังไม่มีโรงงานรับ" and "เราจะแสดงตัวเลขเมื่อมีโรงงานอย่างน้อย 3 แห่ง…" — both leak network size/coverage.
  Becomes "มาตรฐานการผลิต" (no factory data at all).

Product decisions (confirmed):
- getpack Factory = the factory ERP, free for every module and unlimited users; the only condition is that the factory
  opens a factory account and signs the partner agreement with getpack before use.
- ERP modules: รับงานจาก getpack (live) · 6 roles (live) · สต็อกและคลัง · จัดซื้อ · วางแผนผลิตเชื่อมสต็อก · หน้างานพนักงาน ·
  ทีมขาย · ระบบบัญชีและบัญชีแยกประเภท (ผังบัญชี สมุดรายวัน บัญชีแยกประเภท ลูกหนี้ เจ้าหนี้ งบการเงิน, auto-posting from
  sales/purchase/payments) · คลังเอกสาร (full-text search) · แจ้งซ่อมเครื่องจักร · คู่ค้า. Price source per factory:
  getpack rate card or factory price list; 3 participation tiers (full prices / partial / quote-on-request).
  Payment and delivery terms for factories are in the partner agreement only — never on public pages.
- FACTORY CONFIDENTIALITY (business decision, applies to the whole system): nothing that identifies or describes our
  partner factories may be visible to customers, other factories or the public — names, locations/regions, number of
  factories, capacity, machines, which product types are/aren't covered, factory-fleet delivery, factory terms.

Reference: docs/design/business-redesign/business-contact-partners-prototype.html.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/business-redesign`. Small commits. Never merge to main, never force-push.
2. Do not change credit, approval, KYC, tax or pricing rules — only presentation, forms and the new features below.
3. NEVER ship sample data. Fake in the prototype: dashboard and factory-board screens and numbers, company/branch
   names, budgets, catalogue SKUs, order amounts in the simulator except unit prices, response times ("1 วันทำการ"),
   callback hours, ticket statuses, revenue-estimator ratios (15–35 %) and average prices, QR code, e-mail/phone/address.
4. Marketing copy must not state internal strategy (why the ERP is free, network-growth reasons). Only state the offer:
   free, all modules, unlimited users, after account + partner agreement.
4a. Factory confidentiality (see context) on every surface: storefront pages, JSON-LD, sitemap, order tracking,
   e-mails/LINE messages, QC reports and photos (photos show the product only), delivery notes, box/parcel labels,
   invoices (getpack only), PDFs (strip author/producer metadata), API responses (no factory ids/names to customers).
   The partner portal must not show customer brand names or contact details beyond what delivery needs (recipient
   name/phone/address at dispatch). No public numbers about the network, ever.
5. Features not live yet are labelled "เร็ว ๆ นี้" (business) / "กำลังพัฒนา" (factory modules) until released;
   driven by a config, not hard-coded copy.
6. Real contact data (e-mail, phone, office address, tax ID, LINE OA link/QR) come from one config/CMS source used by
   /contact, footer and JSON-LD; show nothing (not placeholders) if a value is missing.
7. Forms: labelled fields, inline errors linked with aria-describedby, focus first error, PDPA purpose line, spam
   protection (rate limit + honeypot/turnstile), every submission gets a reference (CT-/BZ-/FP-YYYY-#####) stored server-side.
8. SEO/AEO: unique titles/meta, JSON-LD (Organization + ContactPoint on /contact; FAQPage on each FAQ; Service on
   /business and /partner-with-us), answer-first copy. Responsive (no horizontal scroll at 360 px), dark mode, analytics.
</hard_rules>
```

---

## Phase 0 — Discovery

```text
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map /business, /business/apply, /contact, /partner-with-us, /network: routes, components, form handlers, where
   contact submissions go today (e-mail? ticket table?), and business-account APIs (roles, approval threshold, PO,
   branches, credit request, CSV reorder).
2. Confidentiality audit: list every place a customer or the public can see factory information (pages, APIs,
   JSON-LD, e-mails, PDFs + metadata, tracking, QC photos, delivery docs, labels) and every place a factory can see
   customer identity/contact data. Include fixes in PLAN.md.
3. List what is missing for: company catalogue, budgets per branch/cost centre, ticket status lookup, callback
   scheduling, partner applications, factory-ERP module status flags, contact-info config.
4. Write docs/design/business-redesign/PLAN.md (gaps, confidentiality fixes, schema/API changes, risks). Stop for approval.
</task>
```

---

## Phase 1 — /business

```text
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Dark hero: eyebrow "getpack สำหรับธุรกิจ", H1 "บรรจุภัณฑ์ของทั้งบริษัท จัดการในที่เดียว", lede, CTAs
   "เปิดบัญชีบริษัท ฟรี" (/business/apply) and "นัดคุยกับทีมขาย" (#sales), facts 15–60 วัน · 1–2 วันทำการ · 4 บทบาท;
   product screenshot of the company account (real UI screenshot or a static illustration — label "ตัวอย่างหน้าจอ").
2. Audience chips; "ก่อน → หลัง" (4 cards); bento of the 6 live features + "เร็ว ๆ นี้" cards (ล็อกแบรนด์สำหรับสาขา,
   เตือนก่อนกล่องหมด, ติดตามการผลิตพร้อมหลักฐาน, e-Tax Invoice และส่งออกเข้าระบบบัญชี, เชื่อมระบบ/API).
3. Approval simulator (client-side): threshold slider, sample orders priced from the pricing service, PO-required and
   credit toggles → flow ผู้สั่งซื้อ → ผู้อนุมัติ (required/auto) → ฝ่ายบัญชี → ผลิต 5 วันทำการ.
4. "ควบคุมการสั่งซื้อ": company catalogue demo (approved SKUs with steppers, total, approval hint) and budgets per
   branch/cost centre demo (80 % warning, over-budget needs approval) — marketing demo now, real features in Phase 4.
5. ROI calculator: quotes/month, hours per quote, approvals/month, hourly cost → hours and baht saved per year; show
   the formula and assumption (15 min saved per approval) under the result.
6. Credit path (4 steps + 15/30/45/60), payment methods, invoice issuer line; apply section (3 steps + document
   checklist with progress, saved in localStorage only); FAQ (6); network section "ผลิตโดยโรงงานที่ใช้ระบบเดียวกับคุณ"
   ("เห็นงานของคุณทุกขั้น": real-time status, QC photos/report, proof of delivery — no factory details) + band
   linking /partner-with-us.
7. Sales form (#sales): company, contact, work e-mail, mobile, monthly volume, interests (chips), message →
   creates a sales lead with BZ- reference; success state with "เปิดบัญชีบริษัทระหว่างรอ".
8. Analytics: biz_cta{target}, biz_sim_change{threshold}, biz_roi_change, biz_doc_check{n}, biz_sales_submit{volume}.
</task>
```

---

## Phase 2 — /contact

```text
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Header: H1 "มีอะไรให้ช่วยครับ", live team status computed in Asia/Bangkok from the configured hours (ออนไลน์อยู่ตอนนี้
   / กลับมาตอบ 09:00 น.), one tracking box that accepts PK-YYYY-##### (→ /track) and CT-YYYY-##### (→ inline ticket
   status: ได้รับเรื่อง → กำลังดำเนินการ → ตอบกลับแล้ว, with "เพิ่มข้อมูลในเรื่องนี้" for the owner/verified contact).
2. 8 intent cards (same values as today's subject list) → answer panel with 2–3 real answers + self-serve links, and a
   form whose fields change by intent: order (order no.*), quote (product, qty ≥ 100, inside size, attachments),
   file (order no. optional, attachments), payment (order no.), shipping (order no., destination postcode), business
   (company, volume), partner (company, capabilities chips, province → or deep link to /partner-with-us), other.
   Partner answers say factory data stays confidential; no payment/delivery terms.
3. Common fields: name*, mobile/e-mail (at least one), message*, reply channel (LINE / e-mail / โทรกลับ). When
   "โทรกลับ" is chosen: require mobile and pick one of the next 5 working days + a slot (09–12, 12–15, 15–18).
4. Submit → ticket with CT- reference, stored and routed to the right queue by intent; success panel with reference,
   expected reply time (from config per intent) and "คุยต่อทาง LINE".
5. Side column: LINE OA card (real QR + add-friend link), other channels (e-mail, phone, office) and company legal info —
   all from the contact config (hide rows with no value). Bottom: cards to /business, /partner-with-us, /help.
6. Analytics: contact_intent{intent}, contact_answer_open{q}, contact_submit{intent,channel}, contact_track{type}.
</task>
```

---

## Phase 3 — /partner-with-us (getpack Factory)

```text
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Hero: eyebrow "getpack Factory · สำหรับโรงงานบรรจุภัณฑ์", H1 "ระบบ ERP ทั้งโรงงาน ใช้ฟรี พร้อมงานใหม่ทุกวัน", lede
   (สต็อก จัดซื้อ วางแผนผลิต หน้างาน QC จัดส่ง ไปจนถึงระบบบัญชีและบัญชีแยกประเภท), CTAs สมัคร / ดูโมดูล, offer line
   "฿0 · ทุกโมดูล · ไม่จำกัดผู้ใช้ · เปิดบัญชีและทำสัญญาพาร์ตเนอร์กับ getpack", production-board illustration (labelled).
2. "งานจาก getpack + ลูกค้าของคุณเอง ในระบบเดียว" (3 tiles). Customer data of the factory belongs to the factory.
3. Modules grid from a status config (live / กำลังพัฒนา); highlight cards: รับงานจาก getpack and ระบบบัญชีและบัญชีแยกประเภท.
4. Shop-floor section with the operator phone screen (start/pause/done, scrap, photos, maintenance request).
5. Comparison table (Excel + LINE · ERP ทั่วไป · getpack Factory) incl. the accounting row; scrolls horizontally on phones.
6. 3 participation tiers + 2 price-source options.
7. No public revenue estimator (demand by type/region is business data). The partner team assesses suitable work
   after the application.
8. Application form: factory name, contact, mobile, province, capabilities, current system → partner application with
   FP- reference, routed to the partner team; steps shown: สมัคร → เปิดบัญชีโรงงานและทำสัญญาพาร์ตเนอร์ → เริ่มใช้ทุกโมดูล.
9. FAQ: ใช้ฟรีจริงไหม (free, all modules, unlimited users, after account + agreement) · ข้อมูลลูกค้าของโรงงานเป็นของใคร ·
   getpack เปิดเผยชื่อโรงงานพาร์ตเนอร์ไหม (no — names, location and data are never shown; customer documents are issued
   by getpack; terms are in the partner agreement) · ใช้แทนโปรแกรมบัญชีที่มีอยู่ได้ไหม · ไม่อยากใช้ทุกโมดูลได้ไหม.
10. Do NOT include any copy explaining why the ERP is free (internal strategy).
11. Analytics: fx_cta{target}, fx_apply_submit{capabilities}.
</task>
```

---

## Phase 3b — /network → มาตรฐานการผลิต

```text
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Replace /network content with "มาตรฐานการผลิตของ getpack" (keep the URL, update the footer label to
   "มาตรฐานการผลิต"). Remove the product-type coverage list, the "ยังไม่เผยแพร่ตัวเลข" block and the
   "อย่างน้อย 3 แห่ง / 30 งาน" threshold text, and delete any code/API that computes public network statistics.
2. Sections: ควบคุมคุณภาพ 4 ขั้น (ตรวจไฟล์และสเปก · ตรวจระหว่างผลิต · ตรวจก่อนส่ง · รักษาความลับ — no numbers, no
   mention of factories, partners, vetting or where production happens) ·
   เกณฑ์ตรวจ (ขนาด ± 3 มม. · สี ΔE2000 ≤ 3 เทียบตัวอย่างที่อนุมัติ · จำนวน ± 5% ส่วนที่ขาดคืนเป็นเครดิต) · สิ่งที่ลูกค้าเห็น
   (แบบให้อนุมัติ · สถานะ · ผลตรวจ · รับประกันงาน) · FAQ (ใครรับผิดชอบงานของฉัน: getpack is the seller and is responsible end-to-end — never say who produces it ·
   ไฟล์ปลอดภัยไหม · ถ้างานไม่ตรงมาตรฐาน · สั่งอะไรได้บ้าง → /products).
3. Product availability is shown only from the customer's view on product pages (instant price vs request a quote),
   never as factory coverage.
</task>
```

---

## Phase 4 — Make the business features real

```text
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Each behind its own feature flag; stop for approval after each.
1. Company catalogue: admins publish approved items (spec + file + current price); a setting restricts branch users to
   catalogue items; ordering from the catalogue respects approval thresholds and budgets.
2. Budgets: monthly budget per branch / cost centre; warning at 80 %; orders that exceed need approval; spend report by
   cost centre (CSV/Excel export).
3. e-Tax Invoice + accounting export: write docs/design/business-redesign/ETAX.md (provider options, Revenue Department
   requirements, export formats for common Thai accounting software) before any build.
4. Ticket system for /contact (CT- references, statuses, internal assignment, customer view) if none exists.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| อีเมล เบอร์โทร ที่อยู่สำนักงาน เลขผู้เสียภาษี ลิงก์และ QR LINE OA | /contact, footer, JSON-LD |
| เวลาตอบกลับต่อเรื่อง และช่วงเวลาที่โทรกลับได้ | ฟอร์มติดต่อ |
| ภาพหน้าจอจริงของบัญชีบริษัทและ getpack Factory | Hero ทั้งสองหน้า |
| สถานะโมดูล ERP (ใช้ได้แล้ว / กำลังพัฒนา) และวันเปิดใช้ | /partner-with-us |
| สัญญาพาร์ตเนอร์และขั้นตอนเปิดบัญชีโรงงาน | ฟอร์มสมัครโรงงาน |
| เงื่อนไขสัญญาราคารายปีและบริการเก็บสต็อก | FAQ /business |
| ข้อความในสัญญาพาร์ตเนอร์เรื่องห้ามติดต่อลูกค้าโดยตรงและการรักษาความลับ (ให้ทนายร่าง) | ปกปิดข้อมูลโรงงาน |
