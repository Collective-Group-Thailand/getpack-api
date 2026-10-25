# getpack — /styles Catalogue Redesign · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอกไฟล์ทั้ง 4 ไฟล์ในชุดนี้ไปไว้ที่ `getpack-web/docs/design/styles-redesign/`
   - `PROMPT-styles-redesign.md` (ไฟล์นี้)
   - `styles-redesign-prototype.html`: ต้นแบบที่กดใช้งานได้ เปิดในเบราว์เซอร์ แล้วกด "ดูสิ่งที่เปลี่ยน" เพื่ออ่านเหตุผลและ dev spec
   - `design-tokens.css`: สี ฟอนต์ ขนาดมุมโค้ง แบบ Light/Dark
   - `catalog-commercial-data-template.csv`: แม่แบบข้อมูลที่ทีมธุรกิจต้องกรอก (ขนาดที่ผลิตได้ ขั้นต่ำ ระยะผลิต ราคาประมาณ ฯลฯ)
2. เปิด Claude Code ใน Claude desktop ที่โฟลเดอร์ `getpack-web`
3. รัน prompt ทีละขั้นตามลำดับ: **Phase 0 → 1 → 2 → 3** และ **API** (รัน API ใน `getpack-api` ระหว่าง Phase 1–2 ได้)
4. ทุก Phase จบด้วยรายงาน ให้ตรวจ branch และ screenshot ก่อนสั่ง Phase ถัดไป
5. คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง ทุกบล็อกสั่งให้ Claude อ่านส่วน **Shared context** ในไฟล์นี้ก่อนเริ่มงานอยู่แล้ว (จึงต้องวางไฟล์ไว้ใน repo ตามข้อ 1)

---

## Shared context (embedded in every phase prompt below)

```text
<context>
Project: getpack storefront (getpack.co) by Collective Group (Thailand).
Frontend: Next.js app `getpack-web` (customer + admin). Backend: NestJS `getpack-api`.
Page in scope: the public box-style catalogue at `/styles` (title "คลังแบบกล่องและบรรจุภัณฑ์").
Catalogue data/images currently come through the BFF (e.g. `/bff/v1/store/catalog/...`).

Reference material (read before coding):
- docs/design/styles-redesign/styles-redesign-prototype.html — interactive hi-fi prototype.
  Open it in a browser. The "ดูสิ่งที่เปลี่ยน" dialog contains the full change log and dev spec
  (URL params, SEO routes, analytics events, perf budget, rollout phases).
- docs/design/styles-redesign/design-tokens.css — colour/type/radius tokens, light + dark.
- docs/design/styles-redesign/catalog-commercial-data-template.csv — the commercial fields the UI needs.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: create/continue branch `design/styles-catalog-redesign` from the current working branch.
   Small commits per task. Never merge to main, never force-push. I review the branch myself.
2. The prototype is a visual + behaviour reference, NOT code to copy. Rebuild it with this repo's
   existing stack and conventions (component library, styling approach, data fetching, routing, i18n).
   Reuse existing components (header, compare, favourites, cart, auth) instead of duplicating them.
3. NEVER ship sample data. These prototype values are fake: size ranges, MOQ, lead times, price
   estimates, tier prices, LINE ID "@getpack", account projects/orders, trust-section content.
   Read real fields from the API. If a field is missing/null → hide that UI element entirely
   (no placeholder text, no "0", no "—"). Collect every missing field in the phase report.
4. The isometric SVG drawings in the prototype are placeholders. Keep using the real catalogue
   images from the API. Do not add any badge, caption, alt text or metadata saying images are AI-generated.
5. Trust section (certifications, customer logos, production photos) renders only from real,
   configured content. Never render "LOGO" boxes or placeholder copy in production.
6. Copy: use the Thai copy from the prototype verbatim unless it conflicts with existing approved copy.
   Brand name is always lower-case Latin "getpack". Rename "แบบย่อย" → "ตัวเลือก" on this page.
7. Accessibility: full keyboard support, visible focus, correct roles/aria for tabs, switches,
   dialogs/drawers (focus trap + Esc + return focus), checkbox groups; honour prefers-reduced-motion.
8. SEO/AEO/GEO: results are server-rendered from searchParams; JSON-LD per the spec; canonical rules.
9. Performance budget (mobile 4G field data): LCP < 2.5s, INP < 200ms, CLS < 0.1.
   next/image with correct `sizes`, first row `priority`, rest lazy; fixed aspect-ratio media;
   heavy UI (quick view, wizard, 3D) via dynamic import.
10. Don't break existing routes, APIs or tests. If something in this brief conflicts with the codebase,
    stop and ask instead of guessing.
</hard_rules>

<design_system>
- Tokens: design-tokens.css (map into the existing theme; do not create a second parallel system).
  Brand green #17573F (dark #56BC91); "ราคาทันที" uses its own amber status colour, not the brand colour.
- Fonts: Anuphan (headings), IBM Plex Sans Thai (body/UI), IBM Plex Mono (style codes like PK-RG-01).
  Load via next/font with Thai + Latin subsets.
- Radius: 8 / 12 / 16. Cards: 1px border, shadow only on hover. Layout gaps via flex/grid gap.
- Light and dark themes both required. Tabular numbers for prices/counts.
</design_system>
```

---

## Phase 0 — Discovery & plan (no code)

```text
First read docs/design/styles-redesign/PROMPT-styles-redesign.md, section "Shared context",
and follow its <context>, <hard_rules> and <design_system> strictly for this whole task.

<task>
Phase 0 of the /styles redesign. DO NOT write or change code in this phase.

1. Open and study docs/design/styles-redesign/styles-redesign-prototype.html (all states: filters,
   size search, quick view, wizard, compare tray, mobile 390px, dark mode) and its "ดูสิ่งที่เปลี่ยน" notes.
2. Inspect the repo: the /styles route, its components, data fetching, API types/DTOs for catalogue
   styles and facets, existing compare/favourite/cart/auth/analytics/i18n utilities, header component,
   and how the Studio (design editor) is opened for a given style.
3. Reproduce the current header bug: at ~1054px width the nav item "สตูดิโอออกแบบ" overlaps the logo
   and "ติดต่อ" is covered by the search icon. Find the cause.
4. Produce `docs/design/styles-redesign/PLAN.md` containing:
   a. Mapping table: prototype section → files to create/modify → reused components.
   b. Data gap table: every field the new UI needs vs what the API returns today
      (use catalog-commercial-data-template.csv columns as the checklist). Mark: available / derivable / missing.
   c. Facet structure today (labels like "ก้นกล่อง: ก้นล็อกอัตโนมัติ") and how you'll group them
      into sub-groups (strip the "group:" prefix).
   d. Risks, open questions, and an ordered task list for Phase 1.
5. Stop and wait for my approval.
</task>
```

---

## Phase 1 — Foundations (header, filters, cards, quick view, URL state, VAT, LINE, analytics)

```text
First read docs/design/styles-redesign/PROMPT-styles-redesign.md, section "Shared context",
and follow its <context>, <hard_rules> and <design_system> strictly for this whole task.

<task>
Phase 1 of the /styles redesign, following the approved docs/design/styles-redesign/PLAN.md.
Match the prototype's layout, spacing, states and copy. One commit per numbered item.

1. Header
   - Fix the overlap bug at 1024–1180px. Show the account as an avatar with initials (full name in
     tooltip + menu). Below 1040px collapse nav into a hamburger menu. Cart icon shows item count.
2. Page head
   - Breadcrumb, H1 "คลังแบบกล่องและบรรจุภัณฑ์", one-paragraph lede with live totals
     ("{n} โครงสร้างหลัก · {m} ตัวเลือก"). Height ~40% smaller than today so the first product row is above the fold at 1440×900.
   - Large search input: live results (debounce ~160ms, no submit button needed), "/" focuses it,
     "ค้นหาบ่อย" quick terms (source: config now, analytics later). Search tabs: "ค้นหาด้วยคำ" (this phase)
     and "ค้นหาด้วยขนาดสินค้า" (Phase 2, render the tab only when size data exists).
3. Category rail
   - Replaces the old category chips. Icon + name + count per category, horizontal scroll on mobile, selected state.
4. Filters (one system only)
   - Remove the old 3-layer duplication. "แบบหลัก / ทุกตัวเลือก" becomes a view toggle in the toolbar, not a filter.
   - Sidebar: "ราคาทันทีเท่านั้น" switch at top; collapsible groups; sub-group headings with the
     repeated prefix stripped; checkboxes with counts; first 5 items + "ดูเพิ่มอีก N รายการ";
     "เหมาะกับ" as chips; materials with colour swatches.
   - OR within a group, AND across groups. Counts come from the API.
   - Active filters shown as removable chips above results + "ล้างทั้งหมด".
   - ≤1040px: filters open as a bottom sheet with "แสดงผลลัพธ์".
5. Toolbar: result count, view toggle, sort (ยอดนิยม / มาใหม่ / ราคาทันทีก่อน / ชื่อ ก–ฮ),
   "ราคารวม VAT" switch, copy-link button.
6. Product card (exact anatomy from prototype)
   - Image stage (real photo) · "ราคาทันที" badge only for instant-price styles (remove the
     "ขอใบเสนอราคา" badge) · "{n} ตัวเลือก" pill · favourite heart on image (visible on hover / always on touch).
   - Body: style code (mono) · family · name (2-line clamp, fixed height) · spec row (size range,
     MOQ, lead time — each hidden if missing) · max 2 option tags + "+n".
   - Footer: price ("เริ่มต้น ฿x/ใบ" for instant, "ราคาประมาณ ฿a–b/ใบ" for quote when estimate exists,
     otherwise "ขอใบเสนอราคา") + "เปรียบเทียบ" checkbox.
   - All cards in a row equal height. Grid: auto-fill min 228px; 2 columns on mobile.
7. Compare tray: floating bottom bar, up to 4 styles with thumbnails, toast when exceeding 4.
   Reuse the existing compare page/logic for the "เปรียบเทียบ" action.
8. Quick view drawer (right side; full-screen sheet on mobile)
   - Opens on card click; URL param `style=PK-XX-00` so it is shareable and survives refresh.
   - Content: image (+ "แบบคลี่" tab only if a dieline asset exists), option groups, spec grid
     (size range, material, MOQ, lead time, pricing method, use cases, tax-invoice note),
     quantity-tier table (500/1,000/3,000/5,000) ONLY from real pricing data, VAT note.
   - CTAs: "เริ่มออกแบบแบบนี้" → existing Studio route with this style preselected;
     "ดาวน์โหลด dieline (.ai) ฟรี" if the file exists; "สั่งกล่องตัวอย่าง" only if a sample flow exists
     (otherwise hide and list it in the report); "เพิ่มลงตะกร้า" (instant) / "ขอใบเสนอราคา" (quote).
9. URL state contract (server-rendered from searchParams):
   cat, q, size (LxWxH), use, mat, close, feat, fam, eco (comma-separated), price=instant,
   view=all, sort, page, style. Defaults are omitted. Typing/filtering → router.replace;
   category change → router.push. Copy-link button copies the canonical URL.
10. VAT switch (site-wide rule, same as /products): default ON = show VAT-inclusive prices, matching the
    existing product pages which already display "รวม VAT". Switch OFF shows ex-VAT. First check whether the API
    returns VAT-inclusive or exclusive amounts, then implement ONE shared price-display helper used by /styles,
    /products and product pages. Persist the choice per user (account setting if logged in, localStorage
    otherwise, wrapped in try/catch).
11. LINE OA button: floating bottom-right, popover with LINE ID + copy + "เพิ่มเพื่อนใน LINE" +
    "ฝากเบอร์ให้โทรกลับ". ID comes from env/config (e.g. NEXT_PUBLIC_LINE_OA_ID); hide the button if unset.
    Moves up when the compare tray is open. Don't use the LINE logo artwork; a chat icon + text is fine.
12. Empty state: message + "ล้างตัวกรองทั้งหมด" + "ขอแบบใหม่จากทีม" (link to existing contact/RFQ flow).
13. Analytics: use the existing analytics lib (or a thin `track()` wrapper if none) for:
    catalog_search{query,mode,result_count}, catalog_filter{facet,value,action,result_count},
    catalog_quickview{style_code,position,source}, catalog_cta{style_code,cta},
    catalog_compare{style_codes}. Zero-result searches must be queryable.
14. Load more: batches of 24 with "แสดง x จาก y" + progress bar (keep pagination URL-addressable).
</task>

<acceptance>
- No horizontal scroll at 390px; header has no overlap at 1024, 1054, 1180, 1440px.
- All interactive elements reachable by keyboard; drawers/dialogs trap focus and close on Esc.
- No fake data rendered anywhere; missing fields hidden.
- Lint, typecheck and existing tests pass; add tests for URL-state parsing/serialising and facet grouping.
- Lighthouse mobile ≥ 90 performance on the page (and note field-data plan).
</acceptance>

<report>
At the end: summary, files changed, commits, screenshots (1440 light, 1054 light, 390 dark, quick view,
filters sheet), missing-data list, open questions. Then stop.
</report>
```

---

## Phase 2 — Decision aids (size search, price estimate, wizard, dieline, SEO, trust)

```text
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
```

---

## Phase 3 — Returning business customers (account, re-order, 3D fold, EN, eco)

```text
First read docs/design/styles-redesign/PROMPT-styles-redesign.md, section "Shared context",
and follow its <context>, <hard_rules> and <design_system> strictly for this whole task.

<task>
Phase 3 of the /styles redesign on branch design/styles-catalog-redesign.

1. Account menu (avatar) — use the SAME labels and routes as the account pack Phase 1 nav: คำสั่งซื้อ (badge = items
   needing action) · ใบเสนอราคา (badge with pending count) · งานออกแบบ · สั่งซ้ำ · เอกสาร · ข้อมูลบัญชี ·
   ทีมและผู้อนุมัติ (only when the checkout pack Phase 2 approval feature exists) · ออกจากระบบ. Link to existing /account routes; hide items whose feature doesn't exist yet and report them.
2. "ทำต่อจากครั้งก่อน" strip under the category rail for logged-in users with history: up to 2 items
   (last order → "สั่งซ้ำ", latest draft/awaiting approval → "ทำต่อ") + "โปรเจกต์ทั้งหมด". Real data only; hidden otherwise.
3. Quick view "พับ 3D" tab: animated fold from dieline to box (≈1.9s ease-in-out), drag to rotate,
   slider คลี่ ↔ พับ, "เล่นอีกครั้ง". Start with box/tray families (the prototype shows a CSS-3D approach);
   use Three.js only if the repo already has it or real 3D models exist. Dynamic import; reduced-motion → show folded state.
4. English: `/en/styles` via the repo's i18n approach; all UI strings into message files; `name_en`
   from the catalogue; style codes shared; hreflang pairs.
5. Sustainability filter "ความยั่งยืน": รีไซเคิลได้, ไม่มีพลาสติก (+ certification values when data exists),
   from catalogue attributes (not derived guesses). Also shown in the quick-view spec grid.
</task>

<report>Same report format.</report>
```

---

## API — getpack-api (NestJS): fields the new UI needs

```text
<context>
Repo: getpack-api (NestJS). The storefront /styles redesign needs new catalogue fields.
Reference: docs/design/styles-redesign/catalog-commercial-data-template.csv (copy it into this repo's docs if needed).
Rules: new branch `feat/catalog-commercial-fields`; never merge to main; migrations reversible;
keep existing API contract backward compatible (additive fields only).
</context>

<task>
1. Inspect the catalogue style entity/DTOs, facet endpoint and pricing engine. Write a short plan first and wait for approval.
2. Add per-style fields (nullable): length/width/height min/max (cm), moq_units, lead_time_days_min/max,
   price_est_low_thb / price_est_high_thb / price_est_basis_qty (store ex-VAT; the UI shows VAT-inclusive by default), recyclable, plastic_free,
   certifications[], dieline asset refs (.ai + rendered SVG/WebP), name_en, use-case tags.
3. Estimates: compute from the real pricing formulas where possible (default spec per style) and expose
   tier prices for 500/1,000/3,000/5,000; otherwise use the manually entered estimate fields.
4. Catalogue search: support `size=LxWxH` fit filter (rule: product+0.5cm per dimension within min/max,
   L/W rotation allowed), all facet params, and facet counts that respect the other active filters.
5. Admin: edit these fields in the back-office style form + CSV import/export using the template columns
   (validate, dry-run preview, report row errors).
6. Tests for the fit rule, facet counts and CSV import. Report: endpoints/DTO changes, migration, open questions.
</task>
```

---

## Data the business team must prepare (ทีมธุรกิจต้องเตรียม)

กรอก `catalog-commercial-data-template.csv` ให้ครบทุกแบบ (ไฟล์มีรหัสและชื่อ 20 แบบแรกให้แล้ว ส่วนที่เหลือเพิ่มจากระบบ)

| คอลัมน์ | ใช้ทำอะไร |
|---|---|
| length/width/height min–max | ค้นหาด้วยขนาดสินค้า, ช่วงขนาดบนการ์ด |
| moq_units | ขั้นต่ำบนการ์ด / Quick view, ซ่อนแถวราคาที่ต่ำกว่าขั้นต่ำ |
| lead_time_days_min/max | "ผลิต x–y วัน" |
| price_mode, price_est_low/high, basis_qty | ราคาเริ่มต้น / ราคาประมาณ, ตัวช่วยเลือกตามงบ (กรอกราคาไม่รวม VAT · หน้าเว็บแสดงรวม VAT เป็นค่าเริ่มต้น) |
| recyclable, plastic_free, certifications | ตัวกรองความยั่งยืน, ส่วนความน่าเชื่อถือ |
| dieline_ai_url | ดาวน์โหลด dieline ฟรี, ภาพแบบคลี่ |
| name_en | หน้าภาษาอังกฤษ |

นอกจากนี้ต้องเตรียม: LINE OA ID จริง, ใบรับรองวัสดุ/เอกสาร food grade ที่มีจริง, โลโก้ลูกค้าที่ได้รับอนุญาต และรูปงานผลิตจริง
