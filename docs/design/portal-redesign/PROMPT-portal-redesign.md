# getpack — ติดตามคำสั่งซื้อ (/track) + พอร์ทัลลูกค้า (/account/*) · Claude Code Prompt Pack

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 4 ไฟล์นี้ไปไว้ที่ `docs/design/portal-redesign/` ของ **ทั้ง** `getpack-web` และ `getpack-api`
   - `PROMPT-portal-redesign.md` (ไฟล์นี้)
   - `AUDIT-PORTAL.md` บันทึกผลตรวจ 51 route, ข้อตกลงการทำงาน, คำแนะนำทุกหน้า (อ่านก่อนทุกรอบ)
   - `DECISIONS-PORTAL.md` การตัดสินใจทางธุรกิจของรอบนี้ (ตัวเลข SLA ระดับสมาชิก เพดานค่าตอบแทน ฯลฯ)
   - `portal-redesign-prototype.html` ต้นแบบที่กดได้ เลือกหน้าจากเมนูซ้าย, `#track` และ `#consent` · ปุ่ม "ดูสิ่งที่เปลี่ยน" บอกเหตุผลและ dev spec ของแต่ละหน้า · สลับธีมได้ที่แถบบนสุด
2. **ต้องมีก่อน:** เมนูบัญชี 9 รายการของ account Phase 1 (`PROMPT-account-orders.md`) ต้องอยู่ใน branch ต้นทางแล้ว ถ้ายังไม่มี ให้รัน account Phase 0–1 ก่อน (Phase 0 ของ prompt นี้เช็กให้และจะหยุดถ้ายังไม่มี)
3. ลำดับ: **Phase 0 → 1 → 2 → … → 8** แล้วจึง **Phase 9** (ฟีเจอร์เพิ่ม เปิดด้วย flag ทีละตัว) ทุก Phase หยุดรออนุมัติ
4. ทุก Phase มี 2 กล่อง
   - **🟦 API** วางใน session ของ `getpack-api` (รันก่อน) ฝั่งนี้เขียน `docs/design/portal-redesign/API-CHANGES.md`
   - **🟩 Web** วางใน session ของ `getpack-web` (รันหลัง API เสร็จ) ฝั่งนี้อ่าน `API-CHANGES.md` จาก `../getpack-api` แล้วรัน `pnpm gen:api`
   - Phase ที่ไม่มีงานฝั่งใดฝั่งหนึ่งจะเขียนว่า "ไม่มี"
5. Branch: Phase 0 ลง `fix/uat-phase0` ตาม GLOBAL-RULES §4 แล้ว `git merge` เข้า `design/portal-redesign` · Phase 1–9 ลง `design/portal-redesign` (ชื่อเดียวกันทั้งสอง repo) ซึ่งสร้างจาก `design/business-redesign` ถ้ายังไม่มี ให้ใช้ branch ล่าสุดที่มีอยู่ตามลำดับ upload → editor → studio → account → checkout → configurator
6. ระหว่างรัน ห้ามชำระเงินจริง ห้ามสร้างคำสั่งซื้อหรือเอกสารภาษีจริงใน UAT นอกจากที่ prompt อนุญาต

---

## Shared context

```text
<context>
Project: getpack (getpack.co) by Collective Group (Thailand) Co., Ltd. Next.js `getpack-web` (customer, admin.*, partner.*)
+ NestJS `getpack-api`. This pack covers the public order-tracking page /track, the sign-in consent step, and the
customer portal menus not designed by the account-orders pack.

Already designed (do not redesign, extend consistently): docs/design/account-redesign/PROMPT-account-orders.md and
account-orders-prototype.html — account navigation 19 → 9 (ภาพรวม · ซื้อ: คำสั่งซื้อ, ใบเสนอราคา, งานออกแบบ, สั่งซ้ำ ·
เอกสารและบัญชี: เอกสาร, ข้อความ, คะแนนและสิทธิพิเศษ, ข้อมูลบัญชี), overview, orders list, order detail. Its Phase 1
owns the nav labels and routes; this pack fills the tabs inside those menus.

Reference prototype: docs/design/portal-redesign/portal-redesign-prototype.html (routes #track, #consent, #quotes,
#designs, #reorder, #docs, #msgs, #rewards, #account). Its "ดูสิ่งที่เปลี่ยน" dialog lists, per page, the UAT evidence,
the redesign and the dev spec. Design language = docs/design/styles-redesign/design-tokens.css (no new colours/fonts).

Observed in UAT on 2026-10-28 (accounts C01 มาลี, C03 นภา, C06 อนันต์, C07 ปรีชา, C09 กมล; OTP 000000):
- Tax invoices are issued twice for instalment orders. UATOR-2610-00008 (C01, ฿39,988.82, deposit 50% + balance):
  UATTR-2610-00010 ฿19,994.41 + 00011 ฿19,994.41 + 00012 ฿39,988.82. UATOR-2610-00007 (C07, ฿179,361.06): 00007
  ฿89,680.53 + 00008 ฿89,680.53 + 00009 ฿179,361.06 labelled "ใบกำกับภาษีฉบับสุดท้าย". Documents total 2× the order.
- C07 is a juristic buyer flagged "หักภาษี ณ ที่จ่าย"; nothing in the portal handles the WHT amount or the 50 ทวิ
  certificate. C07's confirmed billing statement (ใบวางบิล) and any delivery note are not listed in /account/documents.
- /account/documents: "สถานะ" column empty although the intro promises e-Tax status; date inputs are dd/mm/yyyy (CE).
- Design thumbnails load from `abbon-oic-documents.s3.ap-southeast-1.amazonaws.com/getpack/customer_content/2026/`
  (no object key → broken image; bucket name of another company/project is exposed to customers).
- Referral link renders `https://www.getpack.invalid/r/<code>` (STOREFRONT_BASE_URL unset → `.invalid` default in
  platform/notifications/deep-links.service.ts).
- /account/agent: "ไม่เกิน 30% ของกำไรคำสั่งซื้อนั้น" (internal margin) and "แนะนำพาร์ทเนอร์ผลิต ได้ ฿3,000 เมื่อ…ผลิตงาน
  สำเร็จ 3 งานภายใน 120 วัน" (tells an outsider about a factory's activation/output).
- Order detail (C06 O6, C07 O7) still shows the production sub-step "โรงงานรับงานแล้ว". O6: all production sub-steps
  done incl. "พร้อมจัดส่ง" but the main status is "กำลังผลิต"; promised ship date 26 ต.ค. passed with no late badge.
- /track accepts only a `trk…` token; wrong token → generic 404 "ไม่พบหน้านี้". The order page has a button
  "ลิงก์ติดตามสถานะสำหรับแชร์" that mints a new link on each click. Public DTO (store.tracking.get) is already minimal and
  throttled (D-224, TRACKING_THROTTLE_LIMIT 30/min) but still returns the external carrier `trackingUrl`/`trackingNo`.
- /account/instalments: C01 group UATOG-2610-00016 due 15 ต.ค. shows "ถึงกำหนดชำระ · ชำระงวดนี้" while the overview shows
  "เลยกำหนดชำระ · ตรวจราคาใหม่และชำระ"; table overflows at 390 px (scrollWidth 523).
- /account/quotes (C01): 9 identical saved quotes (300 ชิ้น ฿5,469), no quote number, no filter, dimension label order
  differs between rows ("ยาว × กว้าง × สูง" vs "กว้าง × ยาว × ลึก"). C07: expired quotes offer only "เปิดอีกครั้ง"; ordered
  quote has no link to the order.
- RFQ: C07 UATRFQ-2610-00005 "รอข้อมูลเพิ่มเติม" — team asked a question on 12 ต.ค., nothing in the list or messages shows
  it is waiting for the customer; spec label "material" untranslated; tape size shown as "100 × 100 × 48 มม.". C03
  UATRFQ-2610-00002 quote expired 27 ต.ค. = dead end (no re-quote); totals contain hidden shipping (500 × ฿25 + VAT =
  ฿13,375 but shown ฿13,749.50).
- Call-off (C07): unit "piece" untranslated, "คงเหลือ 0 piece" before any call-off (should be 10,000), "ใช้ได้ถึง ไม่กำหนด"
  for a 6-month term, "ใส่งวดใหม่ลงตะกร้าแล้ว 0", minimum per call-off 1 piece.
- Overview (C07, C09): "เริ่มกล่องแรกของคุณ" shown to a customer with a completed order. Completed order shows
  "แจ้งปัญหาสินค้า" next to "หมดเวลาแจ้งเคลม".
- Messages (C06): customer message of 12 ต.ค. unanswered for 16 days, no status/SLA; thread renders empty for 2–3 s
  with no skeleton; a delivery question sits in "สอบถามทั่วไป" with no link to the order.
- Company workspace exists at /business/* (C09, UAT-CO-001: overview, approvals, reorder, credit, members, branches,
  assets, settings, api) and collides with the public marketing page /business. Overview says "อนุมัติเมื่อเกิน
  ฿10,000" while the settings field is empty. /account/team is 404.
- Sign-in consent step: native <details> triangles, links inside checkbox labels, legal text is placeholder
  "[UAT] ข้อความทดสอบ…", privacy notice must be "accepted", all marketing channels in one checkbox, disabled primary
  button with no reason. Cookie banner reappears on several pages within one session.
- Address line mixes the company name into the street ("10/1 ถนนทดสอบ แบรนด์สกินแคร์ออนไลน์ สีลม …").
- Toggles in notifications/privacy expose no on/off state to screen readers. Referral table overflows at 390 px.

Business decisions for this pack (owner, 2026-10-28):
- Tax invoices for instalment orders: one tax invoice/receipt per payment received; never an extra full-amount
  "final" tax invoice. Existing duplicates in UAT are reported, not edited by code; accounting voids them by procedure.
- Sales agents are external: no profit-based cap wording (use a THB cap per order from config); no reward or status
  for referring factories — partner leads go to an admin-only form (/partner-with-us) with no feedback to the agent.
- Team & approvers this round: roles + approval threshold (+ PO rule, approval by e-mail/LINE). Reuse the existing
  company module; move logged-in /business/* to /account/company/* (public /business stays marketing).
- /track: the carton QR / signed link shows minimal status without a second factor (status, timeline, ETA, carton
  count). Order number + phone/e-mail (or a signed link from the customer's e-mail/LINE) unlocks order no., product,
  destination province + postcode, in-production photos (product only) and LINE follow. Never full address, price,
  origin or anything about production sites.
- Earlier decisions stay (GLOBAL-RULES §6, DECISIONS-STAGE-A): overdue = re-quote then pay, never auto-cancel; split
  artwork statuses; price lock 15 days; production 5 working days; tolerances ± 5% (credit), ± 3 mm, ΔE2000 ≤ 3;
  LINE support daily 09:00–18:00; full tax ID shown to the account owner; customer-file access by role + audit (D-444).
</context>

<hard_rules>
0. GLOBAL RULES: follow docs/design/GLOBAL-RULES.md, docs/design/DECISIONS-STAGE-A.md and
   docs/design/portal-redesign/DECISIONS-PORTAL.md + AUDIT-PORTAL.md (decisions P-01..P-27, findings F-01..F-28, sign-off items S-01..S-06 for
   this pack — use those values; S-items ship as config, off in production until signed off). Precedence:
   GLOBAL-RULES.md → DECISIONS-STAGE-A.md → DECISIONS-PORTAL.md → this file.
1. Factory confidentiality: no factory name, location, count, capacity, machines, coverage, shipper or terms in any
   page, API payload sent to the storefront, PDF, e-mail, LINE message, image, file name, alt text or metadata. Use
   "ทีมงาน", "ฝ่ายผลิต", "การผลิต". Strip such fields server-side. Agents and /track viewers are outsiders.
2. Reverse confidentiality: production/partner surfaces never receive customer name, address, phone, e-mail or
   company; files sent to production are metadata-stripped and named by job code.
3. No internal strategy on customer or partner pages (why getpack Factory is free, margins, supplier strategy).
4. NEVER ship sample data. Everything the prototype marks "ตัวอย่าง" is fake. Missing real data → hide the element or
   use the prototype's neutral placeholder label, and list it in the phase report. No fake reviews, no AI-image hints.
5. Copy only claims what the system does today. A feature not live yet is hidden or behind its flag.
6. Git: Phase 0 on `fix/uat-phase0`, then `git merge fix/uat-phase0` into `design/portal-redesign`; Phases 1–9 on
   `design/portal-redesign` in each repo. Never merge to main, never force-push, never rebase. Small commits.
7. Single owners (GLOBAL-RULES §5): spec label helper (ยาว × กว้าง × สูง, mm), VAT/price display helper, pricing service,
   quote PDF + 15-day lock, header/tokens/LINE button, account nav labels (account Phase 1). Import, never fork.
8. Every old URL keeps working (308 to the new route + tab). Lists are cards, not wide tables; no horizontal page
   scroll at 360/390 px; dark mode via tokens; keyboard operable; visible focus; role="switch" + aria-checked on
   toggles; aria-live for filters/results; Thai-first copy via i18n (no raw keys, no English labels like "material",
   "piece").
9. Gate for every Web phase: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` (NODE_OPTIONS=
   --max-old-space-size=4096) · e2e for the pages touched · `grep -rn "โรงงาน" src/ messages/` limited to customer
   surfaces returns nothing new. API phases: lint · typecheck · unit + e2e tests · OpenAPI regenerated.
10. Each phase ends with a report (done / assumptions / open questions / not verified) and STOPS for approval.
</hard_rules>
```

---

## Phase 0 — บั๊ก ข้อมูลรั่ว และสำรวจ (ยังไม่ออกแบบใหม่)

### 🟦 API — วางใน `getpack-api`

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: fix/uat-phase0 (git fetch; continue it if it exists).

<task>
0. Survey first (read-only): list the modules/controllers/DTOs behind /track, quotes, RFQs, call-offs, replenishment,
   designs, samples, structural requests, documents, instalments, messages, points, wallet, referral, agent,
   addresses, notifications, privacy/consents, company (/business). Write the map into
   docs/design/portal-redesign/FINDINGS-API.md before changing code.
1. Tax invoices (decided, P-01): for orders with instalments issue one tax invoice/receipt per payment received and
   never the extra full-amount "final" tax invoice. Evidence (read-only DB): final TRs UATTR-2610-00009/00012/00016
   set deducted_prior_amount = prior gross but restate the full vat_amount and wht_amount of the instalments, and
   net + vat ≠ gross. Whatever the accountant decides on a final summary TR (S-02), add invariants and tests: per
   document net + vat (+ rounding) = gross; per order Σ vat over non-void TRs = VAT of the order; Σ wht likewise;
   VAT/WHT reports never count a summary document. Find where "ใบกำกับภาษีฉบับสุดท้าย" is issued and stop it for instalment
   orders. Invariant + tests: Σ tax-invoice amounts per order = order total − credit notes. Add a read-only script
   `pnpm docs:duplicate-tax-invoices` listing affected orders/documents (UAT: 00008/00010/00011/00012,
   00007/00007/00008/00009). Do NOT void or edit issued documents in code — report for accounting.
2. Customer files: thumbnails and every customer-facing file URL are signed URLs on getpack's own domain/CDN (or
   presigned with a getpack bucket). No bucket name of another company/project in any URL. Verify the object exists
   before returning a thumbnail; otherwise null. Report every bucket/prefix in use.
3. STOREFRONT_BASE_URL: required in env schema; production refuses `.invalid`; dev default http://localhost:3001.
   All deep links (referral, tracking, e-mail, LINE) use it.
4. Agent programme (decided): store/agent DTOs drop any profit-based cap and any partner-referral reward/status;
   add `maxCommissionPerOrderThb` (config). Partner leads from agents go to the admin queue only.
5. Production step labels to customers come from one neutral map (รับงาน, พิมพ์, ขึ้นรูป, ตรวจคุณภาพ, แพ็กเสร็จ); no
   "โรงงาน" in any store payload, e-mail or LINE template. Add a test scanning store DTO examples and templates.
6. Order customer status: when every production sub-step is done and a shipment is ready, status = ready_to_ship
   ("พร้อมจัดส่ง"); expose `shipLate: boolean` when promisedShipDate < today and not shipped. Completed orders past the
   claim window expose no claim action.
7. Public tracking: remove carrier `trackingUrl`/`trackingNo` from PublicTrackingDto; carrier events keep only status,
   time and destination-side location. Add `GET /v1/store/orders/:id` → `trackingUrl` (one durable signed link per
   order, created at payment; regenerate endpoint revokes the old one) so the UI no longer mints links on click.
8. Instalments: overdue instalments return the same customer status/action as the overview (เลยกำหนดชำระ +
   re-quote action from account Phase 0, D-436).
9. Call-offs: remainingQty = contractQty − calledQty; unit via i18n key; before confirmation return termMonths and
   validUntil = null with basis "from_confirmation"; minCallOffQty from the product MOQ.
10. RFQ spec labels are i18n keys; spec shape per product type (tape: width × length, not L × W × H).
11. Company: approvalThreshold has one source (overview and settings read the same field); fix the empty field.
12. Overview next step: never "start your first box" for customers with any paid order.
12a. Boot guard: on start, compare applied Prisma migrations with the build; if any are pending, log the names and make
    /health return 503 with reason "migrations_pending" (AUDIT F-34). Public tracking DTO: drop statusLabelAdminTh and
    per-step promisedAt; step labels from the neutral map (F-33).
12b. UAT seed (idempotent, via existing admin/seed APIs, never raw SQL): one RFQ basket (C02), one sample request
    in "shipped" (C03), one structural request with draft round 1 (C05), one agent account with 2 bound customers and
    a statement (C13 as agent), one admin-minted tracking link for O6. List the new ids in FINDINGS-API.md so the
    audit can re-check the 5 routes not yet verified (AUDIT-PORTAL.md §1).
13. Agent sub-routes (customers, leads, commissions, statements, statements/:id) for non-agents return 403 with
    code agent.not_enrolled (the web shows the join page), never a 500 (AUDIT F-07, P-27).
14. Reorder price (order /reorder): return goodsExVat, shipping, vat, total so lines add up; the reorder price is a
    quote locked 15 days (P-24); return leadTimeReason when lead time > the 5-working-day standard (P-26).
15. Claims: one customerStatus (in_review | awaiting_customer | decided) + decisionDueAt = claim date + 5 working
    days; CS-lead alert at 3 working days (P-25). Fix the contradictory "รอทีม / ตอบกลับแล้ว / เลยกำหนด" payload.
16. Bulk reorder (company): accept current order numbers (e.g. UATOR-2610-00008 / OR-…); remove the legacy "PK-"
    prefix from examples, error codes shown to customers and docs (reference codes become GP-…).
Write docs/design/portal-redesign/API-CHANGES.md (Phase 0 section: endpoints, DTO diffs, migrations, env vars,
examples). Run lint, typecheck, tests; commit; push. Then `git checkout design/portal-redesign` (create from the base
named in the วิธีใช้ section) and `git merge fix/uat-phase0`. STOP with the report.
</task>
```

### 🟩 Web — วางใน `getpack-web`

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: fix/uat-phase0.

<task>
0. Check prerequisites: the 9-item account nav of account Phase 1 exists in the base branch of design/portal-redesign.
   If not, STOP and say which pack/phase to run first.
1. Fetch docs/design/portal-redesign/API-CHANGES.md from ../getpack-api (same branch), commit it here, run
   `pnpm gen:api`.
2. Fix what the user sees: thumbnails (placeholder when null), referral link base URL, agent copy (no profit cap, no
   partner reward), "โรงงานรับงานแล้ว" → neutral labels, ready_to_ship + late badge, completed order without claim
   action, overview next step, call-off numbers/units, RFQ labels, instalment overdue status/action, tracking link
   from the order (no mint-on-click).
3. 390 px overflow: /account/instalments and the referral table (cards, not tables).
4. Toggles: role="switch" + aria-checked everywhere in the account zone.
5. Cookie consent: the banner must not reappear after a choice (persist 180 days across routes); add a test.
6. Date inputs in the account zone display Buddhist-era dates via the shared formatter.
7. Agent sub-pages show the join page for non-agents. Reorder page: lines that add up ("ราคารวม VAT" breakdown),
   15-day validity, lead-time reason. Claim page: one status + due date. Artwork page: dieline download (free AI/PDF),
   unpaid note "ไฟล์ได้รับแล้ว ทีมงานจะตรวจหลังชำระเงิน", LINE/phone shown. Proof page: remove the stray "หัวข้อ" label.
   Bulk reorder example uses the current order-number format. Error pages show GP- reference codes.
8. Write docs/design/portal-redesign/FINDINGS-WEB.md (what changed, screenshots 1440/390, open questions).
Gate (hard rule 9). Commit, push, merge into design/portal-redesign. STOP with the report.
</task>
```

---

## Phase 1 — ติดตามคำสั่งซื้อ `/track`

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. POST /v1/store/tracking/lookup {orderNo, contact} → 200 {token} | 404 (one identical body for every miss:
   unknown order, wrong contact, cancelled). Normalise phone to E.164 and e-mail to lower case; constant-time compare.
   Throttle per IP (5 per 10 min) and per orderNo (10 per hour); 429 with Retry-After. Log attempts without contact
   values.
2. POST /v1/store/track/:token/verify {contact} → sets an httpOnly, SameSite=Lax cookie (15 min) scoped to that
   token. GET /v1/store/track/:token returns the minimal DTO; with a valid verify cookie (or a token minted from the
   customer's own e-mail/LINE link, flag `verified: true`) it adds orderNo, productName, destination {province,
   postcode}, photos[] (product-only, EXIF stripped), lineFollowAvailable.
3. Minimal DTO keeps: status + statusLabelTh, promisedShipDate, estimatedDeliveryDate, shippedAt, deliveredAt,
   shipLate, steps (neutral labels + dates), cartons count. Never: names, addresses, phone, price, origin, carrier URL.
4. Tests: enumeration (same 404 body/timing class), throttle, verify cookie scope/expiry, DTO field allow-list.
Update API-CHANGES.md (Phase 1). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /track: one form, two modes (รหัสจากกล่องหรือลิงก์ | เลขคำสั่งซื้อ + เบอร์/อีเมล), privacy note, track-specific
   errors (ไม่พบข้อมูลที่ตรงกัน / ลองหลายครั้งเกินไป with wait time) announced via aria-live; side card for sign-in.
3. /track/[token]: status + pill, 3 facts (คาดว่าจะได้รับ, กำหนดออกจากฝ่ายผลิต, ปลายทาง → "ยืนยันเพื่อดู" until
   verified), late callout when shipLate, 5-step timeline with production sub-steps, verify panel (contact) →
   verified view (order no., product, photos lightbox, LINE follow, "เปิดในบัญชี", "ถามทีม"), add-to-calendar (.ics
   generated client-side), noindex. Unknown token → the same not-found state as the form, not the global 404.
4. Order detail links to its trackingUrl ("แชร์สถานะ" copies the durable link).
5. Match the prototype (#track): compare at 1440 / 1054 / 390 dark and fix every difference that comes from design
   (spacing, hierarchy, copy, states). Keep code-driven differences and list them.
6. Analytics: track_lookup{mode,result}, track_verify{result}, track_calendar, track_line_follow.
Gate (hard rule 9) + e2e: lookup ok / miss / 429, verify, mobile no horizontal scroll. Commit, push. STOP.
</task>
```

---

## Phase 2 — ขั้นตอนข้อตกลงตอนเข้าสู่ระบบ + หน้าอ่านฉบับเต็ม

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Legal documents: GET /v1/store/legal/documents?keys=tos,privacy → [{key, version, effectiveAt, title,
   summary[], sections[{id,title,html}], pdfUrl, readingMinutes, requiresAcceptance}] (privacy = notice,
   requiresAcceptance=false). Admin can publish a new version (existing admin CMS if present; otherwise a seed + admin
   endpoint). Production refuses to serve text starting with "[UAT]".
2. Consents: POST /v1/store/me/consents {accept:[{key,version}], marketing:{email,line,sms}}; audit row per change
   (timestamp, version, channel, ip hash, user agent). GET /v1/store/me/consents/pending → versions to accept +
   changeSummary[]. GET /v1/store/me/consents/history.
3. Marketing LINE consent only when LINE is linked (else 422 consent.line_not_linked).
Update API-CHANGES.md (Phase 2). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. ConsentStep (replaces the current step after OTP): step indicator 3/3 on the brand panel; three cards — ข้อกำหนด
   (จำเป็น, 3-point summary from the API, "อ่านฉบับเต็ม", one checkbox outside any link), ประกาศความเป็นส่วนตัว
   (แจ้งให้ทราบ, no checkbox), ข่าวสาร (ไม่บังคับ, per-channel switches off by default, LINE disabled with reason when not
   linked). Primary button states its reason while disabled ("ยอมรับข้อกำหนดก่อนเริ่มใช้งาน"). Re-consent shows only
   changed documents + changeSummary.
3. LegalReader dialog (shared): title, version / effective date / reading time chips, summary box, sticky table of
   contents (hidden < 900 px), reading progress bar, PDF, "ยอมรับและกลับไป" when opened from the consent step, focus
   trap, Esc, scroll restore. 15 px / 1.75 / max 68ch.
4. Match the prototype (#consent and the reader) at 1440 / 1054 / 390 dark; fix every design difference.
5. Analytics: consent_view{reason:first|new_version}, consent_accept{marketing_channels}, legal_open{key}.
Gate (hard rule 9) + e2e: first login, re-consent, keyboard-only. Commit, push. STOP.
</task>
```

---

## Phase 3 — ใบเสนอราคา (ใบเสนอราคา | คำขอใบเสนอราคา)

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Quote.number (QT-YYMM-#####, UAT prefix as other documents) + migration/backfill. GET /v1/store/quotes?status=
   active|expired|ordered → number, specLabel (shared helper), qty, gross/goods/shipping/vat, lockedUntil, daysLeft,
   orderId. Dedupe: identical spec + qty + price saved within 24 h return once (keep the newest; others archived).
2. POST /v1/store/quotes/:id/actions/requote → {old, new, diff, deliveryDate} (pricing service, no writes);
   POST /v1/store/quotes/:id/actions/confirm-requote → new quote locked 15 days. DELETE archives.
3. RFQ: customerStatus awaiting_customer | in_review | quoted | expired | declined (+ reason); pendingQuestion
   {text, askedAt}; quote lines [{qty, unitPrice, goods, shipping, vat, total, leadTimeBusinessDays}] — shipping is
   its own line; POST /v1/store/rfqs/:id/answer {text, attachments}; POST …/actions/request-new-quote (copies spec).
   Badge count for the nav = RFQs awaiting_customer + quotes expiring ≤ 3 days.
Update API-CHANGES.md (Phase 3). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/quotes?tab=quotes|requests (redirect /account/rfqs, /account/rfqs/[id] → ?tab=requests&rfq=id,
   /account/rfq-baskets kept or redirected to the quote basket owner).
3. Quotes tab: filter chips with counts, info callout (15-day lock), cards (number, specLabel, qty, total "รวม VAT และ
   ค่าส่ง", lock meter "ราคาคงที่อีก n วัน" / หมดอายุ / สั่งซื้อแล้ว → link to order), actions per state (สั่งซื้อ ·
   ตรวจราคาวันนี้ dialog with old/new/diff/date · ตัวเลือก: ขอตัวอย่าง, สัญญาเรียกของ, PDF, ลบ).
4. Requests tab: cards with owner-based status; team question shown on the card; side sheet per RFQ: answer with
   quick chips + attachments; quoted → tier picker with goods/shipping/VAT lines, PDF, สั่งซื้อจำนวนนี้; expired/declined →
   ขอราคาใหม่.
5. Match the prototype (#quotes) at 1440 / 1054 / 390 dark; fix every design difference.
6. Analytics: quotes_tab{tab}, quote_requote{result}, quote_order, rfq_answer, rfq_request_new, rfq_order{qty}.
Gate (hard rule 9). Commit, push. STOP.
</task>
```

---

## Phase 4 — งานออกแบบ (งานออกแบบ | ตัวอย่างสินค้า | คำขอออกแบบโครงสร้าง) และสั่งซ้ำ (สั่งซ้ำตามรอบ | สัญญาเรียกของ)

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Designs: DesignVersion created on explicit save, on checkout and every 30 min while dirty (not on every
   autosave); list returns thumbnailUrl (signed, Phase 0), sizeLabel, versionCount, lastOrderedAt.
   POST /v1/store/designs/actions/claim-local {localIds[]} moves browser drafts into the account after sign-in.
2. Samples: customerStatus (requested → in_production → shipped → awaiting_review → approved | changes_requested),
   POST …/approve, POST …/request-changes {notes, photos}.
3. Structural requests: rounds, slaDueAt, drafts (3D/dieline links), POST …/feedback {pins[], notes}, completed →
   style added to the customer's library.
4. Replenishment: GET /v1/store/replenishment → [{productRef, lastOrder, dailyUseEstimate, source: history|customer,
   runOutDate, orderByDate (lead time = production working days + shipping)}]; PATCH dailyUse; reminder preference.
5. Call-offs: fields from Phase 0 + nextCallOff action allowed only when confirmed.
Update API-CHANGES.md (Phase 4). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/designs?tab=designs|samples|structural (redirect /account/samples*, /account/structural-requests*):
   design cards with real thumbnails, search, sort, version history, "สั่งผลิต"; drafts claimed automatically after
   sign-in (info callout once, no import button); samples and structural requests as cards with the owner's next step.
3. /account/reorder?tab=cycle|calloffs (redirect /account/replenishment, /account/call-offs*): forecast card (usage
   bar, run-out and order-by dates, สั่งซ้ำ, ปรับการคาดการณ์), reminder settings; call-off card with 3 numbers, locked
   price, term basis, disabled call-off button with its reason until confirmed.
4. Match the prototype (#designs, #reorder) at 1440 / 1054 / 390 dark; fix every design difference.
5. Analytics: design_open, design_version_restore, sample_action{action}, structural_feedback, reorder_forecast_edit,
   reorder_now, calloff_next.
Gate (hard rule 9). Commit, push. STOP.
</task>
```

---

## Phase 5 — เอกสาร

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Document types for the customer list: tax_invoice_receipt, receipt, invoice, credit_note, debit_note,
   delivery_note, billing_statement, wht_certificate (customer upload). Each with number, date, amount, orderRef,
   instalmentLabel, eTaxStatus (pending|sent|failed|not_applicable), voided {at, reason, replacedBy[]}.
2. GET /v1/store/documents?month=&type=&q=&buyerProfileId= (grouped by month); GET …/zip?month= (async job →
   signed link, notify when ready). All documents issued by Collective Group (Thailand) under the getpack brand.
3. Withholding tax: BuyerProfile.withholdsTax + whtRateCode (rates from config per income type; business confirms with
   the accountant). Payment shows grossAmount, whtAmount, netToPay. POST /v1/store/documents/:id/wht-certificate
   (PDF/image ≤ 10 MB, virus scan, finance review queue) → status awaiting|received|mismatch; reconcile on approval.
4. Automatic delivery: BuyerProfile.accountingEmail + mode (each_document | monthly_zip).
Update API-CHANGES.md (Phase 5). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/documents?tab=&month=: header actions (ดาวน์โหลดทั้งเดือน, ส่งให้ฝ่ายบัญชีอัตโนมัติ dialog), WHT callout when
   certificates are awaited, type tabs with counts (ทั้งหมด, ใบกำกับภาษี/ใบเสร็จ, ใบลดหนี้/เพิ่มหนี้, ใบส่งของ, ใบวางบิล,
   50 ทวิ), search + month + buyer filters, cards grouped by month with e-Tax and WHT chips, voided documents struck
   through with reason and replacements, WHT sheet (pre-VAT base, rate, amount, upload).
3. Match the prototype (#docs) at 1440 / 1054 / 390 dark; fix every design difference.
4. Analytics: docs_filter{type,month}, docs_zip, docs_automail_save{mode}, wht_upload{result}.
Gate (hard rule 9). Commit, push. STOP.
</task>
```

---

## Phase 6 — ข้อความ

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Conversation.subject {type: order|rfq|quote|general, id, label}; RFQ questions and answers live in the RFQ's
   conversation (one thread, no duplicates). customerStatus awaiting_customer | awaiting_team | answered; slaDueAt
   from business hours config; admin alert when a customer message passes its SLA.
2. GET /v1/store/conversations (unread, status, last message preview); POST …/messages; quick-reply suggestions per
   subject type from config; reply channel preference (web | line when linked).
Update API-CHANGES.md (Phase 6). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/messages?thread=id (redirect /account/messages/[id]): inbox (list + thread on desktop, two screens on
   mobile), "เริ่มเรื่องใหม่" with subject picker, header with subject link and status pill, waiting-on-you callout,
   contextual quick chips, attachments, skeleton while loading, aria-live for new messages, reply-channel line.
3. Match the prototype (#msgs) at 1440 / 1054 / 390 dark; fix every design difference.
4. Analytics: msg_thread_open{type}, msg_send{type,quick}, msg_new{type}.
Gate (hard rule 9). Commit, push. STOP.
</task>
```

---

## Phase 7 — คะแนนและสิทธิพิเศษ (คะแนน | เครดิตร้านค้า | ชวนเพื่อน | ตัวแทนขาย)

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Points: summary {available, valueThb, pending, nextExpiry}, tiers [{name, thresholdThb, multiplier}],
   spend12m + basis text, history with order links.
2. Agent: application status; dashboard {boundCustomers (masked names), pendingThb, paidThb, linkClicks30d},
   statements with WHT certificate PDF; terms with maxCommissionPerOrderThb (Phase 0). No factory/partner data.
3. Referral: link from STOREFRONT_BASE_URL; referred friends with masked names and status.
Update API-CHANGES.md (Phase 7). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/rewards?tab=points|credit|referral|agent (redirect /account/points, /wallet, /referral, /agent/*): points
   stats + tier ladder + rule text + history; credit balance and codes; referral code/link copy (clipboard fallback)
   and friends as cards; agent: terms (THB cap, payout day, WHT) + apply, then dashboard; separate "แนะนำพาร์ตเนอร์"
   card linking to /partner-with-us with no feedback loop.
3. Match the prototype (#rewards) at 1440 / 1054 / 390 dark; fix every design difference.
4. Analytics: rewards_tab{tab}, referral_copy{what}, agent_apply, partner_lead_open.
Gate (hard rule 9). Commit, push. STOP.
</task>
```

---

## Phase 8 — ข้อมูลบัญชี (ที่อยู่และใบกำกับภาษี | การแจ้งเตือน | ความเป็นส่วนตัว | ทีมและผู้อนุมัติ)

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Address: placeName (separate from street), deliveryNote; postcode → subdistrict/district lookup.
2. BuyerProfile: type (juristic|individual), taxId (full, owner only), branchCode/headOffice, withholdsTax,
   accountingEmail; GET /v1/store/tax-lookup/:taxId (DBD open data, cached; graceful when unavailable). Changing a
   profile never rewrites issued documents; POST /v1/store/documents/:id/reissue-request.
3. Notifications: matrix topic × channel with `locked` (order/payment e-mail, documents e-mail); SMS only for OTP,
   due instalments, delivery day.
4. Privacy: consent toggles (history kept), data export request (ZIP within 30 days), deletion request with retained
   categories (tax documents 5 years) shown before confirming; deletion preview lists what is lost with amounts
   (store credit, points, designs, brand-kit fonts/logos), OTP confirmation, 30-day window with cancel (AUDIT F-29).
5. Company: expose the existing company module under /v1/store/company/* (members, roles: admin, buyer, approver,
   accountant; approvalThreshold; poRule none|optional|required; approve/reject; LINE approval postback signed,
   single-use, 24 h). Keep /business/* API aliases until the web redirect ships.
Update API-CHANGES.md (Phase 8). Lint, typecheck, tests, commit, push. STOP.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign.

<task>
1. Pull API-CHANGES.md, `pnpm gen:api`.
2. /account/settings?tab=addresses|notifications|privacy|team (redirect /account/addresses, /notifications,
   /privacy; /account/team → ?tab=team). Address and buyer-profile cards with edit sheets (tax lookup, WHT switch,
   accounting e-mail, reissue note); notification matrix with locked cells and reasons; connected accounts; privacy:
   accepted versions (LegalReader), consent switches, export/delete with consequences.
3. Team tab (company members only; others see what a company account offers + link to create one): stats (pending
   approvals, credit, PO rule), members with role selects, invite dialog (roles explained), approval rule flow +
   threshold + PO rule + approve-by-LINE switch, links to branches, brand files, API.
4. Move logged-in /business/{approvals,reorder,credit,members,branches,assets,settings,api} → /account/company/*
   (308). Public /business stays the marketing page. Header avatar menu uses the same labels (account Phase 1).
5. Match the prototype (#account) at 1440 / 1054 / 390 dark; fix every design difference.
6. Analytics: settings_tab{tab}, address_save, buyer_profile_save{wht}, notif_toggle{topic,channel},
   privacy_request{type}, team_invite{role}, approval_rule_save.
Gate (hard rule 9). Commit, push. STOP.
</task>
```

---

## Phase 9 — ฟีเจอร์ที่ทำให้ getpack นำตลาด F1–F53 (อนุมัติทุกข้อแล้ว แต่ละข้อหลัง feature flag ปิดไว้ก่อน)

### 🟦 API

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign. Build one flag at a time,
in this order, each with tests and an API-CHANGES.md section; STOP after each flag for approval.

<task>
F1 FEATURE_TRACK_LINE_FOLLOW — after /track verification, follow the order on LINE (LINE Login + OA push per step,
   PDPA consent); ETA change pushes.
F2 FEATURE_WHT_OCR — read uploaded 50 ทวิ with the existing local OCR (file-content-search, Tesseract) to prefill
   payer tax ID, date, base and WHT amount; auto-match to the payment; mismatch → finance queue.
F3 FEATURE_QUOTE_APPROVER_LINK — signed read-only quote link (15 days, revocable, prices optional) for a customer's
   approver without an account; approver can "อนุมัติ" (records name/e-mail) → buyer gets "สั่งซื้อ" unlocked.
F4 FEATURE_QUOTE_COMPARE — compare up to 3 quotes/RFQ lines (unit price, total, lead time, material) server-side.
F5 FEATURE_REORDER_FORECAST — learn daily use from order intervals; reminder 10 days before order-by date by
   LINE/e-mail with a one-tap reorder deep link (today's price, same approved file).
F6 FEATURE_DOCS_AUTOMAIL — send each document or a monthly ZIP to the accounting e-mail; monthly statement PDF.
F7 FEATURE_BRAND_KIT_STUDIO — company brand files (logos, fonts, colours) available in the Studio and editor
   (respects the open customer-font decision D-284: hidden until the business answers).
F8 FEATURE_MSG_SLA — SLA timers, CS alert when breached, customer sees "ทีมจะตอบภายใน …".
F9 FEATURE_AGENT_INSIGHTS — agent link analytics (clicks, sign-ups, first orders) without customer PII.
F10 FEATURE_COMPANY_SPEND — company spend by month, branch, requester and product type; export Excel.
F11 FEATURE_TRACK_DELIVERY_WINDOW — on delivery day, verified viewers see a 2-hour arrival window from the getpack
   delivery team (no vehicle position, no origin); updated when the team updates it.
F12 FEATURE_TRACK_RECEIVER_CHANGE — verified viewers can ask to change receiver name/phone or leave a drop-off note
   before dispatch (goes to CS; address changes stay in the account).
F13 FEATURE_LEGAL_DIFF — re-consent shows a plain-language "สิ่งที่เปลี่ยน" list and a side-by-side diff of changed
   sections between versions.
F14 FEATURE_QTY_BREAK_HINT — quote and RFQ cards show the next price break from the pricing service ("สั่ง 3,000 ชิ้น
   ถูกลงชิ้นละ ฿x") — computed, never invented.
F15 FEATURE_QUOTE_EXPIRY_REMINDER — LINE/e-mail 3 days before a saved quote's lock ends, with "สั่งซื้อ" deep link.
F16 FEATURE_DESIGN_SHARE_REVIEW — share a read-only 3D preview of a design (signed, 15 days) for colleagues to pin
   comments; comments return to the designer in the Studio.
F17 FEATURE_DESIGN_PRINT_READY — each design card shows the shared preflight result (upload Phase 2 engine) before
   ordering.
F18 FEATURE_CALLOFF_SCHEDULE — call-off agreements can schedule automatic call-offs (e.g. monthly qty); customer
   confirms each one by LINE 3 days before.
F19 FEATURE_MULTI_REORDER — one reorder basket for several previous items (merges the company "สั่งซ้ำหลายรายการ").
F20 FEATURE_ETAX_FILES — per document: resend to e-mail, download the e-Tax XML/PDF-A, show e-Tax delivery status.
F21 FEATURE_STATEMENT_OF_ACCOUNT — credit accounts: statement with ageing (current, 1–30, 31–60, > 60 days) and
   pay-all-due.
F22 FEATURE_MSG_CONTEXT — starting a message from any order/quote/document attaches it as context; CS sees it.
F23 FEATURE_MSG_CSAT — one-tap "ตอบตรงคำถามไหม" after a thread is answered; internal metric only, never published.
F24 FEATURE_POINTS_AT_CHECKOUT — cart and quote show "ใช้คะแนนได้ ฿x" with one toggle (points rule from P-04).
F25 FEATURE_REFERRAL_SHARE — LINE share card and QR for the referral link (no fake numbers on the card).
F26 FEATURE_SESSIONS — account security: signed-in devices list, sign out others, alert on a new device.
F27 FEATURE_CONTACT_ROUTING — company contacts per topic (เอกสาร → ฝ่ายบัญชี, สถานะ → ผู้สั่งซื้อ, อนุมัติ → ผู้อนุมัติ).
F28 FEATURE_COMPANY_WEBHOOKS_UI — manage webhook subscriptions, secrets and delivery history in /account/company/api.
F29 FEATURE_APPROVAL_BUDGET — optional monthly budget per branch set by the company admin; the approval detail shows
   used / after-this-approval as one bar; over budget is flagged, never blocked. No budget set → bar hidden.
F30 FEATURE_DOCS_RECONCILE — per order, a reconciliation row: the sum of non-voided tax invoices (net, VAT, WHT, gross)
   against the order total; "ยอดรวมตรงกับคำสั่งซื้อ" only when it matches to the satang, otherwise finance gets an alert
   and the customer sees "ทีมบัญชีกำลังตรวจ". Uses the P-01 rules.
F31 FEATURE_STUDIO_BRAND_LOCK — company admin can limit the Studio colour picker to kit colours ("ใช้เฉพาะสีแบรนด์");
   the brand check strip adds edge distance (text ≥ 3 mm from the cut line) and logo minimum size before ordering.
F32–F53 — see AUDIT-PORTAL.md §7 (one flag each, FEATURE_<NAME> in SCREAMING_SNAKE from the table row): action queue,
   proof pins/compare, split delivery, QC report (only with recorded measurements), instalment reminders + pay-all,
   quote quantity tiers, RFQ from photo, design versions, dieline download, sample credit, structural 3D approval,
   stock-count reply, input-VAT summary, company shared inbox, points expiry reminder, agent commission forecast,
   branch CSV import, data export, member spending limit, approval delegation, proof of delivery, brand guideline PDF.
</task>
```

### 🟩 Web

```text
First read docs/design/portal-redesign/PROMPT-portal-redesign.md, section "Shared context", and follow its
<context> and <hard_rules> strictly for this whole task. Branch: design/portal-redesign. Build the UI for each flag
the API side finished, in the same order, hidden when the flag is off; STOP after each flag.

<task>
For each flag: pull API-CHANGES.md, `pnpm gen:api`, build the UI exactly where the prototype shows its entry point
(track "รับแจ้งทาง LINE", docs WHT sheet, RFQ "ส่งให้ผู้อนุมัติ", quotes "เปรียบเทียบ", reorder forecast card, docs
"ส่งให้ฝ่ายบัญชีอัตโนมัติ", company "ไฟล์แบรนด์", message header SLA, agent dashboard, company overview, company approvals
budget bar (F29), docs reconciliation table (F30), Studio "ใช้เฉพาะสีแบรนด์" in the brand-kit prototype (F31)); flags F11–F28
have no prototype screen — place them where their description says, reuse existing components and tokens, and
attach a 1440/390 screenshot of each to the report, match the
prototype at 1440 / 1054 / 390 dark, add analytics `<flag>_used`, run the gate (hard rule 9), commit, push, STOP.
</task>
```

---

## ข้อมูล/การตัดสินใจที่ทีมธุรกิจต้องเตรียม

ตัดสินใจแล้วใน `DECISIONS-PORTAL.md` (P-01..P-21) ได้แก่ เพดานค่าตอบแทนตัวแทน, ระดับสมาชิก, SLA ข้อความและคำขอราคา, สัญญาเรียกของ,
แบบโครงสร้าง, การเตือนสั่งซ้ำ, ใบวางบิล/ใบส่งของ, ย้าย /business, bucket และ base URL · ที่เหลือคือรายการที่ต้องมีคนลงนาม:

| รายการ | ผู้ลงนาม | ใช้ทำอะไร | Phase |
|---|---|---|---|
| S-01 อัตราหัก ณ ที่จ่ายตามประเภทรายได้ | ผู้สอบบัญชี | 50 ทวิ ยอดสุทธิ | 5 |
| S-02 ยกเลิกใบกำกับที่ออกซ้ำ (UATTR-2610-00009, 00012) + นโยบายใบกำกับต่องวด | ผู้สอบบัญชี | เอกสารภาษี | 0, 5 |
| S-03 ข้อความฉบับจริง ข้อกำหนดการใช้บริการ / ประกาศความเป็นส่วนตัว | ที่ปรึกษากฎหมาย | ขั้นตอนข้อตกลง | 2 |
| S-04 หัก ณ ที่จ่ายค่าตอบแทนตัวแทน + สัญญาตัวแทน | ผู้สอบบัญชี + ที่ปรึกษากฎหมาย | ตัวแทนขาย | 7 |
| S-05 เงื่อนไขการใช้ข้อมูล DBD สำหรับค้นเลขผู้เสียภาษี | ที่ปรึกษากฎหมาย | ข้อมูลใบกำกับภาษี | 8 |
| ข้อมูลระบบ: host ของ UAT, LINE OA และสิทธิ์ push, การสร้าง bucket `getpack-<env>-customer-files` | ทีม infra | ลิงก์ ไฟล์ LINE | 0, 1, 8 |
