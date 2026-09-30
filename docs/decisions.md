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
| D-060 | Unpaid-order expiry uses the **legacy rule**: `expired_at` set at order creation, fallback 7 days when missing, auto-cancel job every minute. **Legacy rule as extracted (B3.1, 2026-09-27):** every order creation path (`Api/OrderAPIController@storev2:1574`, `@store:1044`, `OrderController@store:324`) sets `expired_at = now() + AMOUNT_DATE_ORDER_EXPIRED` **calendar days** — no branch per payment method, product type or channel; the value lives in an AWS secret that is not in the repository. Choosing SCB QR / direct debit overwrites it with `created_at + SCB_DAYS_UNTIL_EXPIRATION` (sample secret: 1 day). The cron `orders:cancel-expired` runs every minute, cancels 1 minute before `expired_at` (or after > 7 days when it is NULL) and skips orders whose payment awaits approval or is paid. **Packio:** setting `orders.unpaid_expiry_days` = **7** (the legacy fallback, proposed) on the order group from placement; a QR's lifetime applies to that payment attempt only and never shortens the order's expiry; a group with a slip awaiting verification is not cancelled; cancellation releases reserved promotions and points (legacy did not). | Accepted (value 7 proposed — confirm) |
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
| D-161 | **Reference data is admin-maintained, not imported from an external source**: Thai public holidays are keyed in by admins **once per year in one national calendar shared by every factory**; each factory calendar adds only its own closures. Each holiday is marked with who observes it — days observed only by government offices or financial institutions (e.g. วันพืชมงคล, วันเข้าพรรษา) are recorded but **do not count as non-working days** for factory lead times and SLAs; geography (provinces, districts, subdistricts, postcodes) is admin-maintained through the catalogue admin tools. Nothing is seeded from an outside dataset. | Accepted (geography entry method: see Still open) |
| D-162 | **Discount-memo routing: only the matching tier approves** (one approver step per band, D-052); a discount below the margin floor always routes to C-Level. | Accepted |
| D-163 | **Default quantity tolerance ± 5 %** (shortage and overage), platform default for D-021; each factory and product type may override it at onboarding (effective-dated, superadmin D-063). | Accepted (2026-09-23) — per-type overrides agreed with the launch factory at onboarding |
| D-164 | **Retention release (D-022): the 5 % retention is released 30 days after the order's claim window closes**, paid in the next payout run; configurable per factory (payout policy) with the platform default as a superadmin setting. | Accepted (2026-09-23) |
| D-165 | **Overage within tolerance is not paid to the factory**: the factory payable (GR, P15) uses **min(delivered, ordered)** quantity; shortage within tolerance still pays the delivered quantity (D-080). Overage outside tolerance → automatic claim (D-080). | Accepted |
| D-166 | **Payout-run approval (D-022): the "executive" who approves is C-Level.** Finance proposes the run (requester); one C-Level approval; proposer ≠ approver (SoD). | Accepted (2026-09-23) |
| D-167 | **Changing a factory's pricing-ownership mode (D-042) is approved by the Partner Manager.** | Accepted (2026-09-23) |
| D-168 | **Auditor independence:** the time-boxed Auditor role (`accounting-design.md` §8) can never be held together with Finance or Finance Manager (SoD role pairs, blocked). | Accepted (2026-09-23) |
| D-169 | **Approvals no decision names default to Finance Manager**: manual journals, credit notes, refunds, write-offs, changes to posting rules, chart of accounts, tax settings and document series (one Finance Manager step); vendor and company bank-account changes need two different approvers (Finance, then Finance Manager). Changeable by superadmin as new policy versions (D-063). | Accepted (2026-09-23) |

## Catalogue & partner answers (2026-09-25)
| ID | Decision | Status |
|---|---|---|
| D-170 | **Geography entry (closes the D-161 open item): Excel import with preview → confirm for bulk loading, plus single-row admin forms for corrections.** Admins with `geography.manage` maintain provinces, districts, subdistricts and postcodes; nothing is seeded from an outside dataset (D-161). | Accepted (2026-09-25) |
| D-171 | **Factories enter Packio through the Partner team at launch**: staff create the factory (self-service or assisted onboarding mode) and invite its owner, who completes the onboarding steps in the partner zone. There is no public application form in R1; one can be added later. | Accepted (2026-09-25) |
| D-172 | **No default deviation band for price suggestions** (D-040 "flag when the proposal deviates more than a configurable band"): suggestions always show the value, basis and deviation %, but raise the `above_band` flag only once a superadmin sets `partners.suggestion_deviation_band_pct` (D-063). | Accepted (2026-09-25) |
| D-173 | **Factory-specific tolerance (D-021/D-163) and payout-policy (D-022/D-164) overrides are approved by a Superadmin** (policies `factory_tolerance_change`, `factory_payout_policy_change`; requester Partner Manager, or Finance for payout). Seeded as a proposed default, changeable as new policy versions (D-063). | Accepted (2026-09-25) — approver Proposed |

## Commerce planning answers (2026-09-27)
| ID | Decision | Status |
|---|---|---|
| D-174 | **Customer withholding rates are seeded from the accounting-design §2 design defaults** — hire of work 3 %, transport 1 %, services 3 % (`tax_rates` `wht_customer_*`), used at checkout to show the expected cash for customers whose tax profile withholds; government customers use the same rates until Finance says otherwise. Changes follow `tax_setting_change` (D-169). | Accepted (2026-09-27) — rates ⚖ pending CPA |
| D-175 | **Business hours for SLA clocks: 09:00–18:00 on working days** (national calendar, D-161), setting `calendar.business_hours`; drives the 4-business-hour slip review SLA (D-061) and any later business-hour SLA. | Accepted (2026-09-27) — value proposed |
| D-176 | **Slip verification provider: Slip2Go first** behind the slip-verification adapter (D-061); others (e.g. SCB slip verify) can be added as adapters. SCB (QR) and 2C2P adapters are built from the providers' public documentation, disabled by feature flag until Packio's own merchant accounts exist (D-005). | Accepted (2026-09-27) |

## Storefront design direction (2026-09-29)
| ID | Decision | Status |
|---|---|---|
| D-180 | **Packio visual direction** (no brand kit yet): warm paper/kraft neutrals as the base, near-black warm ink for text, **one primary accent (deep teal-green)** for actions and links, amber as a secondary highlight for campaign badges only, generous white space, product photography on clean paper/white with soft shadows, 12–16 px radii, hairline warm borders, no heavy gradients. Token values are proposed in `packio-web/docs/prompts/design-system.md` §Art direction and are replaced wholesale when a real brand kit arrives (tokens only, no component changes). Layout patterns are informed by a reference packaging store the business supplied; its design, imagery, fonts and copy are never copied. | Accepted (values Proposed) |
| D-181 | **No manufactured urgency on the storefront**: no countdown timers, "only N left" or struck-through reference prices unless they come from a real promotion/campaign in the promotions engine with a real end date (D-053). Product cards for made-to-order items show starting price per piece, the quantity that price assumes, MOQ and lead time instead of retail discount framing. | Accepted |

## U2–U5 intake (2026-09-30)
Collected in session U2.0 (`docs/prompts/RUN-ORDER-U1-U5.md` §3, `docs/prompts/U2-benchmark-2026-09-29.md`); gap analysis and findings F1–F6 in `packio-api/docs/update-2026-09-29-gap.md` §U2.0. Every value below is a setting with effective dates and audit where the decision says so (D-063 unless another owner is named).

### Specification model (U2.1)
| ID | Decision | Status |
|---|---|---|
| D-182 | **Measurement basis on every dimensioned spec**: enum `internal \| external \| over_crease \| product` on configurator input, quote, order line, design document, job spec snapshot and RFQ; dimensions stored in mm with their basis. The customer **must choose** the basis (no silent default); the other bases are computed from the material caliper and the style's construction rules by one pure conversion service shared by API and web, and shown alongside. The ported folding and corrugate calculators take **internal** dimensions; existing rows are marked `internal` in the backfill. | Accepted (2026-09-30) — "legacy inputs are internal" to be confirmed by the Pricing owner before U2.1 closes (see Still open) |
| D-183 | **Units**: the API is mm-only and rejects requests that send a unit. Display unit `mm \| cm \| in` is a per-user preference (default mm), used only by the web for display and input conversion. | Accepted (2026-09-30) |
| D-184 | **Style codes**: every style has a public code `PK-<FAMILY>-<NN>`, unique and **immutable once published** (changes refused), carried on the quote, order line, proof, job sheet, partner bundle and every export. The international name (RSC, FOL, RTE …) is a separate field, filled only when verified (D-211) — empty rather than guessed. Closes finding F6. | Accepted (2026-09-30) |
| D-185 | **Draft configurations and share links**: an incomplete configuration is persisted with a completeness score and kept **90 days** after its last change; share links are signed, expire after **15 days** (as D-051) and can be revoked; drafts convert to a quote or an RFQ. Existing quote share links get the same expiry and stop resolving after it (finding F5). Settings `configurations.draft_retention_days` = 90, `configurations.share_link_days` = 15. | Accepted (2026-09-30) |
| D-186 | **Published tolerances beyond quantity**: dimensional **± 1 mm for folding cartons, ± 3 mm for corrugated**; colour **ΔE2000 ≤ 3 against the approved proof (≤ 5 for flexo)**. Effective-dated platform defaults, overridable per factory × product type at onboarding with the same approval as D-173; shown before purchase, frozen in the quote snapshot and read by the claim engine. | Accepted (2026-09-30) — values agreed with the launch factory at onboarding, like D-163 |
| D-187 | **RFQ-accepted quotes freeze tolerance like instant quotes**: the quote created from an accepted RFQ response snapshots the factory's tolerance (or the D-163 platform default); no order is reconciled at 0 %. Closes finding F2. | Accepted (2026-09-30) |

### Structure Advisor (U2.2)
| ID | Decision | Status |
|---|---|---|
| D-188 | **Advisor data and factors**: rule set + McKee relation; safety factors (humidity, stacking duration, pallet overhang, transport shock) are effective-dated settings changed by a Superadmin (D-063). Board strength (ECT, caliper) comes from the partner's **signed board data sheets** entered as typed material data; a board without data is never recommended. | Accepted (2026-09-30) |
| D-189 | **Advisor sign-off and wording**: golden cases signed by the **Partner Manager and the Prepress lead**; output is always a range with a fixed "indicative" notice, reason codes and numbers only, never the word "AI" while no model is used. A customer may proceed against a structural warning; the acknowledgement (who, when, warning codes) is stored with the recommendation log. | Accepted (2026-09-30) |

### Target price (U2.3)
| ID | Decision | Status |
|---|---|---|
| D-190 | **Target price privacy**: optional target price per unit (THB) on configuration, quote and RFQ; **never shown to any factory**, not even in aggregate outside the prospectus; aggregated target-price figures require **≥ 5 distinct customers per cell** — new setting `analytics.target_price_min_group_size` = 5, enforced in the query layer (D-160 k = 3 stays for other prospectus figures). | Accepted (2026-09-30) |
| D-191 | **Levers and outcomes**: levers are recomputed by the real engine and valid **15 days** (D-051); "send to CS" creates a pre-filled RFQ; quote outcomes (won / lost / expired / converted to RFQ) are recorded with the target, the gap, the levers shown and the one taken; a loss reason is optional for the customer. | Accepted (2026-09-30) |

### Samples (U2.4)
| ID | Decision | Status |
|---|---|---|
| D-192 | **One sample path — extend D-072**: the mockup / physical-proof add-on becomes a single `sample` entity, either **standalone** (before any bulk order, linked to the configuration) or **attached** to an order (replacing today's in-order mockup), reusing the mockup job kind, PO kind and milestone route. The CS "add mockup" endpoints are deprecated additively and removed in U-B5. | Accepted (2026-09-30) |
| D-193 | **Sample lifecycle**: a sample is shipped to the customer and approved by the customer with evidence (who, when, IP, UA, photo hashes); approval **locks the spec and artwork version** for the bulk order; **bulk production is held until the sample is approved** whenever a sample is part of the order; "changes requested" leads to a new, re-quoted sample. Closes finding F4. | Accepted (2026-09-30) |
| D-194 | **Sample price and validity**: price entered by CS (as the mockup today) until a sample rule set has a **signed validation document** — no new formula before that; a sample quote is valid **15 days** (D-051). | Accepted (2026-09-30) |
| D-195 | **Sample freight** is paid by the customer at the customer shipping rate card (D-013); free sample freight only through a real promotion (D-053, D-181). | Accepted (2026-09-30) |
| D-196 | **Store credit is usable at checkout** as a payment method, up to the order total, from the store-credit wallet (2320). Closes finding F3. | Accepted (2026-09-30) — posting (2320 → AR) ⚖ to be confirmed by Finance |
| D-197 | **Sample cost credited against the bulk order**: **100 % of the sample's product price** (freight excluded) as a discount line on a bulk order for the **same spec** placed within **30 days** of sample approval; the discount is removed if that bulk order is cancelled. Settings `samples.credit_pct` = 100, `samples.credit_window_days` = 30. | Accepted (2026-09-30) |

### Guarantee & trust (U2.5)
| ID | Decision | Status |
|---|---|---|
| D-198 | **Remedies matrix** (published as data, read by the claim engine): severity `minor \| major \| critical`. Factory-liable defects (D-083) that are major or critical → reprint of the affected quantity **or** refund, the customer's choice; minor → partial credit; shortage beyond tolerance → reprint of the shortfall or pro-rata refund; errors in customer-approved artwork → no remedy; goodwill only through the discount-memo matrix (D-052). | Accepted (2026-09-30) |
| D-199 | **Claim SLAs**: first response within **1 business day**, decision within **3 business days** of complete evidence (business hours D-175, calendar D-161); overdue claims raise an ops signal. **No late-delivery guarantee at launch.** | Accepted (2026-09-30) |
| D-200 | **Guarantee-policy changes**: new policy version requested by the **CS Lead**, approved by **C-Level** (approval policy `guarantee_policy_change`). | Accepted (2026-09-30) |
| D-201 | **Public network statistics**: audit criteria (content) and capability coverage by product type (yes / no) are public; partner counts, on-time and first-pass-quality rates are published only when **≥ 3 active factories** and **≥ 30 completed jobs in a rolling 90 days** (rates rounded to whole %); never a partner's identity or the factory of an order. | Accepted (2026-09-30) |
| D-202 | **Reviews**: verified only (delivered order), **one per order line**, moderated by Marketing, replies by CS; public display shows an abbreviated name and the product type; the D-135 review reward stays one per order; reviews are never fabricated or synthesised (D-181). | Accepted (2026-09-30) |

### Library, dielines (U2.6 / U3.B5)
| ID | Decision | Status |
|---|---|---|
| D-203 | **Free dieline download**: signed-in customers only, watermark-free, no plan gating; **20 per user per day and 5 per minute** (settings); only published styles within their size limits; every download logged. Staff are not limited. | Accepted (2026-09-30) |

### Repeat business (U2.7)
| ID | Decision | Status |
|---|---|---|
| D-204 | **Reorder suggestions**: only after **≥ 3 earlier orders** of the same SKU (approved spec + artwork version); suggested date = simple moving average of the order intervals + lead time + **7 days** safety stock (settings); reminders count as marketing (D-144: consent, 09:00–20:00). | Accepted (2026-09-30) |
| D-205 | **Tooling (plates, die blocks) reuse**: reusable for **12 months from last use at the same factory** for an unchanged spec; kept at the factory and recorded in a tooling register (owner, location, validity, condition); the factory confirms usability at PO acceptance; if a waived tool proves unusable, Packio absorbs the remake (customer price unchanged, as D-012). Implements the D-153 waiver (finding F1). | Accepted (2026-09-30) — tooling **ownership** open (see Still open) |
| D-206 | **Call-off orders = price lock only**: a committed quantity with the price held up to **6 months** (factory agreement required); each release ≥ the factory's minimum order and becomes a normal order with the normal payment schedule (D-020); **no deposit, no stock held**; unreleased quantity lapses at expiry without charge. Stock holding or deposits need the accountant first (2310). | Accepted (2026-09-30) |
| D-207 | **B2B API access**: the Company Admin issues up to **5** scoped API keys per company; outbound webhooks are signed and delivery-logged. Post-launch (D-219). | Accepted (2026-09-30) |

### Sustainability & partner parity (U2.8 / U2.9)
| ID | Decision | Status |
|---|---|---|
| D-208 | **Sustainability data is out of scope** until a partner supplies real certificates; no system-generated claims. | Accepted (2026-09-30) |
| D-209 | **Factory business hours and closures** are edited by the factory's **Owner or Planner** and by the **Partner Manager**; audited, effective from the next day, no approval; a change never shortens the SLA of a job already accepted. | Accepted (2026-09-30) |
| D-210 | **Release hygiene**: a production build fails on debug markers (`[Dev]`, `mock`, `TODO-REMOVE`), test tax ids or `dev_only` feature flags enabled; `DEV`-prefixed document numbers are allowed outside production only. | Accepted (2026-09-30) |

### Style library (U3)
| ID | Decision | Status |
|---|---|---|
| D-211 | **Industry reference codes** (FEFCO / ECMA) are shown only after Prepress verifies them against an edition Packio legally holds; until then the field stays empty. | Accepted (2026-09-30) — whether Packio holds the editions is open (see Still open) |
| D-212 | **Style names and waves**: Thai / English names approved by **Marketing** (wording) and **Prepress** (technical terms); **wave 1 publishes only variants the launch factory can make** (U3.B3 capability); wave order as `docs/design-tool/style-library-program.md`. | Accepted (2026-09-30) |

### 3D studio (U4)
| ID | Decision | Status |
|---|---|---|
| D-213 | **Studio fonts**: only **OFL-licensed** Thai + Latin families (e.g. Sarabun, Noto Sans Thai, IBM Plex Sans Thai, Prompt, Kanit); no customer-uploaded fonts in the first release. | Accepted (2026-09-30) |
| D-214 | **Background removal** ships after launch; when built, a self-hosted model in Packio's AWS region — no external vendor without a data-processing agreement. | Accepted (2026-09-30) |
| D-215 | **Soft proof**: simplified per-material-class transforms until the factory supplies ICC profiles; always labelled "preview, not a contract proof". | Accepted (2026-09-30) |
| D-216 | **First template set**: **20** templates across the 7 use cases of the studio spec, made by the in-house / design-service team and approved by Marketing; never third-party templates. | Accepted (2026-09-30) — named author open (see Still open) |

### UX (U5)
| ID | Decision | Status |
|---|---|---|
| D-217 | **UX scorecard**: Marketing recruits **8–10 participants** per round; the competitor baseline round may run before launch but does **not** block it; the "failed gate blocks the journey" rule of `docs/ux/competitive-scorecard.md` applies from the first round **after** launch. | Accepted (2026-09-30) — moderator open (see Still open) |
| D-218 | **Assistant off at launch**; model / vendor and data terms (no training on customer data, PDPA cross-border assessment) decided in an ADR before it is enabled in any environment. | Accepted (2026-09-30) |

### Launch gating (D-113)
| ID | Decision | Status |
|---|---|---|
| D-219 | **U2–U5 launch gating.** **Pre-launch (blocking `docs/LAUNCH-CHECKLIST.md` §9):** U2.1 specification model v2 (D-182–D-187); the fixes for findings **F1** tooling waiver (D-205), **F2** RFQ tolerance (D-187), **F3** store credit at checkout (D-196), **F4** mockup lifecycle — shipping, customer approval, production hold (D-193), **F5** share-link expiry (D-185), **F6** immutable style codes (D-184); U2.5 items 1–2 (guarantee policies as data, claim SLA timeline and ops signal — D-198–D-200); U2.9 item 6 release hygiene (D-210). U-B0 and U-B6 remain pre-launch as before. **Post-launch (never blocking):** U2.2, U2.3, U2.4 beyond F4 (standalone samples, sample credit D-197), U2.5 items 3–4, U2.6, U2.7 beyond F1, U2.8, U2.9 items 1–5, all of U3, U4 and U5. | Accepted (2026-09-30) |

## Still open
Approval tier boundaries in D-052 (proposed 5–10 % Director, 10–15 % VP, > 15 % C-Level) · carrier choice in D-114 (proposed Flash Express + Deliveree) · all ⚖ items in `accounting-design.md` §10 (CPA review; defaults are in place). · ~~D-161 geography entry method~~ → D-170 · D-182: Pricing owner confirms the Locopack calculators took **internal** dimensions · D-196: Finance confirms the store-credit posting · D-205: who **owns** tooling paid through an order (Collective Group, the customer or the factory) · D-211: whether Packio holds the FEFCO / ECMA editions (until then no reference codes are shown) · D-216: named author of the first template set · D-217: scorecard moderator
