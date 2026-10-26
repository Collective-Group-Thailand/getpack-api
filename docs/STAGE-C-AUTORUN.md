# Stage C — รีดีไซน์ทุกหน้าให้ตรงกับ prototype

**สถานะตอนนี้:** หน้าที่รีดีไซน์แล้วมี 1 หน้า (/styles) · อีก 10 หน้ายังเป็นดีไซน์เดิม (Stage A แก้บั๊กอย่างเดียว)

## วิธีใช้

- **1 บล็อก = 1 หน้า = 1 session** ตามลำดับในตาราง (branch ต่อกันเป็นสาย)
- **เครดิต cloud ที่เหลือ ($39):** ใช้กับ **C4 configurator** อย่างเดียว (effort medium)
- **หน้าที่เหลือ:** รันด้วย Claude Code บนเครื่องคุณ (โควตาแพ็กเกจปกติ) — ได้ทั้งสอง repo, Docker, ข้อมูล UAT จริง และไม่ต้องมีโควตา `calculate`
- ทุกบล็อกมีขั้น **"ตรงกับ prototype"** เป็นเกณฑ์ผ่าน: ถ่ายภาพ prototype เทียบหน้าจริง 3 ขนาด แล้วแก้ทุกจุดที่ต่างเพราะดีไซน์
- ก่อนเริ่ม: commit ไฟล์นี้ลง `docs/design/` ของทั้งสอง repo

| ลำดับ | หน้า | branch ← สร้างจาก | ข้อมูลที่ควรมีก่อน |
|---|---|---|---|
| C0 | ข้อมูลที่ทำให้หน้าเต็ม (API + web) | `design/styles-catalog-redesign` ← `(continue)` | CSV จากทีมธุรกิจ (catalog-commercial-data-template.csv) — ถ้ายังไม่มี ทำเฉพาะราคาเริ่มต้น |
| C4 | configurator Phase 1 | `design/configurator-redesign` ← `design/styles-catalog-redesign` | คำอธิบายวัสดุทุกตัว, ผลของ "ขอตัวอย่างจริง" ต่อราคา/วันส่ง |
| C1 | products Phase 1 → 2 | `design/products-redesign` ← `design/configurator-redesign` | ราคาสินค้าสต็อก, ราคาตามจำนวน, การจับคู่สินค้า ↔ แบบกล่อง |
| C3 | pdp Phase 1 | `design/pdp-redesign` ← `design/products-redesign` | ไฟล์แบบกล่องรายเบอร์ |
| C2 | category Phase 1 | `design/category-redesign` ← `design/pdp-redesign` | คำโปรย/FAQ ของหมวด, ข้อมูลลอน/ชั้น/ผิว |
| C5 | checkout Phase 1 | `design/checkout-redesign` ← `design/category-redesign` | ฐานรหัสไปรษณีย์, เงื่อนไขมัดจำ (ตั้งในหลังบ้าน) |
| C6 | account Phase 1 → 2 → 3 → 4 | `design/account-redesign` ← `design/checkout-redesign` | ระยะแจ้งปัญหาหลังรับของ, เกณฑ์ระดับสมาชิก |
| C7 | studio Phase 1 | `design/studio-redesign` ← `design/account-redesign` | รายการ "แบบที่คนเริ่มบ่อย" ที่ admin เลือก |
| C8 | editor Phase 1 → 2 → 3 | `design/editor-redesign` ← `design/studio-redesign` | สเปกไฟล์พิมพ์, ค่าบริการออกแบบ |
| C9 | upload Phase 1 → 2 | `design/upload-redesign` ← `design/editor-redesign` | สินค้าที่รับไฟล์เอง + แม่แบบ, โปรไฟล์ตรวจไฟล์ของทีมเตรียมพิมพ์ |
| C10 | business Phase 1 → 2 → 3 | `design/business-redesign` ← `design/upload-redesign` | ข้อมูลติดต่อ, สถานะโมดูล ERP, สัญญาพาร์ตเนอร์ |

C0 ทำเมื่อทีมธุรกิจส่ง CSV แล้ว (ทำให้ /styles และการ์ดทุกหน้ามีราคาและสเปกจริง) — รันก่อนหรือหลัง C4 ก็ได้

---

## C0 — ข้อมูลที่ทำให้หน้าเต็ม (API + web)

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: ข้อมูลที่ทำให้หน้าเต็ม (API + web).
Branch (both repos when API changes are needed): design/styles-catalog-redesign, created from its current state (continue it)
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/styles-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/styles-redesign/styles-redesign-prototype.html and the real page(s) /styles in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C0/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C0" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

Before the phase prompt, do these data steps (API repo first, then web):
- API: run the "API — getpack-api" block of docs/design/styles-redesign/PROMPT-styles-redesign.md on branch
  feat/catalog-commercial-fields (from fix/uat-phase0) — catalogue fields + CSV import + fit rule.
- API: compute a REAL "starting from" price per instant-priced style with the existing pricing engine at the
  style's default spec (same method that gives ฿15.70 for uat-postal-box-b); refresh it when prices or print
  config change (job). Never an estimate (D-220).
- Web: show starting prices on /styles cards and quick view; spec row from the new fields.
- Studio: never trim spot colours silently — preflight warning with "เปลี่ยนเป็น CMYK" / "เพิ่มจำนวนสี".
- Confirm in one line that the VAT unit tests include ฿5,178.00 → ฿338.75 and ฿4,710.00 → ฿308.13.

--- PHASE PROMPT(S) ---
First read docs/design/styles-redesign/PROMPT-styles-redesign.md, section "Shared context",
and follow its <context>, <hard_rules> and <design_system> strictly for this whole task.

<task>
Phase 2 of the /styles redesign on branch design/styles-catalog-redesign. Each feature renders only
when its data exists; otherwise ship it behind a feature flag (off) and report the missing data.

1. Search by product size ("ค้นหาด้วยขนาดสินค้า")
   - Inputs กว้าง × ยาว × สูง (cm), helper "วัดขนาดด้านนอกของสินค้า ระบบเผื่อระยะให้ 0.5 ซม. ทุกด้าน".
   - Fit rule (server-side): internal = product + 0.5cm per dimension; a style fits when each internal
     dimension is within that style's per-dimension min/max (length/width/height). Allow L/W rotation.
   - Results show a "ใส่ได้" pill; quick view shows "ขนาดภายในแนะนำ a × b × c ซม.". URL param `size`.
2. Price estimate for quote-only styles: show "ราคาประมาณ ฿a–b/ใบ" (basis 1,000 units) on cards and a tier
   table in quick view, computed by the real pricing engine/estimate fields from the API. Label as
   estimate; note "ราคาจริงขึ้นกับขนาด งานพิมพ์ และงานเคลือบที่เลือก".
3. "ช่วยเลือกให้หน่อย" wizard (dialog, 3 steps, live result count):
   จะใส่สินค้าอะไร? (multi) → กล่องจะไปอยู่ที่ไหน? (ส่งพัสดุ/ขายออนไลน์, วางขายหน้าร้าน, ของขวัญ/พรีเมียม,
   เสิร์ฟ/ใส่อาหาร) → งบประมาณต่อใบ? (≤฿10, ฿10–30, ฿30+, ยังไม่แน่ใจ).
   Answers become one removable chip "ช่วยเลือก: …" and are encoded in the URL. Track catalog_wizard events.
4. Dieline view: on hover (pointer devices) the card image cross-fades to the flat dieline with a small
   "แบบคลี่" label; quick view has a "แบบคลี่" tab with legend "เส้นทึบ = ตัด · เส้นประ = พับ".
   Use real dieline assets (pre-rendered SVG/WebP from the .ai files at build/upload time). No asset → no hover swap.
5. SEO landing pages: route `/packaging/[slug]` (SSG + revalidate), e.g. cake-boxes, mailer-boxes,
   gift-boxes, cosmetic-boxes, food-boxes, fruit-boxes, apparel-boxes, tea-coffee-boxes.
   Each = preset filter + unique 300–600 word answer-first intro + FAQ + the same grid.
   JSON-LD: ItemList + Product (offers.lowPrice for instant styles) + BreadcrumbList + FAQPage.
   Canonical: multi-filter /styles URLs canonicalise to /styles or the matching landing page; hreflang ready.
   Add the "เลือกตามการใช้งาน" link block at the bottom of /styles. Add pages to sitemap and llms.txt.
6. Trust section ("ความน่าเชื่อถือ"): certifications, food-grade docs, production photos, tax-invoice note,
   customer logos — content from CMS/config only; the whole section is hidden when empty.
   Production photos show the product and the process only: no factory name, logo, signage, location, machine
   branding, vehicles or identifiable workers (GLOBAL-RULES.md §1). Use the label "รูปงานจริงระหว่างผลิต".
</task>

<report>Same report format as Phase 1, plus: list of styles excluded from size search/estimates due to missing data.</report>
~~~~

---

## C4 — configurator Phase 1

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: configurator Phase 1.
Branch (both repos when API changes are needed): design/configurator-redesign, created from design/styles-catalog-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/configurator-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/configurator-redesign/configurator-prototype.html and the real page(s) /configure/uat-postal-box-b in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C4/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C4" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
First read docs/design/configurator-redesign/PROMPT-configurator-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Redesign the configurator per the prototype. One commit per item.
1. Layout: two columns — left: preview + all steps expanded in one scroll; right: sticky price summary
   (top offset under the header). Single column below 1100px; mobile sticky bottom bar (unit price, qty, total, CTA).
2. Sticky progress bar of step chips (ขนาด · วัสดุ · การพิมพ์ · จำนวน · การจัดส่ง · งานออกแบบ · สรุป): click to scroll;
   states = done ✓ / "ค่าเริ่มต้น" (untouched default) / to-do highlight (e.g. postcode missing).
3. Preview card: existing 3D preview (drag to rotate) + side panel with inside / outside / crease dimensions
   (3 mm rule, labelled as reference) and the current spec; show print placement for the chosen print area.
4. Size step: tabs เบอร์มาตรฐาน / กำหนดเอง. Standard sizes as a grid of cards: code, dimensions, and the unit price
   for that size at the selected quantity and current spec (from the pricing service, batched). Toggle mm ↔ cm
   (one consistent order and naming: ยาว × กว้าง × สูง). Custom: L × W × H inputs with validation and live price.
5. Material step: option cards with one-line description for EVERY material (content file) and the price delta
   vs current selection ("+฿x / −฿x / ราคาปัจจุบัน"). Default marked "ค่าเริ่มต้น".
6. Print step: outside (ไม่พิมพ์ · ดำ · สีพิเศษ 1 สี · พิมพ์ 4 สี) with explicit "ไม่พิมพ์" option replacing
   "ไม่เลือกเลยคือไม่พิมพ์"; print area chips (hidden when ไม่พิมพ์); inside print options. All with deltas.
7. Quantity step: tier cards (unit price + "ประหยัด x%" vs the smallest priced tier), custom quantity input that
   adds a card, and a collapsed "มีงบต่อชิ้นในใจ? (ไม่บังคับ)" with the existing target-price behaviour and copy
   "ตัวเลขนี้ใช้ภายในทีมงานเท่านั้น ไม่แสดงต่อผู้อื่น".
8. Shipping step: postcode (autocomplete="postal-code", remembered per user) → zone name, shipping line in the
   summary, arrival date range; note "ที่อยู่เต็มระบุตอนชำระเงิน แบ่งส่งหลายที่อยู่ได้".
9. Design step: three paths — มีไฟล์งานแล้ว (pre-selected from ?design=own_file — that bug fix is owned by the upload
   pack Phase 0; once the upload pack Phase 2 ships, this option links to /studio/upload with the current
   product/size/print/qty so the file is checked BEFORE it goes into the cart; until then keep today's flow and say
   exactly that: "อัปโหลดไฟล์หลังสั่งซื้อ ทีมงานตรวจไฟล์ให้ก่อนผลิต"), ออกแบบในสตูดิโอ
   (open the Studio with this product/size/print preset — new path), จ้างนักออกแบบ (brief, 3 free revisions);
   checkbox "ขอตัวอย่างจริงก่อนผลิต" using the existing sample-request flow (date impact from the service).
10. Standards & next steps card: tolerances (qty ±5% credit, size ±3 mm, colour ΔE2000 ≤ 3) and the next-steps list
    with the ready date.
11. Summary (sticky): unit price, goods line, shipping line (or "ระบุรหัสไปรษณีย์" link to step 5), VAT included
    amount, total (label "ไม่รวมค่าส่ง" when no postcode), arrival/ready date, production days, tolerance line;
    primary "เพิ่มลงตะกร้า" (or "ขอใบเสนอราคา" when not auto-priced); secondary ใบเสนอราคา (15-day lock),
    แชร์ลิงก์ (15 days), PDF; retention note (ร่าง 90 วัน). Completeness meter + discount code field moved here
    from the design step.
12. Read URL params from the product page (size, material, print, qty) and preselect them; keep state in the URL.
13. Analytics: cfg_option_change{step,option,value,delta}, cfg_size_mode, cfg_qty_custom, cfg_target_price_set,
    cfg_postcode_set{zone}, cfg_design_path, cfg_sample_toggle, cfg_cta{cta}, cfg_quote_only_shown{size,qty}.
</task>

<acceptance>
- Price shown on every option card equals the summary price after selecting that option (automated test).
- Summary stays visible while scrolling all steps on desktop; no layout shift on price updates.
- Values from the product page arrive preselected; refresh keeps state.
- Lint, typecheck, tests pass; no raw i18n keys rendered.
</acceptance>

<report>Summary, files, commits, screenshots (1440 default, 1440 with postcode + 4-colour, quote-only state,
390 dark), open questions. Stop.</report>
~~~~

---

## C1 — products Phase 1 → 2

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: products Phase 1 → 2.
Branch (both repos when API changes are needed): design/products-redesign, created from design/configurator-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/products-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/products-redesign/products-redesign-prototype.html and the real page(s) /products in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C1/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C1" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
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

First read docs/design/products-redesign/PROMPT-products-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Product page /products/[slug]: add "แบบกล่องที่ใช้ได้" (box styles this product can be produced in, linking to
   /styles?style=CODE quick view), when the product↔style mapping exists in the API.
2. /styles quick view: add "สินค้าที่ใช้แบบนี้" (products/prices using this style) with start price, when mapped.
3. Category landing pages /products/[category]: reuse the same card, table view, mode tabs and RFQ tray.
4. Report missing product↔style mappings as a CSV (product_slug, style_code) for the business team to fill.
</task>
~~~~

---

## C3 — pdp Phase 1

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: pdp Phase 1.
Branch (both repos when API changes are needed): design/pdp-redesign, created from design/products-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/pdp-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/pdp-redesign/pdp-postal-box-prototype.html and the real page(s) /products/uat-postal-box-b in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C3/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C3" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
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
~~~~

---

## C2 — category Phase 1

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: category Phase 1.
Branch (both repos when API changes are needed): design/category-redesign, created from design/pdp-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/category-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/category-redesign/category-corrugated-prototype.html and the real page(s) /products/corrugated in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C2/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C2" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
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
~~~~

---

## C5 — checkout Phase 1

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: checkout Phase 1.
Branch (both repos when API changes are needed): design/checkout-redesign, created from design/category-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/checkout-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/checkout-redesign/checkout-prototype.html and the real page(s) /cart, /checkout in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C5/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C5" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
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
~~~~

---

## C6 — account Phase 1 → 2 → 3 → 4

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: account Phase 1 → 2 → 3 → 4.
Branch (both repos when API changes are needed): design/account-redesign, created from design/checkout-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/account-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/account-redesign/account-orders-prototype.html and the real page(s) /account, /account/orders, /account/orders/<id> in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C6/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C6" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
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

First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Reuse the "ต้องทำตอนนี้" cards and the latest 3 order cards from Phase 2.
2. Continue designing (drafts with working thumbnails), quick reorder of the last produced items, open quotes with
   price-lock expiry, points/credit/tier with a clear rule of what counts.
3. Business accounts: pending approvals, budget usage, company catalogue shortcut (from the business pack).
</task>
~~~~

---

## C7 — studio Phase 1

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: studio Phase 1.
Branch (both repos when API changes are needed): design/studio-redesign, created from design/account-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/studio-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/studio-redesign/studio-prototype.html and the real page(s) /studio in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C7/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C7" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

Also: make every style open in the Studio (DECISIONS §2) — fix the 41 styles that cannot open, or list exactly what data each still needs.

--- PHASE PROMPT(S) ---
First read docs/design/studio-redesign/PROMPT-studio-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Hero (dark stage band): eyebrow "getpack studio", H1 "กล่องของแบรนด์คุณ ออกแบบเสร็จในไม่กี่นาที", lede,
   CTAs "เริ่มออกแบบ" (scroll to paths) and "ลองกับแบบตัวอย่าง" (existing no-save sample session), 3 proof lines
   (ใช้งานฟรี จ่ายเมื่อสั่งผลิต · ใช้ฟอนต์ของแบรนด์เองได้ · ไฟล์แบบกล่อง .ai ฟรี).
2. Live mini-editor in the hero: "ใช้โลโก้ของคุณ" upload (button + drag-and-drop onto the editor; PNG/JPG/SVG/WEBP,
   max 5 MB) placed on the dieline thumbnail and mapped onto the 3D box faces; the file stays client-side until the
   customer saves (say so in the UI — PDPA/brand confidentiality); the logo carries into the editor without re-upload.
   Fallback: brand-name input rendered on the dieline thumbnail and on the 3D box, size chips
   (A/B/C/D of the postal box), print-colour swatches, price from the pricing service for the chosen size
   (label when the colour's price isn't computed here). Use the real 3D renderer if light enough, else the static
   iso + client-side text. "เปิดในสตูดิโอ" carries the brand text, size and colour into the editor.
3. Bento entry paths: large card "เลือกแบบกล่องแล้วออกแบบ" with 4 style thumbnails (real images) → style picker;
   "มีสินค้าแล้ว อยากได้กล่อง" → inline finder; "มีไฟล์แบบแล้ว" with a real drop zone that starts the upload flow;
   "สั่งซ้ำจากงานเดิม" only when the customer has orders.
4. Inline finder (replaces the modal): units มม./ซม./นิ้ว with conversion, L × W × H, use (ส่งพัสดุ / ขนส่งบนพาเลท /
   วางขายหน้าร้าน), live results from the existing recommendation service (3 styles with reasons, recommended inside
   size, price), "ออกแบบแบบนี้" opens the editor with the style + size. Keep `?start=product` scrolling here.
5. "ทำอะไรได้ในสตูดิโอ" (6 items: แผ่นคลี่จริง + 3D, วางโลโก้และภาพ, ฟอนต์ของแบรนด์, ราคาอัปเดตทันที,
   ไฟล์ .ai ฟรี, ทีมช่วยดูแบบร่าง).
6. "แบบที่คนเริ่มบ่อย": 6 styles ordered by real usage (fallback: curated list in config — never claim popularity
   without data), each "เปิดในสตูดิโอ".
7. "แบบล่าสุดของคุณ": saved drafts with thumbnail, name, edited date, open/duplicate; empty state with
   "ลองแบบตัวอย่าง".
8. Header: on /studio the header CTA becomes "สินค้าและราคา" (avoid linking to the current page).
9. Analytics: studio_hero_interact{field}, studio_hero_open_editor, studio_path{path}, studio_finder_submit{unit,use},
   studio_finder_pick{style,rank}, studio_template_open{style}, studio_try_sample, studio_draft_open.
</task>

<acceptance>
- /studio/new and all old links land on /studio with the right section; one style count everywhere.
- Hero LCP < 2.5s on mobile 4G; mini-editor works with keyboard; values carry into the editor.
- Lint, typecheck, tests pass; screenshots 1440 / 390 light + dark.
</acceptance>
~~~~

---

## C8 — editor Phase 1 → 2 → 3

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: editor Phase 1 → 2 → 3.
Branch (both repos when API changes are needed): design/editor-redesign, created from design/studio-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/editor-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/editor-redesign/editor-prototype.html and the real page(s) /studio/<id> (both modes) in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C8/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C8" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Layout: top bar (logo, editable name, save status, mode switch ง่าย/มืออาชีพ, undo/redo, steps ออกแบบ ·
   ตรวจงาน (issue badge) · สั่งผลิต, theme, แชร์, Mockup, ส่งออก (pro), price chip, สั่งผลิต disabled when there are
   errors), icon rail + asset panel, canvas, inspector with tabs ออกแบบ / ตรวจงาน / สั่งผลิต, status bar.
2. Canvas: dieline fills the stage (fit on load, on resize and on mode switch), zoom 20–600% (+/−, ⇧1 fit,
   ⌘/Ctrl+wheel), Space+drag pan, panel labels, cut (solid) / fold (dashed) lines; bleed and safe-zone 3 mm.
   3D is a live picture-in-picture card (top-right, never covering the dieline at fit) that opens Mockup;
   views แผ่นคลี่ / แผ่นคลี่ + 3D / 3D; sides ด้านนอก / ด้านใน.
3. Selection: click, drag with snapping to panel centres and edges (red guide lines, Alt disables), 4 corner handles
   (keep ratio for image/text/QR/symbol, ⇧ for others; text resize scales pt), size label in mm, double-click to edit
   text, arrows ±1 / ⇧ ±10 mm, Delete, ⌘D, ⌘] ⌘[, Escape.
4. Live preflight markers on the canvas (red = must fix, amber = advice) that open the issue; badge counts in the
   steps and tab; "พร้อมพิมพ์" state in the status bar.
5. Mode preference saved to the account (fallback localStorage); first-open chooser dialog (3 cards + file link).
6. Analytics: editor_open{mode}, editor_mode_switch{from,to}, editor_welcome_pick{choice}, editor_tool{tool},
   editor_issue_view{rule}, editor_autofix{rule,count}, editor_order_click{errors}.
</task>

<acceptance>
- Existing drafts open unchanged; switching modes never changes the document.
- Screenshots 1440 / 1024 / 390 for both modes, light + dark; no horizontal scroll at 360.
</acceptance>

First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Rail (easy): แม่แบบ, แบรนด์, ข้อความ, รูปภาพ, ตกแต่ง, พื้นหลัง, กล่อง, ความเห็น. Hide rulers, numeric fields,
   bleed/safe overlays, CMYK, layers, variants, export menu, history.
2. Inspector, nothing selected: "ออกแบบเสร็จใน 4 ขั้น" with progress bar (เลือกแม่แบบ → ใส่โลโก้ → แก้ข้อความ →
   ตรวจงานและสั่งผลิต; each step jumps to the right place) + quick actions (แก้ข้อความ, ใส่โลโก้, เปลี่ยนสีกล่อง,
   ดูกล่องจริง 3D).
3. Inspector, object selected: header (type + which panel it is on), text box, font select (brand fonts first),
   size slider in pt (6–60), bold, alignment; size slider in mm for non-text; colour swatches (brand + black + white
   + custom); plain-language image quality ("ภาพคมชัด พร้อมพิมพ์" / "อาจไม่คม" / "ภาพเล็กเกินไป"); 9-cell position
   grid inside the current panel (5 mm margin); big buttons ทำสำเนา / ลบ / ขึ้นหน้า / ไว้ข้างหลัง.
4. Auto-fix in ตรวจงาน (both modes): each fixable issue has "แก้ให้", plus "แก้ทั้งหมด" when > 1; every fix is one
   undo step. Rules → fix: outside sheet / crosses fold / inside safe zone → move (and shrink if needed) into the
   panel with the most overlap, 4 mm margin; text < 6 pt → 7 pt; image < 150 dpi → shrink to 300 dpi size; stroke
   < 0.25 mm → 0.3 mm; colours vs print mode → switch to 4 สี (tell the price change before applying).
5. Smart nudge: when an easy-mode user uploads a font (or tries a pro shortcut), show a toast with
   "เปิดโหมดมืออาชีพ".
6. Industry templates (business provides the content): apply with the customer's brand kit (logo, colours, fonts).
</task>

<acceptance>
- A first-time user can go from template to "พร้อมพิมพ์" without opening the pro mode (usability test, 5 users).
</acceptance>

First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Toolbox (vertical on desktop, horizontal bar < 900 px), with tooltips and single-key shortcuts:
   V เลือกและย้าย · H เลื่อนมุมมอง · Z ซูม (Alt ซูมออก) · T ข้อความ (click to place) · R สี่เหลี่ยม · E วงรี
   (drag, ⇧ = square/circle) · L เส้นตรง (⇧ = 45°) · P ปากกา (click points, ⇧ = straight, click first point to
   close, Enter/double-click to finish, Backspace removes last point, Esc cancels) · I ที่ดูดสีและรูปแบบ (copies
   fill/gradient/stroke, and font/weight between texts) · C ปักหมุดความเห็น. Tools revert to V after one shape.
2. Selection: ⇧+click toggle, marquee on empty canvas, ⌘A; move together; inspector for multi: align to selection
   (6), distribute horizontally/vertically (≥ 3), colour all, duplicate/order/delete. ⌘C ⌘X ⌘V (paste +5 mm).
3. Rulers (mm) and guides: click a ruler to create a guide and drag it; drag back into the ruler to delete; guides
   saved with the document. Smart snapping to panel edges/centres, other objects' edges/centres and guides.
4. Inspector (single): name, X/Y/W/H mm, rotation, opacity, flip H/V, rotate 90°, align to panel (6); text: font,
   pt, weight, tracking, line height, alignment, "แปลงเป็นเส้น" (done automatically on PDF export); fill: solid or
   linear gradient (2 colours + angle) with HEX + CMYK; stroke: colour, width mm, solid/dashed/dotted, none;
   rectangle corner radius; image: file px, effective dpi, "ภาพสีเดียว" (for black/spot print), remove background
   and crop (when available); "เปลี่ยนตามรุ่น" toggle; duplicate/front/back/lock/delete.
5. Panels (pro rail adds): ชั้น (hide, lock, rename, reorder), สีในงาน (all colours used with CMYK and usage count;
   recolour one colour across the whole job, both sides and all variants; save to brand kit; ink count vs selected
   print mode), รุ่น (variants with per-variant text/colour overrides and quantities), ประวัติ (versions, restore).
6. Print view menu (top-right of canvas): guide toggles (cut, fold, bleed, safe, labels, 10 mm grid) +
   "จำลองหมึกบนผิวกล่อง" (multiply on kraft) + "แยกหมึก" (all / black only / colours only).
7. Export (pro): PDF/X-4 print-ready (CMYK, outlined text, separate die-cut layer, bleed), Illustrator .ai with
   layers, SVG, PNG 300 dpi, dieline only (DXF / blank .ai — free), mockup image set; Import: PDF/.ai placed on the
   dieline with the same preflight.
8. Keyboard shortcut sheet (?) lists all of the above.
</task>

<acceptance>
- A designer can build a full outside + inside artwork (logo, texts, shapes, a custom path, gradient, barcode, QR)
  and export a PDF the prepress team accepts without changes (test with 3 real jobs).
- 50-object document stays at 60 fps while dragging; undo/redo covers every operation.
</acceptance>
~~~~

---

## C9 — upload Phase 1 → 2

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: upload Phase 1 → 2.
Branch (both repos when API changes are needed): design/upload-redesign, created from design/editor-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/upload-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/upload-redesign/upload-prototype.html and the real page(s) /studio/upload in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C9/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C9" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Header: crumbs, H1 "มีไฟล์แล้ว อัปโหลดเลย", lede (only claims that are true once Phase 2 ships), proof line
   (ตรวจไฟล์อัตโนมัติ 12 ข้อ · ทีมเตรียมพิมพ์ตรวจซ้ำทุกงาน · ไฟล์ของคุณเป็นความลับ).
2. Drop zone (whole card, keyboard operable): multiple files (each file = one version/variant in the same order),
   resumable upload with progress, type/size validation, "ลองด้วยไฟล์ตัวอย่าง".
   Import: Google Drive, Dropbox, OneDrive pickers (official SDKs/OAuth, read-only, single file scope) and "วางลิงก์"
   (server fetches public links: WeTransfer, Drive share links; follow redirects safely, size cap configurable,
   reject non-PDF/AI by magic bytes). Upload by e-mail: per-account address (upload+<account>@…) → same pipeline,
   result e-mailed back; show the address with copy. "API องค์กร" links to docs (Phase 4).
3. Template downloader beside the drop zone: product + size (all real sizes per product), live dieline preview,
   ".ai" and "PDF" download of the exact template (layers Dieline / Artwork, 3 mm bleed box). Fixes the /styles link.
4. "สั่งซ้ำจากไฟล์เดิม" (signed-in, has produced own-file orders): thumbnail, file name, spec, last order date and
   qty, "ดู" and "สั่งซ้ำ" (loads the produced print file — no re-check — at today's price).
5. Lower sections: ตรวจอะไรบ้าง (12 cards), เตรียมไฟล์ให้ผ่านในครั้งเดียว (6 steps + Illustrator .joboptions,
   Figma plugin, Canva export guide, Studio), หลังจากสั่งซื้อ (4 steps), FAQ (confidentiality, accepted files,
   failing files, non-getpack dielines).
6. Analytics: upload_start{source: drop|picker|drive|dropbox|onedrive|link|email}, upload_done{size_mb},
   upload_fail{reason}, template_download{product,size,format}, reorder_click.
</task>

First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Server pipeline (queue, idempotent, observable): read PDF/AI → find die-cut/fold paths (spot colour or layer
   names used by our templates; fallback geometry) → match against product templates and sizes (tolerance ±1 mm) →
   run the preflight → render a flat preview PNG/SVG and the faces for 3D → store results. Target < 30 s for a
   20 MB file; progress events to the page (5 stages as in the prototype); notify by e-mail/LINE if the user left.
2. Detection banner: "ไฟล์นี้คือ <product> เบอร์ <size> · <inside dims> · อ่านจากเส้นไดคัทในไฟล์"; if the customer
   changes product or size and it no longer matches, raise a blocking "ไม่ตรงกับไฟล์" item with "ใช้ขนาดตามไฟล์".
3. The 12 checks (shared engine with the editor): dieline/size match · bleed 3 mm · safe zone 3 mm · images ≥ 300
   effective dpi · fonts embedded/outlined · CMYK · ink count vs print method · text ≥ 6 pt · strokes ≥ 0.25 mm ·
   barcode/QR size, quiet zone, not over folds · die-cut on a non-printing layer · small text in 100 % K.
   Levels: ต้องแก้ (blocks cart) / ควรดู / ระบบแก้ให้ได้ / ผ่าน. Each item: what, where (numbered marker on the
   dieline, click ↔ item), how to fix in Illustrator, actions. Auto-fixes (RGB→CMYK with before/after swatch,
   outline fonts, separate die-cut layer, rich-black small text) create a derived print file; original kept.
4. Workspace: file chips (version v1, v2…, status dot, remove), "เพิ่มไฟล์ (รุ่นใหม่)", preview tabs แผ่นคลี่ / 3D,
   checklist with counts, "แก้ทั้งหมด", "อัปโหลดไฟล์ที่แก้แล้ว" (new version, re-check), downloadable check report
   PDF, file history (versions with result, view).
5. Spec & price card (sticky): product, inside size, material, files/versions; detected inks with recommended print
   method and the cheaper alternative; quantity tiers with unit prices (one file) or per-file quantities (many);
   unit price, lines (goods, per-version fee, prepress fix, physical sample), total incl. VAT; production and ready
   date; tolerances; blocker message; "เพิ่มลงตะกร้าพร้อมไฟล์" (disabled while blocking items remain, or price is not
   automatic → "ขอใบเสนอราคา"); "ใบเสนอราคา"; "ส่งให้อนุมัติ".
6. "ให้ทีมเตรียมพิมพ์แก้ให้" per file: adds the service line, unblocks the cart, creates a prepress task with the
   check report; the customer approves the corrected proof before production.
7. "เปิดในสตูดิโอ": convert the checked file into an editable Studio design (text stays editable when fonts are
   embedded; images and vectors become objects; die-cut mapped to the template) — keep the original print file
   alongside; tell the customer what could not be converted.
8. Analytics: preflight_done{errors,warnings,auto}, autofix_apply{rule}, detect_mismatch{type}, team_fix_add,
   open_in_studio, add_to_cart_with_file{versions}.
</task>

<acceptance>
- 10 real customer files from prepress produce the same verdict as the prepress team (document differences).
- Cart line carries the derived print file id + original file id + check report id.
</acceptance>
~~~~

---

## C10 — business Phase 1 → 2 → 3

~~~~text
Run this page in ONE Claude Code session on your computer (both repos available: ../getpack-web and
../getpack-api, local API at localhost:3000 with the UAT copy DB, Docker for e2e) — or in a cloud session.
Read docs/design/GLOBAL-RULES.md and docs/design/DECISIONS-STAGE-A.md first (precedence: GLOBAL-RULES →
DECISIONS → prompt packs). Page: business Phase 1 → 2 → 3.
Branch (both repos when API changes are needed): design/business-redesign, created from design/upload-redesign
(git fetch; if it exists, continue it; merge forward, never rebase; never merge or PR to main; never force-push).

Run the phase prompt(s) below in order WITHOUT stopping between them ("stop for approval" lines are replaced by
the gate). If a phase needs API changes, make them in getpack-api on the same branch name first, write
docs/design/business-redesign/API-CHANGES.md in both repos, regenerate web types (`pnpm gen:api`), then do the web part.
Missing business data → hide the element (never sample data) and list it as OPEN QUESTION.

MATCH THE PROTOTYPE — this is the acceptance bar, not a nice-to-have:
- Open docs/design/business-redesign/business-contact-partners-prototype.html and the real page(s) /business, /contact, /partner-with-us in Playwright at 1440 px light, 1054 px light
  and 390 px dark. Compare section by section: layout, spacing, type sizes, colours, states, copy, empty states.
- Fix every difference that is styling or structure. Allowed differences only: missing real data, the repo's
  design-language tests/ADRs, photos instead of illustrations — each listed with its reason.
- Save prototype / before / after screenshots to docs/design/screenshots/C10/.

Gate (per phase and at the end): lint · typecheck · related tests · build · e2e for the touched area when Docker
is available · no horizontal scroll at 390 px · dark mode readable · grep of customer-facing files for "โรงงาน",
factory/partner counts, sample data or AI-image wording. 1 fix attempt per failure; still failing → BLOCKED.
Commit per numbered item, push. Report: append "C10" to docs/design/STAGE-C-REPORT.md (max 40 lines: phases ·
status · commits · remaining differences vs prototype with reasons · open questions · what I must check).
Stop and wait for me.

--- PHASE PROMPT(S) ---
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
~~~~