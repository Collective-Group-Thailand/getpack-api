# getpack — Upload Your File (/studio/upload) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/upload-redesign/`
   - `PROMPT-upload-redesign.md` (ไฟล์นี้)
   - `upload-prototype.html`: ต้นแบบ เปิดในเบราว์เซอร์ กด "ลองด้วยไฟล์ตัวอย่าง" แล้วกด "ดูสิ่งที่เปลี่ยน"
2. หน้านี้ใช้ตัวตรวจไฟล์ (preflight) ร่วมกับตัวแก้ไขสตูดิโอ และใช้บริการราคาเดียวกับหน้าปรับแต่ง ให้รัน Phase 0 ของหน้าสินค้า/หน้าปรับแต่งก่อน
3. ลำดับ: **Phase 0 → 1 → 2 → 3 → 4** คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง และหยุดรออนุมัติทุก Phase

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Page in scope: `/studio/upload` ("มีไฟล์แล้ว อัปโหลดเลย") and the own-file path into the cart.

Current behaviour (observed):
- /studio/upload copy promises "ระบบเช็คความละเอียดและเขตปลอดภัยให้ และทีมปรีเพรสตรวจแบบก่อนพิมพ์ทุกงาน",
  3 steps (เลือกสินค้า → ใส่ขนาด กระดาษ และจำนวน → อัปโหลดไฟล์ แล้วรอแบบตัวอย่างให้อนุมัติ), and a list of 5 products:
  กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B) เริ่ม ฿15.70 · กล่องลูกฟูกผิวขาว ฝาชน พิมพ์โลโก้ ฿33.83 · ลังกระดาษขนย้าย 5 ชั้น
  (ลอน BC) ฿198.92 · กล่องผลไม้ ฝาครอบ ฿123.06 · ถาดลูกฟูกเปิดฝาบน ฿136.65 — all ขั้นต่ำ 100.
- Each product links to /configure/<slug>?design=own_file. In the configurator, step 6 "งานออกแบบและตัวอย่าง"
  offers "มีไฟล์งานแล้ว — อัปโหลดไฟล์หลังสั่งซื้อ ทีมงานตรวจไฟล์ให้ก่อนผลิต" and "จ้างนักออกแบบ — แก้ไขได้ฟรี 3 ครั้ง",
  but neither is pre-selected from ?design=own_file and the collapsed step summary reads "ออกแบบออนไลน์".
- The customer cannot upload or see any check before paying. "ดาวน์โหลดแผ่นคลี่จากแบบกล่อง" links to /styles.

Decisions already made (from the prototype review):
- File-first page: upload (or import) → automatic detection of box style + size from the die-cut → 12-point
  preflight → spec, ink and price → add to cart with the checked file.
- Shared preflight engine with the Studio editor; same pricing service as /configure.
- Extra features approved: import from Google Drive / Dropbox / OneDrive / link; convert a checked file into an
  editable Studio design; file version history + reorder from a produced file; approval link for brand owners;
  brand-critical colours with ΔE reporting; proof choice (digital free / physical sample); mockups from the file;
  upload by email and an enterprise API.

Reference: docs/design/upload-redesign/upload-prototype.html.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/upload-redesign`. Small commits. Never merge to main, never force-push.
2. Do NOT change pricing, tax, production or prepress approval rules; only call existing services. Every price on
   this page must equal /configure for the same spec (test).
3. NEVER ship sample data. Fake in the prototype: all preflight results and the artwork image, detection result,
   CMYK conversion swatch, prices for spot/4-colour print, team fix fee ฿300, per-version fee ฿350, physical sample
   ฿450 and +3 days, prepress SLA "1 วันทำการ", editable-object counts, reorder history, upload e-mail address,
   ΔE thresholds. Real: the 5 products, start prices and MOQ 100; postal-box sizes and black-print unit prices
   (00 140×97.5×60 … F 450×300×220; e.g. C ฿58.20/50.65/44.96/38.97 at 100/300/500/1,000; F at 100 = no automatic
   price); production 5 working days; earliest ready 2 พ.ย. 2569 example; tolerances ± 5 % (credit) and ± 3 mm;
   quote price lock 15 days; designer service แก้ไขฟรี 3 ครั้ง; LINE 09:00–18:00.
4. Files are confidential: private storage, signed URLs, access = owner, invited team members, assigned prepress
   staff; virus scan; retention policy configurable (business decides); NDA request flow. Never use customer
   artwork for anything else.
5. Accepted: PDF (PDF/X-4 recommended) and AI, ≤ 200 MB per direct upload (links/cloud imports for larger);
   resumable uploads; progress and failure states; the original file is never modified — fixes produce a new
   derived print file and both are kept.
6. Accessibility (drop zone operable by keyboard, results announced with aria-live, focus management in dialogs),
   responsive (no horizontal scroll at 360 px; summary card stacks under the workspace < 1100 px), analytics.
</hard_rules>
```

---

## Phase 0 — Fix the current flow and investigate (no redesign yet)

```text
First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Bug: /configure/<slug>?design=own_file must pre-select "มีไฟล์งานแล้ว" in step 6, and the collapsed step
   summary must show the selected option (never "ออกแบบออนไลน์" when that option does not exist). Add a test.
2. Replace the copy on /studio/upload with what the system really does today until Phase 2 ships
   (no automatic check claim).
3. Write docs/design/upload-redesign/FINDINGS.md:
   - where files are uploaded today (after payment?), storage, who can access, retention;
   - which products accept own files (only these 5?) and why;
   - whether the prepress team already uses a preflight tool (e.g. Acrobat Preflight, Esko, PitStop, callas) whose
     profile we can reuse server-side;
   - whether dieline templates per product/size exist as files (.ai/.pdf/DXF) and where;
   - the "เริ่ม ฿15.70" vs ฿17.26 mismatch (same as the PDP Phase 0).
4. Stop for approval.
</task>
```

---

## Phase 1 — Upload page, templates and import

```text
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
```

---

## Phase 2 — Detection + 12-point preflight + spec & price

```text
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
```

---

## Phase 3 — Approval, brand colours, proofs and mockups

```text
First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. "ส่งให้อนุมัติ": dialog (recipient e-mail or team member, message, show price yes/no, allow approver to order
   and pay yes/no); approver page without sign-up shows 3D, dieline, check results, spec (and price if allowed) with
   อนุมัติ / ขอแก้ (comment). Status chip in the summary (รออนุมัติ / อนุมัติแล้ว / ขอแก้). Any new file version
   invalidates the approval. Link expires in 15 days. Reuse team roles from the editor.
2. "สีสำคัญของแบรนด์": list the colours found in the file; customer marks critical ones and enters a target
   (CMYK/HEX or "ตามตัวอย่างที่ส่งให้"); stored on the order line; factory controls them and the production report
   shows ΔE2000 per critical colour vs the approved sample (threshold from the factory).
3. Proof choice in the summary: "Proof ดิจิทัล" (free, default) / "กล่องตัวอย่างจริง 1–5 ใบ" (fee and extra days from
   the factory) — ready date and total update.
4. "ภาพ Mockup": dialog with backgrounds and export of a PNG set (4 angles × versions) and a 6 s rotation video,
   rendered from the file's faces; regenerate when a new version is uploaded.
</task>
```

---

## Phase 4 — Enterprise intake (e-mail + API)

```text
First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. E-mail intake hardening: per-account secret address, sender allow-list, attachment and link handling, reply
   with the check report and a link to the workspace; rate limits; spam/virus protection.
2. Public API (OpenAPI spec first, then implementation behind a flag): create upload → poll/webhook preflight
   result → create quote → create order with approved file; API keys per business account with scopes; sandbox.
3. Docs page "API องค์กร". Stop for review before enabling for any customer.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| สินค้าที่รับไฟล์ลูกค้าได้ และขนาดของแต่ละสินค้า | Phase 0–1 |
| ไฟล์แผ่นคลี่ .ai / PDF / DXF ของทุกสินค้าและขนาด | ตัวดาวน์โหลดและการตรวจจับ |
| โปรไฟล์ตรวจไฟล์ที่ทีมเตรียมพิมพ์ใช้อยู่ และเกณฑ์ของโรงงาน | 12 ข้อ |
| ค่าบริการทีมแก้ไฟล์ · ค่าเปลี่ยนแบบต่อรุ่น · ราคาและเวลาทำกล่องตัวอย่างจริง | การ์ดราคา |
| เวลาตรวจไฟล์ของทีม (SLA) | ขั้นตอนหลังสั่งซื้อ |
| นโยบายเก็บไฟล์ (กี่วัน) และแบบฟอร์ม NDA | ความลับของไฟล์ |
| เกณฑ์ ΔE ของสีสำคัญ | Phase 3 |
| บัญชีนักพัฒนา Google / Dropbox / Microsoft และโดเมนอีเมลอัปโหลด | การนำเข้าไฟล์ |
