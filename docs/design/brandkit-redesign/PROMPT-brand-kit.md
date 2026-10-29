# getpack — คลังแบรนด์ในสตูดิโอ (ฟอนต์ลูกค้า สี โลโก้ กติกาแบรนด์) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. วาง 3 ไฟล์นี้ไว้ที่ `docs/design/brandkit-redesign/` ของ **ทั้ง** `getpack-web` และ `getpack-api`
   - `PROMPT-brand-kit.md` (ไฟล์นี้)
   - `BRAND-KIT.md` บันทึกสิ่งที่มีอยู่ การตัดสินใจ BK-01..BK-14 และคำแนะนำ (อ่านก่อน)
   - `brand-kit-prototype.html` ต้นแบบ: `#kits` คลังแบรนด์ · `#kit` แก้คลัง (8 ส่วน) · `#studio` แผงแบรนด์ในสตูดิโอ · `#import` นำเข้าคู่มือแบรนด์
2. ต้องมีก่อน: portal Phase 0 (ย้าย `/business/*`, D-444 audit log) และ account Phase 1 (เมนู 9 รายการ)
3. ลำดับ: **Phase 0 → 1 → … → 7** แล้วจึง **Phase 8** (flag ทีละตัว) · หยุดรออนุมัติทุก Phase
4. ทุก Phase มีกล่อง **🟦 API** (รันก่อน, เขียน `docs/design/brandkit-redesign/API-CHANGES.md`) และ **🟩 Web** (อ่านไฟล์นั้นจาก `../getpack-api` แล้ว `pnpm gen:api`)
5. Branch: Phase 0 ลง `fix/uat-phase0` แล้ว `git merge` เข้า `design/brand-kit` · Phase 1–8 ลง `design/brand-kit` (ทั้งสอง repo) สร้างจาก `design/portal-redesign`
6. ฟีเจอร์อัปโหลดฟอนต์อยู่หลัง `FEATURE_CUSTOMER_FONTS` เปิดใน production ได้เมื่อที่ปรึกษากฎหมายลงนาม S-06

---

## Shared context

```text
<context>
Project: getpack (getpack.co), Next.js getpack-web + NestJS getpack-api. This pack builds the brand kit used in the
Studio: customer fonts, colours, logos, text styles, data blocks, company governance, import and branch batches.

Read first: docs/design/brandkit-redesign/BRAND-KIT.md (what exists, decisions BK-01..BK-14, phase map) and the
prototype docs/design/brandkit-redesign/brand-kit-prototype.html ("ดูสิ่งที่เปลี่ยน" lists findings and spec).

Today: BrandKit is company-only (palette, fontPairs, usageNotes); kit fonts are limited to studio-served OFL
DesignFont rows (D-284 guard in studio-catalog.service.ts); CompanyBrandKits.tsx applies a kit in the Studio;
/business/assets stores files of kind logo/guideline/font/artwork/other but the Studio cannot use them; individuals
have no kit. Print (D-280/ADR-0011): the browser renders 300 dpi JPEG tiles with Konva, the API composes the PDF with
the vector die — text reaches production as pixels, never as font files. No guard ensures fonts finished loading
before tiles render. Print file is named print-<designUUID>-v<n>.pdf.

Decisions: BK-01..BK-14 in BRAND-KIT.md (customer fonts allowed, free kits for all, quotas, licence attestation +
takedown with sign-off S-06, OFL library vendored, Thai companion + glyph coverage, non-embeddable allowed with label,
colours with CMYK/Pantone/spot, logo variants + min size + clear space, company locks + pre-order check
warn|approval|off + external designer role, versions update drafts only, retention, fonts-loaded render guard + job
code file name, /business/assets merged into งานออกแบบ › คลังแบรนด์).
</context>

<hard_rules>
0. GLOBAL RULES: follow docs/design/GLOBAL-RULES.md, docs/design/DECISIONS-STAGE-A.md,
   docs/design/portal-redesign/DECISIONS-PORTAL.md and BRAND-KIT.md (in that precedence, then this file).
1. Factory confidentiality and reverse confidentiality (GLOBAL-RULES §1–2): production never receives font files,
   original logos, customer names or kit data — only the rendered print PDF (metadata stripped, named by job code).
2. Customer fonts and logos are private to their owner (account or company). Delivered to browsers only through
   short-lived signed URLs for members of that owner; every download is logged (D-444). Never cache them on a public
   CDN path; never expose them in API payloads to other customers, partners or the public.
3. Font files are untrusted input: parse server-side (fontkit), reject malformed or oversized tables, re-encode to
   WOFF2 for web delivery, never execute or pass raw files to the client without validation. Virus-scan uploads.
4. NEVER ship sample data — everything the prototype marks "ตัวอย่าง" is fake. No AI-image hints anywhere.
5. Copy only claims what the system does (e.g. "จำลองสีบนคราฟท์" is a simulation; say so).
6. Git: Phase 0 on fix/uat-phase0 then merge into design/brand-kit; Phases 1–8 on design/brand-kit in each repo.
   Never merge to main, never force-push, never rebase. Small commits.
7. Reuse single owners: tokens/header (styles Phase 1), spec label + price helpers, approvals (company module),
   preflight engine (upload Phase 2). Do not fork.
8. Quality: no horizontal scroll at 360/390 px, dark mode via tokens, keyboard operable, role="switch" +
   aria-checked, aria-live for upload/validation results, Thai-first i18n.
9. Gate per Web phase: lint · typecheck · test · build (NODE_OPTIONS=--max-old-space-size=4096) · e2e for touched
   pages · customer-facing grep for "โรงงาน" adds nothing. API: lint · typecheck · unit + e2e · OpenAPI regenerated.
10. Each phase ends with a report (done / assumptions / open questions / not verified) and STOPS for approval.
</hard_rules>
```

---

## Phase 0 — สำรวจ และกันความเสี่ยงของไฟล์พิมพ์

### 🟦 API

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: fix/uat-phase0.

<task>
1. Survey (read-only) → docs/design/brandkit-redesign/FINDINGS-API.md: BrandKit, DesignFont, CompanyBrandAsset,
   studio catalog/print services, file storage and signed URLs, how tiles/renders are uploaded and validated.
2. Render guard: the render upload carries `fontsReady: true` + the list of font families used; the API refuses
   order/hand-off when a version's render metadata lacks fontsReady or lists a family not loaded (error
   studio.fonts_not_ready). Tests.
3. Print/proof file names use the order/job code (not the design UUID); strip PDF metadata (author, title, producer).
4. Plan (no code) for replacing the D-284 kit guard with owner-scoped fonts, and for migrating CompanyBrandAsset
   kind=font into kit fonts after validation. Write it into FINDINGS-API.md.
Write API-CHANGES.md (Phase 0). Lint, typecheck, tests, commit, push; merge fix/uat-phase0 into design/brand-kit
(create it from design/portal-redesign). STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: fix/uat-phase0.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. Before rendering print tiles: collect every font family used in the document, `await document.fonts.load()` for
   each weight/style, verify `document.fonts.check()`; if any fails, stop with "ฟอนต์ X ยังโหลดไม่เสร็จ ลองอีกครั้ง"
   and do not upload tiles. Send fontsReady + families with the render. Tests (mock FontFace failures).
3. Survey → FINDINGS-WEB.md (designer font loading, CompanyBrandKits panel, /business/assets UI).
Gate. Commit, push, merge into design/brand-kit. STOP.
</task>
```

---

## Phase 1 — โครงข้อมูลคลังแบรนด์

### 🟦 API

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.

<task>
1. BrandKit owner: ownerType user|company + ownerId (migrate existing company kits). Fields: name, status, version.
2. KitFontFamily {familyName, role heading|body|other, source upload|library|studio, thaiFallbackFamilyId,
   coverage {thai, latin, digits, thaiDigits, baht}, embeddable(fsType), licenceAttestedBy/at} + KitFontFace {weight,
   style, variableAxes?, fileObject(original), webFileObject(woff2)}.
3. KitColour {name, hex, cmyk {c,m,y,k}, pantone?, spot:boolean, order}. KitLogo {variant primary|reversed|mono|icon|
   other, fileObject, svgFileObject?, minWidthMm, clearSpaceRatio}. KitTextStyle {name, familyId, weight, sizePt,
   tracking, leading, case}. KitBlockRef → existing datablocks.
4. BrandKitVersion snapshot per change (who, when, diff summary); designs store brandKitId + kitVersion used.
5. Quotas (BK-03) enforced per owner; storage counted from file objects.
6. Store API: /v1/store/brand-kits (list/create/duplicate/archive), /:id (get/patch), sub-resources for fonts,
   colours, logos, styles, blocks; /:id/versions; permission: owner members; company roles (admin edits, others use;
   external designer per Phase 5).
Update API-CHANGES.md (Phase 1). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>No UI yet: pull API-CHANGES.md, `pnpm gen:api`, add typed client hooks and fixtures in tests only. Gate.
Commit, push. STOP.</task>
```

---

## Phase 2 — ระบบฟอนต์ลูกค้า

### 🟦 API

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.

<task>
1. POST /v1/store/brand-kits/:id/fonts (multipart, TTF/OTF/WOFF/WOFF2 ≤ 10 MB, attestation required) behind
   FEATURE_CUSTOMER_FONTS: virus scan → parse with fontkit (reject on error, cap table sizes) → read family/subfamily/
   weight/style/axes, fsType, cmap coverage (Thai U+0E00–0E7F, Latin basic, digits, Thai digits, ฿ U+0E3F) → group
   into family → produce WOFF2 for web → store original + web file privately.
2. GET …/fonts/:faceId/web → short-lived signed URL for owner members only; log downloads (D-444).
3. Thai fallback suggestion when coverage.thai = false (default the account's last used Thai family, else Mitr from
   the library).
4. Free library: vendored OFL families (admin-curated list, files in getpack storage) → POST …/fonts/from-library.
5. Takedown: admin action suspends a face/family across kits (designs keep their rendered tiles; Studio shows a
   replacement prompt). Rights-notice intake form for the public. Retention job (BK-12).
6. Replace the D-284 kit guard: kit fonts may be studio-served OR owned by the kit's owner.
Update API-CHANGES.md (Phase 2). Lint, typecheck, tests (malformed fonts, quota, permissions), commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. Font loader for the Studio and kit pages: FontFace from signed WOFF2 URLs, cache per session, refresh on expiry.
3. Upload dialog exactly as the prototype (drop zone, formats, attestation required before upload, aria-live
   results: grouped family, faces, coverage chips, errors in plain Thai).
Gate. Commit, push. STOP.
</task>
```

---

## Phase 3 — หน้าคลังแบรนด์ (งานออกแบบ › คลังแบรนด์)

### 🟦 API
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Usage counts per kit (designs using it), quota summary endpoint, duplicate kit, "drafts affected by this
change" preview + bulk update of drafts only (BK-11). Update API-CHANGES.md. Lint, typecheck, tests, commit, push.
STOP.</task>
```

### 🟩 Web
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/designs?tab=brand: kit cards (swatches, specimen "Aa กข" in the kit fonts, scope, logos, usage, updated),
   new kit, import entry, quota line. 308 /business/assets → here.
3. Kit editor /account/designs/brand/[kitId]: section nav (ฟอนต์ สี โลโก้ สไตล์ข้อความ บล็อกข้อมูล กติกาแบรนด์
   ผู้ใช้และนักออกแบบ ประวัติ) with counts; font families with specimen, faces, coverage chips, Thai pair select;
   colours with hex/CMYK/Pantone/spot + kraft/white simulation (labelled); logo variants grid + min size + clear
   space; text styles with live preview; blocks list; history with restore and "update N drafts".
4. Match the prototype (#kits, #kit) at 1440 / 1054 / 390 dark; fix every design difference.
5. Analytics: kit_create, kit_font_upload{result}, kit_font_library_add, kit_colour_add, kit_logo_add,
   kit_drafts_update{count}.
Gate + e2e. Commit, push. STOP.
</task>
```

---

## Phase 4 — แผงแบรนด์ในสตูดิโอ

### 🟦 API
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Studio catalog returns the kits the user can use (personal + company) with fonts (web URLs), colours, logos
(svg/png URLs), styles, blocks; brand-check endpoint POST /v1/store/designs/:id/brand-check → findings
[{type: off_palette_colour|off_kit_font|logo_below_min|text_below_min_pt|missing_glyph, elementIds, detail}].
Update API-CHANGES.md. Lint, typecheck, tests, commit, push. STOP.</task>
```

### 🟩 Web
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. Replace CompanyBrandKits.tsx with the "แบรนด์" rail panel: kit picker, "ใช้กับทั้งกล่อง", colours, text styles,
   logo variants, data blocks (drag onto faces).
3. Text rendering: per-run font fallback — glyphs missing in the kit font render in the kit's Thai companion; show the
   inline notice once per element ("฿ ไม่มีใน X ใช้ Y แทน").
4. Brand check bar under the canvas (live, debounced) + the fonts-loaded status from Phase 0.
5. Match the prototype (#studio) at 1440 / 1054 / 390 dark; fix every design difference.
6. Analytics: studio_kit_apply, studio_brand_check{findings}, studio_glyph_fallback{family}.
Gate + e2e (fallback rendering, render guard). Commit, push. STOP.
</task>
```

---

## Phase 5 — กติกาแบรนด์สำหรับบริษัท

### 🟦 API
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Kit rules {lockLogo, paletteOnly, kitFontsOnly, minTextPt}; company template element locks; pre-order check
mode warn|approval|off — approval routes the order into the existing company approval queue with the brand-check
findings attached; external designer role (company member type `designer`: kits + designs only, no prices, orders,
documents, credit). Update API-CHANGES.md. Lint, typecheck, tests (permission matrix), commit, push. STOP.</task>
```

### 🟩 Web
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Kit editor sections "กติกาแบรนด์" and "ผู้ใช้และนักออกแบบ" as in the prototype; locked elements in the Studio
show a lock and explain why; checkout shows brand-check findings and, in approval mode, "ส่งให้ผู้อนุมัติ"; invite
external designer dialog. Match the prototype at 1440 / 1054 / 390 dark. Gate + e2e. Commit, push. STOP.</task>
```

---

## Phase 6 — นำเข้าจากคู่มือแบรนด์ และคลังฟอนต์ฟรี

### 🟦 API
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>POST /v1/store/brand-kits/import (PDF ≤ 50 MB) → async job using the existing local PDF text extraction + OCR
(file-content-search, Tesseract): colours (hex/CMYK/Pantone patterns, swatch sampling), font names (match library;
otherwise "upload if licensed"), logo candidates (embedded vector/image objects) → draft suggestions with page
references; nothing is saved until the customer confirms. Library search endpoint. Update API-CHANGES.md. Lint,
typecheck, tests, commit, push. STOP.</task>
```

### 🟩 Web
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Import page (#import): upload, progress, review lists with switches, create kit. Free-library dialog with
search and specimen. Match the prototype at 1440 / 1054 / 390 dark. Gate + e2e. Commit, push. STOP.</task>
```

---

## Phase 7 — สร้างหลายสาขาในครั้งเดียว (variable data)

### 🟦 API
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Variable fields in a design (branch name, address, phone, QR target) bound to company branches or a CSV; batch
creates N design versions + N quotes/cart lines (pricing service, one per variant or ganged when the pricing service
supports it); each variant renders its own tiles (fonts-ready guard applies). Update API-CHANGES.md. Lint,
typecheck, tests, commit, push. STOP.</task>
```

### 🟩 Web
```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit.
<task>Studio: mark text as a variable field; batch dialog (choose branches or upload CSV, preview grid of variants,
quantities per branch, total price) → cart. Reuse prototype components and tokens; screenshots 1440/390 in the
report. Gate + e2e. Commit, push. STOP.</task>
```

---

## Phase 8 — ฟีเจอร์เพิ่ม (flag ทีละตัว, อนุมัติแล้วทุกข้อ)

```text
First read docs/design/brandkit-redesign/PROMPT-brand-kit.md, section "Shared context", and follow its <context>
and <hard_rules> strictly. Branch: design/brand-kit. One flag at a time, API box first then Web, STOP after each.

<task>
BK-F1 FEATURE_VECTOR_TEXT — text below 8 pt (or all text, configurable) is exported as vector outlines in the print
  PDF: shape with harfbuzzjs (Thai-correct mark positioning), outline with the same font files server-side, place
  over the tiles with the tile text masked; compare raster vs vector in a golden-image test set (Thai, Latin, ฿).
BK-F2 FEATURE_SPOT_SEPARATIONS — kit colours flagged spot become separation pages in the print PDF (reuse the finish
  separation mechanism), named by Pantone reference.
BK-F3 FEATURE_KIT_USAGE — per kit: designs, orders, brand-check pass rate, most used styles (company dashboard).
BK-F4 FEATURE_KIT_SHARE_LINK — read-only signed link to a kit (logos download, colours, fonts names only — never font
  files) for agencies; 30 days, revocable.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

ตัดสินใจแล้วทั้งหมดใน `BRAND-KIT.md` (BK-01..BK-15 รวมรายชื่อคลังฟอนต์ฟรีชุดแรก) เหลือเฉพาะรายการลงนาม:

| รายการ | ผู้ลงนาม | Phase |
|---|---|---|
| S-06 ข้อความยืนยันสิทธิ์ใช้ฟอนต์ และขั้นตอนรับแจ้งละเมิด / ระงับไฟล์ | ที่ปรึกษากฎหมาย | 2 |
