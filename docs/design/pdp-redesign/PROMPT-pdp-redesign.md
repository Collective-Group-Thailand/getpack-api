# getpack — Product Page Redesign (/products/[slug]) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/pdp-redesign/`
   - `PROMPT-pdp-redesign.md` (ไฟล์นี้)
   - `pdp-postal-box-prototype.html`: ต้นแบบหน้ากล่องไปรษณีย์ ลอน B เปิดในเบราว์เซอร์ แล้วกด "ดูสิ่งที่เปลี่ยน"
2. **รัน Phase 0 (แก้ราคาให้ตรงกัน) ได้ทันที ไม่ต้องรอหน้าอื่น** เพราะเป็นปัญหาความถูกต้องของข้อมูล
3. Phase 1–2 รันหลัง Phase 1 ของหน้าสินค้าและราคา (ใช้ component ร่วมกัน)
4. ลำดับ: **Phase 0 → Phase 1 → Phase 2 (รีวิว)** คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Pages in scope: product page `/products/[slug]` (prototype: uat-postal-box-b) and its hand-off to the existing
configurator `/configure/[slug]` (7 steps: ขนาดและรูปแบบ → วัสดุ → การพิมพ์ → จำนวน → การจัดส่ง →
งานออกแบบและตัวอย่าง → สรุปและบันทึก). The configurator already has: live price, quantity tiers, shipping by
postcode, "พร้อมจัดส่งเร็วสุด" date, inside/outside dimensions (3 mm board), saved quotes with a 15-day price
lock, and the ±5% quantity tolerance with credit for shortfall.

Reference: docs/design/pdp-redesign/pdp-postal-box-prototype.html (+ "ดูสิ่งที่เปลี่ยน"), and the shared
components/tokens from docs/design/styles-redesign, products-redesign, category-redesign.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/pdp-redesign`. Small commits. Never merge to main, never force-push.
2. ONE source of truth for every number: prices, tiers, dates, dimensions and tolerance on the product page
   come from the same services the configurator uses. No second pricing or date logic anywhere.
3. NEVER ship sample data. Prototype prices for sizes other than 00, materials other than KA125 B and the
   4-colour print are fake (marked "ราคาตัวอย่าง"); review blocks are grey skeletons on purpose.
4. Real product images only; nothing may indicate images are AI-generated.
5. VAT: shared helper, default VAT-inclusive, every price labelled; shipping never included on this page.
6. Reviews: only from delivered, verified orders; never seed, import or write sample reviews; no
   AggregateRating JSON-LD until the threshold is met.
7. Accessibility, SEO (Product + Offer/AggregateOffer + BreadcrumbList + FAQPage JSON-LD), perf budget as in the other packs.
</hard_rules>
```

---

## Phase 0 — Make prices consistent (do first)

```text
First read docs/design/pdp-redesign/PROMPT-pdp-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Data-consistency fix. Investigate, report, then fix only after I approve the plan.
Found issues:
1. /products and /products/uat-postal-box-b show "เริ่มต้น ฿15.70 ที่ 300 ชิ้น" (reference spec: size 00,
   KA125 B, "พิมพ์ 4 สี (CMYK)"), but /configure/uat-postal-box-b defaults to size 00 · KA125 B · "ดำ" and
   shows ฿17.26 at 300 pcs. Customers see the price jump on entry.
2. Tier table shows the same unit price for 100 / 300 / 500 (฿17.26) and ฿14.96 at 1,000. Confirm whether intended.
3. Product description says "เลือกพิมพ์โลโก้ 1–2 สีได้" but print options are "ดำ · พิมพ์ 4 สี (CMYK)".
4. Reference spec says "กว้าง × ยาว × ลึก 97.5 × 140 × 60" while tables say "ยาว × กว้าง × สูง 140 × 97.5 × 60".
5. "ดาวน์โหลดแบบกล่อง" links to the generic /templates page instead of this product/size's file.
6. The Studio editor shows ฿14.79/ชิ้น at 300 pcs for a 150 × 100 × 80 mm postal box (KA125 B), which matches
   none of the above (listing ฿15.70, configurator ฿17.26). All three surfaces must call the same pricing service
   with the same spec and say which spec the price is for.

Steps:
a. Trace where the listing/start price is computed and stored vs the configurator price. Explain the gap.
b. Propose: start price = the configurator's own price for its default spec at the reference quantity,
   computed by the same engine (cached/revalidated), used by listing cards, category pages, product page and
   JSON-LD. Add a test asserting equality for every instant-price product.
c. List copy fixes for 3–4 (do not change business copy without approval) and a deep-link for 5
   (/templates?product=…&size=… or a direct file URL).
d. Write docs/design/pdp-redesign/PRICE-CONSISTENCY.md with findings + plan. Stop for approval, then implement.
</task>
```

---

## Phase 1 — Product page

```text
First read docs/design/pdp-redesign/PROMPT-pdp-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 1 of the product page redesign. One commit per item.
1. Layout: breadcrumb (หน้าแรก / สินค้าและราคา / {category} / {product}); two columns — sticky gallery left,
   buy box right; single column below 1040px; sticky bottom buy bar on mobile (price, qty·size, CTA).
2. Gallery: real photos + a "ขนาดจริง" view rendering the selected size with L/W/H labels (inside dims);
   thumbnails as a button group. Remove the empty space under the image.
3. Buy box:
   - category link, H1, short description, pills (ราคาทันที, structure, ขั้นต่ำ, ระยะผลิต).
   - Price: unit price + total for the current selection, sub-line "{qty} ชิ้น · เบอร์ X · รวม VAT แล้ว · ไม่รวมค่าจัดส่ง".
   - Pickers bound to the configurator's option data: size (standard sizes + "กำหนดเอง" → configurator custom tab),
     material (cards with one-line note), print, quantity (the engine's tier quantities, each showing its unit price).
   - Live price via the configurator's pricing service (debounced; skeleton while loading; error state).
   - CTAs: primary "ปรับแต่งต่อและสั่งซื้อ" → /configure/[slug]?size=&material=&print=&qty= with those values
     preselected (configurator must read them); secondary "บันทึกใบเสนอราคา" (existing saved-quote flow, 15-day
     lock), "แบบกล่องเบอร์ X" (file for this product + size), "สอบถาม" (existing /help/chat).
   - Assurance list from the configurator services: พร้อมจัดส่งเร็วสุด {date} · tier saving at the largest
     tier ("ถูกกว่า x%") · ±5% tolerance with credit · 15-day price lock · link to /guarantee.
4. Sticky section nav: ขนาด · ราคาตามจำนวน · วัสดุและการพิมพ์ · งานออกแบบ · ขั้นตอนสั่งซื้อ · รีวิว (Phase 2) · คำถามที่พบบ่อย.
5. Sizes table: all standard sizes with inside dims, outside dims (from the configurator's board-thickness rule,
   labelled as reference), to-scale bar, unit price at the selected qty for the current spec, "เลือกเบอร์นี้".
   Custom-size callout below.
6. Price tiers card (selected spec) + "อ่านราคาอย่างไร" (VAT, 15-day lock, ±5%, warranty link).
7. Materials & print: options this product supports, link "เปรียบเทียบวัสดุ"; short print notes (content file).
8. Design paths: มีไฟล์งานแล้ว (upload), ออกแบบในสตูดิโอ, ให้ทีมออกแบบ (service product).
9. Order flow strip: the configurator's 7 steps, marking steps 1–4 as "ตั้งจากหน้านี้".
10. Product FAQ (content file) + JSON-LD; related products from the same category.
11. Analytics: pdp_option_change{option,value}, pdp_price_view, pdp_cta{cta}, pdp_size_table_pick, pdp_design_path.
</task>

<acceptance>
- Product-page price equals the configurator price for every combination tested (automated test).
- Values chosen on the product page arrive preselected in the configurator.
- No layout shift when prices load; mobile buy bar never covers content or the LINE button.
- Lint, typecheck, tests pass.
</acceptance>

<report>Summary, files, commits, screenshots (1440, 390 dark, size view, tiers), missing data, open questions. Stop.</report>
```

---

## Phase 2 — Verified-order reviews

```text
First read docs/design/pdp-redesign/PROMPT-pdp-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Data: reviews linked to a delivered order line (product, size, qty, print), rating 1–5, text, optional photos
   (stored on the existing S3 bucket), display name = shop name or initials (customer chooses), created date,
   moderation status. Backend in getpack-api with admin moderation in back-office.
2. Collection: after delivery confirmation (+ N days, configurable) send a review invitation by email/LINE with
   a signed link; one review per order line; editable for 30 days.
3. Product page section "รีวิวจากคำสั่งซื้อจริง": summary (average, count, distribution), filter by size,
   list with "คำสั่งซื้อที่ยืนยันแล้ว" badge, spec pill (เบอร์ · จำนวน · สีพิมพ์), text, photos, date.
   Hidden entirely until the threshold (default 3 approved reviews) is met.
4. JSON-LD Review/AggregateRating only when visible. Never seed or import sample reviews.
5. Analytics: pdp_reviews_view, pdp_reviews_filter, review_invite_sent/opened/submitted.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| ยืนยันราคาเริ่มต้นที่ถูกต้อง และสเปกเริ่มต้นที่ใช้แสดงทุกหน้า | Phase 0 (ด่วน) |
| ยืนยันตารางราคา 100–500 ชิ้นที่เท่ากัน | Phase 0 |
| แก้คำอธิบาย "1–2 สี" และลำดับ/คำเรียกมิติ (กว้าง ยาว ลึก/สูง) | Phase 0 |
| ไฟล์แบบกล่องรายเบอร์ของสินค้าแต่ละตัว | ปุ่ม "แบบกล่องเบอร์ X" |
| เกณฑ์แสดงรีวิว ระยะเวลาเชิญรีวิว และนโยบายตรวจรีวิว | Phase 2 |
