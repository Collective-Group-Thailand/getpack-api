# Changelog — packio-api

Contract-facing changes per release. The contract itself is `contract/openapi.json`; mappings for `packio-web` are in
`docs/contract-requests-triage.md`.

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
