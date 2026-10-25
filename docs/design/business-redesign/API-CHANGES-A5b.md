# business-redesign — API-CHANGES (A5b: confidentiality leftovers, API side)

Repository `getpack-api`, branch `fix/uat-phase0`. Decision **D-442** (product-owner decisions for Stage A step
A5b; closes A1 `PLAN.md` §2 C13, C16, C17, part of C15, and A5 `upload-redesign/FINDINGS.md` G2 / G6;
`DECISIONS-STAGE-A.md` §1 "Production access to originals"; GLOBAL-RULES §1).

**Not breaking for the storefront.** No `/v1/store/*` response changed; no endpoint added or removed. Partner and
admin production-job responses gain one field. One reversible migration, two new settings, no new env var.
The web needs no change for A5b; `pnpm gen:api` picks up the new `originalFiles` field for the partner/admin zones.

---

## 1. What changed

### 1.1 Carrier bookings: getpack is the sender (decision 1)

`POST /v1/admin/shipments/{shipmentId}/actions/book-carrier` (`admin.shipments.bookCarrier`, unchanged contract)
now sends the carrier (Flash Express, Deliveree):

| Field the carrier receives | Before | After |
|---|---|---|
| sender name (`srcName` / first stop `recipient_name`) | factory primary contact | `entity.display_name` |
| sender phone (`srcPhone` / `recipient_phone`) | factory contact phone | `entity.phone` |
| sender address, postcode, district, province (`src*` / first stop address, lat/lng) | factory pickup (else plant) address | `entity.return_address` |

- All three are read from the **issuing entity's settings** (entity scope, falling back to the platform value), never
  constants. If one is missing the booking is refused **before** the carrier is called:
  `422 shipments.carrier_unavailable` with `reason = "the getpack sender is not set (entity.return_address)"`.
- Nothing about the factory (name, code, contact, street address, coordinates) is in the booking request any more.
- `POST /v1/admin/shipments/{shipmentId}/carrier-quotes` (`admin.shipments.carrierQuotes`, price estimates only) still prices from the factory's
  pickup **postcode** (and coordinates for Deliveree) — no name, contact or street line. See open question Q1.
- Carriers stay switched off (`carriers.enabled = false`, flags unchanged).
- Code: `src/modules/logistics/carrier-sender.ts`, `ShipmentsService.bookCarrier` / `carrierSender`.

### 1.2 Metadata stripped from customer-facing and production files (decision 2)

**Uploads — at upload, before the file can be downloaded** (files worker `files.process`):

| Upload purpose | Stripped? | Why |
|---|---|---|
| `evidence` (QC, milestone, POD, claim photos and reports), `proof`, `image` (published photos), `avatar`, `dieline` | **yes** | shared with customers or production |
| `artwork`, `design_asset` | no — kept exactly as the customer uploaded it | customer original; production gets a scrubbed copy (§1.3) |
| `slip`, `document`, `brand_mark`, `signature`, `import` | no | financial / legal records are never rewritten; brand marks and signatures are already re-encoded |

What is removed (container level — pixels, page content and colour profiles are not re-encoded):

| Format (detected by bytes, not MIME / name) | Removed | Kept |
|---|---|---|
| JPEG | APP1 EXIF (GPS, camera, owner, software, dates) and XMP, APP3–APP13 (IPTC / Photoshop), APP15, non-ICC APP2 (MPF), comments, everything after EOI (secondary images with their own EXIF) | image data, JFIF, ICC profile, Adobe APP14, EXIF **orientation** only (one-tag EXIF, so photos do not turn) |
| PNG | `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`, bytes after `IEND` | image and colour chunks (`iCCP`, `sRGB`, `gAMA`, …) |
| WebP | `EXIF`, `XMP ` chunks and their `VP8X` flags | image, alpha, ICC, animation |
| PDF | Info dictionary (Title, Author, Subject, Keywords, Creator, Producer, Company, …), every XMP `/Metadata` stream, `/PieceInfo` (Illustrator / Photoshop private data), comment-annotation authors (`/T`), EXIF / XMP inside embedded JPEG images, orphaned objects of older revisions | pages, fonts, images, colour spaces, form field names; a PDF/X file keeps `GTS_PDFXVersion`, `GTS_PDFXConformance`, `Trapped` and its dates |

- The cleaned bytes replace the stored object; `file_objects.sha256`, `size_bytes` follow, and
  `file_objects.metadata_stripped_at` records when. The `file.scanned` event payload gains `metadataStripped`.
- A file of a stripped purpose that cannot be cleaned (encrypted, digitally signed, unreadable, > 200 MiB) is kept
  as uploaded and audited: `audit_logs.action = 'file.metadata_strip_failed'` (category `security`, outcome
  `failure`, `data.reason`). Formats without a scrubber (MP4 / MOV, SVG, DXF) are left as they are (Q3, Q4).
- `file_objects.purpose` is now recorded on every presigned upload (and on CLI photo imports: `image`).

**Generated PDFs:**

| Generator | Change |
|---|---|
| Chromium (`PuppeteerPdfRenderer`): quotations, spec sheets, invoices / receipts, carton labels, packing lists, statements, payout and ERP documents, document previews, prospectus | no Title (the page `<title>`), Author, Creator (`HeadlessChrome`), Producer (`Skia/PDF`) or XMP. A scrub failure fails the render (`provider.unavailable`) — never a document with metadata. |
| e-Tax PDF/A-3 (`toPdfA3`) | unchanged: after the scrub it writes the XMP / Info that PDF/A-3 **requires** (title, author = the entity's legal name from settings, `getpack` creator) — company data only |
| Studio print file (to production) and digital proof (to the customer) | no Title / Producer / Creator / XMP (`pdf-lib` defaults removed) |
| Designer dieline PDF (D-302) | unchanged: its specified getpack metadata (style code, layer names) — no factory or customer data |

### 1.3 Customer originals made available to production (decision 3)

- When a proof is approved (`store.artwork.approveProof`, `admin.artwork.approveProofOnBehalf`), each **original artwork file**
  (`artwork_submission_files.role = 'artwork'`) of the proof's submission gets an `artwork_production_copies` row
  (`pending`), in the approval's transaction.
- The worker job **`artwork.production_copies`** (every 30 s) reads the original, strips document metadata
  (§1.2 table: author, creator, company, title, XMP; EXIF / GPS of images) and stores a **new private file**:
  - name `<orderCode>-original-v<submission version>[-<n>].<ext>` (`-<n>` only when the submission has several
    artwork files; only the uploaded extension survives);
  - no owner user / company / factory; readable by staff with `files.read` and by the factories whose live job
    (not rejected / cancelled) was released with that approved proof — nobody else (the customer reads their own
    original, not the copy);
  - audit `artwork.production_copy_ready` + domain event of the same name (outbox), same transaction.
  - The original is never modified.
- A format without a safe scrubber, an encrypted / signed / unreadable / > 200 MiB file, or a source that is not
  clean is marked `unsupported` with a reason (audit + event `artwork.production_copy_unsupported`) and **nothing
  is offered** — see Q2.
- The approved proof's **locked copy** (what production already downloads as `approvedFileId`) is now named
  `<orderCode>-proof-v<proof version>.<ext>` instead of the prepress upload name (same bytes, same SHA-256). The
  working proof keeps its name (customer and staff only).

New response field on **`PartnerJobDto`** (and `AdminJobDto`, which extends it) — operations
`partner.production.list`, `.get`, `.today`, `.accept`, `.reject`, `.updateMilestone`, `admin.production.list`,
`.get`, `.hold`, `.resume`, `.reassign`, `.startManually`:

```json
"originalFiles": [
  {
    "status": "ready",
    "fileId": "0192f3a0-7c1e-7d2a-9b1f-0000000f1014",
    "fileName": "DEVOR-2609-00001-original-v1.pdf",
    "reason": null
  },
  { "status": "unsupported", "fileId": null, "fileName": null, "reason": "unsupported_format" },
  { "status": "pending", "fileId": null, "fileName": null, "reason": null }
]
```

`status`: `ProductionCopyStatus` = `pending | ready | unsupported`. `reason`: `ProductionCopyFailure` =
`unsupported_format | encrypted | signed | unreadable | too_large | source_unavailable | null`. Download a `ready`
file with the existing `partner.files.download` (`GET /v1/partner/files/{fileId}/download`; staff: `admin.files.download`). Jobs released
before A5b, or whose proof was approved before A5b, list `[]`.

### 1.4 Factory-confidentiality contract test (decision 4)

`test/unit/storefront-factory-confidentiality.spec.ts` re-run against the rebuilt `contract/openapi.json`: 8/8 pass
over all `/v1/store/*` operations (no store schema changed in A5b). The new field lives on partner / admin schemas
only.

## 2. Settings (new; effective-dated, audited through the settings admin, owner **Superadmin**)

| Key | Scope | Type | Seeded value | Notes |
|---|---|---|---|---|
| `entity.display_name` | entity | string | from `SEED_ENTITY_DISPLAY_NAME` (already required by the reference seed); dev: `Dev entity (fake)`; UAT rehearsal: `UAT rehearsal entity (fake)` | the sender name on carrier bookings. If the company display name customers should see is not the entity's display name (e.g. it should read "getpack"), a superadmin sets a new version. |
| `entity.return_address` | entity | json (schema: `line1`, `district`, `province`, `postcode` required; `line2`, `subdistrict`, `lat`, `lng` optional) | **not set** for a real entity (definition only); dev / UAT rehearsal entities get obviously fake values (`99/9 ถนนตัวอย่าง (ข้อมูลปลอม)`, 10000) | carrier bookings are refused until it is set — **business data needed** |

Both are created by `pnpm db:seed` (idempotent; existing databases get them on the next reference seed run) and
listed in `docs/launch/SETTINGS-REVIEW.md`. Existing `entity.phone` is now also read for the carrier sender.

## 3. Migration (reversible)

`prisma/migrations/20261215000001_files_metadata_production_copies/` — `migration.sql` + `down.sql`:

- `file_objects.purpose VARCHAR(32) NULL`, `file_objects.metadata_stripped_at TIMESTAMPTZ NULL` (existing rows
  stay `NULL`; nothing is rewritten);
- enums `production_copy_status` (`pending`, `ready`, `unsupported`) and `production_copy_failure`;
- table `artwork_production_copies` (one row per submission file; FKs to `artwork_submission_files` and
  `file_objects`; check `ck_artwork_production_copies__state` ties `status` to `copy_file_id` / `ready_at` /
  `failure_reason`).

`down.sql` drops the table, the enums and the two columns (copies' file objects stay as unreferenced private files;
scrubbed uploads stay scrubbed). Retention / purge rules are **not** changed (separate phase).

## 4. Env vars

None added or changed. `SEED_ENTITY_DISPLAY_NAME` (existing) now also seeds `entity.display_name`.

## 5. Tests

Unit (run here, pass): `src/common/files/metadata-scrub.spec.ts` (JPEG / PNG / WebP / PDF scrub, PDF/X, encrypted,
signed, unsupported formats), `src/platform/files/file-processing.scrub.spec.ts` (worker strips evidence photos,
never artwork / slips), `src/modules/logistics/carrier-sender.spec.ts` (Flash and Deliveree bookings carry the
getpack sender and nothing about the factory; refusal when a setting is missing), `src/modules/artwork/
production-copies.spec.ts` (naming, scrubbed copy without owner, unsupported formats), and
`test/unit/storefront-factory-confidentiality.spec.ts`.

**Must run locally (Docker):**
- `pnpm test:e2e -- test/e2e/logistics.e2e-spec.ts` — updated: asserts the fake carrier received the dev entity's
  sender and no factory name, code, address or contact.
- `pnpm test:e2e -- test/e2e/artwork.e2e-spec.ts` — updated: locked copy named `<orderCode>-proof-v2.pdf`;
  production copies created on approval, made by the worker, named by the order code, no owner, not readable by
  the customer.
- `pnpm test:e2e -- test/e2e/production-milestones.e2e-spec.ts test/e2e/production-release.e2e-spec.ts
  test/e2e/production-oversight.e2e-spec.ts test/e2e/claims.e2e-spec.ts test/e2e/design-services.e2e-spec.ts
  test/e2e/settings.e2e-spec.ts test/e2e/shipping-rates.e2e-spec.ts` — not edited, but they upload evidence /
  proof files (now scrubbed: size and SHA-256 can change), approve proofs, or list settings; the safest is the
  whole `pnpm test:e2e`.
- `pnpm test:int` — `test/integration/fulfilment-schema.int-spec.ts` and `schema-catalog.int-spec.ts` exercise the
  migrated schema (no spec edited).

## 6. Open questions (not implemented — need a business decision or business data)

| # | Question | Today |
|---|---|---|
| Q1 | **How does the carrier collect at the factory** when the waybill's sender is getpack's return address? Flash Express treats the sender address as the pickup address; Deliveree's first stop is where the truck goes. Options: register each factory as a pickup point / warehouse in getpack's carrier account, a separate courier-pickup request, or route through a getpack hub. | Bookings carry only getpack's return address — a booked courier would go there. Carriers are off; this blocks switching any carrier on. |
| Q2 | **Customer originals production cannot get as a clean copy**: TIFF, SVG, PostScript / EPS, Adobe Illustrator (`.ai`; private data holds the author), Photoshop (PSD), ZIP, and encrypted / digitally signed / > 200 MiB files. Offer them as they are, ask the customer for a PDF, or have prepress convert them? | Marked `unsupported`; nothing is offered to production; staff see the reason. |
| Q3 | **Videos** (`evidence` MP4 / MOV) can carry GPS and device data. Scrubbing needs a remux tool (e.g. ffmpeg) in the worker image. | Kept as uploaded. |
| Q4 | **SVG / DXF dielines** may carry author / tool / path comments. | Kept as uploaded. |
| Q5 | **Font and reference files** of a submission (`role = font / reference`): should production get copies too (customer fonts are D-284, still open)? | Only `role = artwork` files get production copies. |
| Q6 | **Capture time of claim photos**: stripping EXIF also removes `DateTimeOriginal`, which staff might use to judge a claim. Keep it in the database before stripping? | Removed with the rest of EXIF. |
| Q7 | **Real return address and display name**: `entity.return_address` has no value for the real entity; confirm whether `entity.display_name` should be "getpack" rather than the entity display name from `SEED_ENTITY_DISPLAY_NAME`. | Booking refused until set. |
| Q8 | **PDF/X-4 / PDF/A originals** lose their XMP in the production copy (PDF/X-1a / X-3 keep their Info keys and get the neutral title). Rebuild a minimal conformance-only XMP? | Copy prints the same content; strict conformance claim of X-4 / PDF/A copies is lost. |
| Q9 | **Reorders with unchanged artwork** (D-153) reuse the earlier proof: production copies follow that proof's submission and carry the **earlier** order's code. | Accepted for now; rename per job if needed. |
| Q10 | **Working proof names** (C15): the proof as uploaded by prepress keeps its file name for the customer and staff; only the locked copy production downloads is renamed. Rename on upload too? | Unchanged. |

Also noted, not changed: carton labels and packing lists print `getpack · <entity.legal_name_th>` (a constant
"getpack" prefix from before A5b); switching them to `entity.display_name` is a one-line follow-up if wanted.
