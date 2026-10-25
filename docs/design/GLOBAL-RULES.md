# getpack redesign — GLOBAL RULES (applies to every prompt pack)

Location in the repo: `getpack-web/docs/design/GLOBAL-RULES.md`.
Every pack's `<hard_rules>` item 0 points here. **If a pack conflicts with this file, this file wins.**

---

## 1. Factory confidentiality (highest priority)

Customers, visitors, search engines and competitors must never be able to learn anything about the factories that
produce getpack orders. This applies to every page, API response, PDF, e-mail, LINE message, image, file name,
alt text, JSON-LD, sitemap, llms.txt, analytics event visible in the browser and error message.

Never expose:
- factory names, logos, signage, addresses, provinces/regions, map pins, distance-to-factory;
- the number of factories or partners ("x แห่ง", "อย่างน้อย 3 แห่ง", "14 โรงงาน" …);
- capacity, machines, machine brands, production lines, shifts, staff counts;
- coverage per product type or area ("ยังไม่มีโรงงานรับ", "x/14 หมวด" …);
- who ships (factory fleet / factory vehicle), factory terms or factory pricing;
- factory ids or names inside API payloads sent to the storefront (strip them server-side, not only in the UI).
- pickup/origin locations in shipment tracking events (show status, time and destination-side locations only);
- factory names or counts in the sales-agent / affiliate area — agents are external people.

Customer-facing wording: use "ทีมงาน", "ฝ่ายผลิต", "การผลิต", "มาตรฐานการผลิตของ getpack" — never "โรงงาน" for our
own production. Examples: "ขั้นตอนการผลิต" (not "ขั้นตอนที่โรงงาน"), "ชำระแล้วจึงเริ่มผลิต",
"รูปงานจริงระหว่างผลิต" (not "รูปงานจริงจากโรงงาน"), "รอยืนยัน" (not "รอโรงงานยืนยัน").

Production photos and quality reports: product and process close-ups only — no signage, logos, uniforms, vehicles,
identifiable people, windows/outdoor views, or EXIF/GPS metadata (strip EXIF on upload).

Exception: `/partner-with-us` (getpack Factory) talks TO factories that want to join. It may describe the ERP and
the partner programme, but still never names, counts or describes existing partner factories.

Internal docs (FINDINGS.md, business-data tables, admin tools) may refer to factories — that is not customer-facing.

## 2. Do not publish internal strategy

Never put internal reasoning on a page, e.g. why getpack Factory is free, network-growth logic ("ยิ่งโรงงานมาก
ทุกฝ่ายยิ่งได้"), margins, supplier strategy, or "customers get a factory near them". Public copy states the offer only:
getpack Factory is free for every module, unlimited users, after opening a factory account and signing the partner
agreement; ERP includes accounting and the general ledger (ระบบบัญชี · บัญชีแยกประเภท).

## 3. Truthful content

- NEVER ship sample data. Everything the prototypes mark "ตัวอย่าง" is fake. Missing real data → hide the element
  (or show the prototype's neutral placeholder label) and list it in the phase report.
- Never fabricate reviews, ratings, testimonials, customer logos, counters or "x คนกำลังดู".
- Never show anything implying images are AI-generated (no badges, captions, alt text or metadata).
- Copy only claims what the system does today (e.g. no "ตรวจไฟล์อัตโนมัติ" before the preflight ships).

## 4. Git

- Never merge to `main`, never force-push, never rewrite pushed history (no rebase of pushed branches).
- **Phase 0 of every pack** is committed to one branch: `fix/uat-phase0` (created from the current working branch).
- Each page branch (name from its pack, e.g. `design/products-redesign`) is created from the **previous branch in
  MASTER-RUN-ORDER.md** (stacked), the first one from `fix/uat-phase0`. If an earlier branch changes after review,
  `git merge` it forward into the later branches — do not rebase.
- `getpack-api` work uses its own branches in that repo (names given in each pack), stacked the same way.
- Small commits; every phase ends with the report format of its pack, then STOP for approval.

## 5. One source of truth for shared logic

| Concern | Single owner | Everyone else |
|---|---|---|
| Price for a spec (unit, tiers, print, material, size) | The existing pricing service. Price reconciliation (฿14.79 / ฿15.70 / ฿17.26, flat tiers, size F) is fixed ONCE in **PDP Phase 0** | Configurator, editor, upload, products, category, cart call the same service and only verify |
| VAT display | Shared price-display helper from **styles Phase 1** (default VAT-inclusive, one rounding rule — fixes ฿338.58 vs ฿338.75) | Import the helper; no local VAT math |
| Spec label (one string per spec, order ยาว × กว้าง × สูง, mm) | Helper created in **PDP Phase 0** together with the price fix (configurator/editor Phase 0 only verify) | Cart, checkout, account, PDF, editor, upload use it |
| Header, tokens, LINE button (`NEXT_PUBLIC_LINE_OA_ID`, hidden if unset), analytics wrapper | **Styles Phase 1** (+ `design-tokens.css`) | Reuse; do not fork |
| Account nav labels | **Account Phase 1** | Header avatar menu (styles Phase 3) uses the same labels/routes |
| Preflight engine (12 checks) | **Upload Phase 2** (shared with the editor) | Editor calls it; no second engine |
| Quote PDF template + 15-day price lock | **Configurator** quote (existing) | Products Phase 3, cart quote reuse it. Company: บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด |
| Shipping estimate by postcode | **Configurator Phase 1** step 8 | Products Phase 3, PDP reuse it |
| `?design=own_file` preselect | **Upload Phase 0** | Configurator Phase 1 item 9 keeps it working |

## 6. Decided business rules (do not re-decide)

- Overdue payment: never auto-cancel. Show "เลยกำหนดชำระ" + "ตรวจราคาใหม่และชำระ" (re-quote with current price,
  then pay). Price lock 15 days.
- Artwork status "รอแบบไดคัท" is split into "รอทีมส่งแบบไดคัทให้" (team acts, no upload button) and "รอไฟล์จากคุณ"
  (customer acts, upload button).
- Own-file path: file is checked before it goes into the cart once upload Phase 2 ships; until then the honest
  copy is "อัปโหลดไฟล์หลังสั่งซื้อ ทีมงานตรวจไฟล์ให้ก่อนผลิต".
- Tolerances shown everywhere: quantity ± 5% (difference as credit), size ± 3 mm, colour ΔE2000 ≤ 3.
- Production 5 working days after artwork approval (from data, not hard-coded). LINE support daily 09:00–18:00.
- `/network` becomes "มาตรฐานการผลิตของ getpack" (business Phase 3b) — no factory list, count or coverage.

## 7. Quality bar for every page

Responsive with no horizontal scroll at 360 px (check 390 and 1440), dark mode via tokens, keyboard operable,
visible focus, WCAG AA contrast, Thai-first copy (English via i18n where the pack says), Lighthouse ≥ 90 on
mobile for performance/accessibility/SEO, analytics events as named in each pack. Never submit real payments or
purchases while testing.
