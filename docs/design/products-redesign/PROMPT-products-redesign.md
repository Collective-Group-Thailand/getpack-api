# getpack — /products "สินค้าและราคา" Redesign · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/products-redesign/`
   - `PROMPT-products-redesign.md` (ไฟล์นี้)
   - `products-redesign-prototype.html`: ต้นแบบที่กดใช้งานได้ เปิดในเบราว์เซอร์ แล้วกด "ดูสิ่งที่เปลี่ยน"
2. ใช้ `design-tokens.css` ตัวเดียวกับชุดหน้าแบบกล่อง (`docs/design/styles-redesign/`)
3. **รันหลังจาก Phase 1 ของหน้าแบบกล่องเสร็จแล้ว** เพราะ header, design tokens และตัวช่วยแสดงราคา/VAT ถูกสร้างใน Phase นั้น หน้านี้จะนำมาใช้ต่อ
4. รันตามลำดับ: **Phase 0 → Phase 1 → Phase 2 → Phase 3** (Phase 3 รันหลังทดสอบกับลูกค้า 5 ราย) แต่ละ Phase จบด้วยรายงาน ให้ตรวจก่อนสั่งขั้นถัดไป
5. คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง ทุกบล็อกสั่งให้ Claude อ่านส่วน **Shared context** ในไฟล์นี้ก่อนเริ่มงาน

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co) by Collective Group (Thailand). Frontend `getpack-web` (Next.js),
backend `getpack-api` (NestJS).
Page in scope: `/products` ("สินค้าและราคา"), the hub of everything a customer can buy: ~143 items in 14 categories,
4 buying modes in the data today:
  - ราคาทันที (instant price, e.g. corrugated boxes with real calculators; product pages show "รวม VAT")
  - สั่งผลิตตามสเปก / ขอใบเสนอราคา (quote)
  - สินค้าสต็อก (stock, "มีสินค้า")
  - บริการ (services: graphic design, mockup, offset plate)
Role split with /styles: /styles = choose a box STRUCTURE to design; /products = what you can BUY, price,
MOQ, lead time and how pricing works ("ทำได้แค่ไหน เท่าไร กี่วัน").

Reference (read before coding):
- docs/design/products-redesign/products-redesign-prototype.html (+ its "ดูสิ่งที่เปลี่ยน" notes)
- docs/design/styles-redesign/design-tokens.css and the components built in the /styles redesign
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/products-redesign` (from the /styles redesign branch if it is not merged yet).
   Small commits per task. Never merge to main, never force-push.
2. The prototype is a visual + behaviour reference, not code to copy. Reuse the header, tokens, chips,
   switches, cards, toast, LINE button and price/VAT helper from the /styles redesign. Do not fork them.
3. NEVER ship sample data. In the prototype these are fake: calculator prices at other quantities and the
   "ดำ 1 สี" multiplier, the price curve bars, and the drawn product illustrations. Everything else
   (names, categories, start prices, reference quantity 300, MOQ, lead times, materials, payment methods,
   LINE hours) came from the live system — still read it from the API/config, never hard-code it.
   Missing field → hide the element; list it in the report.
4. Use real product images from the API. No badge/caption/alt/metadata saying an image is AI-generated.
5. VAT (site-wide rule): default display = VAT-inclusive (switch ON), switch OFF = ex-VAT, via the ONE shared
   price helper. Every price shows which one it is. Shipping is never included; say so.
6. Copy: Thai copy from the prototype verbatim. FAQ answers, "รับประกันงาน", included/excluded list and
   material descriptions are drafts — put them in a content/config file and mark them for business review.
7. Accessibility: keyboard, visible focus, aria for tabs/switches/toggles/accordions, reduced motion.
8. SEO/AEO/GEO: SSR from searchParams; JSON-LD ItemList + Product (offers with VAT-inclusive THB price for
   instant items) + FAQPage + BreadcrumbList; FAQ also exposed in llms.txt.
9. Performance budget: LCP < 2.5s, INP < 200ms, CLS < 0.1 on mobile 4G; calculator and table view
   loaded lazily; grid paginated (15 per batch on the hub).
10. Don't break existing routes (/products/[category], /products/[slug], cart, checkout, RFQ). If the brief
    conflicts with the codebase, stop and ask.
</hard_rules>
```

---

## Phase 0 — Discovery & plan (no code)

```text
First read docs/design/products-redesign/PROMPT-products-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 0 of the /products redesign. DO NOT change code.
1. Study the prototype in all states (modes, calculator, tabs, table view, RFQ tray, mobile 390px dark).
2. Inspect: the /products route + components, /products/[category] and /products/[slug], the product DTOs
   (price mode, start price, reference qty, MOQ, unit, lead time, stock status, images, category), the instant
   pricing engine/calculators and how the configurator is opened with preset values, the RFQ/quote flow
   (single vs multi-item), cart, analytics, i18n, and what the /styles redesign already built that can be reused.
3. Write docs/design/products-redesign/PLAN.md:
   a. Prototype section → files → reused components.
   b. Data gap table: every field the UI needs vs the API today (available / derivable / missing).
      Pay special attention to: stock items' real unit prices (today they show "ราคาตามสเปก"), tier prices for
      the calculator, print-option pricing, multi-item RFQ support, mode counts and min prices per mode.
   c. Whether the pricing engine can return prices for quantity presets [100,300,500,1000,2000,5000] fast enough
      for a live calculator (target < 300ms via BFF). If not, propose the smallest endpoint that can.
   d. Risks, open questions, ordered task list for Phase 1.
4. Stop and wait for approval.
</task>
```

---

## Phase 1 — Build the page

```text
First read docs/design/products-redesign/PROMPT-products-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 1 of the /products redesign, following the approved PLAN.md. One commit per item.

1. Page head: breadcrumb, H1 "สินค้าและราคา", lede, product search (live, debounce ~250ms),
   live totals ("{n} รายการ · {m} หมวด"), VAT switch "แสดงราคารวม VAT 7%" (shared helper, default ON).
2. Buying-mode cards (4): ราคาทันที / สั่งผลิตตามสเปก / สินค้าพร้อมส่ง / บริการ — icon, title, one-line
   description, and a data line computed from the API (min instant price + MOQ; MOQ range for quote; MOQ for stock).
   Click = filter the catalogue by that mode (toggle) and scroll to it.
3. Sticky section nav under the header: คำนวณราคา · สินค้าทั้งหมด · ราคาคิดอย่างไร · วัสดุ · ขั้นตอนและระยะเวลา ·
   บริการเสริม · คำถามที่พบบ่อย. Highlights the section in view; horizontal scroll on mobile.
4. Quick price calculator ("คำนวณราคาด่วน") for instant-price products only:
   product picker (thumb + name) → quantity presets (respect MOQ) + custom input → print options from the
   product's real spec options → result panel: unit price, VAT breakdown (ก่อน VAT / VAT 7% / รวม),
   bars for the preset quantities (real tier prices), lead time, MOQ, warranty, CTA "ปรับขนาดและสั่งซื้อ" →
   existing configurator with product/qty/print prefilled. Show the reference spec line from the product.
   Notes: "ยังไม่รวมค่าจัดส่ง" + quantity-tolerance note (link to warranty terms).
   If PLAN.md shows the engine can't serve this yet, ship the section behind a flag (off) and report.
5. Catalogue: mode tabs with counts, category chips (only categories present in the current mode),
   sort (แนะนำ / ราคาเริ่มต้นต่ำ–สูง / ขั้นต่ำน้อยสุด / ผลิตเร็วสุด), grid ↔ price-table toggle,
   server-side filtering + pagination over ALL items (not just page 1), "แสดง x จาก y" + "โหลดเพิ่ม" (15 per batch).
   URL params: mode, cat, q, sort, view, page (defaults omitted; replace on typing, push on tab change).
6. Card anatomy (exact as prototype): image (4:3) · badge only for ราคาทันที (amber) and พร้อมส่ง (green) ·
   category · name (2-line clamp) · price block (instant: "เริ่มต้น ฿x /หน่วย · ที่ 300 หน่วย" from real data;
   quote: "ราคาตามสเปก"; service: "ราคาตามขอบเขตงาน"; stock: real unit price when the API has it) ·
   meta (ขั้นต่ำ, ผลิต x วันทำการ — hidden if missing) · action (instant: "ดูราคาและสั่งซื้อ";
   others: "เพิ่มในใบขอราคา" toggle). Equal card heights per row.
7. Price table view: columns สินค้า (thumb+name) · หมวด · วิธีซื้อ (pill) · ราคาเริ่มต้น (label says รวม/ก่อน VAT) ·
   ที่จำนวน · ขั้นต่ำ · ระยะผลิต · action. Horizontal scroll inside its own container on small screens.
8. Multi-item RFQ ("ใบขอราคา"): add/remove from cards/table, floating tray with count + "ส่งคำขอราคา" + "ล้าง",
   persisted (account if logged in, else localStorage in try/catch). Submit opens the existing quote flow with
   all items as line items. If the backend only supports single-item RFQs, implement the UI, block submit
   behind a flag, and report the API change needed.
9. "ราคาคิดอย่างไร": 4 factor cards (ขนาด, วัสดุ, งานพิมพ์และตกแต่ง, จำนวน) with simple SVG figures +
   included/excluded list (from content config, business-reviewed).
10. "วัสดุกล่องลูกฟูก": table from material master data (code, flute, use, note) with flute cross-section SVG;
    link "เปรียบเทียบวัสดุทั้งหมด" to the existing material comparison.
11. "ขั้นตอนและระยะเวลา": 4 steps + payment methods (from config: โอนผ่านธนาคาร, พร้อมเพย์ QR, บัตรเครดิต/เดบิต, ผ่อนชำระ).
12. "บริการเสริม": service products as 3 link cards (from the service category); remove services from the
    default grid order emphasis but keep them filterable under the บริการ tab.
13. FAQ accordion (8 questions from the prototype, content file, business-reviewed) + JSON-LD FAQPage.
14. CTA band: "ขอใบเสนอราคา" + "คุยทาง LINE" (hours from config). Reuse the floating LINE button.
15. Analytics: products_search, products_mode_select, products_tab, products_view_toggle,
    products_calc_change{product,qty,print}, products_calc_cta, products_rfq_add/remove/submit{count}.
</task>

<acceptance>
- No header overlap at 1024/1054/1180/1440px; no horizontal page scroll at 390px.
- Every price says รวม VAT or ก่อน VAT and matches the product page for the same item and quantity.
- Calculator numbers equal the configurator's numbers for the same inputs (add a test).
- All filters/pagination work across all ~143 items via URL; back button restores state.
- Lint, typecheck, tests pass; tests for URL state, VAT helper, RFQ persistence.
</acceptance>

<report>Summary, files, commits, screenshots (1440 light, 390 dark, table view, calculator, RFQ tray),
missing-data list, content needing business review, open questions. Then stop.</report>
```

---

## Phase 2 — Connect /products and /styles

```text
First read docs/design/products-redesign/PROMPT-products-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Product page /products/[slug]: add "แบบกล่องที่ใช้ได้" (box styles this product can be produced in, linking to
   /styles?style=CODE quick view), when the product↔style mapping exists in the API.
2. /styles quick view: add "สินค้าที่ใช้แบบนี้" (products/prices using this style) with start price, when mapped.
3. Category landing pages /products/[category]: reuse the same card, table view, mode tabs and RFQ tray.
4. Report missing product↔style mappings as a CSV (product_slug, style_code) for the business team to fill.
</task>
```

---

## Phase 3 — Reduce purchase uncertainty (run after Phase 1 + 5 customer tests)

```text
First read docs/design/products-redesign/PROMPT-products-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 3 of the /products redesign. Each item ships behind its own feature flag; turn a flag on only when its
real data/config exists. The prototype's shipping rates, zones, quote number and order history are fake.
IMPORTANT: the configurator (/configure/[slug]) ALREADY has shipping-by-postcode, "พร้อมจัดส่งเร็วสุด" date,
quantity tiers, saved quotes with a 15-day price lock and the ±5% tolerance rule. Reuse those exact services and
helpers — do not build parallel implementations; the numbers must be identical everywhere.

1. Estimated delivery date ("สั่งวันนี้ ได้รับประมาณ 2–3 พ.ย.")
   - Server-side helper: production lead time in working days (skip weekends + Thai public holidays from a
     holiday calendar table, respect a daily order cut-off time) + transit days by shipping zone.
   - Show in the calculator result, on instant-price cards ("ผลิต 5 วัน · ได้รับ ~…"), in the price table, and
     on product pages. Without a postcode use the widest zone range. Always labelled as an estimate.
2. Shipping estimate by postcode
   - 5-digit postcode input in the calculator (autocomplete="postal-code"); remember it per user.
   - Zone + reference shipping rate from the API (getpack charges customers a reference shipping rate);
     never hard-code rates. Breakdown shows "ค่าจัดส่งโดยประมาณ" on its own line; total says whether shipping
     is included. Same number must appear later in cart/checkout for the same inputs (add a test).
3. Instant quotation PDF ("ดาวน์โหลดใบเสนอราคา (PDF)")
   - From the calculator (and later the cart). Preview dialog → PDF generated server-side from one template:
     company name บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด, address, tax ID, logo, running quote number,
     date, validity days, customer/billing details (prefill from account), line items with spec, qty,
     unit price ex-VAT, shipping line, subtotal, VAT 7%, total, payment methods, tolerance/warranty terms.
   - Store issued quotes in the account (ใบเสนอราคา list) and allow "ส่งลิงก์ให้ฝ่ายจัดซื้อ" (signed, expiring
     read-only link). Prices on a quote are locked for the validity period.
4. Ready-made bundles ("ชุดพร้อมใช้")
   - Config/CMS-driven bundles referencing real products (prototype: ชุดเปิดร้านออนไลน์, ชุดแบรนด์สกินแคร์,
     ชุดเบเกอรี่และของฝาก). Card: product thumbnails, description, item list with price/availability,
     "ขอราคาทั้งชุด" adds all items to the RFQ. No discount label unless a real bundle-pricing rule exists.
5. Material sample kit ("ชุดตัวอย่างวัสดุ")
   - A real orderable SKU (price/shipping from the API) linked from the materials section; hide if the SKU does not exist.
6. Re-order from card ("สั่งซ้ำ")
   - For logged-in customers with order history: on the matching product card/table row show
     "สั่งล่าสุด {qty} {unit} · {date}" + "สั่งซ้ำ" → cart prefilled with the previous spec and quantity
     (re-priced at today's price, clearly shown before payment).
7. Analytics: products_eta_view, products_ship_estimate{zone}, products_quote_pdf{product,qty},
   products_quote_share, products_bundle_rfq{bundle}, products_sample_kit, products_reorder.
</task>

<acceptance>
- ETA, shipping and totals match cart/checkout for identical inputs.
- Holidays and cut-off time are respected (unit tests with fixed dates).
- Quote PDF renders Thai text correctly (embedded Thai font), A4, numbers tabular, totals reconcile.
- Every flag defaults off; enabling a flag without its data shows nothing broken.
</acceptance>

<report>Same report format as Phase 1.</report>
```

---

## ข้อมูลที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| ราคาต่อชิ้นจริงของสินค้าสต็อกทุกรายการ | การ์ดและตารางราคา (ตอนนี้ขึ้น "ราคาตามสเปก" ทั้งที่เป็นสินค้าพร้อมส่ง) |
| ราคาตามจำนวน (100–5,000) และราคาตามตัวเลือกพิมพ์ของสินค้าราคาทันที | เครื่องคำนวณราคาด่วน |
| ตรวจคำตอบ FAQ, รายการ "รวม/ไม่รวมในราคา", เงื่อนไขรับประกันงาน, คำอธิบายวัสดุ | เนื้อหาบนหน้า และ JSON-LD |
| การจับคู่สินค้า ↔ แบบกล่อง | Phase 2 |
| ยืนยันว่าระบบขอราคารองรับหลายรายการในคำขอเดียว | ใบขอราคารวม |
| ปฏิทินวันหยุด, เวลาตัดรอบคำสั่งซื้อ, ระยะขนส่งต่อโซน | วันที่ได้รับโดยประมาณ (Phase 3) |
| โซนขนส่งและอัตราค่าส่งอ้างอิง (reference shipping rate) | ประมาณค่าส่งจากรหัสไปรษณีย์ (Phase 3) |
| ที่อยู่บริษัท เลขประจำตัวผู้เสียภาษี โลโก้ รูปแบบเลขที่ และจำนวนวันยืนราคา | ใบเสนอราคา PDF (Phase 3) |
| รายการสินค้าในแต่ละชุด และนโยบายส่วนลดชุด (ถ้ามี) | ชุดพร้อมใช้ (Phase 3) |
| SKU และราคาชุดตัวอย่างวัสดุ | ชุดตัวอย่างวัสดุ (Phase 3) |
