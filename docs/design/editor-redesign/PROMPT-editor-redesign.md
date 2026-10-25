# getpack — Studio Editor Redesign (/studio/[id]) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/editor-redesign/`
   - `PROMPT-editor-redesign.md` (ไฟล์นี้)
   - `editor-prototype.html`: ต้นแบบตัวแก้ไข เปิดในเบราว์เซอร์ เลือกโหมดตอนเปิด แล้วกด "ดูสิ่งที่เปลี่ยน"
2. นี่คือจุดขายหลักของระบบ งานใหญ่ที่สุดในชุด แบ่งเป็น 7 Phase ให้ทำทีละ Phase และหยุดรออนุมัติทุกครั้ง
3. ลำดับ: **Phase 0 → 1 → 2 → 3 → 4 → 5 → 6** (Phase 6 กลุ่ม A–B ทำคู่กับ Phase 2–3 ได้) คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง
4. รัน Phase 0 ของหน้าสินค้า/หน้าปรับแต่งก่อน (ราคาตรงกันทุกหน้า) เพราะตัวแก้ไขใช้บริการราคาเดียวกัน

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Page in scope: the Studio editor `/studio/[id]` (e.g. /studio/<draft-uuid>?product=uat-postal-box-b).

What the current editor already has (keep all of it, only upgrade):
- Steps: เลือกกล่อง → ขนาดและวัสดุ → ออกแบบ → ตรวจงาน → สั่งผลิต
- Rail: กล่อง, แม่แบบ (empty: "ยังไม่มีแม่แบบสำหรับประเภทนี้"), องค์ประกอบ (shapes, QR with error-correction level,
  barcode), ข้อความ (3 preset buttons, no font picker), อัปโหลด, แบรนด์ (colours stored in this browser only),
  พื้นหลัง, ชั้น, ความเห็น
- Views: 3D คู่แผ่นคลี่ / แผ่นคลี่ / 3 มิติ, ด้านนอก/ด้านใน, นำเสนอและ AR, แชร์, ส่งออก, ประวัติ, autosave,
  "พร้อมพิมพ์" status, onboarding tips
- Problems seen: dieline rendered tiny (15–28% zoom) with the 3D window floating over it; right column is price
  only (no object properties); preflight is a tab that does not point at the object; editor price ฿14.79/ชิ้น at
  300 pcs (150×100×80, KA125 B) differs from listing ฿15.70 and configurator ฿17.26.

Product decisions already made:
- ONE editor with TWO modes, not two products: "ง่าย" (default for new users) and "มืออาชีพ" (full designer
  toolset). Same document model; switching never loses work; mode remembered per account.
- First-open chooser: ง่าย / มืออาชีพ / ให้ทีม getpack ออกแบบให้ (existing "จ้างนักออกแบบ", แก้ไขฟรี 3 ครั้ง)
  + link "อัปโหลดไฟล์ PDF หรือ .ai" for customers who already have artwork.
- Customers can upload their own brand fonts; the brand kit (logos, colours with CMYK, fonts) is account-level.
- Dieline (.ai / DXF) download is free.

Reference: docs/design/editor-redesign/editor-prototype.html — open it, try both modes, the welcome chooser,
preflight "แก้ให้", pro toolbox (V H Z T R E L P I C), marquee/shift multi-select, guides from rulers,
"สีในงาน" panel, the overlay menu (จำลองหมึก / แยกหมึก), Mockup and Share dialogs.

Benchmarks the design is based on (match or beat): Adobe Illustrator + Esko DeskPack (packaging preflight,
printable barcodes, white underprint, variable data), Esko Studio / ArtiosCAD (3D while designing, fold
visualisation, print/finish simulation), Pacdora (dieline from dimensions, one-click mockups, PDF/AI/DXF import).
Our edge: real factory price, factory-specific preflight with auto-fix, and ordering in the same place.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/editor-redesign`. Small commits. Never merge to main, never force-push.
2. Do NOT change pricing, production or file-check logic in the backend; the editor only calls existing services.
   Price shown in the editor must come from the same pricing service as /configure for the same spec.
3. NEVER ship sample data. Fake in the prototype: the 4 industry templates, brand kit "ร้านขนมบ้านนุ่ม", version
   history entries, price for other quantities/print modes/inside print/variants, CMYK values (naive conversion),
   spot-colour library, collaborators' avatars, mockup/AR/video exports, background removal, crop.
   Real: dieline 547 × 196 mm for RSC 150 × 100 × 80, KA125 B, ฿14.79/ชิ้น @300 (to be reconciled in Phase 0),
   tolerances (± 3 mm, ΔE2000 ≤ 3, ± 5% with credit), share link 15 days, quote price lock 15 days.
4. Finishes (foil, emboss, spot UV, white underprint) are NOT offered until the factory confirms capability.
5. Never show anything implying images are AI-generated.
6. Performance: canvas interactions at 60 fps on a mid-range laptop with 50 objects; 3D re-render throttled to
   animation frames; fonts loaded with FontFace and cached; autosave debounced (≥ 800 ms) and conflict-safe.
7. Accessibility: every tool has a label + shortcut, inspector fields are labelled, canvas objects reachable via
   the Layers list with keyboard, dialogs trap focus, reduced motion respected.
8. Responsive: ≥ 1180 full layout; 900–1180 compact (no avatars/price chip, step labels hidden); < 900 the editor
   stacks (canvas → inspector → tool tabs → panel), the pro toolbox becomes a horizontal bar above the view bar,
   no horizontal page scroll at 360 px. Test 1440 / 1280 / 1024 / 768 / 390 / 360.
</hard_rules>
```

---

## Phase 0 — Discovery and price consistency (no UI work)

```text
First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map the editor: routes, state store, document schema (objects, sides, variants?), canvas renderer, 3D renderer,
   preflight rules, autosave/history, upload pipeline, export pipeline, brand-kit storage, permissions/sharing.
2. Price: explain why the editor shows ฿14.79 (300 pcs, 150×100×80, KA125 B) while the listing shows ฿15.70 and the
   configurator ฿17.26. Make all three call one pricing function with an explicit spec label. Report first, fix
   after approval.
3. Write docs/design/editor-redesign/PLAN.md: gap list vs the prototype (per Phase below), schema changes needed
   (e.g. object.variant overrides, flip, gradient, path points, guides, mode preference), migration for existing
   drafts, and risks. Stop for approval.
</task>
```

---

## Phase 1 — New shell, canvas and inspector (both modes)

```text
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
```

---

## Phase 2 — Easy mode (โหมดง่าย)

```text
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
```

---

## Phase 3 — Pro mode (โหมดมืออาชีพ): full designer toolset

```text
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
```

---

## Phase 4 — Collaboration, mockups and variants

```text
First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Share dialog: ดูและคอมเมนต์ได้ / แก้ไขได้ / อนุมัติแบบ; link expires in 15 days; viewers see 3D + dieline and can
   pin comments without an account; approvals recorded on the order.
2. Comment pins on the canvas with threads; getpack team can reply inside the editor; notifications.
3. Mockup dialog: backgrounds, variant switch, PNG set (4 angles × variants, 2000 px), rotating video (MP4), AR
   QR — mark each as "เร็วๆ นี้" until it really exports.
4. Variants: one design, several versions (text/colour overrides), per-variant quantity, ordered in one order;
   show the per-variant minimum once the business confirms it.
5. "ให้ทีม getpack ออกแบบให้" flow from the welcome chooser: brief form (logo, ideas, references) → creates the
   design-service order (existing "จ้างนักออกแบบ", แก้ไขฟรี 3 ครั้ง) → designer works in the same editor → customer
   reviews with comments.
</task>
```

---

## Phase 5 — Advanced packaging features (only after factory confirmation)

```text
First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Write docs/design/editor-redesign/ADVANCED.md proposing (do not build yet), each with factory requirements, price
impact and UI sketch:
1. Fold animation in 3D (dieline → box), like Esko Studio.
2. Finish layers (foil, emboss, spot UV, white underprint) as separate spot layers with 3D preview — only for
   finishes the factory offers.
3. Printable-barcode assurance (EAN-13/QR minimum size and quiet zone by print method) like DeskPack.
4. Variable data (numbering, per-batch QR) for digital print.
5. Spot-colour library from the factory's ink book with real ΔE guidance.
Stop after the document.
</task>
```

---

## Phase 6 — Leadership features (10 items, each behind its own feature flag)

```text
First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Build in this order; stop for approval after each group. Every number shown to customers must come from a real
service; until then, label it exactly like the prototype ("ตัวอย่าง" / "รอยืนยัน" / "รอข้อมูลวัสดุจริง").

Group A — start faster
1. Brand kit from a shop link (Brand panel): customer pastes a website / Instagram / LINE OA link → server fetches
   public page metadata (logo/og:image, theme colours from the logo/page) → proposes 3–5 colours and 2 Thai font
   pairings → "ใช้กับแบบนี้" (one undo step) / "เก็บในชุดแบรนด์" (account level). Respect robots.txt, time out
   at 8 s, never store anything the customer did not keep. Event: brand_scan{source,result}.
2. Product fit + courier size (Box panel): product L/W/H in mm → clearance per side and top, fit status
   (ใส่พอดี / ช่องว่างเยอะ / ใหญ่กว่ากล่อง) with a top-view sketch; outside dims (inside + 6 mm) and the courier
   tier from a maintained table per carrier (ไปรษณีย์ไทย, Flash, J&T, KEX — business supplies sizes and prices);
   hint "ลดอีก x มม. จะเป็นไซซ์ y ประหยัด ฿z/กล่อง" with a one-click link to change size. Later: show the product
   as a ghost block inside the 3D box.

Group B — recurring value
3. Smart QR (QR object inspector, both modes): every QR printed by getpack encodes a short redirect
   (gpk.to/<id>); destination type LINE OA / website / reorder / warranty-membership; destination editable after
   printing; scan analytics (count, day, province from IP — no personal data). Paid tier after N scans (business
   decides). Preflight still checks QR size and quiet zone.
4. Reorder reminder (Order tab): toggle "เตือนก่อนกล่องหมด"; sources Shopee / Lazada / TikTok Shop / LINE MyShop
   (read order COUNTS only via official APIs) or manual daily sales; forecast run-out date = boxes ÷ daily orders;
   remind (LINE/email) lead-time + 5 days before; one tap reorders the same spec. Optional stock-holding service
   (produce once, call off in batches) if the factory offers it.
5. Team workspace + brand lock: roles เจ้าของ / ผู้ออกแบบ / ผู้อนุมัติ / สาขา; owner can mark objects
   "ล็อกแบรนด์" (pro inspector) — branch users (and easy mode) cannot move/edit/delete them, auto-fix skips them,
   selection shows an amber dashed frame and an explanation. Multi-brand accounts for agencies.

Group C — price and quality leadership
6. Cost optimiser (Order tab "ลดต้นทุนได้"): price breakdown from the pricing service and ranked suggestions with
   real savings: black 1-colour (recolours everything to black, images to mono — one undo step), next quantity tier,
   no inside print, smaller size that still fits the product (uses item 2). Event: cost_opt_apply{option,saving}.
7. Ganged run "พิมพ์รอบรวม": only if the factory confirms; price and extra lead time from the factory schedule;
   order shows the planned run date.
8. Production tracking: order page timeline อนุมัติแบบ → เตรียมแม่พิมพ์และไดคัท → พิมพ์และขึ้นรูป (factory photos)
   → ตรวจคุณภาพ (ΔE2000 report vs approved sample, quantity, size) → จัดส่ง; notifications at each step.

Group D — future-proof
9. Sustainability data: board area per box (from the dieline) and per order (real geometry now); weight,
   recycled content and kgCO₂e only when the factory provides material data; downloadable report for B2B/export.
10. Ecosystem: Figma and Illustrator plugins (download the exact dieline with layers; send artwork back to the
    same draft for preflight and ordering) + designer partner programme (referral link, commission on production
    orders, partner dashboard) — write the commission rules as config; business sets the numbers.
</task>

<acceptance>
- Each feature has its flag, analytics events and copy reviewed; no sample number is visible in production.
- Smart QR redirect p95 < 150 ms; changing a destination never changes the printed code.
</acceptance>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| ราคาที่ถูกต้องของสเปกเดียวกันทุกหน้า (฿14.79 / ฿15.70 / ฿17.26) | Phase 0 |
| แม่แบบตามธุรกิจ (เบเกอรี่ สกินแคร์ กาแฟ ร้านออนไลน์ ฯลฯ) | Phase 2 |
| ค่าบริการและขั้นตอน "ให้ทีม getpack ออกแบบให้" | Phase 1 และ 4 |
| ราคาเมื่อพิมพ์ด้านใน หลายรุ่น และขั้นต่ำต่อรุ่น | Phase 3–4 |
| สเปกไฟล์ที่ฝ่ายเตรียมพิมพ์ต้องการ (PDF/X-4, เลเยอร์ไดคัท, ระยะตัดตก) | Phase 3 |
| ชุดสีพิเศษของโรงพิมพ์ และงานเคลือบ/ฟอยล์ที่ทำได้จริง | Phase 5 |
| ตารางไซซ์และราคาของขนส่งแต่ละเจ้า (อัปเดตได้) | Phase 6 ข้อ 2 |
| แพ็กเกจและราคา QR อัจฉริยะ, โดเมนลิงก์สั้น | Phase 6 ข้อ 3 |
| การเชื่อมต่อร้านค้าออนไลน์ (บัญชีนักพัฒนา Shopee / Lazada / TikTok Shop / LINE) และบริการเก็บสต็อก | Phase 6 ข้อ 4 |
| บทบาทในทีมและกติกาการล็อกแบรนด์สำหรับแฟรนไชส์ | Phase 6 ข้อ 5 |
| โรงงานทำพิมพ์รอบรวมได้ไหม ราคาและรอบวันพิมพ์ | Phase 6 ข้อ 7 |
| รูปงานและรายงานค่าสีจากโรงงานในแต่ละขั้น | Phase 6 ข้อ 8 |
| ข้อมูลวัสดุ (น้ำหนัก, % รีไซเคิล, ค่าคาร์บอน) | Phase 6 ข้อ 9 |
| เงื่อนไขค่าแนะนำของโปรแกรมพันธมิตรนักออกแบบ | Phase 6 ข้อ 10 |
