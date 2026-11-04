# getpack Agent — autorun REPORT

**Status: DONE** · run 2026-11-02 22:18 → 2026-11-04 (Asia/Bangkok) · every phase passed its gate and is merged to `main` in both repos.

## Overview

| Phase | Status | Merged | api merge | web merge | Notes |
|---|---|---|---|---|---|
| P0 Rules (no cap, progressive WHT) | PASS | ✔ | `fbaceab4` | `e0176433` | D-464, D-465 |
| P1 Landing + two-step apply | PASS | ✔ | `e28f4962` | `6a01d784` | D-466 |
| P2 Agent zone + PWA | PASS | ✔ | `16211925` | `ee7c593f` | D-467 |
| P3 Lead management | PASS | ✔ | `07462222` | `ef7e802d` | D-468 |
| P4 Sales desk + discount approval | PASS | ✔ | `10ecc5f2` | `a28f88f4` | D-469, D-470 |
| P5 Capture + scoring | PASS | ✔ | `45df1407` | `c5dd9765` | D-471 |
| P6 Management P&L | PASS | ✔ | `4830e6b4` | `518d028d` | D-472 |
| P7 QA, pilot, record | PASS | ✔ | `abf9f820` | `35460e3c` | assumptions only |

**Totals:** getpack-api 74 commits + 8 merges · getpack-web 92 commits + 8 merges · decisions D-464 – D-472 (identical in both repos) · every commit authored and committed by Superball, no trailers.

**Tests at the end:** API unit 1,927 · web unit 1,961 (+ dieline 12,678) · web e2e 88/88 · API e2e/integration written for every phase but **not run here (no Docker) — CI must run them before UAT.**

**Not verifiable in this environment:** API e2e (Docker), k6 at 50 rps on UAT, Lighthouse performance ≥ 90 (this VM scores lower; /agent 80–84), Safari iOS / Chrome Android device pass and PWA install, Storybook visual baselines, real XLSX/PDF export (S3 + Chromium).

## สิ่งที่คุณต้องทำ

ลำดับตามความสำคัญ — ข้อที่มี "คำแนะนำ" คือสิ่งที่ผมแนะนำในฐานะหัวหน้าทีมสายนั้น

**ก่อน UAT**
1. ให้ CI รัน e2e และ integration ของ getpack-api บน `main` (เครื่องนี้ไม่มี Docker) — ถ้าล้ม ส่งชื่อ test มาให้ผมแก้
2. รัน `pnpm db:seed:uat` บน UAT โดยตั้ง `UAT_SEED_CONFIRM=uat-only` และ `FIELD_ENCRYPTION_KEY` เดียวกับ API (ไม่งั้นลิงก์ใบเสนอราคาและเลขบัญชีจะว่าง) — ตัวตนสำหรับทดสอบอยู่ใน `docs/launch/UAT-DATA.md`
3. รัน `pnpm lhci agent-landing agent-apply agent-zone` บน CI และ k6 `perf/k6/agent-portal.js` บน UAT — เป้า Lighthouse perf ≥ 90, p95 < 300 ms
4. ทดสอบบน iPhone (Safari) และ Android (Chrome) ตามเช็กลิสต์ใน `DESIGN-NOTES.md` P7 รวมการติดตั้งแอป getpack Agent

**ระบบและโดเมน**
5. ตั้ง DNS + TLS `agent.getpack.co` → ชี้ไปที่ web deployment เดียวกับ `getpack.co` และใส่ `AGENT_HOST=agent.getpack.co`
6. เพิ่ม `agent.getpack.co` ใน LINE Login callback URL และ Firebase Authorized domains
7. สร้าง VAPID keys จริงและใส่ใน env ของ API (UAT และ production), เชื่อม LINE OA channel สำหรับแจ้งเตือนตัวแทน
8. Production image ของ API ต้องมี `tesseract-ocr` + ภาษาไทย (Dockerfile แก้แล้ว) — ตั้ง `OCR_ADAPTER=tesseract_cli`

**กฎหมาย ภาษี PDPA**
9. ให้ทนายรีวิวสัญญาตัวแทน v2 แล้ว export เป็น `getpack-api/docs/legal/sales-agent-agreement-v2-draft.md` → ผมจะ seed เป็นร่าง → publish ผ่าน /admin/agents (maker-checker) — ระหว่างนี้ใช้ v1
10. เติมเลขทะเบียน ที่อยู่ สาขา ของ Collective Group ใน settings บริษัท (ใช้ในสัญญาและ 50 ทวิ)
11. ให้ CPA ยืนยัน: ตารางภาษี SME ใน `tax.cit_rates` (และใส่ทุนชำระแล้ว `paidUpCapital` — ยังไม่ใส่ระบบคิด 20 %), การขยายเวลา e-filing +8 วัน, กรณีภาษีหักเป็น 0 ไม่ออก 50 ทวิ, และกรณี PLAN §5 ที่หักเกินในปีแล้วไม่คืน (ตัวแทนไปขอคืนใน ภ.ง.ด.90) — **คำแนะนำ:** คงแบบไม่คืนระหว่างปีไว้ก่อน เพราะปลอดภัยต่อการถูกประเมินภาษีเพิ่ม
12. Finance Manager เพิ่มเวอร์ชันใหม่ของ `tax.calendar` ให้มี `pnd1` (วันที่ 7 ของเดือนถัดไป) เพื่อให้ระบบเตือนกำหนดยื่น
13. นักบัญชีผูกบัญชี GL ให้ 5 บรรทัด P&L ที่ยังไม่มีบัญชี: เงินเดือน, ค่าเช่าและสาธารณูปโภค, ซอฟต์แวร์และคลาวด์, ค่าวิชาชีพ, ดอกเบี้ยจ่าย (`pnl.line_catalogue`)
14. DPO เขียนและ publish ข้อความ consent `agent_waitlist` (ถ้ายังไม่มี ฟอร์มรอเปิดรับจะปิด) — **คำแนะนำ:** เก็บข้อมูลรายชื่อรอ 12 เดือนหลังเปิด public แล้วลบ; ยืนยันระยะเก็บรูปนามบัตร 7 วัน — **คำแนะนำ:** คง 7 วัน
15. DPO กำหนดขั้นตอนลบข้อมูลผู้ติดต่อที่ถูกบันทึกเป็นลูกค้ามุ่งหวัง (ยังไม่มีปุ่มในระบบ — ทำผ่าน RUNBOOK §6 ไปก่อน)

**ธุรกิจและฝ่ายขาย**
16. เลือกตัวแทนนำร่อง 10–20 คน → Sales Manager ใส่ customer public id ใน `agents.pilot` แล้วตั้ง `enabled: true` — **คำแนะนำ:** pilot 60 วันตาม PLAN §4 แล้วทบทวน KPI ก่อนเปิด `agents.programme` ให้ public
17. ยืนยันค่าที่ยังเป็น proposed: น้ำหนักคะแนน lead (`sales.scoring_rules`), วันรอสตูดิโอ 3 วัน, เวลาตอบครั้งแรก 4 ชั่วโมง, ความน่าจะเป็นต่อขั้น 10/20/40/60 % — **คำแนะนำ:** ใช้ตามที่ seed ไว้ช่วง pilot แล้วปรับจากข้อมูลจริง
18. ตั้งค่าที่ยังว่างโดยตั้งใจ: กันหนี้สูญ % (`finance.bad_debt_provision_pct`) และเพดานยอดอนุมัติส่วนลด — **คำแนะนำ:** เริ่มกันหนี้สูญ 1 % สำหรับลูกค้าเครดิต และยังไม่ตั้งเพดานยอดจนกว่ามีดีลจริง (เกณฑ์ % กับ floor ป้องกันอยู่แล้ว)
19. เปิดสวิตช์จับ lead อัตโนมัติ (`capture.studio_idle_enabled`, `capture.dieline_download_enabled`) เมื่อมีเซลล์รับงานจริง
20. วันจ่ายเงินตัวแทน: ระบบจ่ายภายใน `paymentTermsDays` (15 วัน) หลังอนุมัติ ไม่ใช่ "วันที่ 5" ตาม P-02 — **คำแนะนำ:** คงตามระบบ ถ้าต้องการวันที่ 5 ให้ปรับ setting ไม่ต้องแก้โค้ด
21. กรอกผู้ติดต่อเหตุฉุกเฉินใน `RUNBOOK.md` §8

**งานต่อยอด (ไม่บล็อกการเปิด pilot)**
- แยก client message ตาม route เพื่อดัน Lighthouse perf ของหน้า storefront (`docs/performance-budgets.md`)
- Contract requests ที่ยื่นไว้: win rate รายช่วง, รายการสินค้าสำหรับเซลล์, ผู้ร่าง/ผู้ส่งการ์ดคู่มือ, เมนู P&L สำหรับ Director, deep link ในการแจ้งเตือนตัวแทน
- แหล่ง lead จาก LINE OA (รอระบบแท็กแชท), การยืนยันล็อกราคาโดยโรงงานใน partner zone, คะแนนจากการเข้าหน้าราคา (ต้องมี consent purpose ใหม่)

---

## P0 — Rules: no cap, factory referral retired, no profit wording, progressive WHT · PASS
- Branches `feat/agent-p0-rules` · merge SHAs: api `fbaceab4`, web `e0176433`
- Delivered
  - Commission at the order's locked rate with no cap; margin alert (internal, event to management) + daily KPI table
  - Factory referral retired: customer leads only, plan versions refuse a bounty, auto link + job stopped, data job `agents:retire-bounty`
  - Store terms `StoreAgentTermsDto` (rates, months, `uncapped`) — no margin / cap / bounty anywhere an agent sees
  - Progressive s.50(1) withholding at statement approval; payout run uses the decided amount; ล.ย.01 submit + Finance review; juristic tax invoice before approval
  - Web: "ไม่จำกัดรายได้ ยิ่งขายมาก ยิ่งได้มาก", lead form customers only, ล.ย.01 page, statement WHT method, admin ล.ย.01 queue + review, statement WHT working + attach tax invoice
  - Web also adopted the API's unadopted D-463 follow-ups (factory code/name on admin POs and statements, `carrierBooked`, `receiverRecorded`)
- Decisions recorded: D-464, D-465 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,684+ ✔ (Spectral spec FLAKY under memory pressure, ✔ alone) · build (nest via contract:build) ✔ · contract:build + Spectral ✔ · migrate status clean ✔ · rollback (down.sql → redeploy) ✔ · seed idempotent ✔ · confidentiality + wording ✔ · golden WHT ✔ · e2e SKIPPED-DOCKER
  - Web: typecheck ✔ · lint ✔ · unit 1,793 ✔ · build ✔ · gen:api:check ✔ · tokens:check ✔ · i18n ✔ · e2e `agent-portal-p0` 5/5 ✔ (MSW mock server, no Docker needed) · no horizontal scroll 360–1920 ✔ · Lighthouse n/a (no new public route) · visual (Storybook) n/a (no new primitive)
  - Wording grep ✔ · fonts / dark surfaces: no new font or surface ✔ · commits: Superball author+committer, no trailers ✔
- Assumptions taken
  - YTD of the progressive method = statements approved in the Bangkok calendar year of approval (payment basis, s.50(1)); statements approved before D-465 count with their recorded WHT or 0 (programme not launched, S-04)
  - `agent.margin_alert_pct` owned by Finance Manager (C-Level has no `settings.change`; Superadmin may change any setting, D-448)
  - Store lead lists show customer leads only; historic factory leads stay with staff
  - `dead-ends.test.ts` already failed on main (`PageError.tsx`, G1 admin redesign) → allow-listed with its reason
- Open questions
  - PLAN §5 never refunds over-withholding within the year (golden schedule: ฿11,589.87 withheld vs ฿8,750.05 actual tax) — the agent claims on ภ.ง.ด.90; accountant to confirm or allow a December negative true-up
  - A juristic agent's statement below ฿1,000 records 0 WHT but the payout run's flat service rate still withholds 3 % — edge case for the accountant
  - Agreement v2 draft not exported yet (Phase 1 needs it)
- Screenshots: `docs/design/agent-portal/screenshots/P0/` (agent home, ล.ย.01 empty/submitted, statement, admin queue/review; phone 390 + desktop 1440)

## P1 — Entry points and two-step apply · PASS
- Branches `feat/agent-p1-entry` · merge SHAs: api `e28f4962`, web `6a01d784`
- Delivered
  - API: step-1 application (name, verified phone, e-mail, LINE, sales channels, pitch, agreement) behind flag `agents.programme`; phone OTP `store.agentPhone.request/confirm`; payout profile (Thai tax-id check digit, bank-name match, encrypted account, draft → submitted → verified/rejected) with Finance verification creating the vendor and proposing the bank account (dual approval); statements without a verified profile stay draft with `payout_profile_missing`; public programme + commission example endpoints; FAQ drafts, notifications, flag seed
  - Web: landing `/agent` (th/en, JSON-LD, calculator from the API), `/agent/apply`, `/account/agent/payout`, non-agent account page as compact landing, admin payout-profile queue/review, entry points (header ≥74 rem + drawer, footer, /account, /business, /partner-with-us)
- Decisions recorded: D-466 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,686 ✔ · contract:build (no drift) + Spectral ✔ · migrate status clean ✔ · rollback (down.sql → redeploy) ✔ · seed idempotent ✔ · e2e SKIPPED-DOCKER (suite rewritten for two-step; CI runs it)
  - Web: typecheck ✔ · lint ✔ · unit 1,793 ✔ · build ✔ · gen:api:check ✔ · tokens:check ✔ · i18n ✔ · e2e `agent-portal-p1` 7/7 + `agent-portal-p0` 5/5 ✔ · no horizontal scroll 360–1920 ✔ · Lighthouse `/agent` mobile: a11y 99 · SEO 100 · best practices 100 · perf 64 (VM-limited: the approved /partner-with-us scores 67 on the same machine) → **CI lhci to confirm ≥90**
  - Wording (no โรงงาน/factory, profit/margin, ฿0, coming soon on /agent — e2e asserts) ✔ · light theme, getpack tokens, Anuphan only ✔ · commits Superball, no trailers ✔
- Assumptions taken
  - A phone on the account counts as verified (signed in by OTP); otherwise the form asks for a code (API refuses `agents.phone_unverified`)
  - Payout profile only after approval (API requires an agent); apply copy says so and promises no review time
  - Payment copy follows `paymentTermsDays` (D-466 §5)
  - Header link shown in the bar only from 74 rem so the 1040–1184 px width budget is unchanged
- Open questions
  - Agreement v2 draft still missing → v1 stays in force
  - Landing benefits "quote in your name" and "getpack Agent app" depend on P3 / P2 shipping — re-check at P7 before the flag opens
  - Lighthouse performance must be confirmed in CI (VM throttling)
- Screenshots: `docs/design/agent-portal/screenshots/P1/` (landing, apply, payout empty, admin queue/review; phone 390 + desktop 1440)

## P2 — Agent zone agent.getpack.co (PWA "getpack Agent") · PASS
- Branches `feat/agent-p2-zone` · merge SHAs: api `16211925`, web `ee7c593f`
- Delivered
  - API: sessions record their surface (`client` storefront|agent), list/revoke my sessions per surface; storefront → agent hand-off by one-time code (60 s, single use, fingerprint-bound, hashed, audited); agent-zone guard on every `/v1/store/agent` handler (ended agents: statements + 50 ทวิ for `agents.ended_record_access_years` = 5); agent web push; notification choices per event × channel (payment/tax e-mails locked on, D-144); lead-protection reminders 7 and 1 days; seeds for push/LINE/e-mail routes
  - Web: fourth host zone `agent` (env AGENT_HOST, BFF allow-list, CSP, ESLint boundaries, noindex); sign-in OTP/LINE/Google/Apple with `client: "agent"`; hand-off button on the storefront (code in the URL fragment); installable PWA (manifest, icons, service worker, install prompt after 2nd visit, iOS guide); shell — phone tab bar (ภาพรวม · ลูกค้ามุ่งหวัง · ใบเสนอราคา · ค่าคอม), tablet rail, desktop sidebar; all agent pages moved (overview, customers, leads, commissions, statements + 50 ทวิ, payout, tax, notifications, profile with sessions); `/account/agent/**` → 308; share sheet (Web Share, copy, LINE, full-screen QR)
- Decisions recorded: D-467 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,705 ✔ · contract:build (no drift) + Spectral ✔ · migrations ×3 with down.sql, rollback + redeploy ✔ · seed idempotent ✔ · confidentiality spec extended ✔ · e2e SKIPPED-DOCKER (agents e2e extended)
  - Web: typecheck ✔ · lint ✔ · unit 1,878 ✔ · build ✔ · gen:api:check ✔ · tokens:check ✔ · e2e P0+P1+P2 26/26 ✔ (+ zones.spec) · no horizontal scroll 360–1920 ✔ · Lighthouse mobile: agent `/` perf 94 / a11y 100, `/sign-in` perf 77 (VM) / a11y 100 · PWA installable (manifest, icons, active worker — e2e; this Lighthouse has no PWA category)
  - Wording/confidentiality (agent deny-list extended to src/features/agent) ✔ · Anuphan only, light surfaces ✔ · commits Superball, no trailers ✔
- Assumptions taken
  - `statement_ready` = statement approved (amounts and WHT final); operation ids follow the contract pattern (`auth.customerHandoff.*`, `store.agentPush.*`, `store.agentNotificationPreferences.*`)
  - Channel enum reuses `PartnerNotificationChannel` (Spectral forbids duplicate shapes)
  - Ended agents lose ล.ย.01 and payout profile access (Finance handles late cases)
  - The API has no CORS host list (web calls it server-side), so AGENT_HOST is web-only
  - ใบเสนอราคา tab in P2 = how a quote reaches a customer today + share actions (P3 brings quotes on behalf)
- Open questions
  - Push/LINE deep links for agent events are null until P3 routes settle
- Screenshots: `docs/design/agent-portal/screenshots/P2/` (overview, leads, commissions, statements, payout, tax, notifications, profile, sign-in; phone 390 + desktop 1440; overview tablet 768)

## P3 — Lead management for agents · PASS
- Branches `feat/agent-p3-leads` · merge SHAs: api `07462222`, web `ef7e802d`
- Delivered
  - API: pipeline stages (won set by the system on first payment, lost releases protection), append-only timeline, follow-up reminders outside quiet hours (setting), neutral duplicate check, CSV export/import (dry run → commit, 500 rows, Idempotency-Key); quote on behalf through the store pricing path, shared `/q/{token}` carrying the agent code, opened/accepted in the timeline; discount requests with give-get + competitor evidence (one round per version unless give-get changes), options with the agent's commission (full rate first, co-fund only after the agent accepts, spiff allowed); deal registration (auto ≥ ฿500,000 commission base, 90 days, rate lock used by commission accrual); playbook cards v1 published from PLAYBOOK.md; business-card scan (OCR port: Tesseract CLI tha+eng / fake; photo purged after 7 days); commission forecast per order
  - Web (agent zone): pipeline views (ทั้งหมด · ต้องติดตามวันนี้ · ใกล้หมดสิทธิ์ · ปิดแล้ว) as phone cards / tablet 2 columns / desktop table + board, "ย้ายไปขั้น…" menu (drag optional); new lead FAB/N with duplicate check, card scan review, offline drafts queue (IndexedDB + service worker, "รอส่ง"); lead detail with sticky actions and timeline; agent-mode quote flow + quotes list; 3-step discount request with playbook beside; deal badges; คู่มือการขาย page; CSV import; forecast view; storefront `/q/{token}` sets the agent cookie
- Decisions recorded: D-468 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,745 ✔ · prettier ✔ · contract:build (no drift, 1,514 paths) + Spectral ✔ · 5 migrations with down.sql, full rollback + redeploy ✔ · seed idempotent ✔ · confidentiality spec over every P3 operation ✔ · OCR tried on real Tesseract 5.3.4 ✔ · e2e SKIPPED-DOCKER (agents-p3 e2e written)
  - Web: lint ✔ · typecheck ✔ · unit 1,907 ✔ · gen:api:check ✔ · tokens:check ✔ · build ✔ · e2e P3 10/10, P0–P3 + zones 55/55 ✔ · no horizontal scroll 360–1920 on all P3 pages ✔ · Lighthouse `/leads` mobile a11y 100 · best practices 100 · perf 81 (VM) → CI to confirm ≥90 · visual snapshots not added
  - Wording/confidentiality (no cost/margin/factory in agent surfaces) ✔ · Anuphan, light ✔ · commits Superball, no trailers ✔
- Assumptions taken
  - Forecast dates follow D-466 §5 (summary on the 1st, paid within paymentTermsDays of approval), not "the 5th"
  - Agent quotes belong to getpack until the lead converts, then pass to the customer; standard rate = first-order rate until the customer's first commissioned order
  - An accepted discount option locks one rate for first and repeat orders of that quote and wins over a deal-registration lock
  - Playbook v1 published (PLAN §7 owner-agreed); rep/manager-only cards hidden from agents; English copy empty
  - Quote on behalf uses an agent-zone flow on the same pricing contract instead of the storefront configurator (keeps studio/cart/analytics out of the agent zone)
  - Duplicate/lead refusals collapsed to one neutral `agents.lead_unavailable` (D-440)
- Open questions
  - Card-scan photo retention 7 days is a proposed value for the PDPA owner
  - Staff-side discount options, applying an accepted discount to a new quotation and the PDF conditions line → P4
  - Web commits 3–9 of the branch don't build alone (items 1–2 landed after them); the merged head builds
- Screenshots: `docs/design/agent-portal/screenshots/P3/` (leads, lead detail, new lead, card scan, quote create/list/detail, discount steps + options, playbook, forecast, import; phone 390 + desktop 1440, tablet 768)

## P4 — Sales desk, discount approval and playbook (admin) · PASS
- Branches `feat/agent-p4-sales-desk` · merge SHAs: api `10ecc5f2`, web `a28f88f4`
- Delivered
  - API: staff pipeline for employee agents (`sales.pipeline.self` role sales_rep / `.manage`); inbound pool from contact form and non-customer RFQs + manual, first-response SLA (working hours), manual or round-robin assignment with capacity, SLA breach alerts; dashboard + CSV; discount approval desk (authority rep ≤3 % / manager ≤8 % with floor / C-Level above, negotiation-heavy one level up, SLA + escalation, cost-unknown refusal, snapshot hash → stale, price lock request for big deals), waterfall per quote/option with field-level tiers (rep authority chip / manager margin % / full for C-Level, VP, Director, Finance Manager, Superadmin), view log, finance-only export, simulator; accepted option → discounted quotation + checkout memo + PDF conditions line; negotiation history + lost-to-price; playbook admin with maker-checker; credit cost estimate; post-deal review
  - Web (admin "ฝ่ายขาย"): inbox with SLA timers and bulk/round-robin assign, pipeline table + board (non-drag stage menu), lead page on components shared with the agent zone, sales quotes, dashboard (funnel with drop-off, SLA %, sources, reps, freelance vs employee), approvals queue + detail with the bridge chart, floor line and viewer watermark, live simulator, options builder (full-rate option locked first), decide, view log; playbook admin with phone/desktop preview; negotiation, lost-to-price and post-deal reports; every figure explained by tooltip
- Decisions recorded: D-469, D-470 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,778 ✔ (golden credit cost ฿6,642 + ฿4,757 = ฿11,399 = 1.06 %, deposit case ฿0; forbidden-field absence per role) · prettier ✔ · contract:build (no drift) + Spectral ✔ · 3 migrations rolled back and redeployed ✔ · seed idempotent ✔ · e2e SKIPPED-DOCKER (sales-p4 e2e written)
  - Web: lint ✔ · typecheck ✔ · unit 1,907 ✔ · gen:api:check ✔ · tokens:check ✔ · build ✔ · e2e P4 8/8 + P0–P3 + zones 55/55 ✔ · no page scroll at 1024–1920 (inbox/pipeline also 768) ✔ · field RBAC from the received BFF JSON: rep payload `visibility: authority` with no cost/margin keys, manager `margin_pct` only, C-Level full, export only for Finance Manager, view log written ✔ · visual snapshots SKIPPED (no Storybook build here; stories added) · Lighthouse n/a (admin only)
  - Wording ("กำไรหลังหักค่าคอม", never "กำไรสุทธิ"; agent-visible playbook refuses cost/margin/factory words) ✔ · commits Superball, no trailers ✔
- Assumptions taken
  - Working hours for SLA = every day 09:00–18:00 (`calendar.business_hours`); product class = product category
  - Top-level discounts decided by C-Level (and Superadmin) only; VP/Director see the full waterfall but don't decide
  - Credit cost: day 0 = job acceptance (checkout); receipts net of VAT; each factory leg rounded half-up to baht
  - Non-customer RFQ = customer with no order group and no agent link
  - Dashboard draws won and new leads per period instead of a computed win-rate trend (web does no division of business figures)
- Open questions
  - Unset by design (no decision): bad-debt provision %, approval amount caps
  - LINE OA chats have no sales tag yet → not in the inbound pool; factory confirmation of price locks in the partner zone not built (locks stay `requested`)
  - Contract requests filed: win-rate per period, products for rep quotes, playbook card actors, deal registration in approval header, menu entry for finance/auditor
- Screenshots: `docs/design/agent-portal/screenshots/P4/` (1440 + 1024 per screen; approval detail full tier also 1280 and 1920)

## P5 — Automatic lead capture and scoring · PASS
- Branches `feat/agent-p5-capture` · merge SHAs: api `45df1407`, web `c5dd9765`
- Delivered
  - API: capture sources behind flags (both seeded OFF) — studio designs not ordered after `capture.studio_idle_days` (3) and dieline downloads by signed-in non-customers, each only with recorded marketing consent; first dieline download free without sign-in (`store.dielines.downloadFree`, device cookie hashed, counted under lock, `dielines.anonymous_free_downloads` = 1), then free sign-in — never a paywall; lead score 0–100 from `sales.scoring_rules` with top-3 reasons for staff, score only for agents on their own leads; attribution precedence agent link > agent lead > rep > pool (agent-attributed customers never enter the company pool)
  - Web: second dieline download → sign-in sheet (Google, Apple, LINE first, then OTP) and the download continues; consent copy explains the follow-up; admin inbox/pipeline score chip with reasons popover, min-score filter and sort, source icons; agent-zone score chip
- Decisions recorded: D-471 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · prettier ✔ · unit 1,819 ✔ · contract:build (no drift) + Spectral ✔ · 3 migrations rolled back and redeployed ✔ · seed idempotent ✔ · e2e SKIPPED-DOCKER (sales-p5 + free-download specs written)
  - Web: lint ✔ · typecheck ✔ · unit 1,916 ✔ · gen:api:check ✔ · tokens:check ✔ · build ✔ · e2e P0–P5 + zones 68/68 ✔ · no horizontal scroll 360–1920 on the style page with the dieline form and the agent leads page ✔ · Lighthouse mobile `/styles/pk-te-01` a11y 100, perf 60 (trace-engine error on this VM — indicative only) · visual baselines SKIPPED (story added)
  - Wording ("ฟรี", never "฿0") ✔ · commits Superball, no trailers ✔
- Assumptions taken
  - Capture needs the latest record of at least one marketing consent purpose (e-mail, LINE or SMS); without it nothing is sent (no saved-design service reminder exists, none added)
  - Studio idle: one item per design, one open studio item per person; designs idle before the flag's effective date are not captured; staff, agents and inactive accounts never captured
  - Non-customer = no order group; a freelance agent's contact-form ticket or RFQ no longer creates a pool item
  - Pricing-page visits not scored: page views are collected under analytics consent (PDPA purpose limitation)
  - Clearing the device cookie gives another free first download — accepted, the file is free anyway
- Open questions
  - Turn on `capture.studio_idle_enabled` / `capture.dieline_download_enabled` when sales is staffed; confirm scoring weights and idle days (proposed)
  - Pricing-page scoring needs its own consent purpose; LINE chat source still deferred
- Screenshots: `docs/design/agent-portal/screenshots/P5/` (sign-in sheet 390/1440, admin inbox popover 1440/1024, agent leads 390/1440)

## P6 — Management P&L planner · PASS
- Branches `feat/agent-p6-pnl` · merge SHAs: api `4830e6b4`, web `518d028d`
- Delivered
  - API: plans (base/best/worst/custom, draft → locked with a frozen snapshot and DB trigger), cells auto/calculated/manual/override (note on first manual entry, reason on override, auto value kept), line catalogue as an effective-dated setting seeded from PNL-LINES.md with GL mapping, actuals from the posted ledger (open periods flagged), forecast from pipeline × stage probability + repeat run rate, trailing ratios/averages, depreciation schedules, CIT estimate with the SME table, memo lines (credit cost, bad debt, EBITDA, commission ÷ GM, DSO, DPO, CCC, break-even), variance + notes, drill-down to source records, watermarked XLSX/PDF export, access log; `pnl.read` c_level/vp/director/finance_manager/superadmin, `pnl.manage`/`pnl.export` c_level/finance_manager/superadmin
  - Web `/admin/finance/pnl`: header (plan picker, scenario tabs, status, plan-vs-actual toggle, recompute, lock, export), grouped collapsible grid with sticky column/header, ARIA grid keyboard navigation and inline edit, source marks by shape + label, tooltips on every line and cell (definition, formula, source + drill-down sheet, as-of, who/why), override reason dialog showing both values, summary strip + revenue / net profit charts, variance view with notes, tablet scroll inside the grid, phone summary + read-only month cards
- Decisions recorded: D-472 (both repos)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,892 ✔ (golden P&L, tooltip coverage with PNL-LINES drift check, route RBAC) · prettier ✔ · contract:build (no drift) + Spectral ✔ · migration rolled back and redeployed ✔ · seed idempotent ✔ · service smoke tests on local Postgres ✔ · export not run (needs S3 + Chromium) · e2e SKIPPED-DOCKER
  - Web: lint ✔ · typecheck ✔ · unit 1,953 ✔ · gen:api:check ✔ · tokens:check ✔ · build ✔ · e2e P6 8/8 + P0–P5 + zones 68/68 ✔ · no page scroll 768–1920 ✔ · RBAC: VP read-only (grid aria-readonly, POST 403), sales roles 403 page + BFF 403 ✔ · visual baselines SKIPPED (stories added)
  - Commits Superball, no trailers ✔
- Assumptions taken
  - Fiscal year = calendar year; pipeline spread evenly over 3 months (leads have no close date); stage probabilities 10/20/40/60 % (proposed)
  - CIT estimated on cumulative profit; SME bands only after the accountant enters paid-up capital (20 % until then)
  - Credit cost at company level from the cash conversion cycle; DSO on receivables incl. VAT (conservative); other income left out of revenue
  - Lock has no maker-checker (not in accounting-design §8) but is final and idempotent
- Open questions
  - Five lines unmapped in the chart of accounts (salaries, rent & utilities, software & cloud, professional fees, finance cost) → manual until mapped
  - English tooltip texts empty; Director has no sidebar route to the planner (contract request `admin.menu-pnl`)
- Screenshots: `docs/design/agent-portal/screenshots/P6/` (grid 1440/1920/1024, override, tooltip + drill-down, variance, locked, phone cards)

## P7 — QA, pilot and record · PASS
- Branches `chore/agent-p7-launch` · merge SHAs: api `abf9f820`, web `35460e3c`
- Delivered
  - API: UAT seed layer (`pnpm db:seed:uat`, guard `UAT_SEED_CONFIRM=uat-only`) — freelance individual, juristic VAT and employee agents, 12 leads in every stage, quotes, commissions in every status (฿200,000 uncapped, co-funded, reversal), 6 approval states, deal registrations, two statements (progressive WHT ฿12,216.67 on ฿250,000; juristic 3 % + VAT), inbound with a breached SLA, a P&L plan; k6 script + EXPLAIN pack; security review (21 findings: 7 fixed, 12 verified incl. 17 IDOR tests, 4 accepted, 1 open); runbook; pilot switch (`agents.pilot` allow-list setting, owner Sales Manager, off) + waiting list (consent-versioned, neutral replies, throttled) with admin list/export
  - Web: responsive gate over ~40 routes × 8 widths with fixes; Lighthouse sets for landing, apply and getpack Agent; client message trim; landing/apply decide apply vs waiting list vs closed; admin waiting-list tab; landing claims aligned with what shipped; agent wording unit gate
- Decisions recorded: none new (P7 choices recorded as assumptions)
- Gate results
  - API: typecheck ✔ · lint ✔ · unit 1,927 ✔ · prettier ✔ · contract:build (no drift) + Spectral ✔ · migration rolled back and redeployed ✔ · dev and UAT seeds idempotent ✔ · local smoke 50 rps × 30 s: p95 18.7 ms, 0 errors (plain Node generator; k6 not installed — SKIPPED) · e2e SKIPPED-DOCKER
  - Web: lint ✔ · typecheck ✔ · unit 1,961 ✔ · gen:api:check ✔ · tokens:check ✔ · build ✔ · e2e 88/88 (P0–P7 + zones) ✔ · no horizontal scroll at any width ✔ · Lighthouse mobile (VM): a11y 100 everywhere; perf /agent 80–84, agent pages 80–96 → CI to confirm ≥ 90 · real-device and PWA install passes NOT PERFORMED (no devices; checklists in DESIGN-NOTES) · wording grep clean ✔
- Assumptions taken
  - Pilot list as a Sales Manager setting instead of the flag's own userIds (flags are Superadmin-only)
  - Waiting-list retention 12 months after public opening (proposal for the DPO); rate limits are technical constants
  - Performance budgets are warnings (repo policy for field metrics); accessibility stays an error at 1.0
  - "ใบเสนอราคาในนามคุณ" rewritten to "ส่งใบเสนอราคาให้ลูกค้าได้เอง" (the quote does not carry the agent's name); "เรียลไทม์" → "ได้ในที่เดียว"
- Open questions
  - Forecast reads orders once per active link (fine for the pilot; batch before scale)
  - `tax.calendar` has no ภ.ง.ด.1 row → no filing reminder yet
- Screenshots: `docs/design/agent-portal/screenshots/P7/` (waiting list 390/1440, thank-you, closed 390/1440, pilot landing/apply, admin waiting list, contact sheets 360/1920)

