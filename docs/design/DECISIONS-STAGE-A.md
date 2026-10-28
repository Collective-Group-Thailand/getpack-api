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
