# Changelog — packio-api

Contract-facing changes per release. The contract itself is `contract/openapi.json`; mappings for `packio-web` are in
`docs/contract-requests-triage.md`.

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
