# getpack — Configurator Redesign (/configure/[slug]) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 2 ไฟล์นี้ไปไว้ที่ `getpack-web/docs/design/configurator-redesign/`
   - `PROMPT-configurator-redesign.md` (ไฟล์นี้)
   - `configurator-prototype.html`: ต้นแบบหน้าปรับแต่งกล่องไปรษณีย์ เปิดในเบราว์เซอร์ แล้วกด "ดูสิ่งที่เปลี่ยน"
2. **Phase 0 (แก้บั๊ก) รันได้ทันที** ไม่ต้องรอหน้าอื่น
3. Phase 1 รันหลัง Phase 0 ของหน้าสินค้า (ราคาตรงกันทุกหน้า) เพราะหน้าปรับแต่งเป็นแหล่งราคาหลัก
4. คัดลอกเฉพาะบล็อกโค้ดของแต่ละ Phase ไปวาง ทุกบล็อกสั่งให้ Claude อ่านส่วน **Shared context** ในไฟล์นี้ก่อน

---

## Shared context

```text
<context>
Project: getpack storefront (getpack.co), Next.js `getpack-web` + NestJS `getpack-api`.
Page in scope: the configurator `/configure/[slug]` (prototype: uat-postal-box-b). It is the single source of
truth for price, quantity tiers, shipping by postcode, ready/arrival dates, inside/outside/crease dimensions
(3 mm board rule), saved quotes (15-day price lock), drafts (90 days), share links (15 days), PDF, sample
request, discount codes, and tolerances (qty ±5% with credit for shortfall, size ±3 mm, colour ΔE2000 ≤ 3).
Today it is a 7-step accordion: ขนาดและรูปแบบ → วัสดุ → การพิมพ์ → จำนวน → การจัดส่ง → งานออกแบบและตัวอย่าง → สรุปและบันทึก.

Reference: docs/design/configurator-redesign/configurator-prototype.html (+ "ดูสิ่งที่เปลี่ยน"),
shared components/tokens from the other redesign folders.
</context>

<hard_rules>
0. GLOBAL RULES: also follow docs/design/GLOBAL-RULES.md (factory confidentiality, no internal strategy copy,
   no sample data, no AI-image hints, no fabricated reviews, branch base, single pricing service, shared
   foundations). If anything in this file conflicts with GLOBAL-RULES.md, GLOBAL-RULES.md wins.
1. Git: branch `design/configurator-redesign`. Small commits. Never merge to main, never force-push.
2. Do NOT change pricing formulas, date logic or tolerance rules in this redesign; only how they are shown.
   Every number comes from the existing services. Product page, category and listing reuse the same services.
3. NEVER ship sample data. Prototype values that are fake: price deltas for materials other than KA125 B,
   print options other than outside-black, inside print and print areas; custom-size prices; shipping cost
   and zones; sample-lead-time extension. Real (read from services, never hard-code): sizes, per-size tier
   prices for the default spec, option lists, dimensions rule, tolerances, retention periods, step names.
4. Real product imagery/3D only; nothing may indicate images are AI-generated.
5. Prices are VAT-inclusive with the VAT amount shown; shipping is a separate line.
6. Accessibility (radio-group semantics for option cards, labelled inputs, focus order, live region for price,
   reduced motion), perf (price requests debounced/cancelled; no layout shift), analytics as listed.
</hard_rules>
```

---

## Phase 0 — Bugs and data checks (do first)

```text
First read docs/design/configurator-redesign/PROMPT-configurator-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Fix or report, smallest safe change each, one commit per item:
1. Missing translation: the quantity step renders the raw key `configurator.quantity.target`. Add the Thai/EN
   strings (label: "งบต่อชิ้นในใจ (ไม่บังคับ)") and add a test/lint that fails on any raw i18n key in rendered pages.
2. Investigate (report, don't change pricing): with size 00 selecting "พิมพ์ 4 สี (CMYK)" did not change the price
   (฿17.26), while for size C it did. Explain (minimum charge? bug?) in docs/design/configurator-redesign/FINDINGS.md.
   Also compare with the Studio editor price (฿14.79/ชิ้น at 300 pcs, 150 × 100 × 80 mm, KA125 B) and the listing
   price (฿15.70): one pricing service, one spec label everywhere.
3. Report the 100/300/500 flat tier for small sizes (00, 0) — intended minimum or bug.
4. Steps 2–4 show "เรียบร้อยแล้ว" before the customer touches them. Change the status to "ค่าเริ่มต้น" until the
   customer confirms or changes the step (UI only).
5. VAT check: for a total of ฿5,178.00 (VAT-inclusive) the summary shows VAT ฿338.58, but 5,178 × 7/107 = ฿338.75.
   Find which base the VAT is computed on (per-unit rounding? shipping?) and report; fix only after approval.
6. Size F at 100 pcs returns "สเปกนี้คำนวณราคาอัตโนมัติไม่ได้" only inside the tier table. Make the main price area
   and primary CTA switch to "ขอใบเสนอราคา" with the spec prefilled.
Stop after the report + fixes.
</task>
```

---

## Phase 1 — Configurator layout and interaction

```text
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
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

| รายการ | ใช้ทำอะไร |
|---|---|
| ยืนยันราคาเบอร์ 00 เมื่อพิมพ์ 4 สี (ราคาไม่เปลี่ยน) และราคาเท่ากันที่ 100–500 ชิ้นของเบอร์เล็ก | Phase 0 |
| คำอธิบายสั้นของวัสดุทุกตัว (ตอนนี้มีแค่ 2 จาก 4) | ขั้นวัสดุ |
| ทาง "ออกแบบในสตูดิโอ" เปิดสตูดิโอพร้อมสเปกได้หรือยัง | ขั้นงานออกแบบ |
| ผลของ "ขอตัวอย่างจริงก่อนผลิต" ต่อราคาและวันส่ง | ขั้นงานออกแบบ และสรุป |
