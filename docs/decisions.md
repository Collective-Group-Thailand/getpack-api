# Packio — Decision Log

> Same file in `packio-api/docs/decisions.md` and `packio-web/docs/decisions.md`. Prompts reference decisions by id (`D-###`). A decision changes only by a new entry that supersedes the old one.
> Status: **Accepted** = business confirmed · **Proposed** = recommendation awaiting confirmation · **Open** = needs an answer.

## Architecture & programme
| ID | Decision | Status |
|---|---|---|
| D-001 | Brand: **Packio — Your Packaging Production Partner**, by Collective Group (Thailand). "Locopack" always means the legacy system. | Accepted |
| D-002 | Two repositories: `packio-api` (NestJS 12, PostgreSQL 18 + pgvector) and `packio-web` (one Next.js 16 app, customer/admin/partner host-based zones, BFF auth). Only the OpenAPI contract is shared; `@packio/dieline` is published from `packio-web`. | Accepted |
| D-003 | ~~Rebuild with a one-time ETL~~ — **superseded by D-005**. | Superseded |
| D-005 | **Packio is a new business; nothing is migrated from Locopack.** Locopack (code and docs in `legacy/`) is a **reference for logic and workflows only** — pricing formulas, calculators, order/artwork workflows, reports. No customers, factories, orders, documents, catalogue or master data are imported; no ETL, no cut-over, no redirects from old URLs, no forced re-login. Catalogue and master data are created in Packio by admins (with Excel import tools); factory cost tables are entered through partner onboarding (D-011, D-040). Legacy third-party accounts (SCGP PDPA API, SAP, legacy merchant/LINE/SMS accounts) are not reused — Packio opens its own accounts under Collective Group (Thailand) and builds its own consent management. Collective Group (Thailand) **has confirmed the right to reuse Locopack code and pricing formulas** (2026-09-22). | Accepted |
| D-004 | `packio-web` starts fresh from the BoxStudio single app; PROGRESS restarts 2026-09-22. | Accepted |

## Commercial model
| ID | Decision | Consequences | Status |
|---|---|---|---|
| D-010 | **Packio is the seller (principal).** All customer documents (quotation, tax invoice, receipt, credit/debit note) are issued by the legal entity **Collective Group (Thailand)** under the Packio brand, for the full amount the customer pays (e.g. customer pays 100 → Collective Group pays the factory 80). Packio never issues documents to customers on behalf of a factory; partner factories are Packio's suppliers and bill Packio. | Customer sees one seller. Factory relationship = purchase order → delivery → supplier bill → payment. No collection on behalf of third parties (avoids e-payment licensing questions — confirm with legal counsel). | Accepted |
| D-011 | **Partner onboarding precedes any work** (application, KYC & bank account, capability matrix, capacity, delivery zones, pricing arrangement, tolerance, payout policy, agreement, site visit, trial, activation). A factory commits to produce at the price agreed in its **pricing arrangement** (D-042) before activation. | Accepted |
| D-042 | **Two pricing-ownership modes per factory**, chosen at onboarding and changeable with approval: **(a) platform rate card** — Packio owns the parametric buy-price table and the factory accepts it (whole or per line, with negotiated exceptions); **(b) factory price list** — the factory maintains its own parametric price table through proposals that Packio approves (D-040). Both feed the same calculators; quotes snapshot the version used. The term used everywhere is **buy price / price list**, never "factory cost": Packio never asks a factory to disclose its internal costs or margins. | Accepted |
| D-043 | **Three participation tiers per factory per product type**: **A** full parametric price list (instant quote + automatic selection), **B** partial — prices for common specs, standard sizes or stock products only (instant quote within that envelope, RFQ outside it), **C** quote-on-request only (RFQ with an SLA, no prices held). A factory may sit at different tiers per product type and move up over time; the tier drives whether a configuration can be quoted instantly. A product type is `instant` for a customer only if at least one active factory has a tier-A (or matching tier-B) price path for that configuration; otherwise the configurator routes to RFQ automatically (D-100). | Accepted |
| D-044 | **Price-data protection** (contractual + enforced in the system): a factory sees only its own prices; access to another factory's price lines is limited to the roles in D-141 and is written to the audit log; exports and the partner prospectus contain only aggregated, anonymised figures (k ≥ 3 factories per breakdown, D-102); peer benchmarks (D-040 group 2) are shown to Packio staff only, never to factories, and only when ≥ 3 active factories serve the type; the partner agreement carries a confidentiality clause covering both directions. | Accepted |
| D-012 | **Factory rejection:** the customer price never changes. Re-assignment goes to another activated factory at *that* factory's system cost; Packio absorbs the difference from its margin. | Rule: auto-reassign only to factories that keep margin ≥ configurable minimum; otherwise escalate to a human. Rejection rate and SLA tracked in the scorecard and the partner agreement. | Accepted — margin floor **10 %**, configurable by superadmin (D-063) |
| D-013 | **Shipping:** the producing factory delivers with its own fleet. Packio charges the customer from a **customer shipping rate card** and pays the factory from a **per-factory shipping payout rate card** (e.g. customer ฿5 / factory ฿4). Packio-booked carriers (existing integrations) remain as fallback where a factory cannot serve an area. | Two rate cards per zone/zipcode × weight/volume; shipping margin visible in reports; POD mandatory for factory deliveries. | Accepted (fallback Proposed) |

## Payments & money flow
| ID | Decision | Consequences | Status |
|---|---|---|---|
| D-020 | **Payment schedules**: an order has a schedule of instalments, e.g. 100 % upfront, deposit + balance before shipping (50/50), or credit term (B2B). Schedules come from templates selected by rules (customer type, order value, product type) and can be overridden with permission. Default rules: below **THB 20,000** → 100 % upfront; **THB 20,000** and above → 50 % deposit + 50 % before shipping, or any number of instalments defined in the template; approved B2B → credit term. | "Start production" requires the instalments marked *required before production*; shipping is blocked while *required before shipping* instalments are unpaid. Deposit tax invoice + final tax invoice netting the deposit — **confirm tax-point treatment with the auditor**. | Accepted — threshold THB 20,000, configurable by superadmin |
| D-021 | **Quantity tolerance (± %)** configurable per factory, overridable per product type. Shown to the customer at quote time (value of the selected factory) and frozen in the quote snapshot. | Proposed default billing: shortage within tolerance → pro-rata credit to the customer; overage within tolerance → not charged; outside tolerance → automatic claim. Delivered quantity reported by the factory drives both customer credit and factory payable. | Accepted |
| D-022 | **Factory payout policy** configurable per factory. Default: *x %* on job acceptance (materials), remainder after POD **and** the claim window, minus claim deductions, with an optional reserve %. Faster terms (e.g. immediate) can be granted per factory. | Payout batches per cycle; bank bulk-transfer file first, bank API later; withholding tax where applicable (confirm with the auditor whether factory jobs are *hire of work*); factory statements. | Accepted — 30 % on acceptance, remainder after the 7-day claim window, 5 % retention; payout run approved in 2 levels (Finance proposes, executive approves) |

## Finance & accounting
| ID | Decision | Consequences | Status |
|---|---|---|---|
| D-030 | **No SAP.** All SAP integrations are removed from scope (process service, SQS SAP activity, PR/PO/GR calls, SAP reason codes, SAP retry screens). Legacy SAP data is migrated as read-only history on the order. | B2.5 rewritten. Legacy product hierarchy PH1–PH6 is **dropped**; reporting uses Packio product categories. | Accepted |
| D-031 | **Full general ledger inside Packio** (Packio Accounting). | New bounded context `ledger` in `packio-api` and a finance area in the admin zone. See scope note below. | Accepted |
| D-032 | Minimum finance capability at go-live (R1) — detailed in `accounting-design.md`, because SAP disappears with legacy: customer AR (invoices per instalment, tax invoices, receipts, credit notes, refunds), supplier AP (factory purchase orders, delivery confirmation, supplier bills, payouts), automatic journal posting, GL with Thai chart of accounts, VAT & WHT reports, trial balance, period close. | R1 scope grows; see `accounting-design.md` §9. | Accepted |

### D-031 scope note — what a full GL must cover (to be confirmed with the company accountant)
- Chart of accounts (Thai, TFRS for NPAEs unless the auditor says otherwise), multiple legal entities ready but one active, fiscal periods with open/close/lock and year-end close.
- Double-entry, immutable journal (corrections only by reversing entries), every entry traceable to its source document and domain event; automatic posting rules for every business event (order invoiced, deposit received, payment settled per gateway incl. fees, refund, credit note, factory bill, payout, WHT, shipping payout, claim deduction, points liability & expiry, promotions) + manual journals with approval.
- Sub-ledgers: AR (customers, aging, credit terms, dunning), AP (factories and other vendors, aging), cash & bank (gateway settlement and bank statement reconciliation), tax (output/input VAT, WHT certificates 50 ทวิ).
- Statutory outputs: ภ.พ.30 working reports (sales & purchase tax reports), ภ.ง.ด.3 / ภ.ง.ด.53 working reports, trial balance, balance sheet, P&L, GL detail, audit-trail export for the auditor; e-Tax invoice & e-Receipt readiness (Open).
- Out of scope unless requested: payroll, fixed-asset register, inventory costing, budgeting, consolidation.

| D-033 | Accounting & control design per `accounting-design.md` (tax model, chart of accounts, documents, 30 posting rules, sub-ledgers, close checklist, SoD, auditor role). Items marked ⚖ are configurations that the company CPA/auditor confirms before go-live. | Accepted (⚖ items pending CPA) |

## Partner onboarding & cost governance
| ID | Decision | Status |
|---|---|---|
| D-040 | Price tables are versioned and **effective-dated**, whoever owns them (D-042). In mode (b) the factory proposes changes in the partner zone and Packio approves; in mode (a) Packio staff maintain the rate card and the factory accepts new versions before they apply to new orders. Orders already priced keep the snapshot of their quote. Packio staff see a **suggested value, basis and risk flags** for every line, plus an impact simulation (see note below); suggestions are an internal tool for setting and reviewing buy prices and are never shown to factories. | Accepted |
| D-041 | New partners are approved by the **Partner team**; at least **one site visit** is required before `trial → active`. | Accepted |

### D-040 note — price components and how the system suggests
Price components (modelled on the legacy master price tables) fall into five groups, each with its own suggestion method:
1. **Materials** (paper by type/gsm, board by grade/flute, films, inks, foils): *index-linked*. The system keeps a **material price index** per material family, fed by a pluggable source — admin-entered mill/distributor price lists first, optional paid feeds later (global pulp & paper indices are subscription data), plus Thai official producer-price indices where available. Suggested price = factory's approved price × (index now ÷ index at last approval). Flag when the proposal deviates more than a configurable band from the suggestion.
2. **Process rates** (printing per colour/sheet, plates, die-cut per sheet, die blocks, coating/foil/emboss per area, gluing/assembly, sorting, packing): *peer benchmark (≥ 3 active factories, staff-only — D-044) + own history*. Normalise each rate to a common unit, compare with the median and P25/P75 of active factories with the same capability, and with the factory's own history adjusted by a **cost-driver index** (minimum-wage changes, electricity Ft, general PPI). Suggest the lower of (own history × driver index) and peer P75.
3. **Waste / setup allowances** (paper trim, make-ready sheets, waste %): *actuals-based*. From production reports (reported good vs scrap quantities, R2) compute the factory's actual waste per product type; suggest the actual P75 and flag proposals above it.
4. **Commercial terms** (margins per print type, step prices, code margins, minimum order, lead time): not suggested from market data; admins see **impact only**.
5. **Shipping buy rates** (D-013): suggest from the customer rate card minus the target shipping margin, and from other factories serving the same zone.
For every proposal the admin screen shows: current value, proposed value, suggested value with its basis, deviation %, **impact simulation** (re-price the factory's quotes of the last 90 days: price change, margin change, change in how often this factory would have been selected), and approve / reject / counter-propose with comment. Approved values are versioned with effective dates; nothing overwrites history.

## Selling & promotions
| ID | Decision | Status |
|---|---|---|
| D-050 | Customers **do not see factory names** and cannot choose a factory; they see Packio's price and lead time. | Accepted |
| D-051 | Quotations are valid **15 days** with the price locked; after expiry the quote is re-priced. | Accepted |
| D-052 | Staff discounts: CS may give up to **5 %** on their own. Above 5 % CS raises a **discount memo** (reason, customer, order value, requested %, resulting margin, evidence such as a competitor quote) routed by an approval matrix — proposed default: > 5–10 % **Director**, > 10–15 % **VP**, > 15 % or any discount below the margin floor **C-Level** (only C-Level can go below the floor, explicitly flagged). Approval is valid for the quote's validity (15 days). Limits and tiers configurable by superadmin. | Accepted (tier boundaries Proposed) |
| D-053 | **Full promotion engine** for the web and CS channels (note below). | Accepted |

### D-053 note — promotion engine scope
- **Types**: coupon codes (single code, bulk unique codes, per-customer codes), automatic promotions (no code), campaigns (a time-boxed container with budget and goals grouping promotions and banners), referral programme (invite → both get a reward), loyalty points (legacy rules: earn per packaging type/min order, redeem, expiry, campaigns).
- **Conditions**: date/time window, channel (web, CS, LINE, B2B), customer segment (new, returning, B2B company, tag), product type / category / specific products, quantity tiers, order value, first order, payment method, shipping zone, usage limits (total, per customer, per code), combinability.
- **Benefits**: percentage, fixed amount, tiered by quantity/value, free shipping, free design / free revision rounds, free mockup, points multiplier, bonus points, price-per-piece override for a campaign.
- **Rules**: stacking & priority (exclusive, stack with, best-of), budget caps with auto-stop, **margin guard** (no promotion or combination may take an order below the margin floor; it is capped automatically and the capped amount is shown), abuse controls (per-phone/email/device limits, rate limits on code attempts).
- **Accounting**: discounts post to 4910 with the campaign/promotion dimension; points to 2330/6120 (`accounting-design.md` P09–P12).
- **Reports**: redemptions, cost of promotion, revenue and margin by campaign, new vs returning customers acquired, code performance.

## Payments
| ID | Decision | Status |
|---|---|---|
| D-060 | Unpaid-order expiry uses the **legacy rule**: `expired_at` set at order creation, fallback 7 days when missing, auto-cancel job every minute. The agent extracts the exact `expired_at` computation from the legacy code in B2.3 and records it here. | Accepted (exact value to extract) |
| D-061 | Bank-transfer slips are verified **automatically** through a slip-verification adapter (e.g. Slip2Go or SCB slip verify: receiver account, amount, date, duplicate transaction reference). Only failures go to **Finance**, SLA **4 business hours**. Gateways (2C2P, SCB) confirm automatically. | Accepted |

## Artwork & production
| ID | Decision | Status |
|---|---|---|
| D-070 | Preflight **blocks** on size mismatch or missing bleed; **warns** on low resolution or RGB. | Accepted |
| D-071 | Hired design: target **5 business days**, maximum **10 business days**; **3 free revision rounds**. From round 4: fee per round = **max(THB 500, 20 % of the order's design fee)**; a change that alters the structure/dieline or the concept is a new design (re-quoted), not a revision. Values configurable by superadmin; the customer confirms and pays before the extra round starts. | Accepted |
| D-072 | Physical proof / mockup is an **optional paid add-on** chosen by the customer (legacy behaviour). | Accepted |
| D-073 | **Production starts automatically** when artwork is approved **and** the instalments required before production are paid; CS can start manually only as an exception with a reason (permission + audit). Flow in `start-production-flow`. | Accepted |
| D-074 | Factory must accept within **1 business day**; overdue → alert and proposal to move the job (D-012). | Accepted |
| D-075 | Stage updates are tied to the **factory scorecard and job allocation** (factories that update on time get priority in selection). Stage lists per product type remain editable data. | Accepted |
| D-076 | QC is done by the **factory with photo evidence**; Packio inspects on a **risk basis** (all values configurable by superadmin): order value **≥ THB 300,000 → 100 %** inspected; **THB 100,000–299,999 → 20 %** random; the **first 3 jobs of a new factory** (trial) → 100 %; factories whose defect/claim rate over the last 90 days exceeds **3 %** → 50 % until back below; special finishes (foil, emboss, window) or food-contact packaging → +20 percentage points. Sampling by ISO 2859-1 general level II, AQL **0** critical / **2.5** major / **4.0** minor. Inspection result feeds the scorecard (D-075). | Accepted |

## Delivery, claims
| ID | Decision | Status |
|---|---|---|
| D-080 | Quantity tolerance billing: shortage within tolerance → pro-rata credit; overage within tolerance → not charged; outside tolerance → automatic claim. | Accepted |
| D-081 | Orders auto-complete **7 days** after delivery; customers can confirm receipt themselves earlier. | Accepted |
| D-082 | Claim window **7 days** after receipt; required evidence: product photos **and** shipping-carton photos. | Accepted |
| D-083 | Liability: wrong spec / print defect → factory; transit damage → factory (it is the shipper); errors in artwork the customer approved → customer. | Accepted |

## Finance operations
| ID | Decision | Status |
|---|---|---|
| D-090 | The system **generates the factory billing statement** from PO + POD and the factory confirms it; the factory's own tax invoice is still recorded (`accounting-design.md` §2 self-billing). | Accepted |
| D-091 | e-Tax invoice & e-Receipt: data model ready in R1, enabled in **R2**. | Accepted |
| D-092 | Issuing legal entity: **Collective Group (Thailand)** (exact registered name, tax id and branch stored in `settings`). Packio is a **new business with no orders in flight**: no cut-over or run-off of legacy documents; document series start fresh. | Accepted |
| D-093 | Payout bank is **configurable**: one or more company bank accounts per entity, a bulk-transfer format adapter per bank (SCB, KBank, BBL, KTB… added as adapters) with a generic CSV fallback; bank chosen per payout run. | Accepted |
| D-063 | A **superadmin** role configures platform thresholds (margin floor, discount limits, payout policies, tolerance defaults); every change is audited and effective-dated. | Accepted |


## Launch strategy
| ID | Decision | Status |
|---|---|---|
| D-100 | Launch catalogue covers **every packaging type in the market**, delivered in two tiers (a type is instant only where a factory price path exists — D-043): **Instant quote** (a ported/new calculator gives price and lead time online) and **RFQ — request for quote** (customer submits spec, files, quantity, target date; CS/factory quote within an SLA through the same order pipeline once accepted). A type moves from RFQ to Instant when its calculator ships. | Accepted — 7 instant types + RFQ for the rest (see note) |
| D-101 | Launch with **one partner factory** capable of all types. Multi-factory features are built into the data model but **auto-selection, auto-reassignment (D-012) and peer-benchmark cost suggestions (D-040 group 2) activate only when ≥ 2 (benchmarks: ≥ 3) active factories serve the product type**; until then: rejection/overdue → escalate to CS/Partner team, cost suggestions use index and own-history methods only. Capacity per product type per week is configured for the factory and enforced on lead-time promises. | Accepted |
| D-102 | **Demand & growth analytics in R1**, because traffic and order data are the argument for recruiting more factories: traffic and funnel (visit → configure → quote → order → paid), quotes and RFQs by product type × spec × quantity band × province, GMV, AOV, conversion, repeat rate, lead-time and price competitiveness signals (abandoned after price shown), **unmet demand** (RFQs declined, types/specs the factory cannot make, capacity-limited dates), factory utilisation and on-time rate. Exportable "partner prospectus" report with **aggregated, anonymised data only** (PDPA; no customer identities or prices of individual customers). | Accepted |

### D-100 note — launch tier per type (confirmed 2026-09-22)
| Product type | Source | Launch tier |
|---|---|---|
| Folding carton (A, B, digital) | legacy calculator | **Instant** |
| Corrugated (+ combine) | legacy calculator | **Instant** |
| Labels & stickers | legacy calculator | **Instant** |
| Tags & sleeves | legacy calculator | **Instant** |
| Flexible pouches | legacy calculator | **Instant** |
| Standard / stock products | legacy calculator (table-based) | **Instant** |
| Services (design, mockup, other service items) | legacy calculator | **Instant** |
| Rigid / gift boxes, paper bags, food packaging, tubes, custom tape, POP displays, others | no complete legacy calculator | **RFQ** (new calculators later, prioritised by RFQ demand) |
Consequences: all 7 calculators are ported with golden tests before launch; the launch factory must have cost tables for all 7 — Packio admins may enter them on the factory's behalf during onboarding (**assisted onboarding**), with the factory's sign-off recorded; afterwards the factory maintains them (D-040).


## Release scope
| ID | Decision | Status |
|---|---|---|
| D-110 | **R1 (launch) scope = the full platform** except the items listed as R2 below. R1 includes, in addition to the core order-to-cash flow: 3D preview in the configurator; multi-item cart with multiple delivery addresses; proof annotations & version compare; one-click reorder; campaigns with budgets & referral; loyalty points; B2B company accounts with credit terms & internal approvals; LINE LIFF; index-based material cost suggestions; factory scorecard; fixed-asset register; external carrier fallback through a common `CarrierAdapter` with **1–2 carriers live** (D-114); split & multi-destination shipments; public tracking link; web push & realtime. | Accepted |
| D-111 | **R2** = card instalments (2C2P IPP) and SCB direct debit; e-Tax invoice & e-Receipt enablement (D-091); partner-zone offline sync (PWA background sync); remaining legacy-style operational reports (calculate/search/drawing/event logs, promotion usage beyond the campaign dashboard); the remaining legacy carriers as additional adapters. | Accepted |
| D-112 | Previous "R2 traceability / R3 commerce & B2B" split in the prompts is **retired**; prompts use R1 / R2 as defined in D-110/D-111. | Accepted |
| D-113 | **Single public launch** when R1 is complete — no closed beta milestone. Mitigation: a full **UAT with the launch factory and internal staff running real test orders end-to-end** (including payments in sandbox, documents, payout, GL) before go-live, and a launch-readiness checklist. | Accepted |
| D-114 | Carrier fallback: common `CarrierAdapter { quote, book, label, track, cancel, webhook }`; R1 connects **1–2 carriers** — proposed **Flash Express** (nationwide parcels) and **Deliveree** (on-demand trucks for bulky cartons/pallets); others added later without changes elsewhere. | Accepted (carrier choice Proposed) |


## B2B company accounts
| ID | Decision | Status |
|---|---|---|
| D-120 | KYC: company certificate ≤ 6 months old, ภ.พ.20 (if VAT-registered), authorised signatory details. | Accepted |
| D-121 | Credit: new accounts start prepaid (limit 0). Eligible after 3 paid orders or a financial-statement review. Limit ≤ THB 100,000 approved by Finance; above by C-Level. Terms 15 / 30 / 45 / 60 days (default 30). | Accepted |
| D-122 | Overdue: reminders 7 days before and on due date; > 7 days overdue blocks new credit orders (prepaid still allowed); no late fee. | Accepted |
| D-123 | Company-side approval: each company sets the order value above which its approver must approve before the order is placed. | Accepted |
| D-124 | Company pricing: company-level discount % through the discount-memo approval matrix (D-052), never below the margin floor. | Accepted |
| D-125 | Tax invoice per order plus a **monthly statement** for consolidated payment; PO number required or optional per company; multiple branches and delivery addresses, tax invoice per branch. | Accepted |

## Loyalty & referral
| ID | Decision | Status |
|---|---|---|
| D-130 | Earn rate: **1 point per THB 500** paid (before VAT, excluding shipping), tier multipliers apply (D-134). | Accepted |
| D-131 | Redemption value: **1 point = THB 2.50** (≈ 0.5 % back). Baht-defined rewards convert at this value (rounded down to whole points): sign-up THB 50 = 20 pts, LINE linking THB 20 = 8 pts, review THB 10 = 4 pts, referral THB 500 = 200 pts, minimum redemption THB 10 = 4 pts. Posting rule P10 uses THB 2.50 per point (`accounting-design.md`). | Accepted |
| D-132 | Points credited when the order is completed and the 7-day claim window has passed; reversed for claimed/refunded amounts. Expiry 12 months per earning, reminder 30 days before. | Accepted |
| D-133 | Redemption: minimum equivalent of THB 10 (converted to points), max 20 % of the order value, never below the margin floor. | Accepted |
| D-134 | Tiers by 12-month spend: Member ×1; Silver ≥ THB 50,000 ×1.25; Gold ≥ THB 200,000 ×1.5. | Accepted |
| D-135 | Activity rewards (baht value): sign-up THB 50, LINE linking THB 20, review after delivery THB 10. | Accepted |
| D-136 | Referral: referee 5 % off first order (max THB 500); referrer THB 500 in points after the referee's first order passes the claim window. Anti-fraud: no reward if phone/address/card/device matches the referrer; max 10 rewarded referrals per referrer per month; suspicious cases reviewed by Marketing. | Accepted |

## Roles, visibility, notifications
| ID | Decision | Status |
|---|---|---|
| D-140 | Roles — Packio: Superadmin, C-Level, VP, Director, Admin, CS, CS Lead, Prepress, Finance, Finance Manager, Logistics, Marketing, Partner Manager, Auditor (read-only). Factory: Owner, Planner, Operator, QC, Shipping, Factory Accountant. B2B company: Company Admin, Buyer, Approver, Accountant. Users may hold several roles; conflicting duty pairs are blocked (SoD, `accounting-design.md` §8). | Accepted |
| D-141 | Cost & margin visibility: full factory cost — Superadmin, C-Level, VP, Finance (+Manager), Partner Manager; CS sees margin % only when discounting; Prepress and Logistics see neither. | Accepted |
| D-142 | Factories see only recipient name, delivery address and phone of the customer — no email, selling price or order history. | Accepted |
| D-143 | Customer channels: email for everything; LINE when linked; SMS for critical events only (OTP, instalment due, shipped, claim decision); web push when permitted. Staff: in-app + LINE group per team (Teams adapter available). Factory: partner-zone push + LINE + email. | Accepted |
| D-144 | Marketing messages only 09:00–20:00 and with PDPA consent; transactional anytime. Customers can opt out of marketing, not of order/finance messages; they choose channels. | Accepted |

## Other R1 items
| ID | Decision | Status |
|---|---|---|
| D-150 | Fixed-asset register: categories, straight-line depreciation per category life with monthly auto-journal, disposal/write-off; no barcode tagging. | Accepted |
| D-151 | LINE LIFF: order status, slip upload, artwork approval, reorder, points, chat with CS. | Accepted |
| D-152 | 3D preview for all box styles (folding, corrugated); 2D product mockups for labels, pouches, tags and sleeves. | Accepted |
| D-153 | Reorder: same spec & artwork, re-priced at current cost, quantity editable; proof skipped if artwork unchanged; plate/die-block charges not repeated when reusable. | Accepted |
| D-154 | Campaign budget in THB; auto-stop when exhausted; Marketing alerted at 80 %. | Accepted |
| D-155 | Factory scorecard monthly: on-time acceptance, on-time shipping, QC first-pass, claim rate, on-time status updates; visible to the factory. | Accepted |


## Schema review answers (2026-09-23)
| ID | Decision | Status |
|---|---|---|
| D-160 | **Prospectus anonymity k ≥ 3** factories per breakdown, as in D-044; the "k ≥ 5" in the B6.1 prompt is superseded. Setting `analytics.prospectus_min_group_size` = 3, configurable by superadmin (D-063). | Accepted |
| D-161 | **Reference data is admin-maintained, not imported from an external source**: Thai public holidays and factory closures are keyed in by admins (business calendars); geography (provinces, districts, subdistricts, postcodes) is admin-maintained through the catalogue admin tools. Nothing is seeded from an outside dataset. | Accepted (geography entry method: see Still open) |
| D-162 | **Discount-memo routing: only the matching tier approves** (one approver step per band, D-052); a discount below the margin floor always routes to C-Level. | Accepted |
| D-163 | **Default quantity tolerance ± 5 %** (shortage and overage), platform default for D-021; each factory and product type may override it at onboarding (effective-dated, superadmin D-063). | Proposed — value 5 % from business; per-type overrides to confirm with the launch factory |
| D-164 | **Retention release (D-022): the 5 % retention is released 30 days after the order's claim window closes**, paid in the next payout run; configurable per factory (payout policy) with the platform default as a superadmin setting. | Proposed — awaiting business confirmation |

## Still open
Approval tier boundaries in D-052 (proposed 5–10 % Director, 10–15 % VP, > 15 % C-Level) · carrier choice in D-114 (proposed Flash Express + Deliveree) · all ⚖ items in `accounting-design.md` §10 (CPA review; defaults are in place). · D-163 tolerance default 5 % (confirm; per-type overrides with the launch factory) · D-164 retention release 30 days after the claim window (confirm) · D-161 geography entry method (manual keying vs admin Excel import of ~7,400 subdistricts) · overage within tolerance: whether the factory is paid for the extra pieces the customer is not charged for (D-080 × P15).
