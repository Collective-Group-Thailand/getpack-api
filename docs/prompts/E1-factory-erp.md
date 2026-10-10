# E1 — Factory ERP ("Packio Factory"): blueprint and run order

> Track **E** (ERP), asked for by the product owner on 2026-10-10: *"the partner portal should be a
> full ERP for the factory — stock, purchasing, planning, shop floor, sales, accounting documents,
> documents, maintenance, trading partners — so a factory that also sells on its own never needs
> another system and stays our partner for the long run."* The owner delegated every open choice
> ("decide for me, follow your recommendations"); the choices are recorded as D-316 – D-332.
> Read with `00-master-plan.md`, `decisions.md`, `api-conventions.md`, `accounting-design.md`.

---

## 1. What we are building and why

Today the partner zone serves **Packio's work at the factory** (jobs, milestones, QC, shipments,
claims, billing, payouts, prices, capacity). A factory still runs the rest of its business —
its own customers, its paper stock, purchasing, machine schedule, maintenance, sales tax documents —
in Excel, LINE and paper, or in a desktop accounting package.

**Packio Factory** turns the partner zone into the factory's operating system:

```
                    ┌──────────── Packio jobs (PO from Packio, D-073) ─────────────┐
Own customers ─▶ Sales (lead → quotation → sales order) ─┐                         │
                                                        ▼                         ▼
                                    Planning (production orders, MRP, machine schedule)
                                           │ material needs            │ operations
                                           ▼                           ▼
            Procurement (PO → goods receipt) ─▶ Inventory (stock ledger) ◀─ Shop floor (work orders, output, scrap)
                                           │                           │
                                           ▼                           ▼
             Accounting documents (tax invoice, receipt, credit note, WHT, AP/AR)   Maintenance (breakdowns, PM)
                                           │
                                  Documents (DMS) · Trading partners · Dashboards
```

Principles:
1. **One factory, one workspace** (D-316). Everything the factory enters about its *own* business
   (own customers, own selling prices, own suppliers, own costs) is **private to the factory**.
   Packio staff cannot read it; support access is a time-boxed, owner-approved grant, audited (D-317).
   Packio's own data the factory already sees is unchanged (D-142, D-141 still apply).
2. **Packio work flows in, never re-typed.** A released Packio job becomes a production order with
   its spec, quantity and due date; finishing operations completes its milestones (D-328, D-329).
3. **Built for an untrained owner first** (U5 / design language v3): plain Thai, tables, big actions,
   one screen per task, phone + tablet + desktop, offline-tolerant floor screens.
4. **Modules can be switched on per factory** (D-318) so a small factory starts with stock + planning
   and grows into sales and accounting.
5. Same engineering rules as the rest of packio-api: transactions + audit + outbox, idempotent
   writes, ETags, append-only ledgers, effective-dated settings, contract-first.

## 2. Module catalogue

| # | Module | For | Core objects | Phase |
|---|---|---|---|---|
| M1 | **Trading partners** (suppliers & own customers) | owner, purchaser, sales | `erp_trading_partners` (+contacts, addresses) | E1 |
| M2 | **Inventory** | storekeeper, planner | items, units, warehouses, stock balances, stock ledger, lots/rolls, counts, transfers, reorder points | E1 |
| M3 | **Procurement** | purchaser, owner | purchase requests (incl. auto from shortages/reorder), purchase orders, goods receipts (partial), supplier invoices (3-way match), supplier returns, price history | E1 (PO+GR), E2 (PR, invoice match, returns) |
| M4 | **Planning** | planner | production orders (from Packio jobs, sales orders, make-to-stock), bill of materials & routing, MRP (net requirements → shortages → PR), finite-capacity machine schedule (auto + drag/lock manual), what-if | E2 |
| M5 | **Shop floor** | operators, supervisors | work orders per operation and machine, dispatch list per machine, start / pause (reason) / finish with good & scrap, material issue by scan, downtime, kiosk mode | E3 |
| M6 | **Sales & CRM** | sales team | leads, opportunities (pipeline), activities & follow-ups, quotations (versions, PDF, e-signature accept link), sales orders, delivery notes, sales targets & commissions report | E4 |
| M7 | **Accounting documents** | factory accountant | quotation → invoice / tax invoice (Revenue Code s.86/4) → receipt; credit / debit notes (s.86/9–86/10); billing notes; WHT certificates (50 ทวิ) issued and received; AR/AP aging, payments; VAT purchase/sales reports (ภ.พ.30 support); export to Express / PEAK / FlowAccount; e-Tax Invoice by email later | E4 |
| M8 | **Maintenance (CMMS)** | maintenance, operators | machine register (extends `factory_machines`), breakdown requests (photo, priority), work orders, preventive plans (calendar days or run counter), spare parts from inventory, downtime → capacity and OEE | E3 |
| M9 | **Documents (DMS)** | everyone | folders, files with versions, links to any ERP record, expiry reminders (FSC, GMP, ISO, permits), access per folder | E3 |
| M10 | **Quality** | QC | incoming inspection on goods receipt, in-process checks per operation, NCR / CAPA, certificates of analysis | E5 |
| M11 | **Costing & insight** | owner | job costing (material at moving average + machine hours × rate + labour), margin per own order, OEE, stock value, purchase spend, owner dashboard, LINE daily summary | E5 |
| M12 | **People-lite** | supervisor | shifts, operator skills per machine, who-worked-what (no payroll — out of scope, D-332) | E5 |
| M13 | **Platform for the factory** | owner | module switches, document numbering & templates (logo, tax id, branch), approval thresholds, roles (new: storekeeper, purchaser, sales, maintenance), Excel import of opening stock / partners / items, audit log, data export | E1 |

Explicitly **out of scope** (D-332): payroll, full general ledger and financial statements (export
instead), fixed-asset depreciation, multi-currency, consolidation, e-commerce storefront for the
factory's own customers (they stay Packio customers if they buy online).

## 3. Key flows

### 3.1 Packio job → stock → schedule → floor (E1–E3)
1. `production_job.released` (existing event) → subscriber creates `erp_production_orders(source=packio_job)`
   with the spec snapshot's materials (board/paper by `materialId`, sheets/area by the drawing),
   quantity and due date (`promisedShipDate − buffer`).
2. MRP (on demand, nightly and on every stock/PO change): gross need − on hand − on order + reserved
   = shortage per item and date → suggestion "สั่งซื้อ" with the default supplier and lead time.
3. Accepting the Packio job (existing action) reserves material; the schedule places operations on
   machines (forward, finite, business hours D-292, maintenance blocks M8).
4. Operators finish operations on the floor; the matching Packio milestones complete with the same
   quantities (no double entry); material issue posts stock movements.

### 3.2 Own sale (E4)
Lead → quotation (factory's own prices; optional "price with Packio's calculator" later) → customer
accepts by link → sales order → production order (make-to-order) or stock allocation → delivery note
→ tax invoice → receipt → AR aging. All numbered in the factory's own series, under the factory's tax id.

### 3.3 Buy (E1–E2)
Reorder point / MRP shortage / manual → purchase request (approval above a threshold, E2) →
purchase order (PDF, send by email/LINE) → goods receipt (partial, lot/roll weights, incoming QC) →
stock in at landed unit cost → supplier invoice match (qty × price within tolerance) → payable → payment.

## 4. Data model (new schema file `prisma/schema/factory-erp.prisma`)

All tables `erp_*`, each with `factory_id` (tenant), bigint identity id + uuid `public_id`,
`row_version` on editable aggregates, created/updated by/at. No deletes: `status` (`active` /
`archived`, `draft` / `cancelled`). Ledgers are append-only (trigger, as `stock_movements`).

E1 tables:
- `erp_trading_partners` — code (per factory), kind `supplier|customer|both`, name, tax id, branch,
  contact, phone, email, address, payment terms (days), credit limit, note, status.
- `erp_warehouses` — code, name, is_default, status. A factory gets `MAIN` on first use.
- `erp_items` — sku (per factory), name, kind `raw_material|consumable|spare_part|semi_finished|finished_good|packing`,
  optional `material_id` → platform `materials` (so Packio job specs map to stock), base unit,
  purchase unit + factor, reorder point / quantity, lead-time days, default supplier, track lots,
  last purchase price, status.
- `erp_stock_balances` — item × warehouse: on hand, reserved, average unit cost (moving weighted
  average, D-321), value. Updated only by the stock service, in the same transaction as the movement.
- `erp_stock_movements` — append-only: kind `opening|receipt|issue|return|adjustment|count|transfer_out|transfer_in`,
  signed base quantity, unit cost, value, balance after, average cost after, lot no, source
  (type + public id + document no), reason, occurred at, by.
- `erp_purchase_orders` / `erp_purchase_order_lines` — number, supplier, dates, VAT mode
  (`exclusive|inclusive|none`), rate, totals, status `draft|issued|partially_received|received|closed|cancelled`,
  per line: item, description, quantity, unit, factor, unit price, discount, amount, received.
- `erp_goods_receipts` / `erp_goods_receipt_lines` — number, PO (optional), supplier, warehouse,
  supplier delivery note no, received on, per line: PO line, item, quantity (purchase unit), base quantity,
  unit cost, lot no; posting creates `receipt` movements.
- `erp_document_series` — factory × document type × year: prefix, next number (row-locked).
- `erp_factory_settings` — enabled modules, PO approval threshold, numbering prefixes,
  document template (logo file, footer), allow negative stock (false).

Later phases add: `erp_purchase_requests(+lines)`, `erp_supplier_invoices`, `erp_boms`,
`erp_routings`, `erp_production_orders(+materials, +operations)`, `erp_schedule_slots`,
`erp_work_logs`, `erp_downtimes`, `erp_leads`, `erp_opportunities`, `erp_activities`,
`erp_quotations(+lines)`, `erp_sales_orders(+lines)`, `erp_delivery_notes`, `erp_invoices(+lines)`,
`erp_receipts`, `erp_credit_notes`, `erp_wht_certificates`, `erp_payments`, `erp_maintenance_requests`,
`erp_pm_plans`, `erp_documents(+versions, links)`, `erp_inspections`.

## 5. API surface (partner zone, `/v1/partner/factories/{factoryId}/erp/...`)

Factory in the path (style (a), `FactoryAccess.factory`), so every row is checked against the
caller's factory scope and another factory's id is 404 (D-044). Tags `partner.erp*`.

E1 endpoints:
| Operation | Method & path | Permission |
|---|---|---|
| `partner.erpPartners.list/create/get/update` | `GET/POST …/erp/partners`, `GET/PATCH …/erp/partners/{partnerId}` | `factory_trading_partners.read/manage` |
| `partner.erpItems.list/create/get/update` | `…/erp/items[/{itemId}]` | `factory_inventory.read/manage` |
| `partner.erpWarehouses.list/create/update` | `…/erp/warehouses[/{warehouseId}]` | `factory_inventory.read/manage` |
| `partner.erpStock.list` | `GET …/erp/stock` (balances, filters: low, kind, warehouse, q) | `factory_inventory.read` |
| `partner.erpStock.movements` | `GET …/erp/stock/movements` (item, warehouse, kind, from/to) | `factory_inventory.read` |
| `partner.erpStock.adjust` | `POST …/erp/stock/actions/adjust` (opening / adjustment / count, idempotent) | `factory_inventory.adjust` |
| `partner.erpStock.issue` | `POST …/erp/stock/actions/issue` (issue / return to stock) | `factory_inventory.manage` |
| `partner.erpStock.transfer` | `POST …/erp/stock/actions/transfer` | `factory_inventory.manage` |
| `partner.erpStock.reorder` | `GET …/erp/stock/reorder` (items at or below reorder point with suggested qty and supplier) | `factory_procurement.read` |
| `partner.erpPurchaseOrders.list/create/get/update` | `…/erp/purchase-orders[/{poId}]` (draft editable) | `factory_procurement.read/manage` |
| `partner.erpPurchaseOrders.issue/cancel/close` | `POST …/{poId}/actions/{issue|cancel|close}` | `factory_procurement.approve` (issue), `.manage` |
| `partner.erpGoodsReceipts.list/create/get` | `…/erp/goods-receipts[/{grId}]` (create = post) | `factory_inventory.manage` |
| `partner.erpSettings.get/update` | `…/erp/settings` | `factory_profile.read` / `factory_erp.configure` |

## 6. Roles and permissions (D-319)
New permissions (audience partner, factory-scoped): `factory_trading_partners.read|manage`,
`factory_inventory.read|manage|adjust`, `factory_procurement.read|manage|approve`, `factory_erp.configure`;
later `factory_planning.*`, `factory_floor.*`, `factory_sales.*`, `factory_accounting.*`,
`factory_maintenance.*`, `factory_documents.*`.
New factory roles: **factory_storekeeper** (เจ้าหน้าที่คลังสินค้า), **factory_purchaser** (เจ้าหน้าที่จัดซื้อ);
later **factory_sales** (ฝ่ายขาย), **factory_maintenance** (ช่างซ่อมบำรุง). Grants in D-319.

## 7. Run order
| Phase | Scope | Exit |
|---|---|---|
| **E1** | M13 basics (settings, numbering, roles), M1 trading partners, M2 inventory, M3 PO + goods receipt, reorder list; web: ระบบคลัง / จัดซื้อ / คู่ค้า sections | contract released, web adopted, e2e on phone |
| **E1.1** | Item suppliers (unit, minimum order, lead time, latest price), price history, cheapest/on-time statistics (D-333 – D-335) | done v0.45.0 |
| **E2** | Purchase requests + approval, supplier invoices 3-way matched + payments + aging, recipes, production orders from Packio jobs / stock / sales orders with reservations, issues and completion at cost, floor operations, MRP shortages → PR (D-336 – D-343) | done v0.45.0 — Packio job reserves stock |
| **E2.1** | Quantity breaks, price-rise and quotation-expiry alerts, RFQs with a comparison and award, receiving inspection and supplier scores, landed cost, approved supplier list (D-346 – D-351) | done v0.46.0 |
| **E3** | Machine schedule (auto + manual), shop floor kiosk, maintenance, DMS (D-352 – D-358) | done v0.46.0 — operators run a day without paper |
| E4 | Sales & CRM, accounting documents, AR/AP, VAT/WHT reports, exports | first own tax invoice issued |
| E5 | Quality, costing, OEE, owner dashboard, LINE summaries, people-lite | owner dashboard live |
| E6 | Factory general ledger, financial statements, tax returns, fixed assets, bank reconciliation (D-344; `E6-factory-general-ledger.md`) | first month closed with a CPA |

## 8. Definition of done (per phase)
Same as `00-master-plan.md` §8, plus: every ERP read is factory-scoped (e2e: another factory's id → 404,
a Packio staff token → 403 on private ERP data, D-317), stock ledger invariants tested
(sum of movements = balance; no negative stock unless allowed), money and quantity rounding tested.

## 9. E1.1 + E2 as built (v0.45.0)
- Tables: `erp_item_suppliers`, `erp_price_records` (append-only), `erp_purchase_requests` / `_lines`,
  `erp_supplier_invoices` / `_lines`, `erp_supplier_payments` + `erp_payment_allocations` (append-only, reversal by
  a negative payment), `erp_recipes` + `_materials` + `_operations`, `erp_production_orders` + `_materials` +
  `_operations`; settings `price_tolerance_pct`, `require_request_approval`; series PR, AP, PV, MO; movement kinds
  `production_issue`, `production_return`, `production_receipt`.
- Endpoints: `items/{id}/suppliers`, `items/{id}/prices`, `partners/{id}/items`, `purchase-requests` (+ submit,
  approve, reject, cancel, convert), `supplier-invoices` (+ aging, approve, cancel), `supplier-payments` (+ reverse),
  `recipes`, `production-orders` (+ release, issue, return, complete, cancel, operations start/finish/skip),
  `planning/overview`, `planning/queue`, `planning/mrp` (+ request).
- Subscribers: `production_job.accepted` → production order; `.rejected` / `.reassigned` → cancel;
  `.completed` → complete (consumers `factory_erp.*`, run by the worker).
- Not yet (later phases): per-lot balances, finite-capacity scheduling and drag (E3), labour/overhead costing (E5),
  supplier credit notes and 50 ทวิ printing (E4), posting to a factory ledger (E6).

## 10. E2.1 + E3 as built (v0.46.0)
- Tables: `erp_price_breaks`, `erp_alerts` (one per `dedupe_key`), `erp_rfqs` + `_lines` + `_suppliers` +
  `_quotes`, `erp_landed_charges` + `_lines` (append-only), `erp_operation_events` (append-only),
  `erp_maintenance_plans` + `_plan_parts`, `erp_maintenance_orders` + `_photos` + `_parts` (parts append-only; one
  open preventive order per plan), `erp_doc_folders`, `erp_docs`, `erp_doc_versions` (append-only). New columns:
  settings `price_alert_pct`, `quote_expiry_days`, `supplier_approval`; item suppliers `approval`, `approved_*`,
  `review_on`, `breaks_valid_until`; receipt lines `rejected_quantity`, `reject_reason`, `landed_amount`; receipts
  `charges_total`; operations `scheduled_start/end`, `locked`, `started_at`, `finished_at`, `paused_at`,
  `paused_minutes`, `job_milestone_id`, `milestone_sync(_error)`. Series RFQ, MT; movement kinds `landed_cost` (no
  quantity) and `maintenance_issue`; operation status `paused`. Existing supplier links were approved on migration.
- Endpoints (tags `partner.erpItemSuppliers`, `erpAlerts`, `erpRfqs`, `erpMachines`, `erpSchedule`,
  `erpMaintenance`, `erpDocuments`): price breaks, approve / suspend, supplier scorecard, landed charge on a receipt;
  alerts (+ count, acknowledge, acknowledge all); RFQs (+ send, record quote, decline, comparison, award, cancel);
  machines (+ dispatch for the kiosk); schedule (+ auto-plan, move, lock), operations pause / resume / events;
  maintenance orders (+ breakdown report, schedule, start, parts, finish, cancel) and plans (+ open now); document
  folders and documents (+ versions). Goods receipts take rejected quantities and charges; POs show warnings.
- Scheduled jobs: `factory_erp.sourcing_alerts` (07:10), `factory_erp.maintenance_due` (07:15),
  `factory_erp.document_expiry` (07:20), Bangkok. Subscriber `production_job.milestone_completed` → the
  operation that stands for the milestone is done. Notification matrix rows `erp_alert.*` (factory audience).
- Not yet: printing / e-mailing an RFQ to suppliers from Packio, scanning QR codes with the camera (the kiosk
  takes a typed or scanner-typed order number), per-lot landed cost, OEE (E5).
