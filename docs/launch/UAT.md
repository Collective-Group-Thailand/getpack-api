# UAT package — Packio launch (B6.3, D-113)

> **Audience:** the UAT team — Packio staff of every role, the launch factory, Finance and the CPA observer.
> Packio launches publicly once R1 is complete, with no closed beta (D-113). This UAT is the safety net: real people
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

Run order: UAT-01 → 03 first (catalogue, factory, prices), then the commerce and fulfilment scenarios, then finance
(UAT-17 → 19) on the orders they produced, then analytics / reports / ops (UAT-20 → 22).

---

## UAT-01 Partner onboarding to activation
**Decisions:** D-011, D-041, D-042, D-043, D-100 (assisted onboarding), D-167, D-171, D-173 · **Actors:** Partner Manager, factory owner, Superadmin · **Automated:** `test/e2e/partners-onboarding.e2e-spec.ts`, `partners-configuration.e2e-spec.ts`

**Pre-conditions:** catalogue of the 14 product types (A-16), national calendar with the year's holidays (D-161).

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
**Decisions:** D-040, D-042, D-044, D-172 · **Actors:** factory owner, Partner Manager · **Automated:** `price-governance.e2e-spec.ts`, `price-suggestions.e2e-spec.ts`

1. The factory proposes a price change (mode b) in the partner zone.
2. Partner Manager reviews suggestion, basis, deviation and the 90-day impact simulation; counter-proposes, then approves.
3. A quote saved before the change keeps its snapshot price; a new quote uses the new version.

**Expected:** suggestions never visible to the factory; `above_band` not raised until a band is set (D-172).

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Partner Manager | | | | |
| Factory owner | | | | |

## UAT-03 Instant quote, RFQ routing and saved quotation
**Decisions:** D-043, D-050, D-051, D-100 · **Actors:** test customer, CS · **Automated:** `folding-quotes.e2e-spec.ts`, `saved-quotes.e2e-spec.ts`, `rfqs.e2e-spec.ts`

1. As an anonymous visitor, price each of the 7 instant types for 3 quantities; compare with the factory's reference prices (golden cases for folding: `docs/pricing-validation-folding.md`).
2. Configure a spec outside the factory's tier-B envelope → routed to RFQ.
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
4. Hired design: 3 free revision rounds, the 4th is charged max(THB 500, 20 %) and paid first (D-071); mockup add-on (D-072).

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
**Decisions:** D-075, D-076, D-155 · **Actors:** factory operator / QC, Packio inspector · **Automated:** `production-milestones.e2e-spec.ts`, `production-oversight.e2e-spec.ts`

1. Operators post each milestone with quantities and photos (also from a phone with poor connectivity).
2. QC records pass with photos; an order ≥ THB 300,000 requires a Packio inspection (100 %), the first 3 jobs of the factory too (D-076).
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
2. Claim within 7 days with product and carton photos; print defect → factory liable, re-production or credit; approved-artwork error → customer liable.
3. One-click reorder: re-priced at current cost, proof skipped when artwork unchanged, plate/die charges not repeated.

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
**Decisions:** D-140, D-141, D-142, D-168 · **Actors:** one tester per role · **Automated:** `iam.e2e-spec.ts`, `docs/rbac.md` (generated)

1. Each role signs in and sees only its menu; CS sees margin % only when discounting; Prepress and Logistics see neither cost nor margin (D-141).
2. Factories see only recipient name, address and phone of customers (D-142).
3. Conflicting duties are refused (e.g. Auditor with Finance, D-168; payout proposer approving).

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

| Role | Name | Result | Date | Evidence / notes |
|---|---|---|---|---|
| Tech lead | | | | |
| On-call engineer | | | | |

---

## Sign-off summary

| Scenario | Result | Blocking issues | Signed by | Date |
|---|---|---|---|---|
| UAT-01 … UAT-22 | | | | |

A failed scenario reopens with a defect id; the go / no-go needs every scenario passed or a waiver signed by C-Level with the risk written down.
