# getpack — Studio Entry Redesign (/studio) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/studio-redesign/`
   - `PROMPT-studio-redesign.md` (ไฟล์นี้)
   - `studio-prototype.html`: ต้นแบบหน้าสตูดิโอ เปิดในเบราว์เซอร์ แล้วกด "ดูสิ่งที่เปลี่ยน"
2. หน้านี้เป็นหน้าเริ่มต้นของสตูดิโอ ไม่รวมตัวแก้ไข (editor) ซึ่งควรออกแบบแยกอีกรอบ
3. ลำดับ: **Phase 0 → Phase 1** คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Pages in scope: `/studio` and `/studio/new` — today TWO different "วันนี้อยากเริ่มจากอะไร" hubs with conflicting copy:
- /studio: 4 path cards (เลือกแบบกล่องแล้วออกแบบ → /styles "122 แบบ"; มีสินค้าแล้ว → /studio/new?start=product;
  มีไฟล์แบบแล้ว → /studio/upload "ระบบเช็คความละเอียดและเขตปลอดภัย แล้วแสดงราคา"; สั่งซ้ำ → /account/orders),
  "แบบที่คนเริ่มบ่อย" (3 styles), "แบบล่าสุดของคุณ" (empty state), help copy about the team opening drafts.
- /studio/new: same 4 paths but "เลือกจากคลัง 30 แบบ", upload path "ข้ามการออกแบบ ไปกำหนดสเปกและราคา แล้วอัปโหลดไฟล์ให้ทีมตรวจ",
  "ลองเล่นกับแบบตัวอย่าง (ไม่บันทึก)", and a product-size modal (units มม./ซม./นิ้ว; use ส่งพัสดุ / ขนส่งบนพาเลท /
  วางขายหน้าร้าน; "แนะนำกล่องที่ใส่ได้ 3 แบบ พร้อมเหตุผล").
Product decisions already made: customers can add their own fonts in the Studio; Illustrator (.ai) dieline download is free.

Reference: docs/design/studio-redesign/studio-prototype.html and shared tokens/components from the other redesigns.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/studio-redesign`. Small commits. Never merge to main, never force-push.
2. Do not change the editor itself or the recommendation algorithm in this task — only the entry experience.
3. NEVER ship sample data. Fake in the prototype: the 3 recommendations + reasons, "popular" ordering, the box
   illustrations. Real (read from services): style names, the per-size prices in the mini-editor (postal box,
   300 pcs, black print: A ฿28.21 · B ฿38.12 · C ฿50.65 · D ฿68.73), path copy, units and use options.
4. Real product imagery/3D only; nothing may indicate images are AI-generated.
5. The dark hero band is a deliberate single look in both themes; everything else follows the tokens.
6. Accessibility (the mini-editor is fully keyboard operable, colour swatches have names), reduced motion, perf
   (the hero preview must not block LCP — render a static frame first, hydrate the interactive part after).
</hard_rules>
```

---

## Phase 0 — Consolidate (no visual work yet)

```text
First read docs/design/studio-redesign/PROMPT-studio-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Inspect /studio, /studio/new, /studio/upload and the editor entry route; list every place a style count or path
   copy appears. Find the truth: how many styles are editable in the Studio vs orderable in /styles, and what the
   upload path really does (auto check + price, or straight to spec + manual check).
2. Write docs/design/studio-redesign/FINDINGS.md with the answers and a proposal: one hub at /studio,
   /studio/new → 301/redirect (keep ?start= params working), one source of truth for counts and copy.
3. Check: "แบบที่คนเริ่มบ่อย" currently shows the first 3 catalogue styles — confirm whether real usage data exists.
4. Stop for approval.
</task>
```

---

## Phase 1 — New /studio entry page

```text
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
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| จำนวนแบบที่ออกแบบในสตูดิโอได้จริง (30 หรือ 122) และคำอธิบายทางอัปโหลดไฟล์ที่ถูกต้อง | ข้อความทุกหน้า |
| ข้อมูลยอดใช้งานจริงของแต่ละแบบ (หรือรายการที่ทีมเลือกเอง) | แบบที่คนเริ่มบ่อย |
| เหตุผลแนะนำของแต่ละแบบในตัวแนะนำกล่อง | ตัวแนะนำจากขนาดสินค้า |
