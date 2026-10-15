# Changelog — packio-api

Contract-facing changes per release. The contract itself is `contract/openapi.json`; mappings for `packio-web` are in
`docs/contract-requests-triage.md`.

## v0.60.0 — Every variant as a card; use cases per style

Decision D-410. Additive. New `store.styles.listVariants` (`GET /v1/store/styles/variants`, public): every shown variant
as a `StyleVariantCardDto` (code, style, options, price path, thumbnail), filtered by the style filters and by options
(`option=axis:value`, repeated or comma-separated), with disjunctive option facets and `meta.total`,
`meta.libraryTotal`, `meta.libraryStyles`. `StyleCardDto.options` lists a style's option chips (`axis:value`, closures
first). The master file carries `use_cases` per base (an import replaces curated ones) and drops PK-SP-25, the same
structure as PK-SP-05: 122 bases, 986 variants; the vendored `@packio/dieline` drops its recipe.

## v0.59.0 — Dieline download as .ai

Value set: the dieline download's `format` is now `DielineDownloadFormat` (`svg`, `dxf`, `pdf`, `ai`); `ai` is the
designer PDF delivered under Illustrator's name and type (Superball's change, merged from the Mac). Clients that
switch over the format need a default.

## v0.58.0 — Style library wave 4: 123 bases, 987 variants

Decision D-409. No contract change. The master file adds 18 bases and the axis `fold` (folded leaflets); the vendored
`@packio/dieline` draws all 987 variants with their exact options, and adds two parameters on existing styles: inserts
cut to the product (`cavityShape`, `cavityGrid`, `cavityLength`, `cavityWidth`) and a shaped display header
(`headerShape`, `headerShapeHeight`, `headerPath`). `uat:styles` imports and publishes them.

## v0.57.0 — Style library: 894 variants, every one drawn

Decision D-408. No contract change. The master file's `excluded_combinations` (66 combinations no factory can build)
are not generated; an import retires them — `styles.import` reads the new key and refuses a rule naming an unknown
axis value. The vendored `@packio/dieline` draws every remaining variant (nine new base structures; the seal top
under a hang tab). `uat:styles` / `uat:populate` approve the held import runs (Prepress, then Marketing) and publish
894 variants.

## v0.56.0 — Style page: quote a chosen variant

Decision D-407 (follow-up). Additive. `StyleDetailDto` gains `productTypeCode` (nullable): the product type the style is
priced and quoted as, so a style page can open the right RFQ form with the chosen `styleVariantCode`.

## v0.55.0 — Style library open to customers

Decision D-407. Value sets: `StylePublishReason` gains `not_drawable`; `StylePriceReason` gains `not_makeable`
(clients that switch over them need a default). Every drawn, named style variant is listed and designable; one no
factory can make yet has `pricePath: rfq` with `not_makeable`. The store card's `pricePath` is `instant` when any of
its variants is. Master `mailer` / `shrink_sleeve` bases now map to `flexible_pouch` / `label_sticker`. `uat:populate`
imports and publishes the library.

## v0.54.0 — Factory prices: line counts per component

Decision D-406. Additive. New `GET /v1/partner/factories/{factoryId}/price-list-versions/{versionId}/component-counts`
(`partner.priceLists.componentCounts`): `PriceComponentCountDto[]` (`component`, `lines`).

## v0.53.1 — Owner decisions: intake terms, UAT opening balance

Decisions D-404, D-405; D-397 / D-401 tax point confirmed. No contract change. `partner.styleIntakes.getTerms` now
returns the standard terms v1 once the reference seed has run (it filled `styles.intake_terms`, which had no
version); intakes open. `uat:populate` posts the opening stock as the opening journal.

## v0.53.0 — UX round 8: insight

Decisions D-402, D-403. `ErpDashboardDto` gains `packio` (`ErpDashPackioDto`: `confirmedNet`, `confirmedStatements`,
`toConfirm`, `toConfirmGross`, `toInvoice`). Value set: `ErpProfitBy` gains `packio_job` (rows keyed by the production
order, code = the Packio job number). OEE availability no longer reads 0 % for time run outside planned time.

## v0.52.0 — UX round 6: finance

Decision D-401. Value set: `ErpVatRowKind` gains `packio_statement` (clients that switch over it need a default). The
sales VAT report, ภ.พ.30 summary and tax export include Packio billing statements confirmed in the month; `sourceId` of
such a row is the billing statement's id.

## v0.51.0 — UX round 1: the day's work

Decisions D-399, D-400. Additive. New `GET /v1/partner/factories/{factoryId}/erp/inbox` (`partner.erpInsight.inbox`,
`factory_profile.read`): `ErpInboxDto` with `items[]` (`section` approve / overdue / today / soon, `kind`, `tone`, `count`,
`document` {type, id, number} or null, `party`, `amount`, `date`) and `counts`. Production orders from Packio jobs use the
ERP unit `pcs` (existing rows migrated).

## v0.50.0 — Ledger: Packio revenue (F14 / F15) and the rule editor

Decisions D-397, D-398. Additive. `ErpGlRuleDto` gains `pending`; `GET …/ledger/rules` now shows the version in force
today (a future-dated approved version is not shown until its day). New error `erp.ledger_version_pending` (409). Role Accountant (`factory_accountant`) gains
`factory_ledger.configure` (proposes; the owner approves).

- **Rules** (`partner.erpLedger`): `rules/{ruleId}` (versions, payload variables, purpose accounts),
  `rules/{ruleId}/actions/preview`, `rules/{ruleId}/versions` (propose), `rules/{ruleId}/versions/{versionId}/actions/
  approve|reject|withdraw`. Next-action keys `erp_rule.propose`, `erp_rule_version.approve|reject|withdraw`.
- **Posting**: rules F14 (Packio billing statement confirmed → 1132 / 4120 + 2121) and F15 (Packio payout paid → bank +
  1153 / 1132); the VAT close check and ภ.พ.30 include Packio statements.

## v0.49.0 — Packio Factory ERP E6: the factory's general ledger

Decisions D-385 – D-396. Additive except value sets: `ErpDocumentType` gains `jv`, `fa`; `FactoryRole` gains
`factory_auditor` (clients that switch over them need a default). New permissions `factory_ledger.read/post/approve/
close/configure`, `factory_tax.file`; accountant gains read, post, close and tax file; new role External auditor / CPA.
ERP events `erp_production_order.materials_issued/materials_returned/completed`, `erp_maintenance.parts_issued` and
`erp_goods_receipt.charge_added` now carry `movementIds`.

- **Ledger** (`partner.erpLedger`, `/erp/ledger/*`): `settings` (+ `PUT`), `rules`, `actions/catch-up`, `accounts`,
  `account-changes` (+ `actions/approve|reject`), `periods`, `periods/{id}/checklist`, `periods/{id}/actions/transition`,
  `fiscal-years/{id}/actions/close`, `tax-filings` (+ `POST` mark filed).
- **Journals** (`partner.erpJournals`): `journals` (list, create, get, `PUT`, `DELETE`, `actions/submit|approve|reject|
  reverse`), `exports/journals` (CSV link), `recurring-journals` (+ `PUT`, `actions/run`).
- **Reports** (`partner.erpLedgerReports`): `reports/trial-balance`, `general-ledger`, `profit-and-loss`,
  `balance-sheet`, `cash-flow`, `stock-valuation`.
- **Fixed assets** (`partner.erpFixedAssets`): `asset-categories` (+ `PUT`), `fixed-assets` (+ get,
  `actions/dispose`), `depreciation-runs` (list, `POST` run a month).
- **Bank** (`partner.erpBank`): `bank-accounts` (+ `PUT`, `statements` import), `bank-lines` (+ `actions/match|
  ignore|unmatch`), `cash-position`.

## v0.48.1 — ERP units

Decision D-384. Value set: `ErpUnit` gains `pouch`, `tube`, `job`, `round`, `trip` (clients that switch over it need a
default). Factory documents print them in Thai (ซอง, หลอด, งาน, รอบ, เที่ยว).

## v0.48.0 — Packio Factory ERP E5: quality, costing, OEE, the owner's dashboard, people-lite, support access

Decisions D-372 – D-383. Additive except value sets: `ErpAlertKind` gains `ncr_overdue`, `oee_low`; `ErpModule`
gains `quality`, `insight`, `people`; `ErpMovementSource` gains `ncr` (clients that switch over them need a
default). New permissions `factory_quality.read/record/manage`, `factory_insight.read`, `factory_people.read/manage`,
`factory_support.grant` (owner only); QC, operator, storekeeper, planner, accountant and maintenance gain the read or
record grants listed in D-382. A completed production order now receives its product at full cost (materials +
machine + labour + overhead), so `ErpProductionOrder.unitCost` is that figure.

- **Quality** (`partner.erpQuality`): `inspection-templates` (list, create, get, `PUT`), `quality-checks` (list,
  create, get, `PUT` to record, `actions/override`, `coa` PDF), `ncrs` (list, create, get, `PUT`, `actions/dispose`,
  `verify`, `close`, `cancel`). A failed check opens an NCR; a scrap posts a stock adjustment out.
- **Insight** (`partner.erpInsight`): `dashboard`, `machine-rates` (+ `PUT machine-rates/{machineId}`),
  `production-orders/{orderId}/cost`, `insight/costs?month=`, `insight/profitability?month=&by=`,
  `insight/oee?from=&to=`.
- **People** (`partner.erpPeople`): `shifts` (+ `PUT`), `operator-skills` (`PUT` upsert, `DELETE`), `work-log`,
  `support-grants` (+ `actions/revoke`).
- **Admin** (`admin.erpSupport`): `GET /v1/admin/factories/{factoryId}/erp/support-view` (`partners.read`, only under
  an active grant; audited).
- Settings gain `labourRatePerHour`, `overheadPct`, `dailySummary`, `oeeAlertPct`; the supplier score gains `ncrs`.
- Notifications: `erp_alert.ncr_overdue`, `erp_alert.oee_low`, `erp_daily.summary` (LINE, to roles with
  `factory_insight.read`; the factory audience honours a `recipientRoles` payload).
- Errors: `erp.check_not_passed`, `erp.ncr_action_required`, `erp.support_grant_active`, `erp.support_not_granted`.

## v0.47.0 — Packio Factory ERP E4: CRM, quotations, sales orders, delivery notes, invoices, receipts, tax

Decisions D-359 – D-371. Additive except value sets: `ErpMovementKind` gains `sales_issue` and `sales_return`,
`ErpMovementSource` gains `delivery_note` and `sales_note`, `ErpAlertKind` gains `quote_follow_up`,
`invoice_overdue`, `activity_overdue` (clients that switch over them need a default). New factory role
`factory_sales`; new permissions `factory_sales.*`, `factory_delivery.manage`, `factory_receivables.*`,
`factory_tax.read`.

- **CRM**: `leads` (+ `actions/convert`, `actions/lose`), `opportunities` (+ `actions/win`, `actions/lose`),
  `pipeline`, `activities` (+ `actions/complete`), `salespeople`.
- **Quotations**: `quotations` (list, create, get, `PUT`), `actions/send` (returns the customer link), `revise`,
  `accept`, `reject`, `cancel`, `order`, `pdf`. Public `GET /v1/store/quote-links/{token}`, `POST …/actions/accept`,
  `POST …/actions/decline` (no account; throttled).
- **Sales orders and delivery**: `sales-orders` (+ `confirm` with `overrideReason` past the credit limit, `close`,
  `cancel`, `pdf`); `delivery-notes` (+ `issue`, `deliver`, `cancel`, `pdf`).
- **Receivables**: `sales-invoices` (+ `PATCH`, `DELETE` draft, `issue`, `void`, `pdf`), `sales-notes` (+ `issue`,
  `void`, `DELETE` draft, `pdf`), `receipts` (+ `cancel`, `pdf`), `billing-notes` (+ `cancel`, `pdf`),
  `receivables/aging`.
- **Tax**: `supplier-payments/{paymentId}/wht`, `wht-certificates` (+ `void`, `pdf`), `tax/sales-vat`,
  `tax/purchase-vat`, `tax/vat30`, `tax/wht?form=`, `tax/exports`, `sales/report`, `PUT sales/targets`.
- Settings gain `quoteValidDays`, `documentLogoFileId`, `documentFooter`, `bankDetails`, `signatoryName`; trading
  partners `entityType`, `salesperson`. Reason bodies use the common `ReasonDto`.
- Errors: `erp.credit_limit_exceeded`, `erp.quotation_expired`, `erp.over_delivery`, `erp.invoice_date_order`,
  `erp.note_exceeds_invoice`, `erp.allocation_exceeds_open`, `erp.document_settled`, `erp.nothing_to_deliver`,
  `erp.nothing_to_invoice`, `erp.no_withholding`, `erp.recipe_required`, `erp.customer_required`,
  `erp.seller_incomplete`.

## v0.46.0 — Packio Factory ERP E2.1 + E3: sourcing, machine schedule, kiosk, maintenance, documents

Decisions D-346 – D-358 (D-344, the E6 plan, is now accepted). Additive except value sets: `ErpMovementKind` gains
`landed_cost` and `maintenance_issue`, `ErpMovementSource` gains `maintenance_order`, `ErpOperationStatus` gains
`paused` (clients that switch over them need a default). New factory role `factory_maintenance`.

- **Sourcing (E2.1)**: `PUT items/{itemId}/suppliers/{linkId}/price-breaks` (If-Match), `POST …/actions/approve`,
  `…/actions/suspend`, `GET partners/{partnerId}/scorecard`, `POST goods-receipts/{grId}/charges`.
  `ErpItemSupplierDto` gains `approval`, `approvalNote`, `approvedAt`, `approvedBy`, `reviewOn`, `priceBreaks`,
  `breaksValidUntil`, `score`. `ErpCreateGoodsReceiptDto` gains `charges[]`; its lines `rejectedQuantity`,
  `rejectReason`; `ErpGoodsReceiptDto` gains `chargesTotal`, `charges[]`, `nextActions` (`erp_gr.add_charge`), lines
  `rejectedQuantity`, `rejectReason`, `landedAmount`, `landedUnitCost`. `ErpPurchaseOrderDto.warnings[]`
  (`supplier_not_approved`, `supplier_suspended`, `price_rise`). Settings gain `priceAlertPct`, `quoteExpiryDays`,
  `supplierApproval` (`off` / `warn` / `enforce`); issuing a PO under `enforce` may answer `erp.supplier_not_approved`.
- **Alerts**: `alerts` (paginated; `status`, `kind`), `alerts/count`, `alerts/{id}/actions/acknowledge`,
  `alerts/actions/acknowledge-all`; notifications `erp_alert.*` to the factory's users.
- **Requests for quotation**: `rfqs` (list, create, get, `PUT`), `actions/send`, `suppliers/{rfqSupplierId}/quote`
  (`PUT`), `suppliers/{rfqSupplierId}/actions/decline`, `comparison`, `actions/award`, `actions/cancel`
  (`nextActions` `erp_rfq.*`).
- **Machines and floor (E3)**: `machines` (list, create, get, `PATCH`), `machines/{machineId}/dispatch`;
  `schedule`, `schedule/actions/auto-plan`, `production-orders/{moId}/operations/{operationId}/schedule` (`PUT`),
  `…/actions/lock`, `…/actions/pause`, `…/actions/resume`, `…/events`. `ErpProductionOperationDto` gains
  `scheduledStart`, `scheduledEnd`, `locked`, `startedAt`, `finishedAt`, `pausedMinutes`, `actualMinutes`,
  `pauseReason`, `milestone`, `milestoneSync`, `milestoneSyncError`. Finishing takes `note` and `photoFileIds`;
  starting / resuming on a machine with an open breakdown answers `erp.machine_down`. Production orders of Packio
  jobs now carry one operation per job milestone.
- **Maintenance**: `maintenance/orders` (list), `maintenance/orders/breakdowns`, `maintenance/orders/{mtId}`
  (+ `actions/schedule|start|parts|finish|cancel`, `nextActions` `erp_mt.*`), `maintenance/plans` (list, create,
  get, `PUT`, `actions/open`).
- **Documents**: `documents/folders` (list, create, `PATCH`, `DELETE`), `documents` (list, create, get, `PATCH`),
  `documents/{docId}/versions`.
- New problem codes: `erp.supplier_not_approved`, `erp.machine_down`, `erp.file_not_usable`, `erp.folder_exists`,
  `erp.folder_not_empty`. New permissions: `factory_maintenance.read/report/manage`, `factory_documents.read/manage`.

## v0.45.2 — production orders offer an issue only while something is left to issue

- `ErpProductionOrderDto.nextActions`: `erp_mo.issue` is offered only while a material's required quantity is not
  fully issued (it was offered on every running order, and the call then failed with `erp.nothing_to_issue`).

## v0.45.1 — contract fix: production movements name their source

- `ErpStockMovementDto.sourceType` (`ErpMovementSource`) gains `production_order`: the movements a production order
  posts (`production_issue`, `production_return`, `production_receipt`, D-341) name it; v0.45.0 returned the value
  without listing it. Clients that switch over the source need a default.

## v0.45.0 — Packio Factory ERP E1.1 + E2: supplier prices, purchase requests, payables, production, MRP

All changes are additive except one value set: `ErpMovementKind` gains `production_issue`, `production_return`,
`production_receipt` (clients that switch over movement kinds need a default). Decisions D-333 – D-345; the plan
for a factory general ledger is `docs/prompts/E6-factory-general-ledger.md` (D-344, proposed).

- **Supplier prices (E1.1)**: `items/{itemId}/suppliers` (list, add, `PATCH` with If-Match), `items/{itemId}/prices`
  (history, paginated; `POST` a quotation or a noted price), `partners/{partnerId}/items` — tag
  `partner.erpItemSuppliers`. Each link: supplier code / name, unit and factor, minimum order, lead time, latest
  price and per base unit, preferred, cheapest, quotation validity, 12-month min / avg / max, change %, on-time %,
  average lead days. Issued POs and goods receipts write the history; POs and receipts accept the supplier's unit.
  The reorder list and drafts from it use the preferred supplier's unit, minimum order and price.
- **Purchase requests**: `purchase-requests` (+ `actions/submit|approve|reject|cancel|convert`, `nextActions`
  `erp_pr.*`).
- **Payables**: `supplier-invoices` (3-way match → `matched` / `variance`, WHT, due date; `aging`,
  `actions/approve|cancel`, `erp_ap.*`), `supplier-payments` (allocations, `actions/reverse`, `erp_pay.reverse`).
- **Production**: `recipes`, `production-orders` (+ `actions/release|issue|return|complete|cancel`,
  `operations/{id}/actions/start|finish|skip`, `erp_mo.*`), `planning/overview`, `planning/queue`, `planning/mrp`
  (+ `actions/request`). An accepted Packio job becomes a production order automatically (worker consumer
  `factory_erp.job_to_production_order`).
- `ErpSettingsDto` / `UpdateErpSettingsDto`: `priceTolerancePct`, `requireRequestApproval`; prefixes include
  `pr`, `ap`, `pv`, `mo`.
- New permissions `factory_procurement.request`, `factory_ap.read/manage/approve`, `factory_planning.read/manage`,
  `factory_production.record`; role grants per D-343.
- New problem codes `erp.supplier_linked`, `erp.invoice_duplicate`, `erp.invoice_not_payable`, `erp.overpayment`,
  `erp.nothing_to_issue`, `erp.materials_issued`, `erp.nothing_to_request`.
- Migration `20261201000001_factory_erp_e2` (14 tables, 3 append-only triggers, 30 checks). `db:seed:uat` adds supplier
  links with price history, a second paper supplier, a product recipe and a planned production order.

## v0.44.0 — Packio Factory ERP, phase E1: trading partners, inventory, purchasing

All changes are additive. Blueprint `docs/prompts/E1-factory-erp.md`; decisions D-316 – D-332.

- New partner endpoints under `/v1/partner/factories/{factoryId}/erp/*` (tags `partner.erp*`), factory-private
  (D-317): `settings` (get / patch with ETag), `partners` (suppliers and the factory's own customers),
  `warehouses`, `items` (with stock across warehouses), `stock` (balances, `overview`, `movements` ledger,
  `reorder`, `actions/adjust|issue|transfer` — idempotent), `purchase-orders` (draft, edit, `actions/issue|cancel|close`,
  `actions/from-reorder`, `nextActions` keys `erp_po.*`), `goods-receipts` (post, list, get).
- New permissions `factory_trading_partners.read/manage`, `factory_inventory.read/manage/adjust`,
  `factory_procurement.read/manage/approve`, `factory_erp.configure`; new factory roles **Storekeeper**
  (`factory_storekeeper`) and **Purchaser** (`factory_purchaser`) — `FactoryRole` / `FactoryStaffRole` enums grow.
- New problem codes `erp.*` (stock_insufficient, sku_taken, code_taken, invalid_status, over_receipt, lot_required,
  not_a_supplier, archived, unit_not_allowed, empty_document, same_warehouse).
- Migration `20261130000001_factory_erp` (12 tables, append-only stock ledger and goods receipts). `db:seed:uat`
  adds ERP rehearsal data to the UAT factory (F9001).

## v0.43.4 — partner UX: price components name their product types; rate lines name their zone

All changes are additive.

- `PriceComponentDto.productTypeCodes` (new, `string[]`): the product types whose calculator reads the component.
  A factory's price list for one of them offers it, others do not — packio-web drops its own copy of the mapping
  (`components-by-type.ts`, CONTRACT-GAP `partner.price-components-by-type`).
- `FactoryRateDto.zoneNameTh` / `zoneNameEn` (new): the zone as the factory reads it, beside `zoneCode`.
- Behaviour: accepting a production job completes its `job_received` step (no start-and-finish by hand).

## v0.43.3 — the whole drawing engine; engine fingerprint in the contract

All changes are additive.

- `info.x-packio-dieline` (new): the `@packio/dieline` engine the drawing service runs — `package`, `version`,
  `sourceTree` (git tree of packio-web `packages/dieline`), `packioWebCommit`, `bundleSha256`. packio-web's
  `pnpm dieline:check` compares its own engine with it in CI.
- The vendored engine now carries the whole style library (`@packio/dieline/library`): 96 bases instead of 20, so
  style recipes, dieline downloads and drawings cover every base the web draws (PK-CT-02, PK-PG-02 included).
- `docs/decisions.md` D-309: note — the homepage hero states the lowest quantity of `catalog.hero_presets`, not
  `minOrderQty.custom`; both intentional.

## v0.43.2 — hero default and style codes (**breaking for one field**)

### Breaking
- `HeroPresetsDto.defaultAdjusted` removed (`oasdiff`: response-required-property-removed). `default` is now the
  product owner's selection when the catalogue offers it and `null` otherwise — there is no adjusted state. packio-web
  reads the field only in generated types (pinned `v0.43.1`); re-run `pnpm gen:api` when adopting. The CI check needs
  the `contract:breaking` label on this change.

### Changed values
- Seeded `catalog.hero_presets`: default `{ mailer, size 0, corrE, one, 500 }`; lid `styleCode` `PK-CT-02`, tuck
  `PK-TE-01`.
- UAT / dev FAQ seed: answers no longer show decision ids; the `[DEV]` FAQ fixture is a draft.
- `docs/decisions.md`: D-314 (interim photography, accepted 2026-10-07).

## v0.43.1 — Phase 4 review follow-ups

All changes are additive (`oasdiff breaking` against `v0.43.0`: none).

### Changed fields
- `HeroShapeDto`: new `styleCode` (nullable) and `qtys[]` — the quantities that shape offers.
- `HeroPresetsDto`: new `default` (`HeroDefaultDto`: shape, sizeId, inside mm, material, print, qty; nullable) and
  `defaultAdjusted` (the owner's default is not offered by the catalogue; `default` is the nearest offered one).
- `HeroSizeDto`: ids are now `<shape>:s<index>` of the preset sizes (were `<shape>:<standard size code>`); `code` is
  `s<index>`; `labelTh` is the inside W × D × H in cm. `store.quotes.preview` returns the same `presetId`.
- Labels of shapes, boards and prints come from the setting when given.

### Behaviour
- `catalog.hero_presets` is seeded with the product owner's values; the catalogue mapping is per environment, so a
  catalogue without it offers nothing. Per shape, only boards / prints published on the product, sizes its calculator
  accepts and quantities within its limits are offered; `store.quotes.preview` refuses (409) the rest.
- The hero prices every part of a multi-part box (telescope body + lid).
- D-312 (15-minute QR) accepted; a lapsed QR is replaced by a new one on the same order group.
- `pnpm test:int` runs with a 6 GiB heap (the suite outgrew Node's default).

## v0.43.0 — Phase 4 contract (UX round 2, Homepage v10 / design language v3)

All changes are additive: no field, operation or enum value was removed or renamed.

### New operations
| Operation | Path | Notes |
|---|---|---|
| `store.publicConfig.get` | `GET /v1/store/public-config` | Anonymous, `Cache-Control: public, max-age=300`, ETag / 304 (D-309) |
| `store.catalog.getHeroPresets` | `GET /v1/store/catalog/hero-presets` | Anonymous, cached; from setting `catalog.hero_presets` (D-310) |
| `store.quotes.preview` | `POST /v1/store/quotes/actions/preview` | Anonymous, 30/min per client; same pricing path as `store.quotes.calculate` (D-310) |
| `store.statusLabels.list` | `GET /v1/store/status-labels` | Anonymous, cached (D-313) |
| `store.cms.getHome` | `GET /v1/store/cms/home` | Anonymous, cached; photos + approved customer stories (D-311) |
| `admin.cmsHomeCases.list/get/create/update/delete` | `/v1/admin/cms/home-cases` | `cms.manage` (D-311) |
| `admin.cmsHomeCases.approve` / `.withdraw` | `POST /v1/admin/cms/home-cases/{id}/actions/approve|withdraw` | `cms.cases.approve`, If-Match (D-311) |

### New schemas
`PublicConfigDto`, `MinOrderQtyDto`, `SupportHoursDto` (+ enum `SupportDays`), `ContactDto`; `HeroPresetsDto`,
`HeroShapeDto`, `HeroSizeDto`, `HeroMaterialDto`, `HeroMaterialOptionDto`, `HeroPrintDto`, `HeroPrintOptionDto`,
`HeroPreviewRequestDto`, `HeroPreviewDto` (+ enums `HeroShape`, `HeroMaterial`, `HeroPrint`); `StatusLabelEnumDto`,
`StatusLabelValueDto`; `DesignIssueDto`; `StoreHomeContentDto`, `HomePhotoDto`, `HomeCaseCardDto`; `HomeCaseDto`,
`CreateHomeCaseDto`, `UpdateHomeCaseDto` (+ enum `HomeCaseStatus`).

### New fields on existing schemas
- `statusLabelTh`, `statusLabelAdminTh` next to `status` on: `OrderDto`, `OrderGroupDto`, `OrderQueueItemDto`,
  `AdminOrderListItemDto`, `PaymentDto`, `SlipDto`, `RefundDto`, `InstalmentDto`, `ArtworkSubmissionDto`, `ProofDto`,
  `MilestoneDto`, `PartnerJobDto`, `ProgressStepDto`, `StoreShipmentDto`, `StoreShipmentEventDto`, `PartnerShipmentDto`,
  `ShipmentEventDto`, `StoreClaimDto`, `SavedQuoteDto`, `RfqDto`, `RfqQuotationDto`, `SampleDto`, `PartnerSampleDto`,
  `DesignServiceDto`, `DesignRoundDto` — and through inheritance their admin / partner / staff variants.
- `artworkStatusLabelTh`, `artworkStatusLabelAdminTh` on `OrderDto`, `OrderQueueItemDto`, `AdminOrderListItemDto`,
  `PrepressQueueItemDto`; `preflightStatusLabelTh`, `preflightStatusLabelAdminTh` on `ArtworkSubmissionDto`,
  `PrepressQueueItemDto` (nullable there); `previousStatusLabelTh`, `previousStatusLabelAdminTh` on `ProofCompareDto`.
- `statusLabelTh` on `TrackingStepDto` and the public tracking shipment.
- `TimelineEntryDto` (and `StaffTimelineEntryDto`): `messageTh`, `messageEn`, `count`.
- `DesignDocumentDto` (and `AdminDesignDocumentDto`): `issueCount` (nullable), `hasIssues` (nullable), `issueSummary[]`.
- `ConsentDto`, `AdminConsentDto`, `ConsentPurposeDto`: `labelTh`, `labelEn`.
- `InboxItemDto`: `eventTypeLabelTh`, `eventTypeLabelEn`.

### New problem codes
`quotes.preview_unavailable` (409), `cms.case_consent_required` (422), `cms.case_invalid_status` (409).

### Changed behaviour and text
- `Idempotency-Key` accepts any textual uuid; `idempotency.key_invalid` / `key_required` details are customer-readable.
- Proof wording (D-313): Thai problem details, examples, notification templates and studio labels use
  "ตรวจแบบก่อนพิมพ์" / "แบบตัวอย่าง" for customers and "Proof" for staff and factories.
- Seeded `payments.qr_validity_minutes` is 15 (D-312); new settings `artwork.first_proof_business_days`,
  `storefront.support_hours`, `support.reply_minutes`, `catalog.hero_presets` (all unset).
- New permission `cms.cases.approve` (Superadmin, Admin, Marketing).
