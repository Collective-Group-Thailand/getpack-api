# E6 — Factory general ledger (plan)

Status: **plan** (D-344, proposed 2026-10-10). Supersedes the "full general ledger and financial statements,
fixed-asset depreciation" part of D-332; payroll, multi-currency and consolidation stay out of scope.
Build after E4 (the factory's own sales and accounting documents) and only once a CPA has reviewed the
factory chart of accounts and the posting rules (§4, §5). This document is the blueprint the coding agent
follows; it changes only through decisions in `docs/decisions.md`.

## 1. Why

Packio Factory already records everything a factory's books are made of: purchases and goods received (E1),
supplier invoices and payments (E2), stock movements at moving average cost (D-321), production issues and
finished goods (D-341), and from E4 its own sales documents. Today the factory re-keys all of it into
Express / PEAK / FlowAccount or hands paper to its bookkeeper. E6 turns those records into double-entry books
the factory owns, so the month closes in Packio and the CPA receives a trial balance, financial statements
and tax returns that tie back to the documents.

Outcome: a factory closes a month in Packio — trial balance, P&L, balance sheet, ภ.พ.30, ภ.ง.ด.3/53 with 50 ทวิ —
with stock, payables and receivables reconciling to the ledger, signed off by its CPA.

## 2. Principles

1. **Factory-private** (D-317): the books belong to the factory; only its users (and an external auditor it
   invites, time-boxed) read them; no Packio staff endpoint, report or benchmark reads them; Packio is the
   software provider, never the bookkeeper or the signer.
2. **Double entry, posted is final**: every entry balances; posted entries and lines are immutable (DB trigger);
   corrections are reversing entries; periods close and lock.
3. **Sub-ledgers drive the ledger**: documents post through **versioned posting rules** (data, not code —
   ADR-0007); the ledger never invents a figure the documents do not have; a rule that does not balance fails
   the event (retried, dead-lettered), it is never plugged.
4. **Reuse Packio's engine, not its tables** (§3).
5. **Thai rules first**: TFRS for NPAEs, the DBD financial-statement layout, Revenue Code VAT and WHT, the
   Accounting Act B.E. 2543 retention (books and documents kept at least 5 years).
6. **Configurable, reviewable defaults**: the chart and rules ship as a template a CPA reviews per factory;
   every ⚖ item is a setting, not code.

## 3. Architecture choice

Packio's own ledger (`src/modules/ledger`, `financial-reports`, `tax`, `fixed-assets`, `banking`, `close`;
D-031, D-033, ADR-0007) is multi-entity in its tables but not in its services: they resolve
`EntitiesService.defaultEntityId()` in ~40 places, posting rules and tax rates are global, journal lines carry
Packio-specific dimension foreign keys (orders, customers, campaigns, vendors), and every endpoint lives in the
admin zone under staff permissions.

| Option | What | Verdict |
|---|---|---|
| A. A Packio `Entity` per factory in the existing ledger tables | least new schema | **No** — mixes factory-private books into Packio's finance tables that staff tools read (D-317 by convention instead of by structure), needs entity-awareness retrofitted into ~40 call sites and global rules / tax rates split per entity |
| **B. A factory-scoped ledger context reusing the engine code** | new `erp_gl_*` tables keyed by `factory_id`; the template renderer, expression evaluator, period state machine, balance / immutability triggers and report queries extracted into a shared `src/common/ledger-core/` used by both contexts | **Recommended** — isolation is structural, Packio's books are untouched, the proven engine is shared |
| C. Export only (journals CSV for Express / PEAK / FlowAccount) | no books in Packio | Keep as an **add-on** (E4 already exports); not a ledger |

Refactor step (E6.0): move `posting/template.ts`, `posting/expression.ts`, the balance / period / immutability
trigger SQL generators and the TB / P&L / BS query builders into `ledger-core` with Packio's ledger re-pointed
at them — no behaviour change, its tests unchanged.

## 4. Chart of accounts (template, TFRS for NPAEs, DBD layout)

Four-digit codes, Thai and English names, type, normal side, control flag, DBD statement line. Per factory,
created from the template on first use, edited only through a maker-checker change (`factory_ledger.configure`
proposes, owner approves). The template for a printing / packaging factory:

| Range | Group | Accounts (examples) |
|---|---|---|
| 11xx | Current assets | 1110 เงินสด · 1120 เงินฝากธนาคาร (one sub-account per bank account) · 1131 ลูกหนี้การค้า (control) · 1132 ลูกหนี้ Packio (control) · 1135 ค่าเผื่อหนี้สงสัยจะสูญ · 1141 วัตถุดิบ · 1142 งานระหว่างทำ · 1143 สินค้าสำเร็จรูป · 1144 วัสดุสิ้นเปลือง · 1145 อะไหล่ · 1146 วัสดุบรรจุภัณฑ์ · 1151 ภาษีซื้อ · 1152 ภาษีซื้อยังไม่ถึงกำหนด · 1153 ภาษีถูกหัก ณ ที่จ่าย · 1160 เงินมัดจำ / จ่ายล่วงหน้า |
| 12xx | Non-current assets | 1210 ที่ดิน · 1220 อาคาร · 1230 เครื่องจักร · 1240 เครื่องมือ / แม่พิมพ์ · 1250 ยานพาหนะ · 1260 อุปกรณ์สำนักงาน · 12x9 ค่าเสื่อมราคาสะสม (per class) |
| 21xx | Current liabilities | 2111 เจ้าหนี้การค้า (control) · 2115 สินค้ารับแล้วยังไม่ได้รับใบแจ้งหนี้ (GR/IR clearing) · 2121 ภาษีขาย · 2122 ภาษีขายยังไม่ถึงกำหนด · 2131 ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.3 · 2132 ภ.ง.ด.53 · 2133 ภ.ง.ด.1 (payroll, if any) · 2140 ค่าใช้จ่ายค้างจ่าย · 2150 เงินรับล่วงหน้า / มัดจำลูกค้า · 2160 ประกันสังคมค้างจ่าย |
| 22xx | Non-current liabilities | 2210 เงินกู้ยืมระยะยาว · 2220 หนี้สินตามสัญญาเช่า |
| 3xxx | Equity | 3100 ทุนจดทะเบียน / ทุนที่ชำระแล้ว · 3200 กำไรสะสม · 3300 กำไรขาดทุนปีปัจจุบัน (system) |
| 41xx | Revenue | 4110 รายได้ขาย (own customers) · 4120 รายได้รับจ้างผลิต Packio · 4190 รับคืน / ส่วนลดจ่าย |
| 49xx | Other income | 4910 ดอกเบี้ยรับ · 4920 กำไรจากการขายทรัพย์สิน · 4990 รายได้อื่น |
| 51xx | Cost of sales | 5110 ต้นทุนขาย · 5120 วัตถุดิบใช้ไป · 5130 ผลต่างสต็อก (count / adjustment) · 5140 ผลต่างราคาซื้อ · 5150 ผลต่างการผลิต · 5160 ค่าแรงทางตรง · 5170 ค่าโสหุ้ยการผลิต (applied) |
| 52xx | Manufacturing overhead (actual) | 5210 ค่าไฟฟ้าโรงงาน · 5220 ค่าซ่อมบำรุง · 5230 วัสดุสิ้นเปลืองโรงงาน · 5240 ค่าเสื่อมราคาเครื่องจักร |
| 6xxx | Selling & admin | 6110 เงินเดือน · 6120 ค่าขนส่ง · 6130 ค่าธรรมเนียมธนาคาร · 6140 ค่าเสื่อมราคา (non-factory) · 6900 ค่าใช้จ่ายอื่น |
| 7xxx | Finance cost and tax | 7110 ดอกเบี้ยจ่าย · 7210 ภาษีเงินได้นิติบุคคล |

Item kinds (D-320) map to inventory accounts by default (raw material → 1141, consumable → 1144, spare part →
1145, semi-finished → 1142, finished good → 1143, packing → 1146), overridable per item.

## 5. Posting rules (template v1 — ⚖ CPA review)

Rules listen to the ERP's domain events (ids and numbers only, D-345; the posting job reads the document).
Amounts from the documents; VAT and WHT split as the documents computed them.

| # | Event | Debit | Credit | Notes |
|---|---|---|---|---|
| F01 | `erp_goods_receipt.posted` | Inventory (item kind) — receipt value | 2115 GR/IR | value at cost excl. VAT (D-321) |
| F02 | `erp_supplier_invoice.recorded` (matched) / `.approved` (variance) | 2115 GR/IR — received value of matched lines · 5140 price variance (difference) · expense account (unordered lines) · 1151 input VAT (tax invoice) or 1152 (not yet received) | 2111 AP (total) | cancellation reverses (source reversal) |
| F03 | `erp_supplier_payment.recorded` | 2111 AP (allocated + WHT share) | Bank / cash · 2131 / 2132 WHT payable | Thai WHT arises **at payment**: the WHT on an invoice is withheld pro rata to each allocation; issues the 50 ทวิ (E6.3) |
| F04 | `erp_supplier_payment.reversed` | mirror of F03 | | |
| F05 | `erp_stock.adjusted` (count / adjustment) | 5130 stock variance ↔ inventory | | sign by direction |
| F06 | `erp_stock.issued` (non-production issue) | 5230 factory supplies (or the item's expense account) | Inventory | returns mirror |
| F07 | `erp_production_order.materials_issued` / `_returned` | 1142 WIP | Inventory | per movement value |
| F08 | `erp_production_order.completed` | 1143 finished goods (receipt value) · 5150 production variance (WIP residual) | 1142 WIP | Packio-job orders: the WIP goes to 5120 / 5110 at delivery instead |
| F09 | `erp_stock.transferred` | — | — | no entry (same entity, same value) |
| F10 | E4 `erp_sales_invoice.issued` | 1131 AR | 4110 sales · 2121 output VAT | |
| F11 | E4 `erp_delivery.posted` | 5110 COGS | 1143 finished goods | |
| F12 | E4 `erp_receipt.recorded` | Bank · 1153 WHT withheld by the customer | 1131 AR | |
| F13 | E4 credit / debit notes | mirror of F10 | | |
| F14 | Packio statement confirmed (`billing_statement.confirmed`, factory side, D-090) | 1132 AR Packio | 4120 Packio revenue · 2121 output VAT | from the factory's view of Packio payables (`factory_payables.read`) |
| F15 | Packio payout paid (`payout.paid`, factory side) | Bank · 1153 WHT withheld by Packio (D-022) | 1132 AR Packio | the 50 ทวิ Packio issues is attached |
| F16 | Fixed assets: acquisition / monthly depreciation / disposal | per category | | reuse D-150 logic in `ledger-core` |
| F17 | Undue VAT reclass when the tax invoice arrives | 1151 | 1152 | output side 2122 → 2121 at payment for services |

Manual journals (maker-checker: accountant drafts, owner approves), recurring journals, and accruals with an
auto-reverse date as in Packio's ledger.

## 6. Periods and close

Fiscal year per factory (start month a setting), monthly periods `open → soft_closed → closed → locked`,
closing in order; posting to a closed period goes to the next open one keeping the document date for tax
(Packio's rule). The close checklist blocks closing until:

1. Stock valuation report (balances × average cost) = inventory accounts.
2. AP sub-ledger (open supplier invoices − payments) = 2111; GR/IR aging reviewed (receipts not invoiced > 30 days).
3. AR sub-ledger = 1131 / 1132 (E4).
4. Purchase and sales VAT registers = 1151 / 2121 movements; undue VAT reviewed.
5. WHT registers = 2131 / 2132 movements.
6. Every bank account reconciled.
7. Depreciation run posted.
8. Production orders still open at month end listed (WIP balance explained).

Year end: closing entry to 3200, opening balances carried.

## 7. Tax

- **ภาษีซื้อ / ภาษีขาย registers** in the Revenue Department's required columns; **ภ.พ.30** working paper and
  e-Filing data; undue VAT (services) handled through F17.
- **ภ.ง.ด.3 / ภ.ง.ด.53** monthly from payments with WHT (F03), and the **50 ทวิ** certificate numbered per factory,
  issued at payment, printable / PDF (E4 already prints documents).
- Tax calendar with due dates (paper 7th / e-filing 15th of the following month) and reminders (LINE in E5).
- Corporate income tax (ภ.ง.ด.50 / 51): a worksheet from the P&L only, filing by the CPA — not automated.

## 8. Financial statements and reports

Trial balance, GL detail with drill-down to the document, account roll-forward, P&L by function (cost of
sales / selling / admin) and by product group, balance sheet in the DBD NPAEs layout, cash flow (indirect,
by account cash-flow class), comparatives (month, YTD, last year). Exports: PDF, XLSX, and the journal CSV for
Express / PEAK / FlowAccount (option C stays available for factories whose CPA keeps their books elsewhere).
DBD e-Filing XBRL generation is a later option.

## 9. Fixed assets and banking

- Fixed-asset register with categories, straight-line monthly depreciation that catches up missed months,
  disposals and write-offs — Packio's D-150 logic through `ledger-core`; machines (`factory_machines`) link to
  their asset record so maintenance cost and depreciation sit together (E3).
- Bank accounts per factory; statement import (CSV / Excel of the main Thai banks — reuse Packio's banking
  parsers), auto-match by amount / date / reference against payments and receipts, manual match, unmatched
  queue; daily cash position.

## 10. Costing link (with E5)

E2 values finished goods at the materials consumed (D-341). E5 adds labour (operation minutes × rate) and
overhead absorption (machine-hour rates per cost centre); E6 then posts applied labour / overhead to 5160 / 5170
against WIP and the under / over-absorption to 5150 at month end. Packio jobs get a job-cost report (Packio's
payout vs the factory's actual cost) — the factory's private margin view, never shared with Packio (D-317).

## 11. Data model (sketch, `prisma/schema/factory-ledger.prisma`)

`erp_gl_settings` (fiscal year start, VAT registrant, WHT at payment, account mapping per item kind, CPA
contact) · `erp_gl_accounts` (factory, code, names, type, normal side, parent, control, postable, statement
line, cash-flow class, status) · `erp_gl_account_changes` (maker-checker) · `erp_gl_fiscal_years` /
`erp_gl_periods` (state machine, exclusion constraint on overlap) · `erp_gl_journal_entries` (entry no
`JV-YYMM-NNNN`, kind auto / manual / reversal / recurring / closing, status, source document type + id + no,
domain event id + rule version — unique for idempotency, reverses id, totals) · `erp_gl_journal_lines`
(account, debit, credit, dimensions: item, supplier / customer (trading partner), warehouse, production
order, machine, cost centre; tax code and base) · `erp_gl_posting_rules` / `_versions` (per factory, copied
from the template, approved versions only) · `erp_gl_recurring_journals` · `erp_wht_certificates` ·
`erp_tax_reports` · `erp_fixed_assets` + categories + depreciation runs / lines · `erp_bank_accounts`,
`erp_bank_statement_lines`, `erp_bank_matches` · `erp_close_checklists` / `_tasks`. Triggers (balance, open
period, account belongs to the factory and is postable, posted immutable, periods never deleted) generated
by `ledger-core`.

## 12. API surface (partner zone, `/v1/partner/factories/{factoryId}/erp/ledger/...`)

`accounts` (+ changes, approve) · `periods` (+ soft-close, close, lock, reopen with reason) · `journals`
(list, get, manual create / submit / approve / reverse, recurring) · `reports/trial-balance`,
`reports/general-ledger`, `reports/profit-and-loss`, `reports/balance-sheet`, `reports/cash-flow`,
`reports/stock-valuation` · `tax/vat-registers`, `tax/pp30`, `tax/wht-returns`, `wht-certificates` (+ pdf) ·
`fixed-assets` (+ depreciation runs) · `bank-accounts`, `bank-statements` (import), `bank-matches` · `close`
(checklist, tasks, sign-off) · `exports/journals.csv`.

## 13. Roles and permissions

`factory_ledger.read`, `factory_ledger.post` (manual journals, matches), `factory_ledger.approve` (approve
manual journals and chart changes), `factory_ledger.close` (period state), `factory_ledger.configure` (chart,
rules, settings), `factory_tax.file` (mark returns filed). Owner: all. Accountant: read, post, close (soft),
tax file. New role **External auditor / CPA** (`factory_auditor`): read-only on ledger, reports and documents,
granted by the owner for a period, every read audited.

## 14. Phases

| Phase | Scope | Exit |
|---|---|---|
| E6.0 | Extract `ledger-core` from Packio's ledger (no behaviour change) | Packio ledger tests green unchanged |
| E6.1 | Settings, chart template + maker-checker, periods, manual / recurring journals, TB, GL detail, opening balances import | an opening TB loaded and a manual month posted |
| E6.2 | Posting rules F01 – F09 from E1 / E2 events, GR/IR, close checks 1, 2, 4, 5, 8, stock valuation report | a month of E1 / E2 activity posts and reconciles |
| E6.3 | VAT registers, ภ.พ.30, WHT at payment, ภ.ง.ด.3 / 53, 50 ทวิ, tax calendar | a month's returns prepared from the books |
| E6.4 | P&L, balance sheet (DBD layout), cash flow, fixed assets + depreciation, bank import and reconciliation, full close | first month closed and signed by a CPA |
| E6.5 | Sales posting F10 – F15 with E4, costing with E5, journal export, auditor role | year-end close rehearsed |

## 15. Decisions to take before building (owner / CPA)

1. CPA review of the chart template (§4) and rules (§5) — ⚖.
2. WHT timing: Thai law withholds at payment; E2 shows WHT on the invoice for planning only — confirm F03.
3. Packio revenue recognition point for the factory: statement confirmation (F14) vs job completion.
4. Inventory method stays moving average (D-321) for the books; no FIFO.
5. Whether Packio offers bookkeeping services (a different, regulated business) — recommended **no**:
   Packio provides software; the factory's accountant / CPA keeps and signs the books.
6. Retention: books, journals and tax documents kept ≥ 5 years (Accounting Act B.E. 2543 s.14; Revenue
   Code s.87/3) even if the factory leaves Packio — export-on-exit and a read-only archive.
7. Pricing of the ledger module (D-318): a commercial decision.

## 16. Risks

- **Wrong books are worse than none**: every rule balanced by a DB trigger, a golden-month test per rule set,
  and CPA sign-off before a factory goes live.
- **Sub-ledger drift** (documents edited after posting): E1 / E2 documents are already final once posted or
  append-only; reversals post mirror entries; the close checks catch any drift.
- **Isolation**: separate tables, factory-scoped endpoints and a schema test that no staff module imports
  `erp_gl_*` models.
- **Effort**: E6 is about the size of E1 + E2 together; `ledger-core` reuse keeps it so.

## 17. Definition of done

As `00-master-plan.md` §8 and E1 §8, plus: every rule has a balancing unit test and an e2e from document to
journal; a golden month (opening TB → E1 / E2 / E4 activity → close) reproduces the expected TB, P&L, BS,
ภ.พ.30 and ภ.ง.ด.53 to the satang; reversing any document reverses its entries; another factory's id → 404 and a
staff token → 403 on every ledger endpoint (D-317).

## 18. As built (v0.49.0, 2026-10-14)

Decisions D-385 – D-396. Option B with `src/common/ledger-core/` (template renderer, expressions, dates) shared with
Packio's ledger. Schema `prisma/schema/factory-ledger.prisma` (`erp_gl_*`, 18 tables) with the same database discipline
as Packio's books. Chart template v1 (79 accounts) and rules F01 – F18 in `src/modules/factory-erp/erp-ledger.template.ts`.
Differences from the sketch above: WHT certificates and tax reports stay where E4 built them (`erp_wht_certificates`,
`erp-tax.service`); the ledger reconciles against them and records filings (`erp_gl_tax_filings`); the close checklist is
computed (stored on the period at close) rather than kept as tasks; F14 / F15 (Packio statements and payouts) wait for
a factory's Packio payables to be posted from the factory side — they are entered as manual journals until then;
labour / overhead absorption posts at completion (F08) rather than at month end. API under
`/v1/partner/factories/{factoryId}/erp/ledger/*` (tags `partner.erpLedger`, `erpJournals`, `erpLedgerReports`,
`erpFixedAssets`, `erpBank`).
