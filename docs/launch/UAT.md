# UAT package — getpack launch (B6.3, D-113)

> **Audience:** the UAT team — getpack staff of every role, the launch factory, Finance and the CPA observer.
> getpack launches publicly once R1 is complete, with no closed beta (D-113). This UAT is the safety net: real people
> run real test orders from end to end (sandbox payments, real documents in a UAT series, payouts to test accounts, a
> simulated month closed in the GL) before the go / no-go (`docs/LAUNCH-CHECKLIST.md`).
>
> Every scenario below lists the decisions it proves, who takes part, what must be true before it starts, the steps,
> what must happen, the automated test that already covers it (so UAT focuses on people, data and providers rather
> than logic) and a **sign-off sheet**. A scenario passes when every listed signer has signed "Pass".

## 0. The UAT environment

| Item | How it is set up | Owner |
|---|---|---|
| Deployment | The release candidate image (`vX.Y.Z-rc`) on the UAT stack, same topology as production (API, worker, PostgreSQL 18, Redis, S3, SES sandbox). | Tech lead |
| Legal entity | Collective Group (Thailand) seeded from `SEED_ENTITY_*` (real legal name, tax id, branch — D-092). | Finance Manager |
| Document series | The Finance Manager creates every series with a **`UAT` prefix** (`admin.documentSeries`, D-169) — documents are real in form and numbering rules (gapless, per period) but can never be mistaken for production ones. Production starts its own series fresh (D-092). | Finance Manager |
| Payments | SCB and 2C2P **sandbox** merchant accounts; Slip2Go test key (D-176). Feature flags `payments.scb`, `payments.twoc2p`, `payments.slip_verify` on in UAT only. | Finance Manager |
| Factory | The launch factory's real onboarding data (capabilities, price lists for the 7 instant types — assisted onboarding with sign-off, D-100 note), its users in the partner zone. | Partner Manager |
| Payout accounts | The factory's vendor bank account in UAT points to a **company-controlled test account**; bank files are generated and checked, not uploaded to the live bank channel. | Finance Manager |
| Carriers | Flash Express / Deliveree sandbox accounts (D-114, choice Proposed). | Logistics |
| Messaging | LINE OA test channel, ThaiBulkSMS test sender, SES sandbox with the UAT team's addresses verified. | Admin |
| Test customers | Staff create test customers with obviously fake names (`ทดสอบ …`, `@example.invalid` addresses are not deliverable — use team mailboxes in SES sandbox). No real customer data in UAT (PDPA). | CS Lead |
| Settings | The values of `docs/launch/SETTINGS-REVIEW.md`, with the owners' confirmed changes applied as new versions. | Superadmin |
| Rehearsal | Before the launch factory's data exists, the team rehearses every scenario on `pnpm db:seed:uat` + `pnpm uat:populate` (`docs/launch/UAT-DATA.md`: a market-like catalogue, 13 personas, orders parked at every stage). Rehearsal prices are **not** prices; a rehearsal never signs a scenario. | QA lead |

Run order: UAT-01 → 03 first (catalogue, factory, prices), then the commerce and fulfilment scenarios, then finance
(UAT-17 → 19) on the orders they produced, then analytics / reports / ops (UAT-20 → 22). The pre-launch U2 items (D-219) run with the
fulfilment scenarios they extend: UAT-23 with UAT-03, UAT-24 with UAT-11 / UAT-15, UAT-25 with UAT-15, UAT-26 with
UAT-07. The last run of the automated layer is recorded in `docs/launch/UAT-RUN-2026-10-06.md`.

---

## UAT-01 Partner onboarding to activation
**Decisions:** D-011, D-041, D-042, D-043, D-100 (assisted onboarding), D-167, D-171, D-173 · **Actors:** Partner Manager, factory owner, Superadmin · **Automated:** `test/e2e/partners-onboarding.e2e-spec.ts`, `partners-configuration.e2e-spec.ts`

**Pre-conditions:** catalogue of the 14 product types (A-16); the national calendar of the year keyed in by an Admin
through `admin.calendar.putHoliday` or the Excel import, each holiday marked with who observes it (D-161, D-170 —
`admin-platform.e2e-spec.ts`, `catalog-imports.e2e-spec.ts`).

1. Partner Manager creates the factory (assisted mode) and invites the owner (D-171).
2. Owner completes KYC, bank account (verified by a call — A-18), capability matrix, capacity, delivery zones, tolerance, payout policy, agreement e-acceptance.
3. Partner Manager enters the price lists of the 7 instant types on the factory's behalf; the owner signs them off (D-100 note).
4. Partner Manager records the site visit (D-041); factory moves trial → active.
5. A tolerance override and a payout-policy override are requested and approved by a Superadmin (D-173).

**Expected:** no step can be skipped; activation refused before the site visit; the factory sees only its own prices (D-044); every change audited.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Partner Manager | | | | |
| Factory owner | | | | |
| Superadmin | | | | |

## UAT-02 Price governance
**Decisions:** D-040, D-042, D-043, D-044, D-172, D-234 · **Actors:** factory owner, Partner Manager · **Automated:** `price-governance.e2e-spec.ts`, `price-suggestions.e2e-spec.ts`, `tier-b-envelopes.e2e-spec.ts`, `test/unit/partner-price-protection.spec.ts`

1. The factory proposes a price change (mode b) in the partner zone.
2. Partner Manager reviews suggestion, basis, deviation and the 90-day impact simulation; counter-proposes, then approves.
3. A quote saved before the change keeps its snapshot price; a new quote uses the new version.
4. For a getpack rate card (mode a) the factory accepts the new version (evidence: who, when, IP, user agent — A-114);
   it applies to new quotes only after acceptance.
5. A Partner Manager reads the factory's price lines: the read is in the audit log with its purpose (D-044, D-141);
   a CS user cannot read them.

**Expected:** suggestions, benchmarks, margins and sell prices never visible to the factory; `above_band` not raised
until a band is set (D-172).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Partner Manager | | | | |
| Factory owner | | | | |

## UAT-03 Instant quote, RFQ routing and saved quotation
**Decisions:** D-043, D-050, D-051, D-100, D-233, D-234 · **Actors:** test customer, CS, Pricing owner · **Automated:** `folding-quotes.e2e-spec.ts`, `corrugate-quotes.e2e-spec.ts`, `label-quotes.e2e-spec.ts`, `tag-sleeve-quotes.e2e-spec.ts`, `pouch-quotes.e2e-spec.ts`, `standard-product-quotes.e2e-spec.ts`, `service-quotes.e2e-spec.ts`, `tier-b-envelopes.e2e-spec.ts`, `saved-quotes.e2e-spec.ts`, `rfqs.e2e-spec.ts`

1. As an anonymous visitor, price **each type whose validation document is signed** (`docs/pricing-validation-<type>.md`
   — today corrugated only) for 3 quantities and compare with that document's cases and the factory's signed price
   list; every type not signed yet routes to RFQ (A-16). Folding engine B stays off until
   `docs/pricing-validation-folding-b.md` is signed (D-233).
2. Configure a spec outside the factory's tier-B envelope → routed to RFQ; the store shows the type as `partial` (D-234).
3. Save a quotation; sign in; claim it; download the PDF (QT number in the UAT series); share it.
4. After 15 days (simulate by editing the validity in UAT only) the quote is re-priced (D-051).

**Expected:** no factory name anywhere on the store (D-050); prices identical to the calculator validation sheets.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS Lead | | | | |
| Business owner (pricing) | | | | |

## UAT-04 RFQ to order, and declined RFQ
**Decisions:** D-100, D-102 · **Actors:** test customer, CS, factory planner · **Automated:** `rfqs.e2e-spec.ts`

1. Customer submits an RFQ (rigid box) with files and a target date.
2. CS consults the factory; the factory answers buy price and lead time; CS sends the quotation; the customer accepts and orders.
3. A second RFQ is declined with the reason `spec_not_feasible`.

**Expected:** the decline appears in unmet demand (UAT-20); the factory never sees the sell price.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS | | | | |
| Factory planner | | | | |

## UAT-05 Cart, checkout and payment schedules
**Decisions:** D-013, D-020, D-060, D-174 · **Actors:** test customers (individual and juristic with withholding) · **Automated:** `carts.e2e-spec.ts`, `checkout.e2e-spec.ts`, `payment-schedules.e2e-spec.ts`

1. Multi-item cart split over two addresses; shipping from the customer rate card.
2. Order below THB 20,000 → 100 % upfront; above → 50 / 50 (D-020).
3. A juristic customer who withholds tax sees the expected cash (D-174).
4. Leave one order unpaid: it expires after `orders.unpaid_expiry_days` (D-060, value to confirm).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS Lead | | | | |
| Finance | | | | |

## UAT-06 Payments in the sandbox, slips and refunds
**Decisions:** D-061, D-169, D-176 · **Actors:** test customers, Finance, Finance Manager · **Automated:** `payments.e2e-spec.ts`, `refunds.e2e-spec.ts`

1. Pay by SCB QR (sandbox) and by 2C2P card (sandbox test cards).
2. Pay by bank transfer with a slip: automatic verification by Slip2Go; a mismatching slip goes to the Finance queue and is decided within 4 business hours (D-061).
3. Refund part of a payment: Finance requests, Finance Manager approves (D-169), the gateway refund succeeds.

**Expected:** callbacks verified by signature; no card or account number stored or logged (PDPA).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Finance | | | | |
| Finance Manager | | | | |

## UAT-07 Promotions, campaigns and referral
**Decisions:** D-053, D-136, D-154 · **Actors:** Marketing, test customers · **Automated:** `promotions-admin.e2e-spec.ts`, `promotions-checkout.e2e-spec.ts`, `referrals.e2e-spec.ts`

1. Marketing creates a campaign with a budget, an automatic promotion and a coupon batch.
2. A stack that would go below the margin floor is capped and the capped amount shown.
3. The budget alert fires at 80 % (D-154); the campaign stops when exhausted.
4. A referee orders with the referral discount; the referrer is rewarded after the claim window; a self-referral (same phone) is refused.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Marketing | | | | |

## UAT-08 Loyalty points
**Decisions:** D-130 – D-135 · **Actors:** test customer, Marketing · **Automated:** `loyalty.e2e-spec.ts`

1. Points are credited after completion + the claim window; sign-up, LINE link and review rewards.
2. Redeem at checkout within 20 % of the order and above the minimum; a claim / refund reverses points.
3. Expiry reminder 30 days ahead; tier change at the spend thresholds.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Marketing | | | | |
| Finance (points liability, UAT-20 report) | | | | |

## UAT-09 B2B company accounts
**Decisions:** D-120 – D-125 · **Actors:** Company Admin / Buyer / Approver (test), CS, Finance, C-Level · **Automated:** `companies.e2e-spec.ts`, `company-orders.e2e-spec.ts`, `company-credit.e2e-spec.ts`

1. Company applies with KYC documents; CS reviews; the company is activated.
2. A buyer's order above the company's threshold waits for the company approver (D-123).
3. After 3 paid orders, a credit limit is requested: ≤ THB 100,000 by Finance, above by C-Level (D-121).
4. An overdue invoice > 7 days blocks new credit orders; prepaid orders still allowed (D-122); monthly statement (D-125).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS | | | | |
| Finance | | | | |
| C-Level | | | | |

## UAT-10 Discount memos
**Decisions:** D-052, D-124, D-162 · **Actors:** CS, Director, VP, C-Level · **Automated:** `discount-memos.e2e-spec.ts`

1. CS gives 5 % on its own; 8 % goes to the Director; 12 % to the VP; 18 % and a below-floor discount to C-Level only (tier boundaries Proposed).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS | | | | |
| Director / VP / C-Level | | | | |

## UAT-11 Artwork, proof, design service and automatic production start
**Decisions:** D-070 – D-073 · **Actors:** test customer, Prepress, designer · **Automated:** `artwork.e2e-spec.ts`, `design-services.e2e-spec.ts`, `designs.e2e-spec.ts`, `production-release.e2e-spec.ts`

1. Upload artwork with a missing bleed → blocked; RGB → warning (D-070).
2. Prepress sends a proof; the customer annotates, a new version is compared and approved.
3. Paid + approved → production released automatically (D-073); a manual start requires a reason.
4. Hired design: 3 free revision rounds, the 4th is charged max(THB 500, 20 %) and paid first (D-071). The mockup
   add-on is now an attached sample — tested in UAT-24 (D-072, D-253).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Prepress | | | | |
| CS | | | | |

## UAT-12 Factory acceptance, rejection and escalation
**Decisions:** D-012, D-074, D-101 · **Actors:** factory owner, CS, Partner Manager · **Automated:** `production-release.e2e-spec.ts`, `production-oversight.e2e-spec.ts`

1. The factory accepts one job within 1 business day; leaves another beyond the SLA → alert and escalation.
2. The factory rejects a job → with one factory (D-101) it escalates to CS / Partner team; the customer price never changes (D-012).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Factory owner | | | | |
| Partner Manager | | | | |

## UAT-13 Milestones, QC, inspection and scorecard
**Decisions:** D-075, D-076, D-155 · **Actors:** factory operator / QC, getpack inspector · **Automated:** `production-milestones.e2e-spec.ts`, `production-oversight.e2e-spec.ts`

1. Operators post each milestone with quantities and photos (also from a phone with poor connectivity).
2. QC records pass with photos; an order ≥ THB 300,000 requires a getpack inspection (100 %), the first 3 jobs of the factory too (D-076).
3. The monthly scorecard shows on-time acceptance, shipping, QC first pass, claim rate and updates (D-155).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Factory QC | | | | |
| Partner Manager | | | | |

## UAT-14 Shipping, POD and tolerance
**Decisions:** D-013, D-021, D-080, D-114, D-163, D-165 · **Actors:** factory shipping, Logistics, test customer · **Automated:** `logistics.e2e-spec.ts`, `fulfilment-flow.e2e-spec.ts`

1. Factory-fleet delivery with a signed POD; a carrier fallback booked (sandbox) for an area the factory does not serve.
2. Deliver 97 % of 1,000 (within ± 5 %): pro-rata credit to the customer, factory paid for the delivered quantity; 103 %: not charged, factory paid for 1,000 (D-165); 90 %: automatic claim.
3. Public tracking link and timeline for the customer.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Logistics | | | | |
| Finance | | | | |

## UAT-15 Completion, claims and reorder
**Decisions:** D-081, D-082, D-083, D-153 · **Actors:** test customer, CS, factory owner · **Automated:** `claims.e2e-spec.ts`, `fulfilment-flow.e2e-spec.ts`

1. Order auto-completes 7 days after delivery (simulate by clock in UAT) or on customer confirmation.
2. Claim within 7 days with product and carton photos; print defect → factory liable, re-production or credit; approved-artwork error → customer liable. Severity, remedy and SLA clocks: UAT-25.
3. One-click reorder: re-priced at current cost, proof skipped when artwork unchanged, plate/die charges not repeated (the tooling waiver: UAT-24).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS | | | | |
| Factory owner | | | | |

## UAT-16 Notifications, consent, LINE and LIFF
**Decisions:** D-143, D-144, D-151, D-005 · **Actors:** test customers, staff teams · **Automated:** `notification-matrix.e2e-spec.ts`, `line-conversations.e2e-spec.ts`, `acceptance.e2e-spec.ts`

1. Each customer event arrives by e-mail, LINE when linked, SMS only for critical events, web push when permitted.
2. Marketing messages only 09:00 – 20:00 and with consent; transactional anytime (D-144).
3. LIFF: order status, slip upload, artwork approval, reorder, points, chat with CS (D-151).
4. The analytics-cookie banner records consent; without consent no visitor id is kept (UAT-20).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS Lead | | | | |
| Marketing | | | | |

## UAT-17 Customer documents and receivables
**Decisions:** D-010, D-091, D-092, D-125, D-169 · **Actors:** Finance, Finance Manager, test customers · **Automated:** `receivables.e2e-spec.ts`

1. Deposit tax invoice / receipt at payment; final tax invoice netting the deposit at POD — in the UAT series, Thai, Buddhist-era dates, amount in words, seller from settings.
2. Credit note (tolerance shortage, claim) and debit note; e-Tax XML generated but not sent (R2, D-091).
3. AR aging; a company statement.

**Expected:** gapless numbers; the CPA observer confirms the tax point (⚖ `accounting-design.md` §10).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Finance Manager | | | | |
| CPA observer | | | | |

## UAT-18 Factory payables and payouts to test accounts
**Decisions:** D-022, D-090, D-093, D-164, D-166 · **Actors:** factory accountant, Finance, C-Level · **Automated:** `payables.e2e-spec.ts`, `month-simulation.e2e-spec.ts`

1. PO at release; GR at POD; the system's billing statement confirmed by the factory; its tax invoice recorded and validated.
2. Payout run: 30 % advance on acceptance, balance after the claim window, 5 % retention released 30 days later (D-164); Finance proposes, a C-Level approves (proposer ≠ approver, D-166).
3. Bank file generated in the chosen bank's format (D-093), checked against the bank's spec, paid to the **test account**; 50 ทวิ issued.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Finance | | | | |
| C-Level | | | | |
| Factory accountant | | | | |

## UAT-19 Tax papers and closing a simulated month
**Decisions:** D-031, D-032, D-033, D-150, D-168, D-169 · **Actors:** Finance, two Finance Managers, auditor (time-boxed role) · **Automated:** `tax.e2e-spec.ts`, `close.e2e-spec.ts`, `month-simulation.e2e-spec.ts`

1. After a month of UAT activity: sales / purchase tax reports, ภ.พ.30, ภ.ง.ด.3 / 53 — each reconciles to its GL account with a difference of 0.
2. Depreciation run for a test asset (D-150).
3. Close checklist: blocking checks fixed or waived with reasons; submitted by one Finance Manager, approved by another; auditor signs off; lock.
4. PBC pack exported and opened by the auditor; an audit sample reproduced from its seed.

**Expected:** trial balance balanced; every sub-ledger equals its control account.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Finance Manager (submitter) | | | | |
| Finance Manager (approver) | | | | |
| Auditor / CPA | | | | |

## UAT-20 Analytics, partner prospectus and operational reports
**Decisions:** D-102, D-111, D-160 · **Actors:** Marketing, Partner Manager, Finance, C-Level · **Automated:** `analytics.e2e-spec.ts`, `reports.e2e-spec.ts`

1. After the nightly rollup, the funnel, demand, sales, sensitivity and unmet-demand dashboards show the UAT activity; the declined RFQ of UAT-04 is in unmet demand.
2. Partner Manager generates the prospectus: no customer, price of an individual customer or factory name; figures below k = 3 contributors show as "<3".
3. Each of the 12 reports is previewed and exported (XLSX and CSV); a weekly schedule notifies its recipient in-app and by e-mail, without attachment.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Marketing | | | | |
| Partner Manager | | | | |
| Finance Manager | | | | |

## UAT-21 Roles, segregation of duties and visibility
**Decisions:** D-063, D-140, D-141, D-142, D-168, D-222 · **Actors:** one tester per role · **Automated:** `iam.e2e-spec.ts`, `admin-platform.e2e-spec.ts`, `docs/rbac.md` (generated)

1. Each role signs in and sees only its menu; CS sees margin % only when discounting; Prepress and Logistics see neither cost nor margin (D-141).
2. Factories see only recipient name, address and phone of customers (D-142).
3. Conflicting duties are refused (e.g. Auditor with Finance, D-168; payout proposer approving).
4. A Superadmin proposes a new version of an approval matrix (`admin.approvalPolicies.proposeVersion`); it applies
   from its effective date only after its approval, never backwards (D-063).
5. The Data Protection Officer answers a test customer's export request within `privacy.response_days` (D-222).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Superadmin | | | | |
| Finance Manager | | | | |

## UAT-22 Operations drill
**Decisions:** D-113 · **Actors:** tech lead, on-call engineer, Superadmin · **Automated:** `ops.e2e-spec.ts`

1. Stop the worker for 15 minutes: `outbox_backlog_minutes` and `queue_depth` alert; restart; the backlog drains.
2. Force a subscriber failure in UAT: the event is dead-lettered, the alert reaches Superadmins and Admins, the event is replayed from `admin.outbox`.
3. Restore last night's backup to a new instance with PITR and run the verification queries of `docs/launch/SECURITY.md` §5.
4. Deploy and roll back the release (`docs/RUNBOOK.md` §2 – §3).
5. Release hygiene on the release build: `pnpm release:check` is clean, and an API started in production with a
   `devOnly` flag on refuses to boot (D-210, D-296 — `test/unit/release-hygiene.spec.ts`).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Tech lead | | | | |
| On-call engineer | | | | |

## UAT-23 Specification model v2 and published tolerances (pre-launch, D-219)
**Decisions:** D-182 – D-187 (findings F2, F5, F6) · **Actors:** test customer, CS, Prepress · **Automated:** `spec-model.e2e-spec.ts`, `rfqs.e2e-spec.ts`, `saved-quotes.e2e-spec.ts`

1. Configure a box by its **outside** size: the customer must choose the basis (no silent default); the other bases
   are shown from the material caliper; the price is computed on the inside size and the basis is frozen on the
   quotation, the order line and the job sheet (D-182).
2. Change the display unit to cm / in: the screen converts; a request that sends a unit to the API is refused (D-183).
3. Before buying, the product shows its dimensional (± 1 mm folding, ± 3 mm corrugated) and colour (ΔE2000 ≤ 3, ≤ 5
   flexo) tolerances; the quotation freezes them (D-186).
4. An RFQ accepted by the customer freezes the factory's quantity tolerance (or the ± 5 % default) — its order is
   reconciled with it at POD, never at 0 % (D-187, F2).
5. Share a quotation and a draft configuration: the link works, is revoked on demand and stops resolving after 15 days
   (D-185, F5); a draft is kept 90 days after its last change.
6. Try to change a published style code: refused; quotations, orders, proofs and the job sheet carry the
   `PK-<FAMILY>-<NN>` code (D-184, F6).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS Lead | | | | |
| Prepress | | | | |
| Pricing owner (D-182: legacy calculators took inside sizes) | | | | |

## UAT-24 Attached sample, production hold, tooling waiver, store credit (pre-launch, D-219)
**Decisions:** D-072, D-193, D-196, D-205, D-253 – D-256, D-289 (findings F1, F3, F4) · **Actors:** test customer, CS, factory QC, Finance · **Automated:** `samples.e2e-spec.ts`, `tooling.e2e-spec.ts`, `receivables.e2e-spec.ts`

1. CS adds a sample to a bulk order (price entered by CS, D-254); the factory records measured size, material and a
   photo before it ships; the sample ships on its own shipment without touching the bulk order's tolerance (D-258).
2. While the sample is not approved, bulk production does not start, automatically or manually (`sample_not_approved`,
   D-256). The customer approves with evidence (who, when, IP, user agent, photo hashes); the spec and proof lock;
   production releases. "Changes requested" leads to a new, re-quoted sample.
3. A reorder of the same spec and artwork at the same factory within 12 months: the plates / die block are waived,
   the quotation shows the waived amount and the tooling reference, the factory's buy price excludes it; the factory
   reports a tool unusable → getpack absorbs the remake (D-205, D-289, F1).
4. **Store credit at checkout (D-196, F3): not implemented** — see `docs/launch/UAT-RUN-2026-10-06.md` D-1. This step
   stays failed until it is built and Finance confirms the posting (D-196 Still open): a customer with store credit
   from a claim pays part of a new order with it, up to the order total.

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS | | | | |
| Factory QC | | | | |
| Finance Manager (F3 posting) | | | | |

## UAT-25 Guarantee policy and claim SLA (pre-launch, D-219)
**Decisions:** D-198 – D-200, D-260 – D-263 · **Actors:** test customer, CS, CS Lead, C-Level · **Automated:** `claims.e2e-spec.ts`, `ops.e2e-spec.ts`

1. The public guarantee page (`store.guarantee.get`) shows version 1: remedies by claim type and severity, response
   1 and decision 3 business days, no late-delivery guarantee.
2. Approving a claim needs its severity and a remedy the policy stamped on the claim allows; the executed actions fit
   the remedy (reprint → re-production, refund → refund or credit note, partial credit → credit note or store
   credit); artwork the customer approved → no remedy (D-261, D-083).
3. Goodwill is approved only with a discount memo through the D-052 matrix (D-262).
4. The claim shows its owner and due times; asking the customer for information stops the decision clock; an
   overdue claim raises `claim_response_overdue` / `claim_decision_overdue` (D-263; rehearsal: O8 in UAT-DATA.md).
5. The CS Lead requests a new policy version; a C-Level approves; it applies from its effective date only (D-200).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| CS Lead | | | | |
| C-Level | | | | |

## UAT-26 Storefront cards and promotion truthfulness (D-181)
**Decisions:** D-181, D-220, D-307, D-308 · **Actors:** Marketing, test customer, tech lead · **Automated:** `storefront-cards.e2e-spec.ts`, `price-hints.e2e-spec.ts`

1. Every made-to-order card shows the starting price per piece with the quantity and spec it assumes, the MOQ, the
   lead time and instant / partial / RFQ; a product without a reference configuration or an instant path shows none.
2. A struck-through price, a badge and an end date appear only while a live automatic promotion with a real end date
   targets the item on the web; coupon and referral promotions never badge a card; no countdown or "only N left"
   anywhere (D-181, D-307).
3. Changing a price list, a promotion or a catalogue product revalidates the cards on the web (signed call to
   `STOREFRONT_REVALIDATE_URL`, D-308).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Marketing | | | | |
| Tech lead | | | | |

---

## Sign-off summary

| Scenario | Result | Blocking issues | Signed by | Date |
|---|---|---|---|---|
| UAT-01 … UAT-22 | | | | |
| UAT-23 … UAT-26 (pre-launch U2 items, D-219) | | | | |

A failed scenario reopens with a defect id; the go / no-go needs every scenario passed or a waiver signed by C-Level with the risk written down.
