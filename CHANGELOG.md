# Changelog — packio-api

Contract-facing changes per release. The contract itself is `contract/openapi.json`; mappings for `packio-web` are in
`docs/contract-requests-triage.md`.

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
