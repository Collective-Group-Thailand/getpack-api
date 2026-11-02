# getpack Agent — lead management & agent portal · PLAN (v3, 2026-11-01)

Owner request (2026-10-31): lead management for company sales, freelance sales and factory sales; a public way
for freelancers to apply; perfect on desktop **and** phone; a separate portal `agent.getpack.co` (PWA "getpack Agent",
sign-in OTP / LINE / Google / Apple). Roles taken: business lead, strategy & marketing lead, UX/UI lead, accountant
(withholding method), lawyer (agreement draft for a licensed lawyer's review). Design skill: ui-ux-pro-max v2.15.
Prompt pack: `PROMPT-agent-portal.md` (Phase 0–7). Seeds: `PLAYBOOK.md` (sales playbook), `PNL-LINES.md` (P&L lines and tooltips).

## 0. What already exists (code survey 2026-10-31)

| Area | State | Where |
|---|---|---|
| Agent programme (D-416–D-423) | Built: applications, approval with plan, attribution links, leads with 60-day protection + duplicate refusal, commission ledger, monthly statements, WHT 50 ทวิ, maker-checker plans | api `src/modules/agents/*`, `prisma/schema/agents.prisma` |
| Agent kinds | `freelance` and `employee` (company sales are agents of kind employee) | `SalesAgentKind` |
| Agent web pages | 5 pages inside the customer account (`/account/agent/*`), tab under "rewards" | web `src/app/[locale]/(storefront)/account/agent` |
| Admin desk | `/admin/agents` — applications, agents, links, leads (release), factory links, commissions, statements, plans | web `src/app/admin/(console)/agents` |
| Agent link | `getpack.co/a/{code}` (cookie 90 days) | web `(storefront)/a/[code]/route.ts` |
| Customer sign-in | Phone OTP, LINE, Google and Apple (Firebase ID token) already exist | api `src/modules/auth/controllers/customer-auth.controller.ts` |
| Factory sales CRM | Built in getpack Factory (D-359): `ErpLead`, `ErpOpportunity`, `ErpActivity`, quotations, sales orders, scoped by `factory_id` | api `prisma/schema/factory-erp-e4.prisma`, web `partner/(console)/crm` |
| Zones | Host-based zones (`customer`, `admin`, `partner`), host-only cookies, per-zone CSP/BFF/manifest | web `src/lib/zones`, `src/proxy.ts`, `src/app/manifest.ts` |

### Gaps found
1. No public entry: the only way in is `/account` → rewards → agent.
2. Lead = registration only: no pipeline stage, activities, follow-up, value or quote; no quote on behalf.
3. Company sales have no pipeline, inbound pool, assignment, SLA or manager view in admin.
4. Portal pack decisions not in code: P-02 cap ฿10,000/order, P-03 factory referral removed (bounty still in schema,
   DTO and copy), no profit wording (`marginCapPct` still drives copy).
5. Apply form is heavy: ID document, bank account and tax id are required before approval.
6. Launch gate S-04: withholding method and agent agreement (now decided / drafted — §5, §6).

## 1. Decisions (business lead, owner-delegated) — recorded as D-464+ by the phases

| # | Decision |
|---|---|
| A-01 | Three sales audiences, one attribution truth: company sales = `employee` agents; freelance = `freelance` agents; factory sales stay in getpack Factory CRM (D-359) with no data crossing either way (D-435, D-463). |
| A-02 | Public landing `getpack.co/agent` (indexable) + apply; portal on `agent.getpack.co` as a fourth zone `agent`; agent link stays `getpack.co/a/{code}`. |
| A-03 | Apply in two steps: (1) apply — name, verified phone, e-mail, LINE ID, individual/juristic, how you sell, agreement; (2) payout profile — tax id, address, ID document, bank — required before the first payout, not before approval. |
| A-04 | Factory referral bounty removed (P-03); columns kept nullable for history. |
| A-05 | **No commission cap** (owner 2026-11-01, supersedes the cap of P-02): full rate at every deal size; no silent margin cut (margin becomes an internal alert); only the agent can accept a lower rate (co-fund option); spiffs allowed. Copy "ไม่จำกัดรายได้ ยิ่งขายมาก ยิ่งได้มาก"; never profit/margin wording. |
| A-06 | Lead stages `new → contacted → quoted → negotiating → won / lost`; won = first order group of the converted customer has a payment (deposit counts), set by the system only. |
| A-07 | Company sales work in admin (`/admin/sales`) with their staff account; freelancers in the agent zone; same lead model, scoped by agent. |
| A-08 | Agent zone sign-in: phone OTP, LINE, Google, Apple — the existing customer identity; storefront → agent zone by one-time hand-off code, no shared cookie. |
| A-09 | Dieline download stays free: first download without sign-in, from the second a free one-tap sign-in (lead capture, never a paywall). |
| A-10 | Discounts are give-get: one negotiation round per quote unless terms change; like-for-like competitor check; discounted quotes valid 7 days with stated conditions; floor margin is the walk-away line. |
| A-11 | Deal registration = protection (90 days) + rate lock for quotes ≥ ฿500,000 (setting) and call-off agreements; never a rate cut. |
| A-12 | Discount approval desk with a per-deal waterfall (incl. credit cost and bad-debt estimate); field-level visibility: agents/reps no cost or margin (reps see authority colour), sales manager margin % only, C-Level/VP/Director/Finance/Superadmin full; views logged, no export outside finance. |
| A-13 | Sales playbook shown in context in the agent zone and admin, managed as versioned cards. |
| A-14 | Management P&L planner: auto from GL and operations, manual and override cells with reasons, tooltips on every line, scenarios, plan vs actual. |

## 2. Phases

| Phase | Scope | Main decision |
|---|---|---|
| 0 | No cap, rate locked per order, margin alert, remove bounty, no profit wording, progressive WHT + ล.ย.01 | D-464, D-465 |
| 1 | `/agent` landing, apply step 1, payout profile, entry points, agreement v2 draft seeded | D-466 |
| 2 | `agent.getpack.co` zone, PWA, sign-in OTP/LINE/Google/Apple, hand-off, pages moved + 308 redirects, push | D-467 |
| 3 | Pipeline, timeline, follow-ups, quote on behalf, discount request with give-get + co-fund, deal registration, playbook in context, card scan, CSV, forecast, offline drafts | D-468 |
| 4 | `/admin/sales`: inbound pool, assignment, SLA, dashboard; discount approval desk + waterfall + simulator + price lock; negotiation history; playbook admin; credit cost; post-deal review | D-469, D-470 |
| 5 | Lead capture (Studio idle, dieline, RFQ, contact) and scoring | D-471 |
| 6 | Management P&L planner (`/admin/finance/pnl`) | D-472 |
| 7 | UAT seed, load + security review, responsive/device QA, pilot switch, REPORT.md | — |

## 3. Responsive spec (UX lead)

| | Phone < 640 | Tablet 640–1023 | Desktop ≥ 1024 |
|---|---|---|---|
| Nav | Bottom tab 4: ภาพรวม · ลูกค้ามุ่งหวัง · ใบเสนอราคา · ค่าคอม (profile in header) | Icon rail | Sidebar (same shell family as the partner zone) |
| Primary action | FAB "+ เพิ่มลูกค้ามุ่งหวัง" above the tab bar | Header button | Header button + shortcut `N` |
| Lists | Cards, filter in bottom sheet | 2-column cards | Table: sort, filter, bulk actions, export |
| Lead detail | Full page + sticky bar (โทร · LINE · ส่งใบเสนอราคา) | Full page | Split view list/detail |
| Commission | Summary cards + month list | Same | Table + chart + 50 ทวิ download |

Rules (ui-ux-pro-max, priority order): contrast ≥ 4.5:1, visible focus, labels not placeholders; touch ≥ 44 px, 8 px
gaps, press feedback; CLS < 0.1; no emoji icons; mobile-first, no horizontal scroll, never disable zoom; base 16 px,
line-height 1.5, semantic tokens; motion 150–300 ms, reduced-motion; inputmode/autocomplete, `one-time-code`, inline
errors, step indicator; predictable back, deep links; safe-area insets. Brand overrides the skill: getpack tokens,
Anuphan only, light theme without dark surfaces, green scheme of /business.

Acceptance: Playwright journeys at 360, 375, 393, 768, 1024, 1280, 1440, 1920 + visual snapshots; Lighthouse mobile
Performance ≥ 90, Accessibility ≥ 95; real Safari iOS and Chrome Android.

## 4. Go-to-market (strategy & marketing lead)

- Personas: freelance packaging/print sales, design & branding agencies, print brokers, sales people with
  SME/brand-owner networks, existing customers who refer peers.
- Message: "แนะนำลูกค้า รับค่าคอมทุกออเดอร์ที่ชำระ — ส่งใบเสนอราคาได้ทันที ไม่ต้องสต็อก ไม่ต้องตามงานผลิต".
- Pilot: 10–20 invited agents for 60 days, then open sign-up.
- KPIs: application → approval rate; activation (first lead ≤ 14 days); first paid order ≤ 60 days; leads per active
  agent; lead → won; commission ÷ gross margin (internal only).
- Channels: LINE OA, Facebook / LINE OpenChat groups of freelance sales, agency outreach, `/account` banner,
  `/business` cross-link.

## 5. Withholding tax — accountant decision (amends D-421; owner 2026-10-31)

| Agent | Income type | Withholding | Form | Account |
|---|---|---|---|---|
| Freelance, individual (Thai resident) | ค่านายหน้า s.40(2) | s.50(1) progressive — no flat 3 % (a flat rate on ภ.ง.ด.1 needs Revenue Department approval, which getpack does not hold) | ภ.ง.ด.1 monthly (by the 7th, e-filing extension applies); ภ.ง.ด.1ก yearly (by end of February); 50 ทวิ per payment | Cr 2233 |
| Freelance, juristic person | Service / brokerage fee | 3 % when the payment is ≥ ฿1,000; VAT 7 % on top when VAT-registered (agent's tax invoice before payment) | ภ.ง.ด.53; 50 ทวิ | Cr 2231 |
| Employee agent | s.40(1) with salary | Through payroll (D-420 export) | ภ.ง.ด.1 via payroll | Cr 2410 accrued |

Progressive method (cumulative, per calendar year, per agent), run when a statement is approved:
1. YTD = commission paid this year incl. this statement; projected = YTD + this statement × remaining months.
2. Net = projected − 50 % expense (max ฿100,000) − allowances (personal ฿60,000 by default; more only with an
   accepted ล.ย.01).
3. Annual tax from the effective-dated bracket table: 0–150,000 exempt · 5 % · 10 % · 15 % · 20 % · 25 % · 30 % · 35 %
   at 300k / 500k / 750k / 1M / 2M / 5M.
4. WHT now = max(0, annual tax × YTD ÷ projected − WHT already withheld this year); December trues up to actual.
5. Non-resident individuals are not accepted in R1.

## 6. Agent agreement

Draft v1 for lawyer review: Claude Docs "สัญญาตัวแทนขาย getpack (ร่างเพื่อทนายตรวจ)"
(https://claude.ai/artifact/PFj4dgoUoZFchaoyyiXtRp). Export as Markdown to
`getpack-api/docs/legal/sales-agent-agreement-v2-draft.md` before Phase 1; after the lawyer approves, publish it as
agreement template `sales_agent_agreement` v2 (maker-checker).

## 7. Pricing discipline and credit cost (owner agreed 2026-11-01)

Price-shopping customers: one negotiation round per quote; give-get menu instead of free discounts; like-for-like
spec comparison with competitor evidence; discounted quotes valid 7 days with conditions printed; negotiation history
per company (flag "เจรจาราคาสูง" raises the approval level); lost-to-price analytics feed the pricing tables; floor
margin = walk-away.

Credit cost (management estimate, not posted): Σ cash paid to the factory × cost of capital (setting, seed 7 %/yr) ×
days until the customer pays ÷ 365. Example: net ฿1,080,000, cost ฿936,000 paid 50 % at job acceptance (day 0) and
50 % at day 21, customer pays day 74 (60-day credit from delivery on day 14) → ฿6,642 + ฿4,757 = ฿11,399 = 1.06 % of
net revenue; with a 50 % deposit and balance on delivery ≈ 0. P&L: actual interest appears as finance cost
company-wide; cash discounts reduce revenue; bad debts are expenses; the credit cost itself is an opportunity cost
shown as a memo line.

## 8. Open items for the owner

1. Licensed lawyer's review of the agreement (§6).
2. Company registration number and address for the agreement and 50 ทวิ.
3. Pilot list of first agents, if any are already known.
4. DNS/TLS for `agent.getpack.co`; VAPID keys; LINE OA channel for agent notifications.
