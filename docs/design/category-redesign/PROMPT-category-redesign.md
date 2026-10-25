# getpack — Category Page Redesign (/products/[category]) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/category-redesign/`
   - `PROMPT-category-redesign.md` (ไฟล์นี้)
   - `category-corrugated-prototype.html`: ต้นแบบหมวดกล่องกระดาษลูกฟูก เปิดในเบราว์เซอร์ แล้วกด "ดูสิ่งที่เปลี่ยน" เพื่ออ่านกฎของแม่แบบ
2. **รันหลัง Phase 1 ของหน้า /products เสร็จแล้ว** เพราะหน้านี้ใช้ header, token, การ์ด, ตาราง, ตัวช่วยแสดงราคา/VAT และปุ่ม LINE ชุดเดียวกัน
3. ลำดับ: **Phase 0 → Phase 1 → Phase 2** (Phase 2 = สั่งหลายเบอร์ ต้องรอทีมธุรกิจตัดสินเรื่องขั้นต่ำก่อน)
4. คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง ทุกบล็อกสั่งให้ Claude อ่านส่วน **Shared context** ในไฟล์นี้ก่อนเริ่มงาน

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Page in scope: the category template `/products/[category]` (14 categories). The prototype shows
`/products/corrugated` (5 instant-price items) but every rule must work for all categories.

Reference:
- docs/design/category-redesign/category-corrugated-prototype.html (+ "ดูสิ่งที่เปลี่ยน" notes and template rules)
- docs/design/products-redesign/ and docs/design/styles-redesign/ (shared components, tokens, VAT helper)
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/category-redesign` (from the /products redesign branch if not merged). Small commits.
   Never merge to main, never force-push.
2. Reuse components from the /styles and /products redesigns; do not fork them.
3. NEVER ship sample data. Fake in the prototype: prices of standard sizes other than "00", the multi-size
   totals, product descriptions for 4 items, flute thickness/strength meters, FAQ answers, and the drawings.
   Real (still read from API/config, never hard-code): product names, start prices, ref qty 300, MOQ, lead times,
   the postal-box description/ref spec, material + print options, the 11 standard sizes table, the
   "32 corrugated styles" count, and the copy "ส่งสเปกให้ทีม รับใบเสนอราคาภายในวันทำการ".
   Unknown spec values render "ดูในหน้าสินค้า" — never guess.
4. Real product images only; nothing may indicate images are AI-generated.
5. VAT: site-wide helper, default VAT-inclusive, label every price. Shipping never included.
6. Content (category intro, use-case labels, product short descriptions, guide copy, FAQ) lives in a
   per-category content/config file and is marked for business review.
7. Accessibility, SEO (SSR, JSON-LD ItemList + Product offers + FAQPage + BreadcrumbList), perf budget
   (LCP < 2.5s, INP < 200ms, CLS < 0.1) as in the other packs.
8. Fix the data bug found: the postal box description says "เลือกพิมพ์โลโก้ 1–2 สีได้" but its print options
   are "ดำ · พิมพ์ 4 สี (CMYK)". Report it; do not silently change business copy.
</hard_rules>
```

---

## Phase 0 — Discovery & plan (no code)

```text
First read docs/design/category-redesign/PROMPT-category-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 0 of the category template redesign. DO NOT change code.
1. Study the prototype (rows view, comparison table, use-case filter, size finder, size chart with prices,
   multi-size order, flute guide, cross-link, FAQ, mobile 390px dark).
2. Inspect /products/[category]: current sidebar (it lists all 14 categories, each with "1 · ประเภท" — find
   what that number really is), filter chips (they show values with zero results), data per product
   (structure, flute/layers, surface, standard-size tables, custom-size support), the standard-size data
   behind the product page table, and whether the pricing engine can price each standard size.
3. Write docs/design/category-redesign/PLAN.md: section → files → reused components; data gap table for all
   14 categories (which have standard sizes, which are quote-only, which have a material guide);
   per-category content file schema; risks; ordered Phase 1 tasks. Stop for approval.
</task>
```

---

## Phase 1 — Category template

```text
First read docs/design/category-redesign/PROMPT-category-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 1, following the approved PLAN.md. One commit per item.

1. Category head: breadcrumb หน้าแรก / สินค้าและราคา / {category}; H1; category-specific intro (content file);
   VAT switch; facts computed from the API:
   - instant categories: เริ่มต้น ฿x/ชิ้น (VAT label) · ขั้นต่ำ · ระยะผลิต min–max · จำนวนสินค้า · "ราคาทันทีทุกรายการ" or mixed
   - quote-only categories: ขั้นต่ำ · "รับใบเสนอราคาภายในวันทำการ" · จำนวนสินค้า (no price)
2. Replace the sidebar with a horizontal sibling-category chip row (current one highlighted). Remove the
   misleading "1 · ประเภท" counts.
3. Sticky section nav: สินค้าในหมวดนี้ · หาเบอร์กล่อง (only if standard sizes exist) · guide · สั่งผลิตตามสเปก · คำถามที่พบบ่อย.
4. Product list:
   - Use-case filter chips from the content file, each with a live count; never show a filter value with 0 results
     (this replaces "ราคาทันที / ขอใบเสนอราคา / ขั้นต่ำ ≤ 100 / ผลิต ≤ 5 วัน / มีโปรโมชัน" when they are meaningless).
   - ≤ 8 items: horizontal rows (image · name · short description · spec chips · price block · MOQ · lead · CTA).
     > 8 items: the grid card from /products.
   - Toggle to a comparison table (rows: ราคาเริ่มต้น, เหมาะกับ, โครงสร้าง, ลอน/ชั้น, ผิว, ขนาด, ขั้นต่ำ, ระยะผลิต, CTA),
     horizontally scrollable on mobile.
   - Instant items CTA "ปรับแต่งและดูราคา"; quote items "เพิ่มในใบขอราคา" (shared RFQ tray).
5. Standard-size finder (render only when the category has a product with standard sizes):
   - Inputs ยาว × กว้าง × สูง (cm); rule: product + 0.5 cm per side, rotation allowed, pick the smallest-volume
     standard size that fits; show code, dimensions, utilisation % and real price at 300 pcs; tip when < 45%.
     No fit → "ไม่มีเบอร์มาตรฐานที่ใส่ได้" + custom-size message.
   - Size buttons + to-scale front-view chart (L × H, same scale for all sizes) with code and real price under each.
   - Selected-size panel: iso preview, dimensions, price, "สั่งเบอร์ X" (configurator with size preset),
     "ดาวน์โหลดแบบกล่อง" (existing free dieline), "+ เพิ่มลงรายการหลายเบอร์" (Phase 2 flag).
   - URL param `size=C`.
6. Category guide: corrugated = flute guide (B / E / BC cross-sections, qualitative meters, which product uses it,
   link "เปรียบเทียบวัสดุทั้งหมด"); other categories = their material guide from the content file, or hidden.
7. "ต้องการแบบอื่น": link to /styles filtered to this category (with the live style count) + quote CTA.
8. Category FAQ (content file) + JSON-LD FAQPage.
9. Analytics: category_use_filter, category_view_toggle, category_size_find{dims,result}, category_size_select,
   category_size_cta{size,cta}, category_guide_view, category_crosslink_styles.
</task>

<acceptance>
- Works for all 14 categories (screenshot each at 1440 and 390); sections without data are hidden cleanly.
- Size-finder results unit-tested (rotation, exact fit, no fit). Prices per size equal the configurator's.
- No zero-result filter values rendered. Lint/typecheck/tests pass.
</acceptance>

<report>Summary, files, commits, screenshots, missing-data list per category, content needing review, open questions. Stop.</report>
```

---

## Phase 2 — Multi-size order (needs a business decision first)

```text
First read docs/design/category-redesign/PROMPT-category-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<precondition>
Do not start until docs/design/category-redesign/DECISIONS.md states:
(a) MOQ counts per size or per order, and (b) whether partner factories produce mixed sizes in one lot
(and any price/lead-time effect). If missing, stop and ask.
</precondition>

<task>
1. "สั่งหลายเบอร์ในคำสั่งซื้อเดียว" panel under the size finder: rows (code, dimensions, qty stepper ±50 + input,
   unit price, line total, remove), summary (sizes · pieces · total with VAT label), "เพิ่มเบอร์ที่เลือกอยู่",
   "สั่งทั้งหมด" → cart as ONE order with one line per size (shared spec: material, print).
2. MOQ validation per the decision; inline warning per row or per order; block checkout when unmet.
3. Pricing per line from the engine; if the decision says mixed lots change price/lead time, show it.
4. Persist the list (account / localStorage in try/catch). Analytics: category_multisize_add/remove/order{sizes,qty}.
5. Tests: MOQ rules, totals reconcile with cart, persistence.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| ราคาของแต่ละเบอร์มาตรฐาน (ที่ 300 ชิ้น) จาก pricing engine | ราคาใต้ภาพเทียบขนาดและในผลแนะนำ |
| ขั้นต่ำนับต่อเบอร์หรือต่อคำสั่งซื้อ + โรงงานผลิตหลายเบอร์ในล็อตเดียวได้ไหม | สั่งหลายเบอร์ (Phase 2) |
| คำโปรยหมวด, การใช้งานของแต่ละหมวด, คำอธิบายสั้นของสินค้า, FAQ ทั้ง 14 หมวด | เนื้อหาหน้าหมวด |
| ข้อมูลลอน/ชั้น/ผิว/การรองรับขนาดเองของสินค้าทุกตัว | สเปกบนการ์ดและตารางเปรียบเทียบ |
| แก้คำอธิบายกล่องไปรษณีย์ ("1–2 สี" ไม่ตรงกับตัวเลือก "ดำ · 4 สี") | ความถูกต้องของข้อมูล |
