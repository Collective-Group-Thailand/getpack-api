# P6 — management P&L planner · plan (autorun)

Branch `feat/agent-p6-pnl` (both repos). Decision **D-472** "Management P&L planner: auto from GL and operations,
manual and override cells with reasons, scenarios, plan vs actual" (PROMPT Phase 6, PLAN A-14; builds on D-031 /
D-033 (GL, reports), D-150 (fixed assets), D-416–D-423 / D-464 (commission), D-468 (pipeline), D-470 (credit cost,
bad-debt provision), D-444 (access log pattern)). The owner delegated every decision and is not watching: the most
conservative option is taken for money, tax and confidentiality, and every assumption is recorded here, in
`docs/PROGRESS.md` and in the D-472 row.

## Principles kept
- **Management figures only — never posted.** The planner reads the posted ledger, the pipeline, commissions and the
  fixed-asset register; it writes only its own tables. No journal, no posting rule, no document.
- **Decimal-exact**: `numeric(14,2)` cells, `decimal.js` (`MoneyDecimal`) in code, decimal strings in JSON; every
  cell rounded half-up to 2 places, calculated lines computed from the rounded cells (what the user sees adds up).
- **Configurable values are settings** (effective-dated, audited, owner role): the line catalogue with its GL mapping
  and tooltips, the forecast rules (stage probabilities, horizon, trailing window), the corporate income tax table.
- **Confidential**: `pnl.*` permissions only for C-Level, VP, Director, Finance Manager (+ Superadmin); every grid /
  variance view and every export is written to an append-only access log (D-444 pattern); exports watermarked with
  the viewer's name and the time; nothing reaches the store, partner or agent surfaces.
- Every state change: one transaction + audit row + activity + outbox event (`recordAgentEvent` helper).

## Scope (API)

### 1 · Model (`prisma/schema/pnl.prisma`)
- `PnlPlan` — entity, `name`, `fiscalYear` (calendar year; months Jan–Dec Asia/Bangkok, the entity's fiscal year
  is the calendar year — recorded), `scenario` `PnlScenario` base | best | worst | custom, `status` `PnlPlanStatus`
  draft | locked, `version` (1, 2 … per entity + year + scenario + name), `ownerUserId`, `copiedFromPlanId`,
  `computedAt`, the setting versions used (`catalogueVersionId`, `forecastRulesVersionId`, `citRatesVersionId`),
  `lockedAt` / `lockedById` / `snapshotSha256` (SHA-256 of every cell at lock), soft delete `deletedAt` (drafts only),
  `rowVersion` (ETag).
- `PnlPlanCell` — `planId`, `lineKey`, `month` (date, first day), `value` numeric(14,2) null, `mode` `PnlCellMode`
  auto | calculated | manual | override (`calculated` added for formula lines so the web shows the four marks
  ระบบ · คำนวณ · กรอกเอง · แก้ทับ), `autoValue` (kept beside an override), `source` `PnlCellSource`, `sourceRef` json
  (the inputs: accounts, window, ratios — ids only), `note` (manual note / override reason), `periodOpen`, `asOf`,
  `updatedById` / `updatedAt`, `rowVersion`. Unique (plan, line, month).
- `PnlVarianceNote` — a finance note per (plan, line, month) on plan-vs-actual (allowed on locked plans).
- `PnlAccessLog` — append-only (`forbid_mutation()`), viewer, plan, purpose view | export, format, request id.
- **DB triggers**: a locked plan's cells cannot be inserted, updated or deleted; a locked plan row cannot be updated
  or deleted (lock is final; a revision is a copy → new version).

### 2 · Line catalogue (setting `pnl.line_catalogue`, json, owner `finance_manager`, proposed)
Structure (keys, groups, units, formulas) is code (`pnl-lines.ts`); the setting holds per key the labels and
tooltips (`definition`, `formula`, `source`, `howToFill`; th from PNL-LINES.md, en null — PNL-LINES has Thai only,
recorded) and the GL mapping `glAccounts: [{ code, onlyRules?, excludeRules? }]` (posting-rule filters split account
6160 between agent commission and the employee accrual `AG01`). Keys and groups:

| group | keys |
|---|---|
| `revenue` | revenue_goods · revenue_shipping · discounts · net_revenue |
| `cost_of_sales` | factory_cost · shipping_cost · payment_fees |
| `gross_margin` | gross_margin |
| `selling_expenses` | agent_commission · employee_commission · marketing |
| `admin_expenses` | salaries · rent_utilities · software_cloud · professional_fees · depreciation · other_opex |
| `operating_profit` | ebit |
| `finance_and_tax` | finance_cost · cit_estimate |
| `net_profit` | net_profit |
| `memo` (not in the total) | memo_credit_cost · memo_bad_debt · memo_ebitda · memo_commission_ratio · memo_dso · memo_dpo · memo_ccc · memo_break_even |

Seeded mapping (chart of accounts as seeded): revenue_goods 4110 4120 4130 4140 4160 · revenue_shipping 4150 ·
discounts 4910 4920 4930 · factory_cost 5110 5140 5150 5190 · shipping_cost 5120 5130 · payment_fees 6110 ·
agent_commission 6160 (except rule AG01) · employee_commission 6160 (rule AG01 only) · marketing 6120 · depreciation
6150 · other_opex 6130 6140 6900 6910. **Unmapped (no account in the chart → manual):** salaries, rent_utilities,
software_cloud, professional_fees, finance_cost (no 7xxx), and 4990 other income is left out (conservative). The
accountant maps them by a new setting version.

### 3 · Auto values (`pnl-engine.ts` pure + `pnl-data.service.ts` reads)
- **Months**: before the current Bangkok month = actual; the current month = actual to date with `periodOpen`; any
  actual month whose fiscal period is `open` / `soft_closed` (or has none) is `periodOpen` ("ยังไม่ปิดงวด"); later
  months = forecast. `asOf` = compute time.
- **Actual**: posted journal lines per mapped account (revenue: credit − debit; contra, cost, expense: debit −
  credit); commission split by posting rule; depreciation from GL 6150.
- **Forecast** (setting `pnl.forecast_rules`, finance_manager, proposed: stage probability new 10 · contacted 20 ·
  quoted 40 · negotiating 60 %, pipeline spread evenly over the next 3 forecast months, trailing window 3 complete
  months, repeat customer = revenue in ≥ 2 of the 3 months):
  - revenue_goods = Σ open agent / rep leads' expected value × stage probability (spread) + repeat-order run rate
    (trailing revenue per company — else per customer — of repeat customers ÷ 3);
  - revenue_shipping, discounts = trailing ratio to revenue_goods; payment_fees = trailing ratio to net revenue;
    shipping_cost = trailing ratio to revenue_shipping;
  - factory_cost = revenue_goods × Σ class mix × (factory cost ÷ revenue) by product class (product type dimension,
    trailing) — i.e. (1 − gross margin % by class) weighted by the trailing mix;
  - agent / employee commission = pipeline share of that kind × the agent plan's effective first-order rate + run
    rate × trailing commission ratio;
  - fixed costs (marketing, other_opex, any newly mapped fixed line) = trailing 3-month average;
  - depreciation = fixed-asset schedules (straight line as the register computes it);
  - **no system data** (unmapped line, or no posted line in the trailing window) → `manual`, value empty "กรอกค่า".
- **Calculated**: net revenue, gross margin, EBIT, net profit, EBITDA, commission ÷ gross margin, CCC, credit cost,
  break-even. **CIT** (setting `tax.cit_rates`, finance_manager, pending CPA): cumulative — month m = tax(YTD profit
  before tax to m) − tax(YTD to m−1), so the year sums to the tax on the annual profit; SME bands 0–300,000 0 % ·
  300,000.01–3,000,000 15 % · above 20 % only when the setting's company paid-up capital is set and ≤ 5,000,000 and
  the plan's annual net revenue ≤ 30,000,000; otherwise 20 %; loss → 0; always labelled "ประมาณการ".
- **Memo** (read-only): DSO = average AR (1210, opening + closing ÷ 2) ÷ net revenue × days; DPO = average factory
  payables (2110) ÷ (factory + shipping cost) × days; CCC = DSO − DPO; credit cost = (factory + shipping cost) ×
  `finance.cost_of_capital_annual_pct` × max(0, CCC) ÷ 365 (the P4 per-deal estimate aggregated by the cycle — a
  management approximation); bad-debt provision = AR closing balance × `finance.bad_debt_provision_pct.byGrade.credit`
  (unset → empty, "not set"); break-even revenue = fixed costs ÷ (gross margin % − commission %). Forecast DSO / DPO /
  bad debt = trailing average.
- **Golden unit tests**: CIT bands SME and non-SME (incl. losses and cumulative months), break-even, CCC, EBITDA, a
  full small plan.

### 4 · Manual input rules
- A line without system data → `manual`; the first value needs a note (`pnl.note_required`); later edits keep it.
- Changing an auto value → `override`, `autoValue` kept beside it, reason required on every override change.
- `value: null` reverts an override to auto (or clears a manual value). Calculated and memo lines are read-only
  (`pnl.line_read_only`). Locked plan → `pnl.plan_locked`.
- Recompute keeps every manual and override value (a manual line that gains system data becomes an override with its
  note as reason).
- Audit row (before / after) + activity + outbox `pnl_cell.updated` (ids, line, month, mode — no amounts).

### 5 · Endpoints `admin.pnl.*` (`/v1/admin/finance/pnl/…`)
`listLines`, `listPlans`, `createPlan` (computes at once), `getPlan` (ETag), `updatePlan` (If-Match; name / note of
a draft), `deletePlan` (If-Match; drafts, soft), `getGrid` (logged view), `updateCell` (If-Match = the cell's
`etag`), `recompute` (If-Match), `copyPlan` (scenario copy → new draft, version + 1 when the name repeats),
`lockPlan` (If-Match + Idempotency-Key; **no maker-checker**: accounting-design §8 lists money-moving and
configuration steps, a management plan lock is neither — recorded), `getVariance` (logged view), `setVarianceNote`,
`listCellSources` (drill-down, paged), `exportPlan` (XLSX / PDF, watermarked, logged, audited, 5-minute link).
Permissions: `pnl.read` (C-Level, VP, Director, Finance Manager), `pnl.manage` (C-Level, Finance Manager), `pnl.export`
(C-Level, Finance Manager); Superadmin by its all-staff grant. **VP / Director read-only** (no decision gives them
more). **Finance (accountant role), Auditor, Sales roles, agents, everyone else: 403** (the prompt says nobody else).

### 6 · Tooltips
`listLines` and every grid line return `definition`, `formula`, `source`, `howToFill` (manual-capable lines),
`glAccounts` (code + account names) from the setting. Unit tests: every key has all fields; the seed matches
PNL-LINES.md row by row (drift test).

### 7 · Docs
API-CHANGES-P6.md (copied to the web repo), D-472 in both `docs/decisions.md`, P6 row in PROGRESS, rbac.md and
SETTINGS-REVIEW regenerated.

## Migrations (each with `down.sql`; deploy → down → delete rows → redeploy → status clean)
- `20270108000001_pnl_planner`: enums, the four tables, indexes, FKs, lock triggers, append-only trigger.

## Settings
| Key | Type | Seed | Owner | Confirmation |
|---|---|---|---|---|
| `pnl.line_catalogue` | json | PNL-LINES.md + mapping above | finance_manager | proposed |
| `pnl.forecast_rules` | json | 10/20/40/60 %, horizon 3, trailing 3, repeat 2 | finance_manager | proposed |
| `tax.cit_rates` | json | 20 %; SME bands; capital ≤ 5M, revenue ≤ 30M; paid-up capital null | finance_manager | pending_cpa |

## Tests
Unit: engine golden (CIT SME / non-SME / loss / cumulative, break-even, CCC, EBITDA, credit cost, full small plan),
forecast pure functions (pipeline spread, run rate repeat filter, class mix), cell rules (manual note, override
reason, revert, read-only, locked), tooltip coverage + PNL-LINES drift, RBAC (route permissions of every
`admin.pnl.*` handler vs the role catalogue: sales roles, agents, finance, auditor → 403; VP / Director read only),
settings seeds. e2e `pnl.e2e-spec.ts` written (SKIPPED-DOCKER).

## Web scope (getpack-web, after the API — not in this run)
`/admin/finance/pnl`: header (plan picker, scenario tabs, year, status, เทียบกับจริง, recompute, lock, export when
allowed), grid grouped by `group` with sticky first column / header, inline edit for editable cells, marks by
`mode`, tooltips from the line metadata and cell fields, override reason dialog, summary strip from `summary`, chart
from the grid / variance, phone summary + month cards read-only.

## Risks
- Forecast quality depends on the pipeline's expected values (no expected close date → spread evenly) and on the
  accountant's mapping of the unmapped lines.
- DSO uses AR incl. VAT against revenue ex VAT (overstates days slightly — conservative).
- Large GL volumes: queries aggregate per account and month in SQL; drill-down is paged.
