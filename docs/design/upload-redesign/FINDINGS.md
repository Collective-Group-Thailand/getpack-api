# Upload Phase 0 (A5) — findings, API side

Branch `fix/uat-phase0` of `getpack-api`, 2026-10-25. Investigation only: read from the code, the seeds and the
decisions. I did not connect to UAT. Internal document: it may mention factories (GLOBAL-RULES §1, last paragraph).
Business decisions already made for this area are in `docs/design/DECISIONS-STAGE-A.md` §1. Each gap below is
measured against those decisions.

## 1. Where customer files go today

### 1.1 When the customer can upload

| Step | What happens | Code |
|---|---|---|
| Configurator / cart | **No file.** The cart line only stores `designOption` (`own_file`, `online_designer`, `hired_design`, `free_design`). There is no file field on a cart item or a quote. | `src/modules/carts/carts.dto.ts` (`DESIGN_OPTIONS`) |
| Order placed (`waiting_payment`) | The API **already accepts** artwork: `POST /v1/store/orders/{orderId}/artwork-submissions` works while the order is `waiting_payment`, `paid_for_production` or `artwork_approved`, and not after the artwork is approved. | `ArtworkService.assertTakesArtwork`, `TAKES_ARTWORK` in `src/modules/artwork/artwork.service.ts` |
| Order paid (`paid_for_production`) | For an `own_file` order whose product has `templateAvailability ≠ none` and whose pattern has a `dielineKey`, the worker draws the dieline PDF and sends it to the customer (legacy `sendDrawingAutov2`). This only runs when the `drawing.engine` flag is on. It is **off by default** (seed `prisma/seed/data/fulfilment.ts`). If the flag is off, Prepress sends the template by hand (`admin.artwork.sendTemplate`). | `DrawingsService.onFact` in `src/modules/designs/drawings.service.ts` |
| New own-file order | Artwork status starts at `awaiting_template` (`online_designer` starts at `awaiting_upload`). Since A2 the customer sees "รอทีมส่งแบบไดคัทให้" (team acts) and then "รอไฟล์จากคุณ". | `initialArtworkStatus` in `src/modules/orders/customer-status.ts` |

**Answer: files are uploaded after the order is placed, not after payment.** The API accepts a file from
`waiting_payment` onwards. Before the order exists there is no upload and no check. This matches the copy fixed in
GLOBAL-RULES §6: "อัปโหลดไฟล์หลังสั่งซื้อ ทีมงานตรวจไฟล์ให้ก่อนผลิต". Whether the web offers the upload button
before payment is a web question; the API does not block it.

### 1.2 Upload pipeline and storage

- **Storage:** one private S3 bucket (`S3_BUCKET`, optional `S3_KEY_PREFIX`; localstack in dev). The object key holds
  no personal data: `<retentionClass>/<yyyy>/<mm>/<file publicId>`. The browser PUTs straight to S3 through a
  presigned URL valid 15 min. Files over 100 MiB go multipart (parts ≥ 8 MiB, ≤ 1,000 parts), and an upload can be
  resumed (`…/actions/resume`). Pending uploads not completed within 24 h are deleted (`files.expire_pending`).
  Code: `src/platform/files/files.service.ts`, `file-purposes.ts`, `file-processing.jobs.ts`.
- **Purpose `artwork`:** PDF, PNG/JPEG/WebP, TIFF, SVG, PostScript/EPS, AI, PSD and ZIP, **up to 2 GiB**, retention class
  `customer_content`. Up to 20 files plus 5 links per submission (`MAX_ARTWORK_FILES` / `MAX_ARTWORK_LINKS`). Each submission is a
  new version (`artwork_submissions.version_no`). A newer version supersedes the previous one and any proof still
  waiting for the customer.
- **After upload:** the worker hashes the whole object with SHA-256, runs a ClamAV scan (`ClamdScanner`, INSTREAM; real
  mode without `CLAMAV_HOST` leaves every file `pending`, which means it can never be downloaded), reads dimensions or
  page count, and makes a WebP thumbnail for images. Infected files are deleted and audited. A file can only be
  downloaded once it is `uploaded` + `clean`, through a signed GET URL valid 5 min.
- **Original never modified:** proof approval makes a **locked copy** (new key, same SHA-256, `legal_hold = true`)
  (`FilesService.lockedCopy`). Production gets that copy, never the working files.

### 1.3 Who can read a customer's artwork today

| Who | Rule | Code |
|---|---|---|
| Uploader | Always (`owner_user_id`). | `FilesService.canRead` |
| Order's customer | Every file referenced by their order's submissions, proofs and dieline deliveries. | `registerFileReader('artwork')` in `artwork.service.ts` |
| Company team members | Only when the file was uploaded with a company scope (`owner_company_id`), i.e. by a member acting for the company. No per-order sharing with invited members. | `FilesService.ownerOf` / `inScope` |
| Staff | **Any staff member with `files.read`, and every staff role has it** (`EVERY_STAFF_MEMBER` in `src/modules/iam/roles.catalog.ts`). The check is the permission only, not "assigned to this order". Downloads of `customer_content` are **not** audited (only `financial_record` downloads are). | `FilesService.canRead`, `downloadUrl` |
| Factory (partner user / machine client) | Only the **approved locked copy** and the dieline of its own live production jobs. Never the customer's original upload or earlier versions. | `registerFileReader('production')` in `src/modules/production/jobs-query.service.ts` |

### 1.4 Retention today

- `customer_content` has **no purge job**. `file_objects.purged_at` exists and every reader honours it, but nothing
  ever sets it for customer files. Artwork, proofs, generated dielines and design assets are currently kept
  indefinitely.
- Draft configurations are deleted after `configurations.draft_retention_days` (90, D-185). Files are not linked to
  drafts, so nothing file-related happens then.
- A PDPA deletion (D-222) anonymises the customer but **does not delete their files**
  (`src/modules/customers/privacy.service.ts`).

### 1.5 Gaps against `DECISIONS-STAGE-A.md` §1 and hard rule 4 (to plan, not done in Phase 0)

| # | Decision / rule | Today | Proposed owner |
|---|---|---|---|
| G1 | Production files kept **2 years**, unordered drafts **90 days**, delete on request | No purge for `customer_content`. No distinction between files of ordered jobs and unordered uploads. PDPA deletion keeps files. | Upload Phase 1–2 (API): settings `files.production_retention_days` / `files.draft_retention_days` (effective-dated, audited), a purge job that sets `purged_at` and deletes objects (respecting `legal_hold`), and file deletion inside the D-222 request flow |
| G2 | Production may download the **original**, with **no customer identity**: strip metadata (author, creator, company, title, XMP) and rename to the order/job code | Production gets only the approved proof copy. Its file name is kept as uploaded (`originalName`, sent as the download name). Metadata is not stripped. The original is not offered to production. | Upload Phase 2 (API): a derived "production copy" of the original (metadata stripped, named `<jobCode>-v<n>.<ext>`) added to the job's spec snapshot. Needs a PDF/AI metadata scrubber in the worker |
| G3 | Access = owner, invited team members, **assigned prepress staff** | Any staff member can read any customer file. | Upload Phase 1 (API): restrict `customer_content` reads to staff with `artwork.read` on that order, or the order's `prepress_assignee_id`, and audit every download (`data_access`) |
| G4 | ≤ 200 MB per direct upload (hard rule 5) | Purpose `artwork` allows 2 GiB. Preflight stops at 200 MB (`MAX_PREFLIGHT_BYTES`). ClamAV scans only up to `CLAMAV_MAX_BYTES` (512 MiB) of larger objects. | Upload Phase 1: decide whether to lower the artwork ceiling to 200 MB (larger files by link/cloud import) or keep 2 GiB for staff only |
| G5 | NDA download | Nothing in the API. | Content/web (a static document), no API needed |
| G6 | EXIF/GPS stripped from production photos (GLOBAL-RULES §1) | Not part of artwork. Noted only because the same metadata scrubber (G2) could serve both. | — |

## 2. Which products accept own files

- **API:** *every* configurable product. `GET /v1/store/catalog/products/{slug}/configurator` always returns
  `design: { options: ['own_file', 'online_designer', 'hired_design'], default: 'own_file' }`
  (`src/modules/catalog/store/store-configurator.service.ts`). `own_file` is not restricted per product. RFQs accept
  files too (`fileIds` on `store.rfqs.submit`).
- **Why exactly these 5 on `/studio/upload`:** the web page lists `listProducts({ perPage: 48 })` filtered to
  `availability !== 'rfq'`, i.e. products with an **instant price** (`getpack-web`
  `src/app/[locale]/(storefront)/studio/upload/page.tsx`). Availability is per **product type**
  (`QuotePathService.availability`: the type is `quoteMode = instant` and has an active factory capability with a
  price version). On the UAT rehearsal data only the `corrugated` type is instant, and its 5 catalogue products are
  the five listed (`uat-postal-box-b`, `uat-white-mailer-box`, `uat-moving-carton-bc`, `uat-fruit-box-tele`,
  `uat-produce-tray`, all MOQ 100; `prisma/seed/uat/uat-data.ts`). So the list follows instant pricing, not file
  acceptance. If another type gets an instant price path, its products show up automatically.
- The decision "lists own-file products only, plus a link สินค้าอื่น ขอใบเสนอราคา" (DECISIONS-STAGE-A §1) is met by
  that filter as long as "own-file product" means "instant-priced product". There is no separate "accepts own file"
  flag in the catalogue. The closest field is `catalog_products.template_availability` (`none | online_template |
  drawing`), which decides whether a dieline template is sent after payment. All 5 are `drawing`.
- Side notes for the web: `perPage: 48` would silently truncate the list once there are more instant products. And
  `online_designer` is always present in the API's options, even when the Studio cannot draw the pattern. The web
  already filters it (`designOptionsOf(…, designerAvailable)`).

## 3. Preflight tooling

- **No external prepress tool is integrated.** Nothing in the code, the seeds or the docs refers to Acrobat
  Preflight, PitStop, callas pdfToolbox or Esko, and no preflight profile (`.kfp`, `.ppp`, `.xml`) is in the repo.
  **Whether the prepress team uses one, and can share its profile, is an open question for the business** (business
  data table in the prompt pack: "โปรไฟล์ตรวจไฟล์ที่ทีมเตรียมพิมพ์ใช้อยู่").
- **The API already has its own server-side preflight** (D-070, ADR-0009, `src/modules/artwork/preflight/`). It runs
  in the worker on every artwork submission **after the order is placed**:
  - PDF facts via `pdf-lib` plus an in-house content-stream interpreter. Raster facts via `sharp`. No external
    binary.
  - 9 checks (`preflight_check` enum): `size_mismatch`, `missing_bleed` (**block**); `low_resolution`, `rgb_colour`
    (**warn**); `fonts_not_embedded`, `safe_zone`, `thin_lines`, `overprint`, `ink_coverage` (info). Severities and
    thresholds come from the setting `artwork.preflight_rules`, which is effective-dated and seeded as *proposed*:
    bleed 3 mm, size tolerance 1 mm, 300 ppi, safe zone 3 mm, 0.25 pt, 300 % TAC.
  - Not evaluated: ink coverage (needs a Ghostscript rasteriser adapter); AI / PSD / EPS / ZIP and links (go to
    Prepress as-is); files over 200 MB; size and bleed when no dieline template was sent for the order. With the
    drawing engine off, that is every order until Prepress uploads a template.
  - Thai/English report per finding; Prepress cannot accept a `blocked` submission for a proof
    (`artwork.preflight_blocked`); re-run endpoint for staff.
- **Implication for Upload Phase 2:** the "12-point preflight engine" (GLOBAL-RULES §5, owner upload Phase 2)
  should **extend this engine**: 3 more checks, run before the cart against a dieline drawn from the spec. It should
  not be a second engine. If the prepress team has a PitStop/callas profile, its thresholds can be copied into
  `artwork.preflight_rules`. Running PitStop or callas themselves server-side would mean a licensed binary in the
  worker image, which needs an ADR and a licence decision.
- **Copy:** an automated check does exist after ordering, but it is partial (above). GLOBAL-RULES §3/§6 already fix
  the honest wording until Phase 2 ships: no "ตรวจไฟล์อัตโนมัติ" or "ระบบเช็คความละเอียดและเขตปลอดภัยให้" claim. The
  web keeps "อัปโหลดไฟล์หลังสั่งซื้อ ทีมงานตรวจไฟล์ให้ก่อนผลิต".

## 4. Dieline templates per product / size

- **No static template files** (`.ai`, `.pdf`, `.dxf`) exist in the repo, the seeds or object-storage fixtures.
  Dielines are **generated**, not stored as a library:
  - `@getpack/dieline` (owned by getpack-web, vendored as `vendor/getpack-dieline/`, v0.1.0, ADR-0010) draws SVG / PDF /
    DXF from a style recipe and a size.
  - **Style library** (D-270/D-271): each published variant gets 2D/3D thumbnails and a dieline SVG at its default size
    (`styles.render_assets`). Signed-in customers can download any published variant at any size within its ranges
    as SVG/PDF/DXF (`POST /v1/store/dielines/downloads`, 20 a day / 5 a minute). This is what the "ดาวน์โหลดแผ่นคลี่
    จากแบบกล่อง → /styles" link leads to.
  - **Catalogue products:** an order's template is drawn from its pattern's `dielineKey` and priced inside size.
    The patterns of the 5 own-file products (`DEV-RSC`, `DEV-TELE`, `DEV-OPEN-TOP`) have **no `dielineKey`** in the
    seeds. So even with the engine on, `boxOf` returns null, no template is drawn automatically, and Prepress must
    upload one (`admin.artwork.sendTemplate`, any file staff uploaded, normally purpose `dieline`: PDF / DXF / SVG ≤ 50 MiB). In that case the
    automatic path also records **no** internal `dieline.auto_unavailable` activity (it returns before that).
  - Partner intake (D-272) lets factories offer dielines to the library (`dieline` purpose, Prepress review).
- **Open:** whether Prepress or the factories hold ready `.ai`/`.pdf`/DXF dielines for the 5 products and their sizes.
  If they do, they can be uploaded as per-order templates today. For a downloadable library the products need a
  `dielineKey` (or a link from catalogue product to style variant, see A3 open question 5). Business data.

## 5. "เริ่ม ฿15.70" vs ฿17.26

Same root cause as A3/A4, no new finding. `/studio/upload` shows `startingPricePerPiece` from the catalogue list (the
price hint of the reference spec). That is the same value as the listing and the configurator default, ฿15.70 for
size 00 · KA125 B · one ink · 300 pcs (`docs/design/pdp-redesign/PRICE-CONSISTENCY.md`). ฿17.26 / ฿14.96 is exactly size
00 priced with **two inks (ดำ + CMYK)** in `printFront`: the web sent the ink choice as multi-select
(`docs/design/configurator-redesign/FINDINGS.md` §2.2). Pricing is owned by A3 (GLOBAL-RULES §5). Nothing to change here:
the web sends one ink for a "choose one" print option, and `/studio/upload` keeps using the list's starting price.

## 6. Open questions (business)

1. Does Prepress use a preflight tool (Acrobat / PitStop / callas / Esko)? Can it share the profile and the factory
   acceptance criteria, to set `artwork.preflight_rules` and design the 12 checks?
2. Do `.ai` / `.pdf` / DXF dielines exist for the 5 products and every size? Who owns them (Prepress or factory)?
3. Lower the artwork upload ceiling from 2 GiB to 200 MB for customers (hard rule 5), with larger files by link?
4. Confirm G3: restrict staff access to customer artwork to the order's assigned Prepress and holders of
   `artwork.read`, with every download audited?
5. Production's anonymised copy of the original (G2): which formats must be scrubbed? PDF is straightforward; AI is
   PDF-compatible; PSD/EPS/ZIP need a decision (convert, refuse, or Prepress handles them).
