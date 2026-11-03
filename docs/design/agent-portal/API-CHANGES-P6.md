# API changes — Phase 6 (`feat/agent-p6-pnl`, D-472)

Management P&L planner for Finance and executives (`/admin/finance/pnl` on the web). Plans by calendar year and
scenario are filled from the system — actual months from the posted ledger per mapped GL account, forecast months
from the pipeline, repeat-order run rate, trailing ratios / averages and the fixed-asset register — with manual cells
(note on the first entry) and overrides of auto values (reason every time, auto value kept beside it), formulas
(net revenue, gross margin, EBIT, CIT estimate, net profit) and a memo band out of the total (credit cost, bad-debt
provision, EBITDA, commission ÷ gross margin, DSO, DPO, cash conversion cycle, break-even revenue). Locking freezes a
plan (DB trigger) as the baseline of plan vs actual. **Management figures only — nothing is ever posted.** Money,
ratios and days are decimal strings with 2 places; months `YYYY-MM` (Asia/Bangkok); times `+07:00`.

Migration (non-destructive, `down.sql`, rollback tested): `20270108000001_pnl_planner` — tables `pnl_plans`,
`pnl_plan_cells`, `pnl_variance_notes`, `pnl_access_logs` (append-only); triggers: a locked plan row and every cell of
a locked plan can never change.

## 1 · Permissions

| Permission | Roles | Grants |
|---|---|---|
| `pnl.read` | C-Level, VP, Director, Finance Manager, Superadmin | lines, plans, grid, variance, drill-down |
| `pnl.manage` | C-Level, Finance Manager, Superadmin | create / edit / delete drafts, cells, recompute, copy, lock, variance notes |
| `pnl.export` | C-Level, Finance Manager, Superadmin | XLSX / PDF export |

VP and Director are **read-only**. **Finance (accountant role), Auditor, Sales Manager, Sales Rep, agents and every
other role get 403** on every `admin.pnl.*` operation. The web hides actions by `x-required-permissions`.

## 2 · Endpoints (`/v1/admin/finance/pnl`, staff bearer, tag `admin.pnl`)

| operationId | Method + path | Permission | Request → response |
|---|---|---|---|
| `admin.pnl.listLines` | `GET /lines` | read | → `PnlLineCatalogueDto { effectiveFrom, lines: PnlLineDto[] }` |
| `admin.pnl.listPlans` | `GET /plans?page&perPage&fiscalYear&scenario&status` | read | → `{ data: PnlPlanDto[], meta }` |
| `admin.pnl.createPlan` | `POST /plans` | manage | `CreatePnlPlanDto { name (1–120), fiscalYear (2000–2200), scenario, note? }` → 201 `PnlPlanDto` (computed at once) |
| `admin.pnl.getPlan` | `GET /plans/{planId}` | read | → `PnlPlanDto` + `ETag` header (= `etag`) |
| `admin.pnl.updatePlan` | `PATCH /plans/{planId}` (**If-Match** plan etag) | manage | `UpdatePnlPlanDto { name?, note? }` → `PnlPlanDto`; 409 `pnl.plan_locked` |
| `admin.pnl.deletePlan` | `DELETE /plans/{planId}` (**If-Match**) | manage | → 204 (soft, drafts only); 409 `pnl.plan_locked` |
| `admin.pnl.getGrid` | `GET /plans/{planId}/grid` | read | → `PnlGridDto` (view logged) |
| `admin.pnl.updateCell` | `PUT /plans/{planId}/cells/{lineKey}/{month}` (**If-Match** = the cell's `etag`) | manage | `UpdatePnlCellDto { value: string \| null, note? }` → `PnlGridDto`; 422 `pnl.note_required`, `pnl.reason_required`, `pnl.line_read_only`; 409 `pnl.plan_locked`; 404 unknown line / month outside the plan year |
| `admin.pnl.recompute` | `POST /plans/{planId}/actions/recompute` (**If-Match**) | manage | → `PnlGridDto`; 409 `pnl.plan_locked` |
| `admin.pnl.copyPlan` | `POST /plans/{planId}/actions/copy` | manage | `CopyPnlPlanDto { scenario, name?, note? }` → 201 `PnlPlanDto` (new draft, next version of that name/year/scenario, manual + override values and notes copied, then refreshed) |
| `admin.pnl.lockPlan` | `POST /plans/{planId}/actions/lock` (**If-Match** + **Idempotency-Key**) | manage | → `PnlPlanDto` (`status: locked`, `lockedAt`, `lockedBy`, `snapshotSha256`); 409 `pnl.plan_locked`, `pnl.not_computed` |
| `admin.pnl.getVariance` | `GET /plans/{planId}/variance` | read | → `PnlVarianceDto` (view logged) |
| `admin.pnl.setVarianceNote` | `PUT /plans/{planId}/variance-notes/{lineKey}/{month}` | manage | `SetPnlVarianceNoteDto { note (3–1000) }` → `PnlVarianceDto` (allowed on locked plans) |
| `admin.pnl.listCellSources` | `GET /plans/{planId}/cells/{lineKey}/{month}/sources?page&perPage&kind` | read | → `{ data: PnlSourceItemDto[], meta }` |
| `admin.pnl.exportPlan` | `POST /plans/{planId}/exports` | export | `ExportPnlPlanDto { format: xlsx \| pdf, view?: plan \| variance }` → `DownloadUrlDto { url, expiresAt }` (5-minute link) |

Every write: one transaction + audit row (`pnl_plan.created / updated / deleted / copied / locked`, `pnl_cell.updated`
with before / after, `pnl_variance_note.set`) + activity + outbox event (same names, plus `pnl_plan.recomputed`;
payloads ids, line, month, mode — no amounts).

## 3 · DTOs

- **`PnlLineDto`** `{ key: PnlLineKey, group: PnlLineGroup, unit: PnlLineUnit (money | percent | days), calc:
  PnlLineCalc (source | formula), inTotal, editable, mapped, labelTh, labelEn, definition, formula, source:
  LocalisedTextDto { th, en|null }, howToFill: LocalisedTextDto | null, glAccounts: PnlGlAccountDto[] { code, nameTh,
  nameEn, onlyRules[], excludeRules[] } }`. `en` texts are null for now (PNL-LINES.md is Thai only).
- **`PnlPlanDto`** `{ id, name, fiscalYear, scenario: PnlScenario (base | best | worst | custom), status:
  PnlPlanStatus (draft | locked), version, note, owner: UserRefDto, copiedFromId, computedAt, lockedAt, lockedBy,
  snapshotSha256, etag, createdAt, updatedAt }`.
- **`PnlGridDto`** `{ plan, currency: 'THB', months: PnlMonthDto[], lines: PnlGridLineDto[], summary: PnlSummaryDto }`.
  - `PnlMonthDto { month, kind: PnlMonthKind (actual | forecast), periodOpen, periodStatus: PeriodStatus | null }` —
    actual = months up to the current Bangkok month; `periodOpen` true for the current month and any actual month
    whose fiscal period is open / soft-closed / missing → show **"ยังไม่ปิดงวด"**.
  - `PnlGridLineDto { line: PnlLineDto, cells: PnlCellDto[12], total }` — total: money summed; ratios and days
    recomputed on the year; bad-debt provision = last month with a value; break-even on the year's totals.
  - **`PnlCellDto`** `{ month, value, mode: PnlCellMode (auto | calculated | manual | override → marks ระบบ · คำนวณ ·
    กรอกเอง · แก้ทับ), autoValue, source: PnlCellSource (gl | pipeline_run_rate | trailing_ratio | trailing_average |
    commission_rates | fixed_assets | balances | formula | none), sourceRef (object: accounts, lines, window, ratioPct,
    pipelinePerMonth, runRatePerMonth, openLeads, repeatCustomers, byClass[], assets, smeApplied … for the tooltip),
    note (manual note / override reason), periodOpen, asOf ("ข้อมูลถึง"), updatedBy, updatedAt, etag, drillable }`.
    An empty editable cell (`value: null`, mode manual) shows "กรอกค่า" with the line's `howToFill`. The
    `cit_estimate` cells carry `sourceRef.smeApplied`; always label it "ประมาณการ".
  - **`PnlSummaryDto`** `{ netRevenue, grossMargin, grossMarginPct, contributionAfterCommission
    ("กำไรหลังหักค่าคอม"), contributionAfterCommissionPct, ebitda, netProfit, cashConversionDays, breakEvenRevenue,
    citSmeApplied, emptyManualCells }` (year figures).
- **`PnlVarianceDto`** `{ plan, currency, asOf, months, lines: PnlVarianceLineDto[] { line, cells:
  PnlVarianceCellDto[] { month, plan, actual, variance (actual − plan), variancePct (÷ |plan|; null when plan 0),
  actualBasis: PnlActualBasis (ledger | calculated | includes_plan_values | none | not_yet), note, noteBy,
  noteUpdatedAt }, totalPlan, totalActual, totalVariance, totalVariancePct } }` — totals over actual months only. For
  the chart "plan vs actual by month" use `revenue_goods`/`net_revenue` and `net_profit` lines' `plan` and `actual`.
- **`PnlSourceItemDto`** `{ kind: PnlSourceKind (gl_line | commission | lead | fixed_asset | customer_run_rate), id
  (journal entry / commission / lead / asset / company uuid or null), code, date, amount, accountCode, description,
  sourceDocumentType, sourceDocumentId, sourceDocumentNo, orderId, orderCode }`. Defaults by the cell's source: GL →
  journal lines of the month (or of the trailing window for ratio / average forecasts); pipeline / commission
  forecast → open leads (weighted; description = stage, no contact data); depreciation forecast → fixed assets;
  `kind=commission` on the commission lines → commission records earned in the month; `kind=customer_run_rate` →
  repeat customers (company ids only). Links on the web: journal → `GET /v1/admin/ledger/journals/{id}`, orders,
  fixed assets, agent commissions by id.

## 4 · Line catalogue keys (groups)

| group | keys |
|---|---|
| `revenue` | `revenue_goods` · `revenue_shipping` · `discounts` · `net_revenue` (formula) |
| `cost_of_sales` | `factory_cost` · `shipping_cost` · `payment_fees` |
| `gross_margin` | `gross_margin` (formula) |
| `selling_expenses` | `agent_commission` · `employee_commission` · `marketing` |
| `admin_expenses` | `salaries` · `rent_utilities` · `software_cloud` · `professional_fees` · `depreciation` · `other_opex` |
| `operating_profit` | `ebit` (formula) |
| `finance_and_tax` | `finance_cost` · `cit_estimate` (formula) |
| `net_profit` | `net_profit` (formula) |
| `memo` (not in total, read-only) | `memo_credit_cost` · `memo_bad_debt` · `memo_ebitda` · `memo_commission_ratio` (percent) · `memo_dso` (days) · `memo_dpo` (days) · `memo_ccc` (days) · `memo_break_even` |

Seeded GL mapping: revenue_goods 4110 4120 4130 4140 4160 · revenue_shipping 4150 · discounts 4910 4920 4930 ·
factory_cost 5110 5140 5150 5190 · shipping_cost 5120 5130 · payment_fees 6110 · agent_commission 6160 except rule
AG01 · employee_commission 6160 rule AG01 · marketing 6120 · depreciation 6150 · other_opex 6130 6140 6900 6910;
memo DSO / bad debt 1210, DPO 2110. **Unmapped → manual:** salaries, rent_utilities, software_cloud,
professional_fees, finance_cost (no account in the chart yet).

## 5 · Settings

| Key | Type | Seed | Owner | Status |
|---|---|---|---|---|
| `pnl.line_catalogue` | json | PNL-LINES.md texts + mapping above | finance_manager | proposed |
| `pnl.forecast_rules` | json | stage % new 10 · contacted 20 · quoted 40 · negotiating 60; pipeline horizon 3 months; trailing 3; repeat ≥ 2 of 3 months | finance_manager | proposed |
| `tax.cit_rates` | json | standard 20 %; SME 0 % ≤ 300,000 · 15 % ≤ 3,000,000 · 20 % above when paid-up capital ≤ 5,000,000 and revenue ≤ 30,000,000; `paidUpCapital` null → standard rate | finance_manager | pending CPA |

Also read: `finance.cost_of_capital_annual_pct` (7.00), `finance.bad_debt_provision_pct.byGrade.credit` (unset →
memo bad debt empty with `sourceRef.status: not_set`).

## 6 · Error codes (new)

`pnl.plan_locked` 409 · `pnl.line_read_only` 422 · `pnl.note_required` 422 · `pnl.reason_required` 422 ·
`pnl.not_computed` 409 (th / en titles and details in `errors.json`). Plus the shared `concurrency.stale` 412,
`concurrency.precondition_required` 428, `idempotency.*`, `http.not_found`, `validation.failed`, `auth.forbidden`.

## 7 · Web notes

- Cell edit: send `If-Match: <cell.etag>`; the response is the whole refreshed grid (formulas changed). Override
  flow: editing an `auto` cell → reason dialog → the cell shows `value` and `autoValue`. `value: null` reverts.
- Lock: `If-Match: <plan.etag>` + `Idempotency-Key`. Locked plans: grid read-only; variance notes still allowed.
- Export watermark: "ลับ — <viewer name> · <time>" on every sheet header / footer and across every PDF page.
- Phone: summary strip + per-month cards read-only (no API difference).
