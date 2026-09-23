# Packio Accounting — Functional & Control Design (v1)

> Bounded context `ledger` in `packio-api`, finance area in the admin zone of `packio-web`. Implements decisions D-010 (Packio is principal), D-020 (payment schedules), D-021 (quantity tolerance), D-022 (factory payout), D-030 (no SAP), D-031 (full GL in Packio).
> Written from the perspective of an accounting-systems and audit design. **Tax positions marked ⚖ are design assumptions that a Thai CPA / tax advisor must confirm before go-live** — statutory financial statements must be audited by a licensed auditor, so their sign-off is a legal requirement, not an optional review. The system is built so that every ⚖ item is a configuration, not code.

---

## 1. Principles
1. **Sub-ledgers drive the GL.** Business documents (invoices, receipts, credit notes, factory POs, delivery confirmations, supplier bills, payouts, bank lines) are the source of truth; every one posts a balanced journal automatically through versioned **posting rules**. Manual journals are the exception and need maker-checker approval.
2. **Immutable journal.** Posted entries are never edited or deleted; corrections are reversing entries linked to the original. Every entry carries `source_document`, `domain_event_id`, `posting_rule_version`, `created_by`, `approved_by`.
3. **One currency (THB), one active legal entity, multi-entity ready.** Every table carries `entity_id`; document numbering, chart of accounts, tax registration, bank accounts and periods are per entity.
4. **Period discipline.** Periods `open → soft_closed → closed → locked`. Postings into closed periods are rejected; late items post to the next open period with the original document date kept for tax reporting.
5. **Decimal-exact.** `numeric(14,2)` amounts, VAT and WHT rounding rules ported from legacy helpers (`calculateVat`, `calculateWithholdingTax`, `convertTo2Decimal`) and documented; line-level vs document-level rounding is a configuration.
6. **Segregation of duties** enforced by permissions, not by policy documents (§8).
7. **Audit-ready by default**: every number in every report drills down to journal lines → source document → domain event → user and timestamp.

## 2. Tax model (configurable) ⚖
| Topic | Design default | Why / what the auditor confirms |
|---|---|---|
| Nature of Packio's sale | Configurable per product type: `sale_of_goods` or `hire_of_work` (จ้างทำของ). **Default `hire_of_work` for made-to-order printed packaging, `sale_of_goods` for standard (stock) products.** | Legacy customers already withhold tax on orders (tax profile withholding flag, `calculateWithholdingTax`), which is consistent with hire-of-work treatment. |
| VAT rate | Table with effective dates (currently 7 %). | Rate changes are dated, never edited in place. |
| Tax point — goods | Delivery, or earlier payment / invoice issuance. | Revenue Code tax-point rules for goods. |
| Tax point — hire of work | Payment receipt. Invoice issued before payment → VAT recorded in **output VAT not yet due** (ภาษีขายยังไม่ถึงกำหนด) and moved to output VAT when paid. | Revenue Code tax-point rules for services/hire of work. |
| Deposits & instalments | Receipt of any instalment before delivery creates a tax point for that amount → **tax invoice/receipt for the instalment**; the final tax invoice shows the full value and deducts instalments already taxed. | Same result under both natures, so the design is robust to the classification decision. |
| Customer WHT | Juristic customers may withhold (default 3 % for hire of work); government customers per their rule (legacy tax type 3). Receipt records gross, WHT receivable (ภาษีถูกหัก ณ ที่จ่าย) and net cash; the 50 ทวิ certificate is tracked until received. | Missing-certificate report drives collection; WHT receivable offsets corporate income tax. |
| WHT on factory payments | Per line type: production (hire of work, default 3 %), transport line (default 1 %), design freelancers (individual → ภ.ง.ด.3). WHT applies at each payment, including the 30 % advance. | Factory bills separate production and shipping lines so the correct rate applies. |
| Input VAT | Claimed only when a valid tax invoice from the factory/vendor is recorded (number, date, seller tax id, branch). Non-VAT-registered factories → no input VAT. | Input VAT without a valid document stays in *input VAT pending document*. |
| Two separate sales | **Sale 1:** Collective Group (Thailand) → customer, full amount (e.g. 100 + VAT), documents in Collective Group's name under the Packio brand. **Sale 2:** factory → Collective Group (e.g. 80 + VAT). For sale 2, Packio **generates the billing statement** (ใบวางบิล) from PO + delivery confirmation and the factory confirms it; the **factory's own tax invoice** to Collective Group (its number, its name) is recorded (e-Tax or uploaded PDF + fields). Packio never issues documents in a factory's name, and never to customers on a factory's behalf. | Without the factory's tax invoice Collective Group cannot claim input VAT on sale 2 and would bear VAT on the full 100 (see §11 example). |
| Credit notes (ใบลดหนี้) / debit notes (ใบเพิ่มหนี้) | Always reference the original tax invoice; reason from a controlled list mapped to statutory reasons (price reduction, defective/short goods, returns, cancellation, discount after sale). | Legacy reasons (`reason_of_cancel_order`) migrate to this list (SAP codes dropped, D-030). |
| e-Tax invoice & e-Receipt | Data model and XML/PDF-A output ready in R1, enabled in R2 (D-041). | Registration with the Revenue Department is a business action. |
| Record retention | Documents and ledgers retained ≥ 10 years (config), exceeding the statutory minimum; legal hold flag. | Statutory minimum is 5 years and can be extended by authorities. |

## 3. Chart of accounts (seed, editable by finance; codes are defaults)
**1 Assets** — 1110 Cash on hand · 1121–1129 Bank accounts (one per account) · 1131 Clearing — 2C2P · 1132 Clearing — SCB · 1133 Clearing — slip transfers pending bank match · 1140 Undeposited / unidentified receipts · 1210 Trade receivables · 1219 Allowance for doubtful accounts · 1230 WHT receivable (ภาษีถูกหัก ณ ที่จ่าย) · 1241 Input VAT · 1242 Input VAT not yet due / pending document · 1250 Advances to factories (เงินจ่ายล่วงหน้าโรงงาน) · 1260 Claims receivable from factories · 1270 Other receivables · 1510+ Fixed assets (manual, R2).
**2 Liabilities** — 2110 Trade payables — factories · 2120 Trade payables — other vendors (carriers, freelancers, services) · 2130 Factory retention payable (reserve, D-022) · 2210 Output VAT · 2211 Output VAT not yet due · 2220 VAT payable (ภ.พ.30 net) · 2231 WHT payable — ภ.ง.ด.53 · 2232 WHT payable — ภ.ง.ด.3 · 2310 Customer advances / contract liabilities (เงินรับล่วงหน้าจากลูกค้า) · 2320 Customer credit balances (store credit, shortage credits) · 2330 Loyalty points liability · 2340 Unapplied receipts · 2410 Accrued expenses.
**3 Equity** — 3100 Share capital · 3200 Retained earnings · 3300 Current-year profit (system).
**4 Revenue** — 4110 Sales — made-to-order packaging · 4120 Sales — standard products · 4130 Design services · 4140 Mockup / sample fees · 4150 Shipping income · 4160 Extra revision / service fees · 4910 Sales discounts & promotions (contra) · 4920 Sales returns & allowances (contra) · 4930 Points redemption (contra) · 4990 Other income (points expiry, rounding, forfeited deposits).
**5 Cost of sales** — 5110 Production cost — partner factories · 5120 Shipping cost — factory delivery payout · 5130 Shipping cost — external carriers (fallback) · 5140 Design outsourcing · 5150 Mockup / sample cost · 5190 Claim costs net of recoveries.
**6 Operating expenses** — 6110 Payment gateway fees · 6120 Promotion & loyalty expense · 6130 Bad debts · 6140 Bank charges · 6900 Other.
Each account: type, normal side, `is_control` (only sub-ledgers post to control accounts: 1210, 2110, 2120, 1250), dimensions allowed.

**Dimensions on every journal line**: entity, order / order group, customer, factory, product type, channel (web / CS / LINE / B2B), campaign / promotion, cost centre. Management reports (margin per factory, per product type, per campaign) come from dimensions, not extra accounts.

## 4. Documents & numbering
| Code | Document (TH) | Issued by | Numbering |
|---|---|---|---|
| QT | ใบเสนอราคา | Packio | per entity / year |
| IV | ใบแจ้งหนี้ (per instalment or credit-term invoice) | Packio | per entity / year |
| TR | ใบกำกับภาษี/ใบเสร็จรับเงิน (instalment or full, full-form for juristic customers) | Packio | per entity / month, **gapless** |
| RC | ใบเสร็จรับเงิน (credit-term collection) | Packio | per entity / month, gapless |
| CN / DN | ใบลดหนี้ / ใบเพิ่มหนี้ | Packio | per entity / month, gapless |
| PO | ใบสั่งผลิต/ใบสั่งซื้อถึงโรงงาน | Packio | per entity / year |
| GR | ใบรับมอบงาน (from POD + reported quantity) | system | per entity / year |
| BS | ใบวางบิล (generated, factory confirms) | system for factory | per factory |
| VI | Vendor tax invoice (factory's own number recorded) | factory | factory's series |
| PV | ใบสำคัญจ่าย (payout / vendor payment) | Packio | per entity / month |
| WT | หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) issued to factories/vendors | Packio | per entity / year |
| JV | ใบสำคัญทั่วไป (manual journal) | Packio | per entity / month |
Gapless series use a locked sequence row per (entity, type, period) inside the posting transaction; voided documents keep their number with status `void` and a reason. Collective Group (Thailand) starts new series at go-live (D-092).

## 5. Posting rules (default set, versioned)
Notation: Dr / Cr, amounts incl. VAT where stated. Nature = hire of work unless stated.
| # | Event | Journal |
|---|---|---|
| P01 | Instalment / deposit paid by gateway (before delivery) — tax invoice/receipt TR issued | Dr 1131/1132 gross · Cr 2310 net of VAT · Cr 2210 VAT |
| P02 | Instalment paid by slip transfer (verified) | Dr 1133 gross · Cr 2310 · Cr 2210 |
| P03 | Customer withholds tax on a payment | Dr 1230 WHT · (reduces the cash/clearing debit in P01/P02/P08 by the same amount) |
| P04 | Gateway settlement arrives in bank | Dr 112x net · Dr 6110 fee · Dr 1241 VAT on fee (when fee tax invoice recorded) · Cr 1131/1132 gross |
| P05 | Slip transfer matched to bank statement | Dr 112x · Cr 1133 |
| P06 | Delivery confirmed (POD) — revenue recognised, final TR for remaining value | Dr 2310 instalments applied · Dr 1210 remaining gross · Cr 41xx revenue (full net value by line type) · Cr 2210 VAT on remaining value · Cr 4150 shipping income (own line) |
| P07 | Credit-term (B2B) invoice at delivery | Dr 1210 · Cr 41xx · Cr 2211 VAT not yet due |
| P08 | Collection of credit-term invoice (RC) | Dr 112x/113x (net of WHT) · Dr 1230 WHT · Cr 1210 ; and Dr 2211 · Cr 2210 (VAT becomes due) |
| P09 | Promotion / coupon discount (on the document) | Revenue posted gross, discount to 4910 (so campaigns are measurable); VAT on the discounted amount |
| P10 | Points issued on a paid order | Dr 6120 · Cr 2330 at the point value (D-131: THB 2.50) × points × expected redemption rate (config, default 100 %) |
| P11 | Points redeemed at checkout | Dr 2330 · Cr 4930 (price reduction; VAT on the net price) |
| P12 | Points expired | Dr 2330 · Cr 4990 |
| P13 | Factory job accepted — PO committed | memo only (commitment, no GL) |
| P14 | Advance payout to factory (30 % default) | Dr 1250 net · Dr 1241/1242 VAT per factory tax invoice · Cr 112x cash · Cr 2231 WHT |
| P15 | Delivery confirmed (GR from POD + reported quantity) | Dr 5110 production cost (actual qty × unit cost) · Dr 5120 shipping payout · Cr 2110 |
| P16 | Apply advance to payable | Dr 2110 · Cr 1250 |
| P17 | Final payout after claim window | Dr 2110 · Dr 1241 VAT (if not already) · Cr 112x · Cr 2231 WHT · Cr 2130 retention (5 % default) |
| P18 | Retention released | Dr 2130 · Cr 112x |
| P19 | Quantity shortage within tolerance (D-021) | Customer: CN → Dr 4920 · Dr 2210 · Cr 2320 store credit (or Cr 112x refund) ; Factory: payable already based on actual qty (P15) |
| P20 | Claim approved — factory liable | Customer side as P19 (credit/refund/re-production) ; Factory: Dr 2110 or 1260 · Cr 5190 recovery (factory issues its credit note) |
| P21 | Claim — carrier liable (fallback carrier) | Dr 1270 · Cr 5190 |
| P22 | Refund via gateway | Dr 2310/2320/4920 · Dr 2210 (with CN) · Cr 1131/1132 |
| P23 | Order cancelled after deposit (before production) | CN against the instalment TR → Dr 2310 · Dr 2210 · Cr refund channel or 2320 store credit ; forfeited deposit (if policy) → Cr 4990 |
| P24 | Re-production caused by factory | New PO to the same factory at zero or agreed price; no customer revenue |
| P25 | Fallback carrier bill | Dr 5130 · Dr 1241 · Cr 2120 · Cr 2231 WHT 1 % at payment |
| P26 | Freelance designer (individual) | Dr 5140 · Cr 2120 ; payment Cr 2232 WHT |
| P27 | Month-end VAT close (ภ.พ.30) | Dr 2210 · Cr 1241 · Cr/Dr 2220 net ; payment Dr 2220 · Cr 112x |
| P28 | WHT remittance (ภ.ง.ด.3 / 53) | Dr 2231/2232 · Cr 112x |
| P29 | Unidentified receipt → matched later | Dr 112x · Cr 1140 ; match: Dr 1140 · Cr 2310/1210 |
| P30 | Bad-debt allowance / write-off | Dr 6130 · Cr 1219 ; write-off Dr 1219 · Cr 1210 |
Each rule is data (`posting_rules` + versions) with unit tests: every event fixture must produce a balanced entry, the expected accounts, and the expected tax report lines.

## 6. Sub-ledgers & processes
- **Customer AR**: instalment schedule per order/group, dunning (LINE/email reminders), credit limits & overdue blocking (B2B), aging, statements, store-credit wallet, customer WHT certificate tracking.
- **Supplier AP**: factory PO (system cost snapshot), GR from POD + quantity, generated billing statement → factory confirmation → factory tax invoice captured → payable; claim deductions; retention; vendor statements; 50 ทวิ generation.
- **Payout** (D-022): policy per factory (advance %, trigger events, claim window, retention %, retention release period); payout run = selection → proposal (Finance) → approval (executive) → bank bulk-transfer file (bank chosen by the business; format adapter per bank) → bank confirmation import → posting; exceptions queue.
- **Cash & bank**: bank statement import (CSV/API per bank), gateway settlement reports (2C2P, SCB), auto-matching rules (amount + reference + date window), unmatched queue, daily cash position.
- **Slip verification** (D-044): automatic via a slip-verification provider adapter (e.g. Slip2Go, SCB slip verify) — checks receiver account, amount, date, and **duplicate transaction reference**; pass → P02 automatically; fail/mismatch → Finance queue with 4-business-hour SLA.
- **Tax**: sales tax report, purchase tax report, ภ.พ.30 working paper, ภ.ง.ด.3 / ภ.ง.ด.53 working papers and attachment files, 50 ทวิ register, customer WHT certificate register, e-Tax output (R2). Tax calendar with reminders (due dates configurable).
- **GL**: journals (auto + manual with approval + recurring + reversing), trial balance, GL detail, balance sheet, P&L (by dimension), cash-flow (indirect, R2), period close.

## 7. Period close checklist (built into the app, each step with owner & evidence)
1. All gateway settlements and bank statements imported; unmatched items < threshold or explained.
2. Slip queue empty; unidentified receipts reviewed.
3. Deliveries with POD but no GR = 0; GR without factory tax invoice listed (input VAT pending).
4. Customer invoices due but unpaid reviewed; allowance for doubtful accounts updated (P30).
5. Points liability roll-forward reviewed; retention roll-forward reviewed.
6. Accruals for known unbilled costs (manual JV with approval).
7. VAT and WHT working papers generated and reconciled to GL control accounts (difference must be 0).
8. Sub-ledger ↔ GL reconciliation (AR, AP, advances, retention, customer advances): difference must be 0.
9. Soft close → finance manager review → close → lock after auditor sign-off (year-end).

## 8. Internal controls & audit
- **Maker-checker** on: manual journals, credit notes, refunds, write-offs, payout runs, changes to factory **bank accounts** (dual approval + verification call logged; highest fraud risk), changes to posting rules, chart of accounts, tax settings, document series.
- **SoD matrix** (enforced): the person who creates a payout run cannot approve it; the person who records a vendor bill cannot change that vendor's bank account; CS can request but not issue credit notes above a limit.
- **Superadmin** configures thresholds (margin floor, discount limits, payout policies) with every change audited and effective-dated.
- **Auditor role** (read-only, time-boxed): trial balance, GL detail, document registers, audit-trail export, sample selection helper (random/stratified samples of documents with attachments), PBC (prepared-by-client) export pack per period.
- Exception reports: gaps in gapless series, entries posted outside business hours, reversals, manual journals by user, back-dated documents, duplicate vendor bank accounts, duplicate slip references, credit notes after period end, payouts to vendors without valid tax invoice.

## 9. Implementation placement
- `packio-api`: `modules/ledger` (accounts, periods, journals, posting engine, rules), `modules/receivables`, `modules/payables` (PO, GR, billing statements, vendor invoices), `modules/payouts`, `modules/banking` (statements, matching, bulk-transfer adapters), `modules/tax` (reports, certificates, e-Tax), integration adapters (slip verification, bank formats). Postings are triggered by domain events through the outbox — never inline in controllers.
- `packio-web` admin zone: Finance workspace (queues: slips, unmatched bank lines, payout proposals, approvals, missing tax invoices, missing 50 ทวิ), documents, AR/AP, payout runs, bank reconciliation, tax reports, GL & reports, period close, settings (CoA, rules, tax, series, policies), auditor view.
- Release: R1 includes §2–§8 except fixed assets, cash-flow statement and e-Tax enablement (R2).

## 10. Items that need the company's accountant / auditor (⚖)
Nature per product type (§2) · deposit and instalment tax invoices · customer and factory WHT rates · shipping as a separate line and its WHT · points liability method · forfeited deposit policy · e-Tax registration timing · opening balances (none expected — new business) · chart-of-accounts codes · revenue recognition point (POD) · allowance method.

## 11. Worked example
**VAT flow (principal model, hire of work, VAT 7 %)**
| Leg | Net | VAT | Gross | Document |
|---|---|---|---|---|
| Customer → Collective Group | 100.00 | 7.00 (output VAT) | 107.00 | TR by Collective Group, Packio brand |
| Collective Group → factory | 80.00 | 5.60 (input VAT) | 85.60 | Factory's tax invoice to Collective Group |
| VAT remitted by Collective Group (ภ.พ.30) | | **1.40** | | = 7.00 − 5.60 |
If the customer is a juristic person withholding 3 %: customer pays 107.00 − 3.00 = 104.00 cash + 50 ทวิ for 3.00 (WHT receivable). Collective Group withholding 3 % on the factory: pays 85.60 − 2.40 = 83.20 cash + issues 50 ทวิ for 2.40 (filed in ภ.ง.ด.53). Gross margin = 100.00 − 80.00 = 20.00 (before gateway fees, shipping margin and promotions). If the factory is **not VAT-registered**, the 80.00 has no input VAT and Collective Group still remits 7.00 — the price table of a non-VAT factory must therefore be compared on a VAT-inclusive basis in factory selection (the calculator's factory comparison must use *effective cost to Collective Group*).

**No cut-over.** Packio is a new business under Collective Group (Thailand) with no orders in flight (D-092); all document series start at go-live.
