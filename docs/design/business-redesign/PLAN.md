# business-redesign — PLAN (API side, `getpack-api`)

Phase 0 discovery for `/business`, `/business/apply`, `/contact`, `/partner-with-us`, `/network`, written from the
backend repository. The pages themselves live in `getpack-web`; the web session writes its own half of this plan
(routes, components, form handlers). This file covers what the API serves today, the confidentiality audit, what is
missing, and the schema/API changes each later phase needs.

Phase 3b (API) is **done** on `fix/uat-phase0` — see `API-CHANGES.md` and decision **D-435**.

---

## 1. What the API serves today

### 1.1 Business accounts (`/business`, `/business/apply`) — `src/modules/companies`, `src/modules/b2b`

| Capability on the page | API today | Notes |
|---|---|---|
| Open a company account (KYC) | `store.companies.apply`, `addKycDocument`, `submitKyc`; staff `admin.companies.reviewKycDocument` / `approveKyc` / `rejectKyc` / `setStatus` | `companies.status` applied → kyc_review → active / suspended / closed (D-120). Files go through `store.files.presign` (purpose and size limits from the files module). |
| Roles: ผู้ดูแล · ผู้สั่งซื้อ · ผู้อนุมัติ · ฝ่ายบัญชี | `company_admin`, `company_buyer`, `company_approver`, `company_accountant` scoped roles; `store.companies.inviteMember` / `acceptInvitation` / `changeMemberRoles` / `removeMember` / `listInvitations` | Company scope in the token (`company:<uuid>`). |
| Approval above a threshold | `companies.order_approval_threshold` (null = never, D-123); `store.companies.updateSettings`; `store.companyApprovals.list` / `decide`; order group status `pending_company_approval` | Approval policy `company_order_approval` in the approvals engine. |
| PO number | `companies.po_number_policy` (`optional` / required), set by `updateSettings` | |
| Branches (tax-invoice branch) | `store.companies.addBranch` / `removeBranch`; `company_branches` (head office 00000) | No budget, cost centre or spend limit per branch. |
| Credit term 15–60 days | `store.companyCredit.apply` / `get` / `receivables` / `listStatements` / `statement`; staff `admin.companyCredit.requestLimit` (maker-checker) | Eligibility from `paid_orders_count` (D-121). Rules unchanged by this pack (hard rule 2). |
| Monthly statement, tax invoices | `store.companyCredit.statement(s)`, `store.documents.*` (customer documents), `b2b.documents.*` | |
| Spend overview | `store.companies.spend` | Per company; not per branch / cost centre. |
| Brand assets | `store.companyAssets.*` | |
| Machine access | `store.companyApiClients.*` (OAuth2 client credentials, D-291) → `/v1/b2b/*` (orders.place, listQuotes, documents, webhooks) | |
| Reorder | `store.reorderSuggestions.list` / `dismiss` (suggestions); re-order of a past order goes through saved quotes / cart | **No CSV reorder endpoint** (order code + quantity file). |

### 1.2 Contact (`/contact`) — `src/modules/conversations`

- `POST /v1/store/support/actions/contact` (`store.support.contact`, public, `Idempotency-Key`): opens a **support
  ticket** (`support_tickets`) on a CS conversation — the signed-in customer's own chat, or a new one for a guest who
  leaves a name and a phone or e-mail. Answers the ticket number (series `support_ticket`, format `CS-YYMM-NNNNN`), the
  first-response target (`support.first_response_business_days`, D-175) and a LINE link carrying only the ticket
  number. `store.support.handoff` does the same from guided help, with `callback: true` for a call back.
- Delivery: no e-mail; CS works the ticket in the admin inbox (conversations). Guest contact details are PII, shown to
  CS only, never logged.
- Spam protection: per-client throttle `SUPPORT_THROTTLE_LIMIT` (default 5 / minute). **No honeypot or Turnstile.**
- Topic is a free string (`order_status`, `quotation`, `artwork`, `other` …), not a closed enum.
- Contacts on the page / footer / JSON-LD: `store.support.getChannels` and `store.publicConfig.get.contact` from the
  setting `storefront.support_channels` (`lineOaId`, `phone`, `email`, `hours`; CS Lead; unset = all null). Company
  data (legal name, tax id, address, phone) are entity settings `entity.legal_name_th`, `entity.tax_id`,
  `entity.address_th`, `entity.phone` — **not exposed on any store endpoint**.

### 1.3 Partner with us (`/partner-with-us`)

- No public application endpoint. Factories are created by staff (`admin.factories.create`,
  `admin.factories.createOwnerAccount`) after onboarding; agents can register a factory lead
  (`store.agent.registerLead`, kind `factory`, D-419).
- Factory ERP lives under `/v1/partner/factories/{factoryId}/erp/*` (modules E1–E6). There is **no machine-readable
  module status** ("ใช้ได้แล้ว / กำลังพัฒนา") the public page could read.

### 1.4 Network (`/network`)

- Was `GET /v1/store/network/stats` (D-201 / D-264). **Removed in this step (D-435).** The web page becomes static
  "มาตรฐานการผลิตของ getpack" copy; the tolerance figures it states (± 3 mm, ΔE2000 ≤ 3, ± 5 %) are fixed by
  GLOBAL-RULES §6 and may later be read from `fulfilment.tolerance_default_pct` / the guarantee policy
  (`store.guarantee.get`) — no new endpoint is needed for Phase 3b.

---

## 2. Confidentiality audit

### 2.1 Customer / public can see factory information

| # | Surface | Finding | Status |
|---|---|---|---|
| C1 | `GET /v1/store/network/stats` | partner count, min-factories threshold, coverage per product type, audit criteria | **Fixed** — endpoint, service and `trust.*` settings removed |
| C2 | `store.publicConfig.get` | `factoryCount` | **Fixed** — field removed |
| C3 | `store.styles.get` / `compare` | `partnersCount` | **Fixed** — field removed |
| C4 | `store.styles.get` / `compare` | variant `priceReasons` could say `not_makeable` (no factory can make it = coverage) | **Fixed** — never sent on the store (price path only) |
| C5 | `store.agent.commissions`, `store.agent.statement` | `factoryName` on bounty entries | **Fixed** — staff only |
| C6 | `store.agent.me` | `totals.factories` | **Fixed** — staff only (`AdminAgentTotalsDto`) |
| C7 | `store.callOffs.*` | `factory` field (null, but present) and `buyUnitPrice` | **Fixed** — `StoreCallOffAgreementDto` without both |
| C8 | `store.shipments.list` | `events[].location` on pickup / line-haul / return steps (origin side) | **Fixed** — location only on `out_for_delivery`, `delivered`, `failed` |
| C9 | `store.timeline.get` | shipment steps' `params.location` — same leak as C8 | **Fixed** — same rule |
| C10 | Status words | customer `picked_up` = "ออกจากโรงงานแล้ว" / "Left the factory" | **Fixed** — "จัดส่งออกแล้ว" / "Dispatched" (staff keep theirs) |
| C11 | Every store response with a status | `statusLabelAdminTh` (staff / factory words) is sent to customers too, and `store.statusLabels.list` (public) lists `labelAdminTh`: "รอโรงงานรับงาน", "โรงงานรับงานแล้ว", "โรงงานปฏิเสธงาน", "รอโรงงานตรวจสอบ", "ออกจากโรงงานแล้ว"; English labels shared with customers say "Factory review" | **Open (P1)** — proposal: store responses carry the customer words in both fields (or drop `*LabelAdminTh` from store DTOs in a coordinated contract change); move `labelAdminTh` to an `admin.statusLabels.list`; customer English words without "factory". Owned with A2 (account Phase 0: "ขั้นตอนที่โรงงาน", "รอโรงงานยืนยัน"). |
| C12 | Enum values on store responses | `CallOffStatus.pending_factory`, `ClaimStatus.factory_review`, `ClaimOwner.factory`, `ClaimAction.factory_deduction`, `QuotePathReason.no_active_factory` (`store.catalog.resolveQuotePath` = coverage signal per product type), `QuoteNoPriceReason.capacity_unavailable` (`store.quotes.calculate`, `store.studio.quote` = capacity signal) | **Open (P1)** — values are machine keys the web maps to words, but they still tell a reader that a factory exists / is missing / is full. Proposal: store-surface aliases (`pending_confirmation`, `under_review`, `getpack`, …; one `not_instant` reason) in a coordinated breaking change; never words. |
| C13 | Carrier bookings (Flash Express, Deliveree) | `srcName` / `srcPhone` / sender address = the factory's primary contact and pickup address; the carrier's own tracking page (`trackingUrl`) and waybill show the sender and origin branch | **Open (P0 when a carrier is switched on; flags are off today)** — sender name and phone must be getpack's (`entity.*` settings); pickup address stays (the carrier needs it) but use the carrier's "hide sender" / shipper-account option where it exists; review each carrier's public tracking page before enabling. |
| C14 | Call-off `declineReason`, claim notes | free text typed by the factory (decline reason) is shown to the customer as is | **Open (P2)** — staff relay, or a closed list of reasons for the customer view. |
| C15 | Proof / artwork file names | `ProofFileDto.originalName` is the uploader's file name (prepress, possibly a factory's proof) | **Open (P2)** — rename to `PK-…-proof-vN.pdf` on upload, keep the original for staff. |
| C16 | PDFs | Puppeteer PDFs carry Chromium's `Producer` / `Creator` metadata (no factory name found); carton labels and packing lists already use the getpack sender (`entity.legal_name_th`, `entity.phone`) | **Open (P2)** — strip / set `Author`, `Creator`, `Producer` = getpack on every customer PDF (hard rule 4a). |
| C17 | Photos | QC / milestone / POD photos shared with customers: EXIF/GPS is not stripped on upload (sharp re-encode only for brand marks) | **Open (P1)** — strip EXIF/GPS on every image upload in the files worker (keep the original private to staff only if needed). |
| C18 | Error codes | `store.agent.registerLead` answers `agents.lead_existing_factory` ("โรงงานนี้อยู่ในระบบ getpack แล้ว") — an agent can test whether a phone / tax id is a getpack factory | **Open (P1, needs a decision)** — one neutral code (`agents.lead_unavailable`) for "existing customer / company / factory / taken". Changes D-417/D-419 behaviour, so not done here. |
| C19 | Agent leads | a factory lead the agent registered shows `converted` when it becomes a factory | Accepted residual — the agent introduced that factory (D-419); no other factory is visible. |
| C20 | Customer e-mail / LINE templates | none of the customer rows in `prisma/seed/data/notification-matrix.ts` mentions a factory | OK |
| C21 | Spec sheet PDF, public tracking (`store.tracking.get`), carton labels, packing list | getpack brand only; tracking has no locations | OK |
| C22 | Seed / UAT data | fake factories stay in the database (allowed); no store response returns them after this step | OK |

### 2.2 Factory can see customer identity / contact data

| # | Surface | Finding | Proposal |
|---|---|---|---|
| F1 | `partner.production.*` → `JobDestinationDto.recipientName` / `phone` | recipient name and phone from job creation, not only at dispatch | Show recipient data only once the job reaches packing / a shipment is being prepared (`partner.shipments.shipPlan`, shipment create); jobs show province + postcode before that. |
| F2 | `partner.claims.*` → `PartnerClaimDto.description` | the customer's claim text verbatim (may contain names, phones, brand) | Staff-written summary for the factory, or redact PII patterns before sharing. |
| F3 | Artwork / proofs | the factory sees the customer's artwork (brand) — inherent to production | Accepted; no customer account name or contact attached. |
| F4 | Spec sheet (`partner.orders.getSpecSheet`) | order code, spec, artwork thumbnail; no customer name | OK |
| F5 | Partner agreement | no-direct-contact and confidentiality clauses | Business / lawyer (pack data list). |

---

## 3. What is missing (for Phases 1–4)

| Need | Today | Gap |
|---|---|---|
| Company catalogue | `companyAssets` (brand files), saved quotes | Catalogue items (spec + file + current price, published by company admin), setting "branch users order from catalogue only", ordering through approval/budget. New tables + `store.companyCatalogue.*`. |
| Budgets per branch / cost centre | `order_approval_threshold` per company; finance `cost_centres` are getpack's own | Customer-side cost centres, monthly budget per branch / cost centre, 80 % warning, over-budget → approval, spend report CSV/Excel. New tables + `store.companyBudgets.*`, report export. |
| Ticket status lookup | ticket number returned; no lookup | `GET /v1/store/support/tickets/{ticketNo}?contact=…` (guest: ticket no. + phone/e-mail match, rate-limited) or signed-in `store.support.listTickets`; ticket status column (open / answered / closed) and admin assignment. |
| Callback scheduling | `callbackRequested` boolean on hand-off only | Preferred window (date + slot) on contact and hand-off, CS callback queue; slots from a setting (CS Lead) — values from the business. |
| Partner applications (`/partner-with-us`) | none (staff-created factories, agent leads) | `POST /v1/store/partner-applications` (public, throttled, honeypot/Turnstile, reference `FP-YYYY-#####`), admin review queue, conversion to `admin.factories.create`. Must not reveal whether the company is already a partner (same answer either way). |
| Factory-ERP module status flags | ERP modules exist; feature flags exist for providers | A public, cached `store.factoryProgramme.get` (or a `publicConfig` block) listing ERP modules with `live` / `in_development` and optional launch date, driven by settings/flags (Partner Manager) — no factory data. |
| Contact-info config | `storefront.support_channels` (LINE, phone, e-mail, hours); entity settings not public | One public block for /contact, footer and JSON-LD: e-mail, phone, office address, tax id, LINE OA link + QR, from settings; null when unset (hard rule 6). Extend `storefront.support_channels` (address, LINE URL, QR file) or expose selected `entity.*` values. |
| Reference numbers CT- / BZ- / FP- | tickets `CS-YYMM-NNNNN`; company has `company_code` | New document series `contact_ticket` (CT-), `business_application` (BZ-), `factory_application` (FP-) in `YYYY-#####` format, or map CT- onto the existing series (decision needed: the pack says CT-, the API says CS-). |
| Spam protection | throttle only | Honeypot field + optional Turnstile verification (secret in env) on contact, business apply, partner application. |
| CSV reorder | none | `POST /v1/store/cart/actions/import-csv` (order code + quantity → re-priced cart items through the pricing service, D-051 lock), with a per-row result. |

---

## 4. Schema / API changes by phase

| Phase | API work | Migration |
|---|---|---|
| 3b (**done**) | Remove network stats; strip factory data from store responses (D-435); contract test | none (settings rows `trust.*` stay in existing databases, unused) |
| 1 /business | contact-info block; BZ- reference on `store.companies.apply`; honeypot/Turnstile; CSV reorder (if in scope) | series row (seed), maybe `companies.application_ref` |
| 2 /contact | ticket status + lookup, CT- format, callback window, closed topic enum, honeypot/Turnstile | `support_tickets.status`, `assigned_to`, `callback_window`; new series |
| 3 /partner-with-us | partner applications + review queue + FP- reference; ERP module status config | `factory_applications` table; settings for module status |
| 4 | company catalogue; budgets per branch / cost centre; ETAX.md before any build; ticket system completion | catalogue + budget tables (reversible, expand-first) |

Every migration expand-first and reversible (down SQL kept in the PR description / runbook, as the repo uses forward-only
Prisma migrations).

---

## 5. Risks

1. **Contract change for the web (Phase 3b):** `factoryCount`, `partnersCount`, `factoryName`, `totals.factories`,
   `CallOffAgreementDto.factory/buyUnitPrice` (store) and `/v1/store/network/stats` are removed — the web must run
   `pnpm gen:api` and drop the network page's API call in the same release (see `API-CHANGES.md`).
2. **Residual leaks C11–C18** remain until their phases; C13 is a blocker for switching on any carrier integration.
3. D-201 / D-264 were accepted decisions; D-435 supersedes them on the business decision in the redesign pack.
   The internal partner prospectus (D-102) and admin coverage reports keep aggregated factory data — staff only.
4. Removing `trust.*` from the seed leaves their rows in already-seeded databases (UAT); they are unused. A cleanup
   needs an explicit data migration — not done (conservative).
5. Enum renames (C12) are breaking and must be coordinated with `getpack-web`.
