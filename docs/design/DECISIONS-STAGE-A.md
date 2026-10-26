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
