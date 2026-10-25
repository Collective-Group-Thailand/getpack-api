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
