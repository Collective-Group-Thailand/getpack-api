# Stage A — decisions (binding for later stages)

Decided by the product owner on 2026-10-25 after the Stage A Part 1 review (`STAGE-A-REPORT-WEB.md`).
Every later stage and phase must follow these. Precedence: `GLOBAL-RULES.md` → this file → the prompt packs. Where a
decision below changes what a pack or an earlier FINDINGS/PLAN says, this file wins.

---

## 1. Customer files (upload pack, A5)

| Topic | Decision |
|---|---|
| Retention | Production files (files of ordered jobs) are kept **2 years** (reorders). Files of unordered drafts are kept **90 days**. Any file is deleted on the customer's request. |
| NDA | A standard NDA is offered as a download, and the terms carry a confidentiality clause. |
| Production access to originals | Production **may** download the customer's original file, but **with no customer identity**: before the file is made available to production, strip document metadata (author, creator, company, title, XMP) and rename it to the order/job code. Production never sees the customer's name, contact or company. |
| `/studio/upload` | Lists own-file products only, plus a link "สินค้าอื่น ขอใบเสนอราคา". |

## 2. Studio (studio and editor packs, A6/A7)

| Topic | Decision |
|---|---|
| Style count | Show **all** styles. Every style must open in the Studio; a style that cannot open today is a **defect**, fixed in studio/editor Phase 1. In Stage A only list each such style and what it is missing (dieline, faces, price mapping, …). |
| "แบบที่คนเริ่มบ่อย" | Keep the name. Until real usage data exists, admins pick the styles in the back office (ordered list, on/off). Switch to usage-based ranking automatically once there is enough data; the threshold is configurable in the back office. |
| Sample designs | Keep autosaving (used to measure interest). Remove the copy that says they are not saved; copy must match what the system does. |
| Editor pricing | An empty draft is priced as **unprinted**; the ink is detected once artwork is added. The editor **starts on standard sizes**. |

## 3. Checkout (A8)

| Topic | Decision |
|---|---|
| Deposit / milestone payment | Rules are configurable in the back office: which customers or accounts, order-value thresholds, percentages, milestones. Default = **full payment**. |
| ผ่อนชำระ | Hidden until it is live. |
| Tax ID | Show the **full** tax ID; no masking (overrides the checkout pack's "mask after entry"). |

## 4. Styles, products, category (A9a/A9b/A9c)

| Topic | Decision |
|---|---|
| Styles conflicts C1–C12 (`styles-redesign/PLAN.md` §1) | Resolve by `GLOBAL-RULES.md` §5–6. Remove factory counts from style pages (`partnersCount`; done with A1). |
| Quote basket | Basket lines must keep the **product reference** — a bug to fix in products Phase 1. |
| Tier prices | The tier-price endpoint (`products-redesign/PLAN.md` §3, R2) is approved for products Phase 1. |
| Category size finder | Same fit rule as styles: **product + 0.5 cm per dimension**. |

## 5. Still open (owner: business team)

- Prepress preflight tool and profile.
- Templates (dielines) for the 5 own-file products.
- Category content owner.
- Timing of stock "starting from" prices.
- Customer fonts (D-284).
- Delivery-note PDPA text.

Until answered: hide the dependent element, never use sample data (GLOBAL-RULES §3).

---

## 6. Stage A Part 2 run rules (web side, in addition to the AUTORUN prompt)

- `API-CHANGES.md` files are fetched with a shallow clone of `getpack-api` (git read works); read-only, the clone is
  deleted afterwards.
- Build with `NODE_OPTIONS=--max-old-space-size=4096` only (without `--use-openssl-ca`); the environment stays as is.
- Price POST endpoints may be called against UAT **only** after the API code confirms the endpoint is a pure
  calculation with no database writes; the report lists every endpoint allowed. All other POSTs stay blocked.
  - **Exception — `calculate`:** if the API code shows that `POST /v1/store/quotes/actions/calculate` writes only a
    `calculate_logs` row (no quote, order, cart or customer record), it is allowed against UAT: **at most 40 calls
    for the whole of Part 2**, only for the A3/A4 price checks and their screenshots. The report states the exact
    number of calls and every spec priced.
- A1 scope: sweep **all** customer-facing text (locale files, components, metadata, JSON-LD, emails) for
  "โรงงาน"/factory wording, not only the footer, using the wording of GLOBAL-RULES §1.

---

## 7. Stage A API decisions

Decided by the product owner after the Stage A API review (`STAGE-A-REPORT-API.md`).

| Topic | Decision |
|---|---|
| D-441 (default spec) | **Confirmed.** Where a product has a reference configuration, it is the configurator's default spec and overrides the admins' per-option default flags. |
| D-442 (confidentiality leftovers) | **Confirmed**: getpack as carrier sender, metadata stripping on customer-facing files, anonymised production copies of originals. The product owner reviews the details in the report. |
| VAT on the design fee | **Bug.** The design fee's VAT is missing from `vatAmount`. Fix in **Stage B** together with the shared VAT helper (GLOBAL-RULES §5); no change before then. |
| VAT rounding rule (pending accountant confirmation) | Round each taxable line **ex-VAT** to 2 decimals; sum all taxable lines (goods, design fee, shipping charged by getpack); VAT = **7 % of that sum, rounded half-up to 2 decimals**. Implement in Stage B with the shared VAT helper. |
| Carrier pickup at the factory | **Deferred** until a carrier is enabled; carriers stay switched off. |
| Return address (`entity.return_address`) | The product owner enters it in settings. Bookings stay refused until then. |
| Customer file access | **Stage B:** role-based access to customer files (not every staff role) plus an access audit log of every download. |
| Own-file upload before payment | Allowed. The automatic file check may run at once; the prepress review queue includes only paid orders; unpaid orders show the customer "ไฟล์ได้รับแล้ว ทีมงานจะตรวจหลังชำระเงิน". Production starts only after payment. |
| VAT on RFQ quotations and CS service pricing (B-API-6) | Use the shared helper `computeVat` (`src/common/money/vat.ts`) for RFQ quotation lines and `POST /v1/admin/cs/service/actions/price`. Issued documents and quotations already sent are never recalculated. |
| Print config effective-dated (B-API-6) | The print model (B-API-2) is versioned with `effective_from` (ADR-0005, audited); the admin endpoint adds a version; reads use the version in force. Until the business answers: max 1 spot colour per side, CMYK + spot add-on off — setting `catalog.print_limits` (seeded, `pending_business`). Combinations the engine cannot price are not offered; a store calculation that still sends one gets the quote path (`rfq_required`), not an error. |
| Spec label spot colours (B-API-6) | Confirmed and kept: the label names spot colours, e.g. "สีพิเศษ 1 สี (ดำ)". |
| Customer file access follow-up (B-API-6) | Support also handles an order through an explicit order assignment (set by CS Lead / Admin, audited); an open order conversation still counts. Superadmin reads the access log, not files; Admin and Auditor have no access to originals; Auditor reads the access log (`customer_file_access_logs.read`). Studio and design-asset files are customer artwork (same rules, logged). |
| Prepress review before payment (B-API-6) | Accept / reject refused on unpaid orders (409 `artwork.order_unpaid`); the "changes requested" list shows paid orders only. |
| Print limits (B-API-7) | `catalog.print_limits` stays a placeholder (`pending_business`: 1 spot colour per side, CMYK + spot add-on off) until the business sets the real values in the back office (Admin, effective-dated, audited). No code change. |
| Studio render previews (B-API-7) | CS and the roles handling the order (support through an explicit assignment or an open order conversation, plus Prepress) may read the low-resolution, metadata-free preview of a Studio render (`GET /v1/admin/files/{fileId}/preview`, logged as `thumbnail`). Full-resolution renders, customer artwork and originals stay restricted as before (D-444). |
| Support assignment end (B-API-7) | An explicit order support assignment ends automatically when the order's claim window ends (an open claim keeps it open); CS Lead / Admin may still end it earlier (`PUT …/support-assignment` with `null`). |

---

## 8. Material descriptions (approved)

Approved customer-facing descriptions of the four corrugated materials shown on the configurator's material cards.
Entered through the back-office admin API (`PATCH /v1/admin/catalog/materials/{id}`), never by direct SQL. On UAT an
admin enters the same text in the back office.

| Material | TH | EN |
|---|---|---|
| KA125 ลอน B (3 ชั้น) | ผิวคราฟท์ เกรดมาตรฐาน เหมาะกับกล่องไปรษณีย์ทั่วไป | Standard kraft finish, ideal for everyday mailer boxes |
| KT125 ลอน B (3 ชั้น) | ผิวคราฟท์ น้ำหนักเบา ราคาประหยัด สำหรับสินค้าน้ำหนักไม่มาก | Lightweight kraft at a lower price, for lighter products |
| KA185 ลอน B (3 ชั้น) | ผิวหนาขึ้น แข็งแรงกว่า สำหรับสินค้าหนักหรือซ้อนหลายชั้น | Heavier liner and stronger, for heavy or stacked goods |
| KA125 ลอน E (3 ชั้น) | ลอนเล็ก ผิวเรียบ พิมพ์คมสวย เหมาะกับกล่องโชว์สินค้า | Fine flute with a smooth surface for sharp print, great for display boxes |

---

## 9. Owner decisions after C0 (2026-10-28)

Decided by the product owner (Superball) on 2026-10-28, answering the open questions of the C0 report (`STAGE-C-REPORT.md`, C0). Implemented in C0b.

| # | Topic | Decision |
|---|---|---|
| 9.1 | Fit ranges from approved recipes | Each style's inside fit range (C0 commercial fields) is filled from its **approved recipe's size range** where the field is empty (81 of 122 complete on UAT). Done by an audited, idempotent backfill through the curation path of `admin.styles.update` (`POST /v1/admin/styles/actions/backfill-fit-ranges`, `pnpm styles:fit-ranges [--confirm]`, UAT seed step 4b) — never raw SQL. Never overwrites a business-entered value; the source is stored (`style_bases.fit_range_source` = `recipe` \| `business`) so a later CSV / curation value wins. Range = the style's own material class, else what every complete class allows; whole mm, never wider than the recipe. |
| 9.2 | CSV size basis | The catalogue CSV's size columns are **inside dimensions in mm** (confirmed). The importer and its docs read them as inside mm, whatever the column suffix says. |
| 9.3 | No price estimates (D-220 stays) | Quote-only styles show no "ราคาประมาณ". They show "ขอราคาได้ ทีมงานตอบภายใน {n} วันทำการ" plus the existing RFQ path with the spec prefilled. `{n}` comes from the API (`quoteResponseBusinessDays` = `rfq.sla_business_hours` of the style's product type, platform fallback, in working days); with no value set, the timing is omitted. The wizard's budget step stays out. |
| 9.4a | Dielines | The flat dieline (card hover, quick view "แบบคลี่") is generated by the repo's own engine (`@getpack/dieline`, vendored in getpack-api, ADR-0010) at each style's default size, by the existing asset job (`styles.render_assets`, base-level `dieline_svg`). Styles the engine cannot draw get none (no hover). Never drawn by hand. |
| 9.4b | Landing copy | DRAFT Thai (and English) intros and 4–6 FAQs for the 8 `/packaging/[slug]` pages, from repo/API facts only (no statistics, counts, certifications, awards, superlatives, competitors, factory names or locations), stored in the copy slot `packagingPages.<slug>` with `status: draft`. Drafts stay behind `FEATURE_PACKAGING_LANDINGS` (off), `noindex`, without FAQPage JSON-LD, sitemap or llms.txt entry, until the owner sets `approved`. |
| 9.4c | Trust section | No invented certificates, photos or logos. Only the tax-invoice note is filled, backed by **D-010** (getpack/Collective Group issues every customer tax invoice for the full amount) and **D-125** (a tax invoice per order, per branch). Everything else waits for the business: `docs/design/styles-redesign/TRUST-CONTENT-CHECKLIST.md`. |
| 9.5 | Flexible corrugated printing | Customers may choose more inks/colours per side than the engine can price instantly; the choice is never blocked or silently trimmed — configurator and Studio route it to "ขอใบเสนอราคา" with the spec (the existing `rfq_required` path; the store print model reports the extra counts as `quote`). On corrugate the Studio's "เพิ่มจำนวนสี" leads to that quote path. `catalog.print_limits` values stay as they are (pending business); no prices added. |

---

## 10. Owner decisions after C1 (2026-10-28)

Decided by the product owner (Superball) on 2026-10-28, answering the 10 open questions of the C1 report (`STAGE-C-REPORT.md`, C1). Implemented in C1b; recorded in `getpack-api/docs/decisions.md` as **D-447**.

| # | Topic | Decision |
|---|---|---|
| 10.1 | `partial` availability | Prices instantly, like `instant` (confirmed, unchanged). |
| 10.2 | Stock items | Both **add to cart** (at the minimum order, signed-in, priced by the API) **and** add to the quote tray, as the prototype — to widen sales. |
| 10.3 | Services | Staff curate which services show: the effective-dated, audited setting `storefront.featured_services` (≤ 3 catalogue product slugs, in order, owner role Marketing), read via `GET /v1/store/catalog/featured-services`. Up to 3 curated ones; none curated → the API's service list (first 3, API order) + "ดูบริการทั้งหมด". No new business values. |
| 10.4 | Out of stock | "สินค้าหมด" badge (`STOCK_AVAILABILITY` in `src/domain/status`), no cart button; may still go to the quote tray. |
| 10.5 | Stock "starting from" | The unit price at the item's **minimum orderable quantity** (first price tier), labelled with that quantity — "เริ่มต้น ฿x/ชิ้น (สั่งขั้นต่ำ N)"; never the cheapest high-volume tier. From the API (`stock_price_hints`, store pricing path), never computed in the browser. |
| 10.6 | Ex-VAT switch | The API adds the ex-VAT (net) figure to the catalogue's price responses (`startingPricePerPieceExVat`, `startingFromPerPieceExVat`; shared VAT helper, approved `vat_standard` rate). The web shows "ราคารวม VAT / ไม่รวม VAT" (default incl. VAT) only when every listed price has both figures. |
| 10.7 | LINE hours | Daily 09:00–18:00: reference/dev/UAT seeds give `storefront.support_hours` (`{days: daily, open: 09:00, close: 18:00}`) and `storefront.support_channels.hours` ("ทุกวัน 09:00–18:00") a first version where unset (`fillIfUnset`); an existing UAT value is changed with `docs/design/products-redesign/set-support-hours.mjs` (admin API, no SQL). |
| 10.8 | Tax-invoice FAQ | The company name comes from settings (`entity.legal_name_th/en` via `PublicConfigDto.issuer`), not content; without a name the answer omits it. |
| 10.9 | Quote tray | Guests keep it in the browser. Signed in, items go straight into the existing server-side draft RFQ basket as lines whose form is pending (`POST /v1/store/rfq-baskets/draft/products`, `formPending`); the same product's filled form fills the line; the basket is not sent while a line is pending; a guest tray merges into the basket at sign-in. Account mode follows `FEATURE_RFQ_PRODUCT_REF`. |
| 10.10 | Materials "หมายเหตุ" | Each material's approved description (§8) from the catalogue API; empty → empty cell (column hidden when none has one); no invented notes. |

---

## 11. Owner decisions (2026-10-28, after C0b)

Decided by the product owner (Superball) on 2026-10-28 (09:47 and 10:43), answering the C0b open questions and two C1b follow-ups. Implemented in C1c; recorded in `getpack-api/docs/decisions.md` as **D-448**.

| # | Topic | Decision |
|---|---|---|
| 11.1 | Fit ranges for all styles | The audited, idempotent backfill (dry run first; curation path; seed step 4b; `pnpm styles:fit-ranges`) takes **each bound** from the first source that gives it: (a) the approved recipe's size range (C0b rule, unchanged for the 81); (b) the style's own standard sizes — its catalogue products' `standard_sizes` (active products of its pattern) and the approved recipe's presets (inside size via the recipe's own `closedSize`); (c) the production envelope already in the system — its pattern's calculator size rules ∩ the dieline engine's solver limits (via `closedSize`). Nothing invented or mapped by hand (a diameter, gusset or flat item gets no L/W/H). Each bound's source + basis is stored (`style_bases.fit_range_bounds`), summary in `fit_range_source` (`recipe` / `standard_sizes` / `production_envelope` / `combined` / `business`); a business range always wins. Not used: factory process capabilities (flat blank sizes, not inside dimensions) and tier-B envelopes (pricing coverage, not capability). Seed data: **90 of 122** (recipe 81, combined 9); 32 stay empty (listed in the C1c report). |
| 11.2 | Quote response days | `ceil(rfq.sla_business_hours ÷ hours of one business day)`, the day length from `calendar.business_hours` (D-175; 09:00–18:00 = 9 h); missing/unusable values → timing omitted. |
| 11.3 | CSV size headers | `length_min_mm` … `height_max_mm` (inside dimensions, mm) in both repos' templates and docs. |
| 11.4 | Corrugated CMYK + spot colours | Quote path confirmed (§9.5 kept). |
| 11.5 | Back-office screens | Admin style workspace "ข้อมูลการขาย" (fit range per dimension with its source, MOQ, recyclable, plastic-free, certification codes); `/style-library/fit-ranges` (dry-run preview → confirm); `/style-library/content` (certificates name/number/issuer/expiry/document, food-grade documents, production photos, permitted customer logos with the permission record, tax-invoice note). Content = effective-dated, audited setting `storefront.style_library` (owner Marketing), edited by **Admin and Marketing** (`styles.curate`, D-246) via `admin.styleLibrary.*`; public `store.styleLibrary.getSettings` (expired certificates and permission records never shown). Links are https or site paths (file upload into this editor: later). |
| 11.6 | Superadmin | Superadmin may do what any role can do, on its behalf — implemented narrowly: the settings owner check (`admin.settings.changeValue`) lets Superadmin change any setting (audited as the Superadmin); e.g. `storefront.featured_services` stays Marketing's and Superadmin may change it too. Feature flags were already Superadmin's. **Not** extended to customer original files (§7, D-444), maker-checker self-approval or role-named sign-offs (D-212 name approvals) — open question. |
| 11.7 | English support hours | Built per locale from `storefront.support_hours` (`PublicConfigDto.supportHours`) — TH "ทุกวัน 09:00–18:00", EN "Daily, 09:00–18:00"; without it TH keeps the channels' text and EN shows no hours. |
| 11.8 | Out-of-stock price | An out-of-stock stock item keeps showing its price (confirmed, unchanged). |

## 12. Superadmin powers (2026-10-28, C1d)

Decided by the product owner (Superball) on 2026-10-28 (11:00, choice A + B at 11:04). Implemented in C1d; recorded in `getpack-api/docs/decisions.md` as **D-449** and in `docs/accounting-design.md` §8.

| # | Topic | Decision |
|---|---|---|
| 12.1 | Customer original files | Superadmin **may** open / download customer originals, production copies and Studio / design artwork, but every access needs a typed reason (≥ 10 characters, the existing reason rule) stored in `customer_file_access_logs` with actor, file, order and time (`admin.files.downloadWithReason`, permission `customer_files.read_with_reason`, Superadmin only; audit + event in the same transaction). Supersedes §7 / D-444 "Superadmin reads the access log, not files" **for Superadmin only**; Admin and Auditor unchanged (no access). Back office: a reason dialog opens before the download when the ordinary download is refused. |
| 12.2 | Maker-checker | Superadmin may decide a step of any staff role (not a customer-company step, not through a delegation) but may **not** approve a request they made themselves — except under 12.3. One person still approves at most one step. |
| 12.3 | A. Solo-owner mode | Effective-dated, audited setting `approvals.solo_owner_mode` `{enabled, expiresAt}`; only Superadmin changes it (back office: approvals page → "โหมดเจ้าของคนเดียว" toggle with expiry); default and longest expiry `approvals.solo_owner_mode_max_days` = **90 days**, renewable. While on, a Superadmin may approve their own request with a mandatory typed reason; the approval is flagged **"อนุมัติด้วยตนเอง"** (stored flag + reason, audit row, event `approval.self_approved`) and listed in a daily digest to Superadmins (in-app + e-mail). Off at expiry (recorded by the worker) and never for a step another active user can decide (holds the step's role, or another Superadmin). Badge on the approvals list and detail. |
| 12.4 | B. Approval threshold | Requests of **≤ ฿500,000.00** skip the second approval: approved at creation, audited with reason "below threshold", event `approval.approved` (`autoApproved`). Implemented as the policy version's `autoApproveMaxAmount` (approval-policy editor; effective-dated through `approval_policy_change`; Superadmin only), allowed only on versions whose steps have an amount condition. Seeded on **`credit_limit`** only (the one staff money policy with amount conditions). Not applied to refunds, credit notes, write-offs, journals, payout runs, bank-account changes, tax / series settings or tax-document cancellation (no amount conditions). |
| 12.5 | Unchanged | D-212 role-named name approvals (Marketing / Prepress sign-offs on style names) and the factory-ledger maker-checker (D-386 / D-389 / D-398) — open question for the owner. |

## 13. Size search by product class; trust-section files (2026-10-28, C1e)

Decided by the product owner (Superball) on 2026-10-28 (12:07), answering the C1c open questions. Implemented in C1e; recorded in `getpack-api/docs/decisions.md` as **D-450** (amends D-448 (1), (5)).

| # | Topic | Decision |
|---|---|---|
| 13.1 | Recipe presets | Count as the style's "standard sizes" (fit-range source (b), §11.1) — confirmed, kept. |
| 13.2 | Size search by product class | Each style has a **size class** (`style_bases.size_class`), set by the audited fit-range backfill from the documented rule in `getpack-api/src/modules/styles/size-classes.ts` (read-only in the back office): **`bag`** — paper bags PK-PG-* and plastic bags PK-PB-*: inside size = **width × gusset (as the depth) × height**, from the recipe / preset values where present (a recipe range's `width` is the inside length; the gusset comes from the presets or the solver limits; `inside-rules.ts`). **`cylinder`** — cups, bowls, tubes (a style whose approved recipe is sized by a body diameter: `diameter`, `topDiameter`, `bottomDiameter`; a tapered body uses the smaller, the narrowest inside): inside footprint = **diameter × diameter (bounding square)**, height = height; the size search fits the product's L × W against that square (the larger side + 5 mm clearance is the diameter, within the range). **`not_applicable`** — labels, shrink sleeves, tags, sleeves, inserts, flat folders (PK-LA-*, PK-TG-*, PK-SL-03, PK-IN-02, PK-CI-02, PK-DS-04, PK-SP-13, PK-SP-12): "size search not applicable" — a field, not an empty range: no fit range (a backfilled one is cleared — PK-SP-12's 4 mm range, PK-TG-03's recipe range; a business-entered one is kept but never searched, and curation refuses a new one), excluded from the size search without counting as missing; the admin tab shows "ไม่ใช้กับการค้นหาด้วยขนาด". **`box`** — every other style, unchanged. A recipe's own `closedSize` always wins over a mapping. Plastic bags have no engine reference material (`flexible`): listed for Prepress in `docs/design/styles-redesign/PREPRESS-SIZE-TASKS.md` (closed-size definitions); until then they stay empty. Seed coverage (engine `@getpack/dieline@0.1.0+ccc03fe8`): **93 of 101 applicable styles**; 21 not applicable; 8 empty (PK-PB-01…08). |
| 13.3 | Trust-section files | The content editor (`/style-library/content`) picks **uploaded files** through the existing file service instead of typed links: production photos, customer logos and material swatches are pictures (purpose `image`, PNG / JPEG / WebP, D-415), served by the public catalogue image route only while the content in force publishes them (the same rule as other public marketing images: uploaded, scan clean, referenced by published content); certificate and food-grade documents are uploaded files (purpose `document`, or `image`) served by the new public `GET /v1/store/style-library/documents/{fileId}` only while published (an expired certificate's document is not), **or an external https link — documents only**. The setting's schema and `admin.styleLibrary.updateSettings` refuse anything else (`validation.failed`, `fileReady`). |
| 13.4 | PK-SP-12 | Empty — covered by 13.2 (not applicable). |

## 14. Owner answers after C1e and C3 (2026-10-28, C1f)

Decided by the product owner (Superball) on 2026-10-28 (13:58, after C1e; 14:36, after C3). Implemented in C1f; recorded in `getpack-api/docs/decisions.md` as **D-451** (amends D-449 (2A), (B) and D-450 (2), (3)).

| # | Topic | Decision |
|---|---|---|
| 14.1 | PK-TG-03 (cup carrier) | Size class `box` — the one documented exception to the `PK-TG-*` "not applicable" rule (`BOX_EXCEPTION_CODES`, `size-classes.ts`); it keeps its recipe range (seed: 160–260 × 80–260 × 100–220 mm). |
| 14.2 | Cylinders / cups | The diameter (fit L and W) comes from the production envelope — the dieline engine's limits for the cylinder class, with the calculator's size rules where they state one — not from the preset / standard sizes; the source is recorded per bound (`production_envelope`, basis `engine_limits`). The height keeps the fallback order (recipe first). A business-entered range still wins. Seed (engine `@getpack/dieline@0.1.0+ccc03fe8`): PK-SP-23 ⌀ 30–88, PK-SP-24 ⌀ 30–163, PK-RG-07 ⌀ 30–200; coverage **94 of 102** applicable styles, 20 not applicable, 8 empty (PK-PB-01…08, Prepress task). |
| 14.3 | Trust-section PDFs | Uploaded as the file purpose `published_document` (standard retention, PDF or a picture), whose metadata (PDF Info / XMP, EXIF) the worker strips like published images (D-442). The editor saves only `published_document` / `image` documents; the public document route serves a file only once its metadata was stripped (a financial-record `document` upload is never served). |
| 14.4 | Reusing uploaded files (picker) | Later — not built (follow-up). |
| 14.5 | `credit_limit` threshold | **฿100,000.00** (was ฿500,000.00, §12.4; owner: "I am the executive and the approver"). New databases: version 1; existing databases: one new effective-dated version from the seed while the value in force is still the seed's — never over a value a Superadmin set, changed or removed, never an edit of history. UAT: `getpack-api/docs/design/superadmin-controls/set-credit-threshold.mjs` (admin API; dry run by default, `--confirm`, optional `--self-approve "<reason>"`). The back-office policy editor keeps letting Superadmin change it. |
| 14.6 | Solo-owner mode on every step | A Superadmin may decide **every** step of a multi-step policy (bank-account changes, `style_library_change`…) on their own request while the mode is on — each step its own flagged action "อนุมัติด้วยตนเอง" with its own typed reason, audit row, event and digest line; each step is still refused while another active user could decide it. Narrowly: the "one approval per person per request" unique index excludes flagged self-approvals; a new index allows one self-approval per step; the maker-checker trigger is unchanged. |
| 14.7 | Customer file access log page | Back office `/customer-file-access-logs` ("บันทึกการเปิดไฟล์ลูกค้า"; menu for `customer_file_access_logs.read` — Superadmin, Auditor): filters date, actor, order (code), file, kind (original / production copy / approved proof copy / Superadmin access with a typed reason); the reason is shown; CSV / XLSX through the existing list export (`admin.exports.create`, resource `customer_file_access_logs`, also `reports.export`). |
| 14.8 | Quote-only product page | `StoreProductDetailDto.quoteResponseBusinessDays` (same rule as §9.3 / §11.2) for products with `availability = rfq`; the PDP shows "ทีมงานตอบภายใน {n} วันทำการ" and omits the timing when null (it no longer shows the RFQ form's SLA hours). |
| 14.9 | PDP after C3 (14:36) | (1) The C3 copy `catalog.pdp.print.*`, `catalog.pdp.faq.items.*`, `catalog.pdp.design.*` (th/en) is approved as is. (2) "หาเบอร์จากขนาดสินค้า" = a link to the existing /styles size search (`/styles#size-search` opens the size tab), no product finder. (3) = 14.8. (4) The FAQ tolerance answer uses the API's tolerance figures of the current calculation (the buy box's source); none → the answer without a figure (the FAQPage JSON-LD keeps the figure-free answer). (5) Dieline: the published variant matching the selected size, else the first published variant — the API has no data tying a variant to a size (variants differ by option axes; size ranges are the style base's), so the first published variant with the selected size's millimetres is used; the per-size variant is a contract request (`docs/contract-requests.md`). |

## 15. Owner answers after C2 (2026-10-28, C2b)

Decided by the product owner (Superball) on 2026-10-28 (17:48; MOQ 17:56), answering the C2 open questions. Implemented in C2b; recorded in `getpack-api/docs/decisions.md` as **D-454**. Accepted recommendations with no work now: a size-matched dieline variant from the API comes later (when Prepress links variants to sizes); a cup's diameter stays cut by the calculator's size rules; category content = the repo file reviewed by Marketing (back office later); the category size finder is for instant products only; flute stiffness stays hidden until Prepress supplies values; a mixed category's badge is "ราคาทันทีบางรายการ" (done in C2).

| # | Topic | Decision |
|---|---|---|
| 15.1 | Category → style library | `flexible_pouch` → `flexible`, `rigid_box` → `rigid`, `label_sticker` → `label`, through the approved-content mechanism of C2 (`getpack-web/src/features/customer/catalog/category/content/entries.ts`, `styles`): these three mappings only are `approved` (reviewer "Superball (product owner)", 2026-10-28); every other category content entry stays draft. The cross-link shows only when the library has styles in that category (live count). |
| 15.2a | Postal box print sentence | `uat-postal-box-b` said "เลือกพิมพ์โลโก้ 1–2 สีได้"; its print model offers per side none · 1 spot colour (ดำ) · CMYK, no add-on → "เลือกพิมพ์โลโก้ 1 สี หรือพิมพ์ 4 สี (CMYK) ได้". Rule (seed and UAT script): the sentence is derived from the print model in force (outside side): N = 1 → "พิมพ์โลโก้ 1 สี", N > 1 → "พิมพ์โลโก้ 1–N สี", CMYK → "พิมพ์ 4 สี (CMYK)" (+ "เพิ่มสีพิเศษได้ M สี" when the add-on is on); no print model → the colour count is removed. Never an invented count. |
| 15.2b | "[DEV]" on the fruit box | The leak was the telescope pattern's parts (sub-patterns "[DEV] ตัวกล่อง" / "[DEV] ฝา", customer-facing in the configurator parts, spec lines and the starting price's basis). The UAT seed renames them ("ตัวกล่อง", "ฝา", `UAT_SUB_PATTERN_RENAMES`) like the other reused dev data; the dev seed keeps its `[DEV]` marker by design (obviously fake data, release-hygiene check). UAT: the script strips "[DEV] " from the names of active catalogue products, their patterns, parts and standard sizes. |
| 15.2c | Size names | Standard-size names carry their dimensions in the spec-label order **L × W × H** (GLOBAL-RULES §5; e.g. "เบอร์ 00 (14×9.75×6 ซม.)", was "9.75×14×6"). Names are free text entered with the size (seed / back office), not built by code; the UAT seed's 18 W × L × H box names (postal, white mailer, moving carton, fruit box, produce tray) and the dev example are fixed; folding-carton names were already L × W × H. 2-D names (labels, tags, cards, sleeves) and pouch names (W × H by the pouch spec label) are not changed — open question. |
| 15.2 | UAT fix | `getpack-api/docs/design/category-redesign/fix-catalogue-data.mjs` (admin API — catalogue products, patterns, sub-patterns, standard sizes; If-Match; dry run by default, `--confirm`; idempotent; reports 2-D names and other colour counts for review). No SQL. |
| 15.3 | Minimum order (MOQ) | **Per size**: each size is its own die / plate / set-up, so one configuration = one quotation = one cart item, and each item meets its catalogue product's `quantity_min` / `quantity_max` on its own; one order may mix sizes, each priced separately (the cart already does). Nothing sums quantities across sizes (checked: quotes, cart, checkout, orders). The API now also checks it when an item is added (`store.cart.addItem`: a customer's instant quotation option below / above the limits → 422 `validation.failed`, path `quoteOptionId`, code `min` / `max`; CS quotations, accepted RFQs, samples, call-offs and reorders keep their own terms), as `changeQuantity` already did. Plateless / digital exceptions: a later option, not now. |
| 15.4 | Free shipping | Wherever the API sends a shipping amount of exactly `"0.00"` for a priced shipment — cart estimate and summary, checkout summary and address step, configurator / PDP dock, reorder preview, Studio order sheet, the order page's shipping line — the web shows **"ส่งฟรี" / "Free shipping"** (`common.shipping.free`) instead of "฿0.00": a string comparison on the API value (`isFreeShipping`), no arithmetic; never when shipping is pending or unpriced (null keeps its own wording). The CS quotation page (`/q/[token]`) has no shipping line type and is unchanged. |

## 16. Wrap-up of every open question (2026-10-29, C11)

Decided by the product owner (Superball) on 2026-10-29 (18:47, "agree with all your recommendations"), answering the open questions of C2b and C7–C10 (`STAGE-C-REPORT.md`). Implemented in C11 (branch `design/stage-c-wrapup`); recorded in `getpack-api/docs/decisions.md` as **D-459**. Database values change through the seed (a first version where unset, or one effective-dated amendment that never overwrites a person's choice — `SettingSeed.fillIfUnset` / `amendInForce`) and admin-API scripts (dry run by default, `--confirm`), never SQL.

| # | Topic | Decision |
|---|---|---|
| 16.1 | Contact (C10) | Call-back windows `support.callback_slots` = **09:00–12:00 · 12:00–15:00 · 15:00–18:00** (Asia/Bangkok; seeded where unset; CS Lead may change them from a date). The queue routing `support.topic_queues` (quote / business → sales, partnership → partner, artwork → prepress, payment → finance, else cs) is **confirmed** (was *proposed*). Per-topic reply days `support.reply_business_days_by_topic` **stay unset** (1 business day for every topic). Guests who type a PK- order number go to sign-in (kept, privacy). Quote requests have **no fixed quantity floor** (no "≥ 100"): verified — the contact form takes any whole number, the RFQ form's minimum comes from the API (1), the cart enforces each product's own minimum per size (§15.3). UAT: `getpack-api/docs/design/business-redesign/set-contact-settings.mjs` (sets the windows; sets the routing only while unset, reports a CS Lead's different routing). |
| 16.2 | Upload checks (C9) | `ink_count` defaults to **"must fix"** (`block`, the cart stays closed) in `artwork.preflight_rules`; an existing database gets it once and only while no ink-count severity is set. The other new checks' severities and `minTextPt` / `blackOnlyTextBelowPt` stay for Prepress. A finished file check can be told to the customer by **e-mail + LINE** (template and route on `file_check.checked`, link to `/studio/upload?check=`) behind the flag **`artwork.file_check_notify`, seeded off** until the wording is approved (sent for every finished check while on — the server cannot tell whether the page is still open). Files of file checks that **never became orders are deleted after 90 days** (§1): new setting `artwork.file_check_retention_days` = 90 and the daily job `artwork.file_check_retention` (no G1 purge job existed) — only files held by nothing else (no order artwork, cart line, attachment, message or Studio asset, no legal hold), storage deleted after the commit, `purged_at` kept, one audit row per file, idempotent. |
| 16.3 | Editor (C8) | "เปลี่ยนเป็น CMYK" **shows the new price before it applies**: `store.studio.quote` takes `alternativeSpec` (the same version priced with the CMYK spec through the same box checks and pricing path; nothing saved — no snapshot, quotation or cache) and the Studio shows "ราคาตอนนี้" / "เมื่อพิมพ์ CMYK" at the dock's quantity in a confirm step (a guest's design: `store.quotes.calculate`). The server's document checks (C8-1, partly): **hidden elements are skipped** (not printed, checked or priced); the ink count counts a **gradient's two ends** and asks for process printing, a **one-ink image** as one ink, a colour image as process, no fill on an open path, no stroke of width 0 — the web counts the same way (`documentInks`). The order render and the other C8-1 fields stay a contract request. |
| 16.4 | Studio entry (C7) | Hero presets: the mailer offers the **postal sizes A–D of its product** (`catalog.hero_presets` shape `standardSizeCodes: ["A","B","C","D"]` — the catalogue's own sizes and names, never typed numbers; a product without them falls back to the typed sizes); the home hero reads the same setting. `studio.featured_styles`: usage threshold **200 designs within 90 days**; the styles list stays **empty for the Admin to choose** (the section stays hidden until either). UAT: `getpack-api/docs/design/studio-redesign/set-studio-settings.mjs`. |
| 16.5 | Catalogue (C2b) | Flat items' size names (labels, hang tags, the A6 card, the food-tray sleeve) state **L × W** like the flat spec label ("A6 (14.8×10.5 ซม.)"); pouches keep **W × H**. UAT seed fixed; UAT: `fix-catalogue-data.mjs` step d. **CS-made quotations stay exempt** from product minimums (confirmed; CS may agree exceptions). |
| 16.6 | Still owner-supplied / blocked | Lawyer wording (partner agreement clauses, "ข้อมูลลูกค้าเป็นของโรงงาน" / "ไม่เปิดเผยชื่อโรงงาน"); Marketing content (real screenshots, sample upload file, category / trust content, easy-mode templates); Prepress specs (preflight profile and thresholds, print-file spec, plastic-bag closed sizes, flute stiffness, DEV-OPEN-TOP dieline); contact details (LINE OA, phone, e-mail, office line; issuer tax id / branch / address on UAT); roadmap statuses (Admin flips released keys to `live`); guest uploads on the contact form (later); capability-chip curation (optional). |

## 17. Owner-delegated decisions: Prepress, Logistics, Marketing, Legal (2026-10-29, C12)

Delegated by the product owner (Superball) on 2026-10-29 (21:10: "you act as lawyer / head of Marketing / head of Prepress / Logistics — think and recommend"). Every value below is **recommended by the assistant, delegated by the owner 2026-10-29**. Implemented in C12 (branch `design/stage-c-content`); recorded in `getpack-api/docs/decisions.md` as **D-460**. Nothing about the company is stated — certificates, customer names or logos, photos, counts, awards and years in business stay empty. Database values through the seed (first version, or one effective-dated amendment that never overwrites a person's value) and admin-API scripts (dry run by default, `--confirm`), never SQL.

| # | Topic | Decision |
|---|---|---|
| 17.1 | Prepress profile (`artwork.preflight_rules`, now *confirmed*) | Base (paper board): bleed **3 mm** · safe zone **3 mm** · images warn **< 300 ppi**, must fix **< 150 ppi** (`blockBelowPpi`) · text **≥ 6 pt** (`small_text` warn), reversed / knock-out **≥ 8 pt** (`minTextReversedPt`; not detectable yet → team check) · text below **12 pt** in **100 % K** only (`small_text_black` warn; auto-fix later) · lines **≥ 0.25 pt** · total ink **≤ 300 %** (team check until a rasteriser exists) · fonts embedded or outlined → **must fix** · ink count above the print method → must fix (§16.2) · die lines: a spot colour **CutContour** / **Die** or a layer named **die** (either), creases **Crease** → **must fix when missing on an own-file upload** (the file check; creases only when the product's engine dieline has creases; the order's own submissions keep the team match) · barcode: team check (≥ 80 % magnification, quiet zones — in the spec). Print profile **`corrugated`** (corrugate calculator or `corrugated` material class; flexo): safe zone **5 mm**, images warn **< 200** / must fix **< 100 ppi**, text **≥ 7 pt**, lines **≥ 0.5 pt**, ink **≤ 240 %**. Applied in the file check, the order preflight, the order's upload rules and the dieline template's safe distance; the upload page shows "กล่องลูกฟูก 5 มม." (`corrugatedSafeZoneMm`). Spec: `docs/design/upload-redesign/PRINT-FILE-SPEC.md` (PDF/X-4, PDF/X-1a accepted, CMYK + named spots, transparency in X-4, text outlined or embedded, die / crease separate spot layers set to overprint, 1 : 1, one design per file, ≤ 200 MB); export / import features are follow-ups. UAT: `getpack-api/docs/design/upload-redesign/set-prepress-rules.mjs` (Superadmin). |
| 17.1b | Plastic mailer bags | PK-PB-01…08 keep an empty fit range (no `flexible` engine class). Proposal only, not product data: mailer bags W × H cm **17×30, 20×30, 25×35, 28×42, 32×45, 38×52** (`docs/design/styles-redesign/PREPRESS-SIZE-TASKS.md` §1a). |
| 17.2 | Transit days (`shipping.transit_days`, now *confirmed*) | Bangkok & vicinity **1–2**, Central & East **2–3**, North / Northeast / South **3–5** (the default) working days; remote areas / islands **4–7** once a zone exists for them (none does — not seeded). UAT: `getpack-api/docs/design/checkout-redesign/set-transit-days.mjs` (zone codes given by `ZONES_JSON`; default the rehearsal zones). |
| 17.3 | Marketing content (approved after an edit pass) | The 8 `/packaging` landing pages (answer-first, "สั่งขั้นต่ำต่อเบอร์", the fit rule "+0.5 ซม. ในแต่ละมิติ" — the drafts said "ด้านละ", which was wrong; no ส่งฟรี, counts or superlatives) — `status: approved`; **`FEATURE_PACKAGING_LANDINGS` stays off** (the owner turns it on). An intro + FAQ for all 14 catalogue categories (`catalog.categoryContent`, reviewer recorded in `entries.ts`); the intro says what the category is and the API's mode line (instant / quote / mixed) follows it. Notice wording approved for `file_check.checked` and `order_group.payment_overdue` (e-mail + LINE); flags `artwork.file_check_notify` and `orders.payment_overdue_reminder` **stay off**; UAT: `getpack-api/docs/design/content/set-notice-wording.mjs`. Trust section: the tax-invoice note plus a "ขั้นตอนการทำงาน" block (ตรวจไฟล์ → อนุมัติแบบ → ผลิต → ตรวจคุณภาพ → จัดส่ง) with the default tolerances from the settings (`store.publicConfig.get` `tolerances`: quantity ± %, size ± min–max mm, colour ΔE2000 standard / flexo); no certificates, photos or logos. Recommended, not implemented: first 6 Studio-featured styles **PK-TE-01, PK-CF-01, PK-CS-01, PK-TR-04, PK-LB-01, PK-SL-02**; featured services: graphic design, box structure design, physical sample (Admin / Marketing enter them in `studio.featured_styles` / `storefront.featured_services`). |
| 17.4 | Legal — **DRAFT pending review by a licensed Thai lawyer** (owner accepted their use on UAT meanwhile) | Privacy §6 (retention): unordered file-check files deleted 90 days after their last change; an order's artwork kept for reorders and as support for accounting / tax records; files and designs deleted on request ("ลบได้ตามคำขอ") except what the law requires; requests via the contact page, answered within 30 days (PDPA s.30 practice). Partner agreement key clauses on `/partner-with-us` and in `getpack-web/docs/legal/PARTNER-TERMS-DRAFT.md`: getpack is the customer's counterparty; no direct contact or sale to customers met through getpack during the agreement + **12 months**; customer data and artwork used for the job only, deleted / returned on request, PDPA processor duties; white label (no factory name or logo on anything that reaches the customer). Time frames for breach notice and data return, breach remedies and governing law are left to the lawyer. Factory FAQ: who owns customer data, factory names never disclosed, the non-solicitation question — factual, GLOBAL-RULES §1. |
