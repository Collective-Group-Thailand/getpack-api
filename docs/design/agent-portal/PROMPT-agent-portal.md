# getpack Agent — Lead management & agent portal · Claude Code Prompt Pack (v2, 2026-11-01)

## วิธีใช้ (อ่านก่อน)

1. คัดลอก 4 ไฟล์นี้ไปไว้ที่ `docs/design/agent-portal/` ของ**ทั้ง** `getpack-web` และ `getpack-api`
   - `PROMPT-agent-portal.md` (ไฟล์นี้)
   - `PLAN.md` แผน, ผลสำรวจ code, มติ A-01–A-14, มติภาษี §5, วินัยราคาและต้นทุนเงิน §7 (อ่านก่อนทุกรอบ)
   - `PLAYBOOK.md` เนื้อหาตั้งต้นของคู่มือการขาย (Phase 3–4 seed)
   - `PNL-LINES.md` รายการบรรทัด P&L พร้อมคำอธิบาย tooltip (Phase 6 seed)
2. **ลำดับ:** Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 ทุก Phase หยุดรออนุมัติ (Plan Mode ก่อนเสมอ)
3. **ทุก Phase มี 2 กล่อง**
   - **🟦 API** วางใน session ของ `getpack-api` (รันก่อน) ฝั่งนี้เขียน `docs/design/agent-portal/API-CHANGES-P<n>.md`
   - **🟩 Web** วางใน session ของ `getpack-web` (รันหลัง API เสร็จ) อ่าน `../getpack-api/docs/design/agent-portal/API-CHANGES-P<n>.md` แล้วรัน `pnpm gen:api`
   - Phase ที่ไม่มีงานฝั่งใดฝั่งหนึ่งจะเขียนว่า "ไม่มี"
4. **Branch:** `feat/agent-p<n>-<slug>` ชื่อเดียวกันทั้งสอง repo สร้างจาก `main` · CI เขียวแล้ว merge เข้า `main` ทันทีเมื่อ Phase นั้นได้รับอนุมัติ
5. **Git:** author และ committer = `Superball <Piyapan.pa@abbon.co.th>` · ห้ามมี `Co-Authored-By` หรือ `Claude-Session` trailer · Conventional Commits
6. ระหว่างรัน ห้ามชำระเงินจริง ห้ามออกเอกสารภาษีจริงใน UAT นอกจากที่ prompt อนุญาต
7. **ก่อน Phase 1:** ดาวน์โหลดร่างสัญญาจาก Claude Docs "สัญญาตัวแทนขาย getpack (ร่างเพื่อทนายตรวจ)" เป็น Markdown แล้ววางที่ `getpack-api/docs/legal/sales-agent-agreement-v2-draft.md` (Phase 1 จะ seed เป็น version สถานะ draft จากไฟล์นี้)
8. ปิดท้ายแต่ละ Phase: อัปเดต `docs/PROGRESS.md` และบันทึกมติใหม่ลง `docs/decisions.md` (เลขต่อจาก D-463 → D-464, D-465 …) ให้**เหมือนกันทั้งสอง repo**

---

## Shared context (แปะไว้บนสุดของทุกกล่อง)

```text
<context>
Project: getpack (getpack.co) by Collective Group (Thailand) Co., Ltd. Next.js 16 `getpack-web` (zones: customer,
admin.*, partner.*) + NestJS/Prisma `getpack-api`. This pack builds lead management for three sales audiences and a
dedicated agent portal:
- getpack company sales = sales agents of kind `employee` (work in the admin zone with their staff account);
- freelance sales = sales agents of kind `freelance` (work in a new agent zone, agent.getpack.co);
- factory sales = already built in getpack Factory CRM (D-359: ErpLead / ErpOpportunity / ErpActivity). Out of scope
  except: NO data may cross between factory CRM and getpack/agent data in either direction (D-435, D-463).

Already built (extend, do not rebuild): the sales agent programme D-416–D-423 — api `src/modules/agents/*`,
`prisma/schema/agents.prisma` (SalesAgentPlan/Version, SalesAgentApplication, SalesAgent, SalesAgentLink,
SalesAgentLead, SalesAgentCommission, SalesAgentStatement); web `src/app/[locale]/(storefront)/account/agent/*`,
`src/features/customer/agent/*`, admin desk `src/app/admin/(console)/agents/*`; agent link `getpack.co/a/{code}`.
Host-based zones: web `src/lib/zones/*`, `src/proxy.ts`, `src/app/manifest.ts`.

Read before every task:
1. CLAUDE.md of this repo, docs/prompts/00-master-plan.md, docs/prompts/design-system.md
2. docs/decisions.md — D-416–D-423, D-435, D-440, D-458, D-463 and every decision after them
3. docs/contract/api-conventions.md
4. docs/design/GLOBAL-RULES.md and docs/design/portal-redesign/DECISIONS-PORTAL.md (P-02, P-03, P-27, F47)
5. docs/design/agent-portal/PLAN.md (this pack's plan; §1 decisions A-01–A-14, §5 withholding tax, §7 pricing
   discipline and credit cost), PLAYBOOK.md, PNL-LINES.md
6. docs/PROGRESS.md (latest entries)

Hard rules (all phases):
- Factory confidentiality: nothing about factories (name, count, location, capacity, cost) reaches the customer
  zone, the public, or the agent zone. Keep test/unit/storefront-factory-confidentiality.spec.ts green and extend it to
  every new `/v1/store/agent/*` and agent-zone response.
- Store words only (D-440): agent-facing responses use customer words; refusals are neutral (one neutral reason, no
  hint that another agent owns a lead).
- No profit / margin wording anywhere an agent can see. The margin cap stays an internal guard only.
- Money = decimal strings from the API; the web never does money arithmetic. Dates in Asia/Bangkok.
- Configurable values are effective-dated, audited settings read from the API, never hard-coded.
- Web: UI primitives from src/ui only; all copy via src/i18n (th default, en); Anuphan is the ONLY font (text and
  numbers); light theme has no dark surfaces; no emoji as icons (Lucide set in src/ui); no "coming soon" badges.
- Design quality bar: must look like a senior product designer at a top European/US studio made it — never
  AI-generic. Use the ui-ux-pro-max skill for UX rules (see "Design method" below); getpack brand tokens win over any
  palette or font the skill suggests.
- API types on the web only from `pnpm gen:api`. Missing endpoint → docs/contract-requests.md + MSW mock marked
  `// CONTRACT-REQUEST`, never invented silently.
- PDPA: every new personal-data field gets purpose, retention and access recorded in the schema comment and in
  docs/rbac.md (api) / consent copy (web).
- Plan Mode first; small vertical slices; tests with every slice; stop at the end of the phase for approval.
</context>
```

### Design method (ใส่ในกล่อง 🟩 Web ทุก Phase ที่มี UI)

```text
<design-method>
1. Install the skill once per machine if missing:  npm install -g ui-ux-pro-max-cli && uipro init --ai claude
   (or in Claude Code: /plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill then
   /plugin install ui-ux-pro-max@ui-ux-pro-max-skill).
2. For each screen, run targeted searches only — one intent, 2–5 terms, e.g.
   search.py "bottom navigation mobile" --domain ux ; "data table mobile cards" --domain ux ;
   "multi-step form progressive" --domain ux ; "dragging movements" --domain ux ;
   "app router server components forms" --stack nextjs
   Do NOT run --design-system --persist: its palette/fonts conflict with getpack tokens and Anuphan.
3. Apply in priority order: accessibility (4.5:1, visible focus, labels) → touch (≥44 px, 8 px gaps, press feedback
   80–150 ms) → performance (CLS < 0.1, lazy images) → layout (mobile-first, no horizontal scroll, never disable zoom)
   → typography/colour (base 16 px, line-height 1.5, semantic tokens) → motion (150–300 ms, reduced-motion) → forms
   (visible labels, inline errors, inputmode/autocomplete, step indicator) → navigation (bottom nav ≤ 5, predictable
   back, deep links).
4. Record the rules applied per screen in docs/design/agent-portal/DESIGN-NOTES.md (append per phase).
5. Before delivery run the skill's pre-delivery checklist (references/pro-rules.md + quick-reference.md §1–§3).
</design-method>
```

### Responsive contract (ใส่ในกล่อง 🟩 Web ของ Phase 2–5)

```text
<responsive>
Breakpoints: phone < 640 · tablet 640–1023 · desktop ≥ 1024. Design each, never a stretched phone layout.
- Navigation: phone bottom tab bar (4 items: ภาพรวม · ลูกค้ามุ่งหวัง · ใบเสนอราคา · ค่าคอม; profile in header; no "More");
  tablet icon rail; desktop sidebar (same shell family as the partner zone).
- Primary action: phone FAB above the tab bar; tablet/desktop header button; desktop shortcut N (new lead).
- Lists: phone cards + filter bottom sheet; tablet 2-column cards; desktop data table (sort, filter, bulk actions,
  export CSV).
- Detail: phone full page + sticky action bar (โทร · LINE · ส่งใบเสนอราคา); desktop split view list/detail.
- Safe-area insets on every fixed bar; no content hidden behind them.
Acceptance (each phase): Playwright journeys at 360, 375, 393, 768, 1024, 1280, 1440, 1920 + visual snapshots
(project `visual`), no horizontal scroll at any width, Lighthouse mobile Performance ≥ 90 and Accessibility ≥ 95 on
every new route, keyboard-only pass on desktop, screen-reader labels on every icon button.
</responsive>
```

---

## Phase 0 — ปรับให้ตรงกับมติที่ตัดสินแล้ว

เป้าหมาย: **ไม่มีเพดานค่าคอม** และไม่มีการตัดค่าคอมแบบเงียบ (แทน P-02 ส่วนเพดาน), ตัดค่าแนะนำโรงงาน (P-03), ไม่มีคำว่ากำไร, ภาษีหัก ณ ที่จ่ายแบบอัตราก้าวหน้า (PLAN §5)

### 🟦 API — `feat/agent-p0-rules`

```text
[paste <context>]

Task: Phase 0 of docs/design/agent-portal/PROMPT-agent-portal.md. Plan Mode first; stop for approval.

1. Commission without a cap; no silent cut (owner 2026-11-01, supersedes the per-order cap of P-02)
   - Accrual (agent-commissions.service.ts): amount = commission base × the rate LOCKED for that order (standard
     first/repeat rate of the plan version, or the rate locked on the quote by Phase 3 deal registration / an
     agent-accepted co-fund option). No per-order cap. The margin cap no longer reduces commission: keep
     `marginCapPct` / `marginAmount` columns for history, stop applying them, and instead raise an internal alert
     (`agents.commission_margin_alert`) to C-Level when commission ÷ order gross margin exceeds the setting
     `agent.margin_alert_pct` (seed 30.00). Nobody but the agent can lower an agent's rate.
   - Do NOT add `agent.max_commission_per_order`. Plan versions get no cap field.
   - Monthly KPI job: commission ÷ gross margin per month (internal dashboard data for Phase 4).
   - Unit tests: large order pays the full rate; margin alert fires but amount unchanged; refund reversal is
     proportional; rate locked on a quote wins over a later plan version.
   - Record as D-464 "Agent commission has no cap; rates are locked per order and only the agent can accept a lower
     rate (co-fund)".

2. Remove factory referral from the programme (P-03)
   - Store surface: drop `factoryBountyAmount`, `factoryQualifyJobs`, `factoryQualifyDays` from every
     `/v1/store/agent/*` DTO and example; remove their allow-list entry from the factory-confidentiality guard.
   - `store.agent.leads.create` accepts only kind `customer`; kind `factory` → 422 `agents.lead_kind_unsupported`
     with the neutral store wording "แนะนำโรงงานได้ที่ getpack.co/partner-with-us".
   - Plans: new approved versions of seeded plans with bounty 0; plan-version create refuses bounty > 0
     (`agent_plans.bounty_retired`). Keep columns nullable for history; no destructive migration.
   - Admin `agent-factory-links` endpoints stay read-only for history (no create); mark them deprecated in the
     contract.
   - Jobs: disable the factory-qualification job; existing pending factory links → `ended` with reason
     `programme_change_P03` (one-off, idempotent, audited, dry-run first).

3. No profit wording
   - Store DTOs must not expose `marginCapPct`, `marginAmount` or any margin-derived field. Programme terms show:
     first-order %, repeat %, attribution months ("ไม่จำกัดรายได้"). Grep the store contract for margin|profit|กำไร.

4. Withholding tax per PLAN §5 (amends D-421)
   - Individuals (s.40(2)): replace the flat `wht_commission` 3 % with the cumulative progressive method:
       YTD = commission paid this calendar year incl. this statement
       projected = YTD + thisStatement × remainingMonthsInYear
       net = projected − min(50 % × projected, expenseCap) − allowances
       annualTax = brackets(net)
       whtNow = max(0, round2(annualTax × YTD / projected) − whtWithheldYTD)
     December statement trues up to actual (projected = YTD).
   - Effective-dated settings: `tax.pit_brackets` (seed 0–150,000: 0 % · 150,001–300,000: 5 % · –500,000: 10 % ·
     –750,000: 15 % · –1,000,000: 20 % · –2,000,000: 25 % · –5,000,000: 30 % · above: 35 %),
     `tax.wht_40_2.expense_rate` (0.50), `tax.wht_40_2.expense_cap` (100000.00),
     `tax.wht_40_2.personal_allowance` (60000.00).
   - New model `SalesAgentTaxDeclaration` (ล.ย.01): agentId, taxYear, allowances JSON (typed DTO: spouse, children,
     parents, insurance, provident/RMF/SSF, social security, home-loan interest, donations), evidence file ids,
     submittedAt, status (submitted | accepted | rejected), decidedBy. Store endpoints
     `store.agent.taxDeclaration.get/submit` (current year); admin review `admin.agentTaxDeclarations.list/decide`.
     Only an accepted declaration changes `allowances`; default personal allowance only.
   - Juristic agents: unchanged — service 3 % on payments ≥ 1,000.00, ภ.ง.ด.53; VAT 7 % added when the agent is
     VAT-registered and a tax invoice from the agent is attached before payment (statement approve refuses without it:
     `agent_statements.tax_invoice_required`).
   - Employee agents: unchanged (payroll export, D-420).
   - 50 ทวิ: income type "ค่านายหน้า 40(2)", form ภ.ง.ด.1; WHT report kind pnd1 includes agent rows.
   - Golden tests: a 12-month schedule of variable commissions (include a month with 0, a refund month, and a
     December true-up) with expected WHT per month; a juristic VAT-registered agent; an agent with an accepted ล.ย.01.
   - Record the decision as D-465 "Agent withholding: progressive s.50(1) for individuals; flat 3 % only for
     juristic agents" (amends D-421, owner delegated the accountant role 2026-10-31).

5. Contract + docs: OpenAPI updated; CHANGELOG; docs/design/agent-portal/API-CHANGES-P0.md listing every removed /
   added field, endpoint, error code, setting, migration, and the web checklist.

Acceptance: pnpm lint, typecheck, test (unit + e2e) green; prisma migrate status clean; storefront guard green;
golden WHT tests green.
```

### 🟩 Web — `feat/agent-p0-rules`

```text
[paste <context>]

Task: Phase 0 web. Read ../getpack-api/docs/design/agent-portal/API-CHANGES-P0.md, run pnpm gen:api. Plan Mode first.

1. Remove every use of the bounty fields and the factory lead kind (agent pages, PlanTerms, i18n keys, MSW mocks,
   stories, tests). The lead form offers customers only; a short neutral note links to /partner-with-us.
2. PlanTerms shows: first order %, repeat %, months and "ไม่จำกัดรายได้ ยิ่งขายมาก ยิ่งได้มาก". Remove every
   margin/profit/กำไร string; add the words to src/i18n customer-wording allow/deny tests so they cannot return.
3. New agent page section "ข้อมูลลดหย่อนภาษี (ล.ย.01)" under the agent account (temporary home until Phase 2 moves it):
   year selector, allowance fields grouped (ครอบครัว · ประกันและการออม · ที่อยู่อาศัย · บริจาค), evidence upload, status
   chip, rejection reason. Short helper text: "ถ้าไม่ส่ง ระบบใช้ค่าลดหย่อนส่วนตัวตามกฎหมายเท่านั้น".
4. Statement detail: show WHT line with its method label (บุคคลธรรมดา: คำนวณตามอัตราก้าวหน้า · นิติบุคคล: 3%) and
   download 50 ทวิ.
5. Admin: tax declaration review queue under /admin/agents (list, detail with evidence, accept/reject with reason).

Acceptance: lint, typecheck, test, e2e green; visual snapshots updated with reason; no string "กำไร" in agent UI.
```

---

## Phase 1 — ทางเข้าบนเว็บ + ฟอร์มสมัคร 2 ขั้น

เป้าหมาย: `getpack.co/agent` (indexable), สมัครขั้นที่ 1 แบบเบา, เก็บ payout profile ภายหลัง (A-03), ทางเข้า 4 จุด, สัญญาฉบับร่างพร้อม version

### 🟦 API — `feat/agent-p1-entry`

```text
[paste <context>]

Task: Phase 1 API. Plan Mode first.

1. Two-step onboarding (A-03)
   - `store.agent.application.submit` step 1 requires only: juristicType, displayName (or legal name for juristic),
     phone (must be the verified phone of the account; else 422 `agents.phone_unverified` → web runs OTP), email,
     lineId?, salesChannels[] (enum: line_groups, facebook, own_network, agency, print_shop, design_studio, other),
     pitch?, agreement acceptance (versionId + evidence as today). Remove taxId, address, ID document and bank from
     step 1 (make the columns nullable; migration non-destructive).
   - New `SalesAgentPayoutProfile` (1:1 agent): legalName, taxId (13, checksum), branchCode, isVatRegistered,
     address + postcode, idDocumentFileId, bankCode, bankBranchName?, bankAccountName, bankAccountNoEnc +
     last4, bankBookFileId?, status (draft | submitted | verified | rejected), verifiedBy/At, rejectReason, rowVersion.
     Endpoints: `store.agent.payoutProfile.get/upsert/submit`, `admin.agentPayoutProfiles.list/get/verify/reject`.
     Verification creates/updates the agent's vendor and proposes the bank account through the existing dual
     approval (B5.3) — move that logic out of application approval.
   - Statements: earned entries accrue as today; statement approval for a freelance agent requires a verified payout
     profile, else the statement stays `draft` with flag `payout_profile_missing` and the agent is notified. Nothing
     is lost.
   - Bank account name must match legalName (normalised); mismatch → `agents.bank_name_mismatch`.
2. Public programme endpoint (no auth) `store.agent.programme.public`: current standard plan terms (first %, repeat %,
   months, no cap, link cookie days, lead protection days, payment day), agreement version id + title + URL,
   FAQ items from CMS. Cached 5 min, ETag.
3. Agreement: seed the draft text of `sales_agent_agreement` v2 from docs/legal/sales-agent-agreement-v2-draft.md
   (the owner will paste the reviewed text; status `draft`, NOT published). Publishing stays a maker-checker action.
   Until published, step 1 uses the currently published version.
4. Feature flag `FEATURE_AGENT_PROGRAMME` gates submit; the public programme endpoint works regardless (for the
   landing page).
5. API-CHANGES-P1.md + D-466 "Agent onboarding in two steps; payout profile before the first payout".

Acceptance: green suites; migration reversible; old applications still readable; e2e: apply → approve → accrue →
statement held → payout profile verified → statement approved.
```

### 🟩 Web — `feat/agent-p1-entry`

```text
[paste <context>]
[paste <design-method>]

Task: Phase 1 web. Read API-CHANGES-P1.md, pnpm gen:api. Plan Mode first.

1. Landing `src/app/[locale]/(storefront)/agent/page.tsx` (indexable; th + en)
   Sections, in order:
   a. Hero — same animated multi-scene hero family and green scheme as /business and /partner-with-us; headline
      "แนะนำลูกค้า รับค่าคอมทุกออเดอร์ที่ชำระ"; sub "ส่งใบเสนอราคาได้ทันที ไม่ต้องสต็อก ไม่ต้องตามงานผลิต"; CTA
      "สมัครเป็นตัวแทน" (+ "ฟรี" chip, never "฿0"); secondary "ดูวิธีคิดค่าคอม".
   b. How it works — 3 steps (สมัครและรับลิงก์ · แนะนำลูกค้าหรือส่งใบเสนอราคา · รับค่าคอมทุกวันที่ 5).
   c. Commission — rates from `store.agent.programme.public`, headline "ไม่จำกัดรายได้"; an interactive example: order value input →
      first order / repeat commission (computed by the API example endpoint or shown as the API's worked examples;
      the web does no money arithmetic — if no endpoint exists, write a CONTRACT-REQUEST).
   d. What you get — ลิงก์และ QR ส่วนตัว · ใบเสนอราคาในนามคุณ · ติดตามลูกค้าและค่าคอมแบบเรียลไทม์ · 50 ทวิ อัตโนมัติ ·
      แอป getpack Agent บนมือถือ.
   e. Who it's for — freelance sales, agencies, print brokers, designers, existing customers.
   f. FAQ — from the API; FAQPage JSON-LD; answer-first copy.
   g. Final CTA.
   No factory information anywhere. Metadata, OG image, sitemap entry, llms.txt entry, JSON-LD (WebPage + FAQPage +
   BreadcrumbList).
2. Apply `/agent/apply` — signed-out users sign in first (OTP · LINE · Google · Apple, existing customer auth),
   then return here. Step indicator "1 / 2". Fields per API step 1; phone must be verified (inline OTP if not);
   agreement shown in a readable sheet with version + accept checkbox. Success page explains step 2 (payout
   profile) is needed before the first payout, with a button to do it now or later.
3. Payout profile form (account area for now; moves in Phase 2): Thai tax id with checksum validation, VAT
   toggle, address with postcode lookup (existing PostcodeArea), ID document + bank book upload, bank picker
   (existing banks.ts). Status chip and reject reason.
4. Entry points
   - Footer: new column "ร่วมงานกับ getpack" → "สำหรับโรงงาน" (/partner-with-us) · "สำหรับตัวแทนขาย" (/agent).
   - Header: "ร่วมงานกับเรา" menu (desktop) / item in the phone menu.
   - /account overview: dismissible banner "แนะนำธุรกิจที่รู้จัก รับค่าคอม" for non-agents (remembered per account
     via API preference if available, else cookie).
   - Cross-links on /business and /partner-with-us.
5. `/account/agent` for non-agents shows a compact version of the landing + apply CTA (P-27: never an error).

Acceptance: design-method + Lighthouse (landing: Performance ≥ 90, SEO 100, Accessibility ≥ 95), JSON-LD valid,
journeys at all widths, visual snapshots, i18n complete th/en.
```

---

## Phase 2 — โซน `agent.getpack.co` (PWA "getpack Agent")

### 🟦 API — `feat/agent-p2-zone`

```text
[paste <context>]

Task: Phase 2 API. Plan Mode first.

1. Sign-in for the agent zone uses the existing customer identity and endpoints: phone OTP, LINE
   (`auth.customer.line`), Google and Apple (Firebase ID token). One person = one account whatever the method;
   linking by verified phone or e-mail as today. Add `client: "agent"` to sign-in requests so sessions are listed and
   revocable per surface; agent-zone refresh tokens are separate from storefront tokens.
2. Hand-off: `auth.customer.handoff.create` (authenticated storefront session → one-time code, 60 s, single use,
   bound to target `agent`, device fingerprint, audited) and `auth.customer.handoff.redeem` (agent zone server
   exchanges the code for a token pair). No cookie is shared across subdomains.
3. Guard: every `/v1/store/agent/*` call from the agent client requires role `sales_agent` with an active or
   suspended agent; ended agents get read-only access to statements and 50 ทวิ for 5 years (tax record retention).
4. Web push: `store.agent.push.subscribe/unsubscribe` (VAPID; keys in env); notification preferences per channel
   (push, LINE OA, e-mail) per event: lead_converted, lead_protection_expiring (7 and 1 days), commission_earned,
   statement_ready, payout_paid, payout_profile_needed. LINE OA messages via the existing LINE integration.
5. CORS / allowed origins: add AGENT_HOST. API-CHANGES-P2.md; D-467 "Agent zone agent.getpack.co; sign-in OTP / LINE /
   Google / Apple; hand-off by one-time code".
```

### 🟩 Web — `feat/agent-p2-zone`

```text
[paste <context>]
[paste <design-method>]
[paste <responsive>]

Task: Phase 2 web. Read API-CHANGES-P2.md, pnpm gen:api. Plan Mode first.

1. Fourth zone `agent`
   - src/lib/zones/zones.ts: ZONES += "agent"; ZONE_CONFIG.agent = { routePrefix: "/agent-zone", bffPath:
     "/agent-zone/bff", apiPrefix: "/v1/store/agent", authPrefixes: ["/v1/auth/customer"], indexable: false,
     localePrefixed: false }. Also allow the store endpoints the agent needs for quotes (Phase 3) — list them
     explicitly, most specific first; nothing else from /v1/store.
   - env AGENT_HOST (+ .env.example `agent.localhost:3000`), ZONES allow-list, resolve.ts tests, per-zone CSP and
     security headers, ESLint boundaries (src/features/agent/** isolated like admin/partner), theme defaults.
   - robots: noindex for the whole zone.
2. Auth in the zone: sign-in page with OTP, LINE, Google, Apple (reuse customer sign-in components through
   src/features/shared); "เปิด getpack Agent" button on the storefront uses the hand-off; returning users stay
   signed in (refresh in proxy.ts as other zones do).
3. PWA: manifest per zone → name/short_name "getpack Agent", display standalone, start_url "/", scope "/",
   theme/background from tokens (light), icons 192/512 + maskable + apple-touch-icon; service worker scoped to the
   agent host (offline shell + lead draft queue, Phase 3); install prompt after the 2nd visit (custom, dismissible);
   iOS "Add to Home Screen" guide sheet (push needs it).
4. App shell per <responsive>: bottom tab (phone) / rail (tablet) / sidebar (desktop); header with agent code and
   profile menu; safe-area insets.
5. Move pages from /account/agent/* to the agent zone: ภาพรวม (link + QR + share sheet, totals, plan terms),
   ลูกค้า, ลูกค้ามุ่งหวัง (list as today — pipeline comes in Phase 3), ค่าคอม, รายงานค่าคอม + 50 ทวิ,
   ข้อมูลรับเงิน (payout profile), ข้อมูลลดหย่อนภาษี, การแจ้งเตือน (channel × event toggles), โปรไฟล์และสัญญา.
   Old URLs `/account/agent/**` → 308 to the matching agent-zone URL (keep query); the account tab becomes a link
   "เปิด getpack Agent".
6. Share: Web Share API with fallbacks (copy, LINE share URL, QR full-screen view for meetings).

Acceptance: <responsive> acceptance; zone isolation tests (cookies host-only, BFF allow-list refuses other store
paths, CSP per zone); PWA installable (Lighthouse PWA checks); redirects covered by tests.
```

---

## Phase 3 — Lead management สำหรับตัวแทน

### 🟦 API — `feat/agent-p3-leads`

```text
[paste <context>]

Task: Phase 3 API. Plan Mode first.

1. Pipeline on SalesAgentLead (keep protection/expiry semantics of D-417)
   - Add: stage enum (new | contacted | quoted | negotiating | won | lost), expectedValue?, nextFollowUpAt?,
     lostReason enum (price | lead_time | no_need | competitor | no_response | other) + note, source enum
     (manual | card_scan | csv_import | link | staff), industry?, lineId?, tags[].
   - `won` is set by the system only (first order group of the converted customer has a payment recorded — deposit
     counts); agents cannot set it. `lost` releases protection immediately.
   - SalesAgentLeadActivity: leadId, kind (call | line | visit | email | note | quote_sent | stage_change | system),
     body, occurredAt, createdBy; append-only.
   - Follow-up reminders: worker job sends push/LINE at nextFollowUpAt (respect notification prefs, quiet hours
     21:00–08:00 Asia/Bangkok).
   - Duplicate check endpoint `store.agent.leads.check` (phone/email/taxId) → { available: boolean } with the neutral
     reason only (D-440).
   - Endpoints: list (filters stage, due, source, text; cursor paging; sort), get, create, update (If-Match), changeStage,
     addActivity, listActivities, withdraw (exists), export CSV (own leads only), import CSV (dry run → result rows
     with errors → commit; max 500 rows; each row through the same duplicate check and max-open-leads rule).
2. Quote on behalf
   - `store.agent.quotes.create` for a lead: uses the existing pricing/quote engine (same path as store quotes,
     D-441 default spec rules), owner = getpack, `agentId` + `leadId` recorded; returns the existing share link
     `/q/{token}` carrying the agent attribution. Opening the link sets the agent cookie like `/a/{code}`; signing up
     with the lead's phone/email converts the lead (existing rule). Agents cannot change price or give discounts
     themselves; they request one (item 3).
   - `store.agent.quotes.list/get/resend/withdraw`; status (sent | opened | accepted | expired | withdrawn) with
     timestamps; opening and acceptance appear in the lead timeline.
   - Agent sees sell prices and the quote document only — never cost, margin or factory fields (guard test).
3. Discount requests, give-get and co-fund (owner 2026-11-01)
   - `store.agent.quotes.requestDiscount` (one open request per quote version): requested %, reason enum
     (competitor_price | budget | volume | strategic_account | other), what the customer gives in return — give-get
     fields: quantity change, commitment (one-off | call-off N months), payment (deposit % / cash within N days),
     lead-time flexibility, spec change; competitor evidence (file + like-for-like spec form: board grade, flute,
     print sides/colours, finish, quantity, lead time, shipping included, VAT included).
   - Second request on the same quote version is refused (`quotes.discount_round_limit`) unless at least one
     give-get field changes; every round is kept in the negotiation history (Phase 4).
   - The response (Phase 4 approval) returns 1–3 options; each option = discount % + the agent's commission rate
     and amount at that price. Default option always carries the FULL standard rate. A lower-rate option exists only
     when the approver offers "co-fund" and becomes effective only when the agent accepts it
     (`store.agent.quotes.acceptOption`), audited with the agent's acceptance evidence. Spiff (higher rate) options
     allowed.
   - A discounted quote's validity = setting `quotes.discounted_validity_days` (seed 7); standard quotes keep their
     normal validity. The PDF shows the net price and its conditions ("ราคานี้สำหรับ … ชำระภายใน … สั่งภายใน …").
4. Deal registration (protection + rate lock, never a rate cut)
   - `SalesAgentDealRegistration`: agentId, leadId, quoteIds, scope (quote | call_off_agreement), lockedFirstRate,
     lockedRepeatRate, approvedOptionId?, status (registered | won | lost | expired), protectedUntil (setting
     `agent.deal_protection_days`, seed 90), threshold snapshot.
   - Created automatically (no approval) when a quote's commission base ≥ setting `agent.deal_registration_threshold`
     (seed 500000.00); optional for smaller quotes. Locks the standard rates in force (or the accepted option);
     later plan versions never change a registered deal; a call-off agreement keeps the lock for every call-off.
   - Protection blocks other agents and company reps on that lead/company while active (neutral refusal).
5. Sales playbook in context: `store.agent.playbook.get(context)` returns the published guidance cards for a
   context key (see Phase 4 item 8): lead_lost_price, competitor_cheaper, discount_request, big_deal, follow_up,
   first_contact. Read-only for agents.
6. Business card scan: `store.agent.leads.scanCard` (image upload, purpose `agent_card_scan`) → OCR with the local
   Tesseract pipeline (tha+eng) → parsed fields with confidence; the image is deleted after 7 days; nothing saved
   until the agent confirms.
7. Commission forecast (F47): `store.agent.commissions.forecast` → per order: status, expected base, expected
   commission, expected payable date (paid on the 5th after completion, claim window and full payment), no extra customer PII.
8. API-CHANGES-P3.md; D-468 "Agent lead pipeline, timeline, quote on behalf, discount requests with give-get and
   agent-accepted co-fund, deal registration, playbook, card scan".
```

### 🟩 Web — `feat/agent-p3-leads`

```text
[paste <context>]
[paste <design-method>]
[paste <responsive>]

Task: Phase 3 web (agent zone). Read API-CHANGES-P3.md, pnpm gen:api. Plan Mode first.

1. ลูกค้ามุ่งหวัง list: views "ทั้งหมด · ต้องติดตามวันนี้ · ใกล้หมดสิทธิ์ · ปิดแล้ว"; phone cards (name, organisation,
   stage chip, next follow-up, protection countdown); desktop table + optional board view by stage. Stage change
   never by drag only: each card/row has a "ย้ายไปขั้น…" menu (WCAG 2.5.7); drag is an enhancement on desktop.
2. New lead: FAB / N → sheet (phone) or dialog (desktop) with duplicate check on blur of phone/email/tax id;
   inputmode/autocomplete per field; "สแกนนามบัตร" opens camera (capture="environment") → review parsed fields →
   save. Offline: drafts queue in IndexedDB and sync when online, with a visible "รอส่ง" state.
3. Lead detail: header (name, stage, protection countdown, value), sticky actions (โทร tel: · LINE deep link ·
   ส่งใบเสนอราคา · บันทึกการติดต่อ), timeline (activities + quote events + system events), follow-up picker with
   quick options (พรุ่งนี้ 10:00 · 3 วัน · 1 สัปดาห์), lost flow with reason.
4. Quote on behalf: from a lead → product/style picker → the existing configurator in "agent mode" (sticky price
   bar, collapsed steps on phone) → review → send via LINE / share sheet / copy; quote list with status and
   opened/accepted badges.
5. Discount request flow (from a quote): step 1 "ลูกค้าให้อะไรกลับมา" (give-get choices first — volume, commitment,
   deposit / cash, lead time, spec), step 2 reason + competitor evidence with the like-for-like spec form, step 3
   review. The playbook card for the context sits beside the form (phone: collapsible above the form). Result screen
   shows the options as plain lines ("ลูกค้าได้ส่วนลด 6% · คุณได้ ฿56,400"); the full-rate option is first; a co-fund
   option needs an explicit confirm with the amount. Never show cost, margin or %-of-profit.
6. Deal registration badge on the lead and quote ("ดีลนี้ถูกจองแล้วถึง …", locked rate), protection countdown.
7. Playbook: a "คู่มือการขาย" tab (all published cards, searchable) and contextual cards (lost-to-price, competitor
   cheaper, big deal, follow-up) with copy-to-LINE for the suggested replies.
8. CSV import/export: template download, dry-run table with row errors, commit.
9. ค่าคอม: add forecast view (expected date per order) next to earned/paid.
10. Empty states that teach the next action (no illustrations that look stock/AI; use the product's own UI).

Acceptance: <responsive> acceptance + journeys: create lead (phone), scan card, send quote, customer opens quote
(second browser context) → timeline shows opened, sign-up converts lead, offline draft sync.
```

---

## Phase 4 — Sales desk, อนุมัติส่วนลด และคู่มือการขาย (admin)

### 🟦 API — `feat/agent-p4-sales-desk`

```text
[paste <context>]

Task: Phase 4 API. Plan Mode first.

1. Staff-facing pipeline over the same lead model for employee agents (A-07): an employee agent works from the admin
   zone via `staffUserId`. New permissions: `sales.pipeline.self` (role sales_rep, new) and `sales.pipeline.manage`
   (sales_manager, c_level, vp, director; Superadmin acts for anyone, audited). Update docs/rbac.md and gen:rbac data.
2. Inbound lead pool: `SalesInboundLead` created from (a) contact form topics sales/business (D-458), (b) RFQ from a
   non-customer, (c) LINE OA chats tagged sales, (d) staff manual. Fields: source, contact, organisation, need,
   createdAt, firstResponseDueAt (SLA from setting `sales.first_response_hours`, working hours as P-05), assignee,
   status (new | assigned | contacted | converted_to_lead | disqualified + reason).
3. Assignment: setting `sales.assignment_mode` (manual | round_robin among active sales_rep with capacity
   `sales.max_open_per_rep`); reassign with reason (audited). Assigning creates a SalesAgentLead for the rep's
   employee agent (protection rules apply).
4. SLA job: breach → alert to sales_manager (push + e-mail), visible flag.
5. Manager analytics: `admin.sales.dashboard` → funnel by stage, win rate, median days per stage, by source, by rep,
   by period; first-response SLA %; agent (freelance) vs employee split. Exports CSV.
6. Discount approval & price lock desk (`admin.discountApprovals.*`, extends discount memos + approval matrix)
   - Approval matrix by discount % and amount (settings): rep ≤ 3 %; sales_manager ≤ 8 % and margin ≥ floor;
     above → C-Level. "Negotiation-heavy" customers (item 7) move one level up. SLA `sales.discount_approval_hours`
     (seed 4 working hours) with escalation. Solo-owner self-approval (D-449) allowed and logged.
   - Prerequisites: every line has a buy price (rate card / factory price list / factory RFQ answer); a quote whose
     cost is unknown cannot open an approval. For a commission base ≥ the deal threshold, the approval also locks
     the factory buy price for the same validity (factory confirmation through the partner zone; validity = the
     shorter of the two).
   - Waterfall DTO per quote and per option (decimal strings, server-computed): list revenue ex VAT; discount; net
     revenue; factory cost; shipping difference (charged reference − paid factory rate); payment fees (by method);
     samples / free services; gross margin (amount, %); agent commission (rate, amount); credit cost estimate
     (item 9); bad-debt provision (setting % by customer credit grade); contribution after commission (amount, %);
     floor check (setting `margin.floor_pct` by product class). Labels: never "กำไรสุทธิ" — "กำไรหลังหักค่าคอม".
   - Simulator endpoint: discount %, credit days, payment schedule template, co-fund/spiff rate → recomputed
     waterfall (no persistence).
   - Decide: approve with 1–3 options (default full-rate option mandatory), reject with reason, or counter with
     give-get conditions. Approval stores a snapshot hash of lines, quantities, costs and terms; any change voids it
     (`discount_approval.stale`); a re-quote after expiry (D-436) needs re-approval only if margin falls below floor.
   - Field-level RBAC (docs/rbac.md): freelance agent and sales_rep never receive cost/margin fields (reps get
     `authorityLevel` green | amber | red only); sales_manager gets margin % only; c_level, vp, director,
     finance_manager, superadmin get the full waterfall. Every view of a waterfall is logged (who, when, quote) and
     visible in an access log like D-444; no export endpoint except for finance roles.
7. Negotiation history per company: rounds per quote, average approved discount, win/loss, lost reasons, last
   competitor named; flag `negotiation_heavy` when rounds ≥ 2 on ≥ 2 of the last 5 quotes (settings). Lost-to-price
   analytics by product class and quantity band for the pricing team.
8. Sales playbook content: `SalesPlaybookCard` (key, context keys, audience: agent | rep | manager, title, body
   markdown, suggested replies[], version, status draft | published, owner role marketing/sales_manager,
   maker-checker publish). Seed the cards in docs/design/agent-portal/PLAYBOOK.md (pricing principle, give-get menu,
   like-for-like spec check, one-round rule, walk-away floor, short validity, cash-discount vs credit, big-deal
   registration, competitor-cheaper replies, follow-up rhythm, first contact). Admin CRUD
   `admin.salesPlaybook.*`; store read (Phase 3 item 5).
9. Credit cost estimate (management figure, not posted to the GL): Σ cash out to the factory × setting
   `finance.cost_of_capital_annual_pct` (seed 7.00) × days until the customer's cash arrives ÷ 365, from the quote's
   payment schedule, the company credit term (D-462) and the factory payout terms. Returned in baht and % of net
   revenue. Unit tests with the PLAN §7 example (฿11,399 = 1.06 %) and a deposit case (≈ 0).
10. Post-deal review: per won deal, approved vs actual gross margin and contribution after delivery (actual invoiced
   quantity incl. tolerance, actual shipping, refunds). Report by approver, agent and customer.
11. API-CHANGES-P4.md; D-469 "Company sales desk: inbound pool, assignment, SLA, dashboard" and D-470 "Discount
   approval with waterfall, field-level margin visibility, price lock, negotiation history, sales playbook, credit
   cost estimate".
```

### 🟩 Web — `feat/agent-p4-sales-desk`

```text
[paste <context>]
[paste <design-method>]

Task: Phase 4 web (admin zone, desktop-first but usable on tablet). Read API-CHANGES-P4.md, pnpm gen:api.

1. Menu "ฝ่ายขาย" (`/admin/sales`): Inbox (inbound pool with SLA timers, bulk assign), Pipeline (table + board,
   same stage rules and non-drag alternative as Phase 3), Lead detail (shared components with the agent zone via
   src/features/shared where zone rules allow), Quotes (existing admin quotations filtered to sales), Dashboard.
2. Dashboard: funnel (stage counts + drop-off), win rate trend, SLA %, by source, by rep, freelance vs employee.
   Use the dataviz rules: one measure per chart, accessible colours, no colour-only meaning, numbers on hover.
3. Rep view (sales.pipeline.self): only their pipeline and inbox items assigned to them.
4. Discount approval desk (`/admin/sales/approvals` + inside the quote page): queue with SLA timers; detail = header
   (quote, customer, agent/rep, deal registration, validity, reason, give-get, competitor evidence with the
   like-for-like comparison side by side), the waterfall as a vertical bridge (drawn, not a table) with floor line,
   the simulator (discount %, credit days, payment schedule, co-fund/spiff) updating live, options builder (full-rate
   option pre-filled and not removable), negotiation history panel, approve / counter / reject. Viewer name
   watermark on the waterfall; no export unless finance. Rep and manager see their permitted fields only (render
   from the API payload, never hide client-side).
5. Playbook admin (`/admin/sales/playbook`): list, editor with live preview of how the card looks in the agent zone
   (phone + desktop), contexts, audience, versions, publish (maker-checker).
6. Negotiation history and lost-to-price report pages; post-deal review report.
7. Every number on these screens has a tooltip: definition, formula, source (with a link to the record) and as-of
   time.

Acceptance: admin journeys (assign → contact → quote → discount request → approve with co-fund option → agent
accepts → won), field-level RBAC tests (rep/manager payloads contain no forbidden fields), waterfall view log written,
visual snapshots 1280/1440/1920 + tablet 1024.
```

---

## Phase 5 — จับ lead อัตโนมัติและให้คะแนน

### 🟦 API — `feat/agent-p5-capture`

```text
[paste <context>]

Task: Phase 5 API. Plan Mode first.

1. Sources into the inbound pool (Phase 4), each behind its own setting flag and with consent recorded:
   a. Studio: a signed-in user with a saved design and no order within `capture.studio_idle_days` (3) → inbound
      item "ออกแบบแล้วยังไม่สั่ง" (skip existing customers with an assigned agent/rep; skip if marketing consent is
      off — then only a service reminder e-mail is allowed under the existing notification rules).
   b. Dieline download: first download stays free without sign-in; from the second download a free sign-in
      (one-tap Google / Apple / LINE / OTP) is required; downloads by signed-in non-customers create/refresh an
      inbound item. The download stays free (product decision) — never a paywall.
   c. RFQ and contact form (already in Phase 4).
2. Lead score 0–100 from configurable, effective-dated rules (`sales.scoring_rules`): e.g. company e-mail domain,
   tax id present, quantity × price band of the design/RFQ, repeat visits to pricing pages, recency. Score and the
   top 3 reasons are returned on inbound items and leads (staff only; agents see score only on their own leads).
3. Attribution precedence (document and test): active agent link/lead (D-417) > rep assignment > unassigned pool.
   An agent-attributed customer never enters the company pool.
4. API-CHANGES-P5.md; D-471 "Automatic lead capture and scoring; dieline download stays free".
```

### 🟩 Web — `feat/agent-p5-capture`

```text
[paste <context>]
[paste <design-method>]

Task: Phase 5 web. Read API-CHANGES-P5.md, pnpm gen:api.
1. Dieline download: second download → sign-in sheet (one tap providers first), then the download continues
   automatically; copy stays "ฟรี".
2. Studio: no UI change for the customer except consent copy where marketing consent is asked (existing pattern).
3. Admin inbox/pipeline: score chip with reasons popover; filter/sort by score; source icons.
4. Agent zone: score chip on own leads.
Acceptance: journeys for the second dieline download and the studio idle capture (job run in test), visual
snapshots, a11y on the popover.
```

---

## Phase 6 — P&L ผู้บริหาร (ดึงข้อมูลอัตโนมัติ + กรอกเองได้)

เป้าหมาย: หน้าจอให้ผู้บริหารดูและวางแผน P&L รายเดือน โดยดึงตัวเลขจากระบบอัตโนมัติ ช่องที่ระบบไม่มีข้อมูลให้กรอกเอง ทุกช่องมี tooltip

### 🟦 API — `feat/agent-p6-pnl`

```text
[paste <context>]

Task: Phase 6 API — management P&L planner (finance). Plan Mode first. Reuse the in-house GL, financial-reports,
fixed-assets, payables, receivables and agents modules; never duplicate postings.

1. Model: `PnlPlan` (name, fiscal year, scenario base | best | worst | custom, status draft | locked, version,
   owner) and `PnlPlanCell` (planId, lineKey, month, value decimal, mode auto | manual | override, note, source ref,
   updatedBy/At). Locking a plan freezes its cells (snapshot) for plan-vs-actual.
2. Line catalogue (setting, effective-dated, mapped to GL accounts by the accountant):
   revenue goods · revenue shipping · discounts · net revenue · factory cost · shipping cost · payment fees ·
   gross margin · agent commission · employee sales commission · marketing · salaries & benefits · rent &
   utilities · software & cloud · professional fees · depreciation · other opex · operating profit (EBIT) ·
   finance cost (actual interest from GL) · corporate income tax (estimate) · net profit;
   memo lines (not in the total): credit cost estimate (Phase 4 item 9), bad-debt provision estimate, EBITDA,
   commission ÷ gross margin, DSO, DPO, cash conversion cycle, break-even revenue.
3. Auto values:
   - Actual months: from posted GL entries per mapped account (closed periods are final; the open month shows
     "ยังไม่ปิดงวด").
   - Forecast months: pipeline Σ open deal value × stage probability (setting per stage) + repeat-order run rate
     (trailing 3 months by company); gross margin % by product class (trailing 3 months); commission from the
     effective rates on forecast revenue; fixed costs = trailing 3-month average unless a manual value exists;
     depreciation from fixed-assets schedules.
   - Corporate income tax estimate from an effective-dated rate table setting with the SME option (net profit
     0–300,000: 0 %, 300,001–3,000,000: 15 %, above: 20 % — when the SME conditions in the setting are met;
     otherwise 20 %). Labelled "ประมาณการ".
4. Manual input rules: a line with no system data is `manual` (required note on first entry); overriding an auto
   value is `override` and keeps the auto value beside it with a required reason; both audited.
5. Endpoints `admin.pnl.*`: plans CRUD, grid (months × lines with mode, value, auto value, source, as-of), cell
   update (If-Match), recompute, scenario copy, lock, plan-vs-actual variance (amount, %, note per cell), drill-down
   (cell → source records: GL lines, orders, commissions, AP bills), export XLSX/PDF (finance and C-Level only,
   watermarked). Permissions: c_level, vp, director, finance_manager, superadmin; nobody else.
6. Tooltip metadata: every line key returns `definition`, `formula`, `source`, `howToFill` (for manual lines),
   `glAccounts` — authored in docs/design/agent-portal/PNL-LINES.md and seeded.
7. API-CHANGES-P6.md; D-472 "Management P&L planner: auto from GL and operations, manual and override cells with
   reasons, scenarios, plan vs actual".
```

### 🟩 Web — `feat/agent-p6-pnl`

```text
[paste <context>]
[paste <design-method>]

Task: Phase 6 web (admin, `/admin/finance/pnl`). Read API-CHANGES-P6.md, pnpm gen:api. Plan Mode first.

1. Header: plan picker, scenario tabs, fiscal year, status (draft/locked), "เทียบกับจริง" toggle, recompute, lock,
   export (if allowed).
2. Grid: lines as rows (grouped, collapsible: รายได้ · ต้นทุนขาย · กำไรขั้นต้น · ค่าใช้จ่ายขาย · ค่าใช้จ่ายบริหาร ·
   กำไรจากการดำเนินงาน · ภาษี · กำไรสุทธิ; memo lines in a separate band), months as columns + total; sticky first
   column and header; keyboard navigation and inline edit for manual cells; each cell shows a source mark
   (ระบบ · คำนวณ · กรอกเอง · แก้ทับ) by shape + label, not colour only.
3. Every line label and every cell has a tooltip (definition, formula, source with a drill-down link, as-of,
   who/why for manual and override); empty manual cells show "กรอกค่า" with the line's `howToFill` hint.
4. Override flow: edit an auto cell → reason dialog → the cell shows both values.
5. Summary strip above the grid: revenue, gross margin %, contribution after commission, EBITDA, net profit, cash
   conversion cycle, break-even revenue — and a chart of revenue and net profit by month (plan vs actual).
6. Tablet usable (horizontal scroll inside the grid only, never the page); phone shows the summary strip and a
   per-month card view, read-only.

Acceptance: journeys (create plan → auto fill → manual cells → override with reason → lock → plan-vs-actual next
month in test data), RBAC (no access for sales roles), tooltip coverage test (every line key has all fields),
visual snapshots.
```

---

## Phase 7 — QA, pilot และบันทึกผล

### 🟦 API — `chore/agent-p7-launch`

```text
[paste <context>]
Task: Phase 7 API.
1. UAT seed: 1 freelance individual agent (verified payout profile, ล.ย.01 accepted), 1 juristic VAT agent,
   1 employee agent with staff account, 12 leads across all stages, 3 quotes (sent/opened/accepted), commissions in
   every status incl. a large uncapped one, a co-funded one and a reversal; discount approvals in every state;
   a P&L plan with auto, manual and override cells, 2 statements (individual progressive WHT, juristic 3 % + VAT),
   inbound items with SLA breached and not. Idempotent; UAT only.
2. Load test the agent endpoints (perf/ k6): p95 < 300 ms at 50 rps for list/detail.
3. Security review: zone tokens, hand-off replay, IDOR on every agent/lead/quote id, rate limits on leads.check and
   scanCard, PII in logs.
4. RUNBOOK: monthly statement day, WHT filing (ภ.ง.ด.1 by the 7th, ภ.ง.ด.1ก by end of February, ภ.ง.ด.53), payout
   failures, agent offboarding, data subject requests.
```

### 🟩 Web — `chore/agent-p7-launch`

```text
[paste <context>]
[paste <design-method>]
[paste <responsive>]
Task: Phase 7 web.
1. Full responsive QA of the landing, apply, agent zone, sales desk, approval desk and P&L planner at every width in <responsive>; fix every
   finding; real-device pass Safari iOS + Chrome Android (document in DESIGN-NOTES.md).
2. Lighthouse budgets in lighthouse/ for every new route; PWA install test on iOS and Android.
3. Pilot switch: FEATURE_AGENT_PROGRAMME on for an allow-list of pilot accounts (setting), landing CTA shows
   "ลงทะเบียนรอเปิดรับ" for others until the owner opens sign-up.
4. Audit record: docs/design/agent-portal/REPORT.md (what shipped per phase, decisions D-464–D-472, open items) and a
   one-page HTML summary docs/design/agent-portal/report.html for the owner's canvas.
```

---

## Checklist ก่อนเปิดรับสมัคร public

- [ ] ทนายรีวิวสัญญาตัวแทน v2 แล้ว → publish version ใน admin (maker-checker)
- [ ] เติมเลขทะเบียน/ที่อยู่บริษัทในสัญญาและเอกสาร 50 ทวิ
- [ ] VAPID keys + LINE OA channel ตั้งใน UAT และ production
- [ ] DNS + TLS ของ `agent.getpack.co`
- [ ] Pilot 10–20 ตัวแทน 60 วัน → ทบทวน KPI (PLAN §4) → เปิด public
