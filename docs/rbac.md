# RBAC matrix — getpack-api

> **Generated** by `pnpm rbac:build` from `src/modules/iam/roles.catalog.ts`, `permissions.catalog.ts` and
> `prisma/seed/data/reference.ts`. Do not edit by hand. Roles per D-140; cost and margin visibility per D-141;
> factories see only delivery contact data of customers (D-142, enforced in projections, not by a permission).
> Grants where a decision is silent are the narrowest that lets the role work (docs/PROGRESS.md, B1.2) — **review**.

Legend: ● granted · ◆ granted and sensitive (cost/margin data, D-141).

## getpack staff (platform scope)

| Permission | `superadmin` | `c_level` | `vp` | `director` | `admin` | `cs` | `cs_lead` | `prepress` | `finance` | `finance_manager` | `logistics` | `marketing` | `sales_manager` | `partner_manager` | `auditor` | `dpo` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `settings.read` — Read platform settings and their history | ● | ● | ● | ● | ● |  | ● | ● | ● | ● |  | ● | ● | ● | ● |  |
| `settings.read_sensitive` — Read settings flagged sensitive | ◆ | ◆ |  |  |  |  |  |  |  | ◆ |  |  |  |  |  |  |
| `settings.change` — Create a new effective-dated setting version (D-063) | ● |  |  |  | ● |  | ● | ● |  | ● |  | ● | ● | ● |  |  |
| `feature_flags.read` — Read feature flags | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `feature_flags.manage` — Change feature flags | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `entities.manage` — Manage legal entities (D-092) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `calendars.read` — Read business calendars | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |
| `calendars.manage` — Key in public holidays and factory closures (D-161) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `consent_purposes.manage` — Manage consent purposes and their texts | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `approvals.read` — Read approval requests | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `approvals.act` — Approve or reject requests routed to the role | ● | ● | ● | ● |  |  |  | ● | ● | ● |  | ● |  | ● |  |  |
| `approvals.delegate` — Delegate own approvals for a period | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |
| `approval_policies.manage` — Create approval policy versions (D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `users.read` — Read staff, partner and customer accounts | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | ● |  |
| `users.manage` — Create, deactivate and edit accounts | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `roles.assign` — Grant and revoke roles (D-140) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `roles.manage` — Edit roles and their permissions (D-140) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `sod_rules.manage` — Edit segregation-of-duties rules | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `audit_logs.read` — Read the audit log | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `audit_logs.export` — Export the audit log (itself audited) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |
| `files.upload` — Upload files | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |
| `files.read` — Download files of records the user can see | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `customer_files.read` — Download customer artwork / originals and their production copies of any order (Prepress); `files.read` no longer covers them (D-444) |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `customer_files.read_handled` — Download customer artwork / originals and their production copies of orders the user handles: explicit order assignment or an open conversation assigned to them (support) (D-444) |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `customer_files.read_with_reason` — Download any customer original / Studio artwork after typing a reason that is stored in the access log with actor, file, order and time (Superadmin only, D-449); Admin and Auditor have no access (D-449, D-444) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `customer_file_access_logs.read` — Read the access log of customer artwork / originals and production copies (Superadmin, Auditor); not the files (D-444) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `orders.assign_support` — Assign the support staff member who handles an order (gives `customer_files.read_handled` access to its artwork) (D-444) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `notification_templates.manage` — Edit and publish notification templates | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `notification_routes.manage` — Edit the notification routing matrix (D-143) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `outbox.manage` — List dead-lettered domain events and replay them | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `catalog.read` — Read the platform catalogue in the admin zone | ● |  |  |  | ● | ● | ● | ● |  |  |  | ● |  | ● |  |  |
| `catalog.manage` — Create and edit catalogue rows (product types, patterns, materials, stock products …) (D-005, D-100) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `catalog.import` — Import and export catalogue tables with Excel (preview → confirm) (D-005) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `cms.manage` — Edit banners, home sections, articles, FAQs and videos | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `cms.cases.approve` — Approve or withdraw a customer story on the home page (written permission on file) (D-311) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `seo.manage` — Edit SEO meta per page | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `business_calendar.manage` — Key in the national holidays once a year, by form or Excel import (D-161, D-170) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `geography.manage` — Maintain provinces, districts, subdistricts and postcodes (D-161, D-170) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `partners.read` — Read partner factories and their onboarding | ● | ● | ● |  | ● |  |  |  | ● | ● |  |  | ● | ● | ● |  |
| `partners.manage` — Create factories, run onboarding, capability, tiers, capacity and status changes (D-011, D-041, D-171) | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `styles.read` — Read the style library: bases, variants, recipes, imports | ● |  |  |  | ● | ● | ● | ● |  |  |  | ● |  | ● | ● |  |
| `styles.import` — Import the style master file and recipe bundles (dry run, then confirm) (D-242) | ● |  |  |  | ● |  |  | ● |  |  |  |  |  |  |  |  |
| `styles.curate` — Curate the style library: featured, hidden, order, copy, product type (D-246) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `styles.approve_recipe` — Approve a style recipe version (Prepress) (D-243) | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `styles.approve_names` — Approve the Thai / English names of a style (Marketing: wording, Prepress: technical terms) (D-212) | ● |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |
| `styles.verify_reference` — Verify an industry reference code (FEFCO / ECMA) against the edition getpack holds (Prepress) (D-211) | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `styles.price_rules` — Maintain the option price rules of styles (Prepress with the Pricing owner, D-268) (D-268, D-266) | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `studio_catalog.manage` — Maintain getpack’s studio templates and elements (D-216, D-282) (D-216, D-282) | ● |  |  |  | ● |  |  | ● |  |  |  | ● |  |  |  |  |
| `studio_catalog.approve` — Approve a studio template for publication — Marketing, never its author (D-216, D-282) (D-216, D-282) | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `structural_requests.manage` — Assign structural design requests, link their service RFQ, decline them (CS, D-273) (D-273) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `structural_requests.design` — Deliver, approve and publish structural designs (structural designers in Prepress, D-273) (D-273) | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `styles.process_rules` — Maintain which processes a style needs (style process rules, Prepress) (D-244) | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |
| `advisory.read` — Read Structure Advisor recommendations (inputs, rule set, board data, choices) and replay them (D-240) | ● |  |  |  | ● | ● | ● | ● |  |  |  |  |  | ● | ● |  |
| `advisory.evaluate` — Run the Structure Advisor for a configuration, also while it is off for customers (D-237, D-239) | ● |  |  |  | ● | ● | ● | ● |  |  |  |  |  | ● |  |  |
| `partners.site_visits.record` — Record site visits of partner factories (D-041) | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `price_proposals.review` — Review price proposals, draft platform rate cards and decide lines (D-040, D-042) | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `price_suggestions.read` — See staff-only price suggestions, benchmarks and impact simulations (D-040, D-044) | ◆ | ◆ |  |  |  |  |  |  |  |  |  |  |  | ◆ |  |  |
| `index_series.manage` — Maintain material and cost-driver index series (D-040) | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `agreements.manage` — Publish partner agreement texts (D-011) | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `zones.manage` — Maintain zone schemes, zones and postcodes (D-013) | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `vendor_bank_accounts.verify` — Record the verification call of a vendor bank-account change (D-033) | ● |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `factory_buy_prices.read` — See full factory buy prices (D-141, D-044, D-042) | ◆ | ◆ | ◆ |  |  |  |  |  | ◆ | ◆ |  |  |  | ◆ |  |  |
| `factory_cost.read` — Deprecated alias of factory_buy_prices.read (D-042 terminology); removed in U-B5 (D-141, D-044, D-042) | ◆ |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `margin.read` — See margins in amounts and percent (D-141) | ◆ | ◆ | ◆ |  |  |  |  |  | ◆ | ◆ |  |  |  | ◆ |  |  |
| `margin.read_pct_when_discounting` — See the resulting margin % while applying a discount (D-141, D-052) | ◆ |  |  |  |  | ◆ | ◆ |  |  |  |  |  |  |  |  |  |
| `quotes.calculate` — Price a configuration for a customer in the admin zone (CS calculator) (D-100, D-043) | ● | ● |  |  | ● | ● | ● |  |  |  |  |  |  | ● |  |  |
| `quotes.read` — Read saved quotations (D-051) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  |  |  |  | ● |  |
| `quotes.manage` — Save quotations for a customer, share them and issue their PDF (D-051) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `rfqs.read` — Read requests for quote and their conversation (D-100) | ● | ● |  |  | ● | ● | ● |  |  |  |  |  |  | ● | ● |  |
| `rfqs.manage` — Work requests for quote: assign, ask for information, consult factories, quote, decline (D-100, D-043, D-102) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `document_series.read` — Read document numbering series (D-092) | ● |  |  |  | ● |  |  |  | ● | ● |  |  |  |  | ● |  |
| `document_series.manage` — Create document numbering series (D-092, D-169) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `shipping_rates.read` — Read the customer shipping rate card and its versions (D-013) | ● | ● |  |  | ● | ● | ● |  | ● | ● | ● |  |  | ● | ● |  |
| `shipping_rates.manage` — Draft customer shipping rate-card versions and submit them for C-Level approval (D-013) | ● |  |  |  | ● |  |  |  |  |  | ● |  |  |  |  |  |
| `factory_shipping_rates.manage` — Draft factory shipping payout cards, send them to the factory and answer counters (D-013, D-042, D-141) | ◆ |  |  |  |  |  |  |  |  |  |  |  |  | ◆ |  |  |
| `carriers.read` — Read fallback carriers and getpack’s carrier accounts | ● | ● |  |  | ● |  |  |  |  |  | ● |  |  | ● | ● |  |
| `carriers.manage` — Enable or disable fallback carriers and register getpack’s carrier accounts (D-114, D-005) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `sell_margins.manage` — Maintain getpack's sell margins, fix costs and design fees (effective-dated) (D-063) | ◆ | ◆ |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `customers.read` — Find customers and read their profile, addresses and tax profiles (D-092) | ● |  |  |  | ● | ● | ● |  | ● | ● |  |  | ● |  | ● | ● |
| `privacy_requests.manage` — Answer customers' PDPA requests: export their data or anonymise them (D-222) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |
| `customers.manage` — Create customer accounts and keep their addresses and tax profiles (CS) (D-092) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `carts.manage_on_behalf` — Build a cart for a customer and check it out on their behalf (CS) (D-051) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `orders.read` — Read order groups, orders and their queues (D-060) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  | ● |  |
| `orders.cancel` — Cancel order groups or orders before production, with a reason (D-060) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `orders.manage` — CS operations on orders: change customer, remarks, cc e-mails, PO number, notes (D-125) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `orders.reprice` — Edit & re-price an order before production (D-051) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `payment_schedules.override` — Choose or replace the payment schedule of an order group, with a reason (D-020) | ● |  |  |  | ● |  | ● |  |  | ● |  |  |  |  |  |  |
| `payment_schedule_templates.manage` — Add effective-dated versions of payment schedule templates (D-020, D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `payments.read` — Read payments, slips and unidentified receipts (D-061) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  |  |  |  | ● |  |
| `payments.verify_slip` — Approve or reject slips that failed automatic verification (D-061) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `payments.allocate` — Attach unidentified receipts to order groups (D-061) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `refunds.request` — Request refunds (approved by the Finance Manager, maker-checker) (D-169) | ● |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |  |  |
| `refunds.complete` — Record that an approved refund was paid out (bank transfer) (D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `promotions.read` — Read campaigns, promotions, coupon codes and the redemption report (D-053, D-154) | ● | ● |  |  | ● |  | ● |  |  | ● |  | ● |  |  | ● |  |
| `promotions.manage` — Create, edit, activate and end promotions; generate, disable and export coupon codes (D-053) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `campaigns.manage` — Create campaigns, set their THB budget, activate, pause and end them (D-154) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `loyalty.read` — Read customers’ points, tiers and points history (D-130, D-134) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  | ● |  |  | ● |  |
| `loyalty.adjust` — Add or remove a customer’s points with a reason (audited) (D-131, D-132) | ● |  |  |  | ● |  | ● |  |  |  |  | ● |  |  |  |  |
| `reviews.moderate` — Hide or re-publish order reviews (Marketing, D-202) (D-135, D-202, D-265) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `reviews.reply` — Write or edit the one reply to a review (CS, D-202) (D-202, D-265) | ● |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `guarantee_policies.read` — See guarantee policy versions and their remedy matrix (D-260) | ● | ● |  |  | ● | ● | ● |  |  |  |  | ● |  |  |  |  |
| `guarantee_policies.manage` — Draft a new guarantee policy version for C-Level approval (CS Lead, D-200) (D-200, D-260) | ● |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `companies.read` — Read B2B companies, their members, branches and KYC documents (D-120, D-125) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  |  | ● |  | ● |  |
| `companies.manage` — Suspend, reactivate or close B2B companies (D-120) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `companies.kyc_review` — Verify company KYC documents and approve or reject applications (D-120) | ● |  |  |  | ● |  | ● |  |  | ● |  |  |  |  |  |  |
| `company_credit.manage` — Request B2B credit limits and terms (approved by Finance / C-Level) (D-121) | ● |  |  |  | ● |  | ● |  | ● | ● |  |  |  |  |  |  |
| `discount_memos.request` — Give CS discounts within the limit and raise discount memos above it (D-052, D-124) | ● |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `discount_memos.read` — Read discount memos and where they were used (D-052) | ● | ● | ● | ● | ● | ● | ● |  | ● | ● |  |  |  |  | ● |  |
| `artwork.read` — Read artwork submissions, preflight reports, proofs and design services of orders (D-070, D-071) | ● |  |  |  | ● | ● | ● | ● |  |  |  |  |  |  | ● |  |
| `artwork.submit_on_behalf` — Upload artwork for a customer’s order (D-070) | ● |  |  |  | ● | ● | ● | ● |  |  |  |  |  |  |  |  |
| `prepress.review` — Accept or reject submissions, send proofs and templates, answer proof annotations (D-070) | ● |  |  |  | ● |  |  | ● |  |  |  |  |  |  |  |  |
| `proofs.decide_on_behalf` — Approve a proof or request changes for the customer, with a reason (audited) (D-070, D-073) | ● |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| `design_services.manage` — Assign designers, deliver design rounds and re-quote structure or concept changes (D-071) | ● |  |  |  | ● |  |  | ● |  |  |  |  |  |  |  |  |
| `mockups.manage` — Add a paid mockup / physical proof to an order at a CS-quoted price (audited) (D-072) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `samples.read` — See samples (attached and standalone), their evidence and the customer’s decision (D-253, D-255) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  | ● | ● |  |
| `samples.manage` — Create, quote and cancel samples at a CS-entered price; record their evidence (audited) (D-253, D-254, D-194) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `drawings.generate` — Generate dieline drawings and send templates to customers (D-070) | ● |  |  |  | ● | ● | ● | ● |  |  |  |  |  |  |  |  |
| `production.read` — Read production jobs, milestones, QC, inspections and factory scorecards (D-073, D-155) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  | ● | ● |  |
| `production.start_manual` — Start production as an exception, with a reason (audited) (D-073) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `production.manage` — Reassign jobs to another factory, hold and resume jobs, resolve escalations (D-012, D-074, D-101) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  | ● |  |  |
| `milestone_routes.manage` — Edit milestone routes per product type as new versions (D-075) | ● |  |  |  | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `inspections.perform` — Carry out getpack inspections and record their results (D-076) | ● |  |  |  | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `shipments.read` — Read shipments, carrier events, proofs of delivery and delivery reconciliations (D-013, D-080) | ● | ● | ● | ● | ● | ● | ● |  | ● | ● | ● |  |  | ● | ● |  |
| `conversations.read` — Read the CS inbox: LINE and web conversations (D-151) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `conversations.reply` — Reply to customers, assign and close conversations (D-151) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| `assistant.manage` — Run and read the assistant evaluation and its usage dashboard (D-306) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `conversations.manage_canned` — Maintain the canned responses CS reuses in conversations (D-300) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `line.manage` — Register the LINE official account rich menus (D-151) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `claims.read` — Read claims, their evidence and resolutions (D-082) | ● | ● | ● | ● | ● | ● | ● |  | ● | ● | ● |  |  | ● | ● |  |
| `claims.manage` — Open, review, ask for information, send to the factory, decide and close claims (D-082, D-083) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  | ● |  |  |
| `claims.override_liability` — Override the liability rule of a claim with a reason (D-083) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `claims.resolve` — Resolve approved claims: re-production, refund request, credit, deductions (D-083, D-022) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `shipments.manage` — Book fallback carriers, correct shipment statuses, record proofs of delivery and cancel shipments (D-013, D-114) | ● |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |
| `ledger.read` — Read the chart of accounts, periods, journals with their lines, posting rules and tax rates (D-031) | ● | ● | ● |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `ledger.journals.manage` — Draft and submit manual, recurring and reversing journals (approved by another person, §8) (D-033, D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `ledger.periods.manage` — Soft-close, reopen, close and lock fiscal periods (§1.4, §7) (D-033) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `ledger.post_soft_closed` — Post into a soft-closed period (§1.4) (D-033) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `ledger.config.propose` — Propose chart-of-accounts changes, posting-rule and tax-rate versions and cost centres (maker-checker, §8) (D-033, D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `receivables.read` — Read customer documents, receivables and aging, 50 ทวิ certificates, credit balances and statements (D-010, D-033) | ● | ● |  |  |  | ● | ● |  | ● | ● |  |  |  |  | ● |  |
| `receivables.manage` — Void invoices / debit notes, record or waive 50 ทวิ, update the allowance for doubtful accounts (D-033) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `credit_notes.request` — Request credit notes (issued after a Finance Manager approves, §8) (D-033, D-169) | ● |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |  |  |
| `receivables.write_off.request` — Request bad-debt write-offs (approved by a Finance Manager, §8) (D-033, D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `receivables.debit_notes.issue` — Issue debit notes (D-033) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `receivables.documents.replace` — Cancel a tax document and issue it again with a corrected buyer (ป.86/2542 ข้อ 25), and decide customers’ correction requests (D-431) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `document_branding.read` — See the logo, company seal, signatories and signing rules of getpack’s documents (D-428, D-429) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `document_branding.manage` — Set getpack’s document logo and company seal, name signatories and decide who signs which documents (never upload a signature for someone) (D-428, D-429) | ● | ● |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `payables.read` — Read POs, goods receipts, billing statements, vendor invoices, payables, vendors and payout runs (D-022, D-090) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `payables.manage` — Capture and validate factory tax invoices (input VAT only with a valid document, §2) (D-090) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `payables.vendors.manage` — Create non-factory vendors and propose their bank accounts (dual approval, §8) (D-033, D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `payables.bills.record` — Record vendor bills (the recorder cannot change that vendor’s bank account, §8) (D-033, D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `payouts.manage` — Create, propose and cancel payout runs (approved by a C-Level other than the proposer, D-166) (D-022, D-166) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `payouts.execute` — Generate the bank file of an approved run and record the bank’s confirmation (D-093) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `banking.read` — Read company bank accounts, statement lines, unidentified receipts and the cash position (D-061, D-093) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `banking.manage` — Import statements and settlements, match, ignore and identify statement lines (D-061, D-093) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `banking.accounts.propose` — Propose company bank accounts (approved by Finance then Finance Manager, §8) (D-093, D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `tax.read` — Read tax reports, working papers, WHT registers and the tax calendar (D-033) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `tax.manage` — Generate and finalise tax reports (GL difference must be 0) and record filings (D-033) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `tax.pay` — Record VAT and withholding-tax payments to the Revenue Department (D-033) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `fixed_assets.read` — Read asset categories, the fixed-asset register, depreciation and roll-forward (D-150) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `fixed_assets.manage` — Manage asset categories, register assets and run the monthly depreciation (D-150) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `fixed_assets.dispose` — Dispose of or write off fixed assets (D-150) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `close.read` — Read close checklists, their checks and evidence (D-033) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `close.manage` — Open close checklists, run checks, complete tasks, attach evidence and submit for review (D-033) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `close.approve` — Waive close tasks, approve and close a month (not the submitter), return it, lock it (D-033, D-169) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `audit_support.read` — Read the §8 exception reports and audit samples (D-033) | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |
| `audit_support.sample` — Draw audit samples (D-033) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `audit_support.export` — Generate and download the prepared-by-client pack of a month (D-033) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |
| `close.audit_sign_off` — Sign off a closed month as the auditor (required to lock the fiscal year end) (D-033) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `analytics.read` — Read the demand & growth dashboards: traffic, funnel, demand, sales, sensitivity, unmet demand, campaigns (D-102) | ● | ● | ● | ● | ● |  |  |  |  |  |  | ● | ● | ● |  |  |
| `analytics.read_factories` — Read factory utilisation and on-time performance by named factory (staff-only) (D-102, D-044) | ● | ● | ● | ● |  |  |  |  |  |  |  |  |  | ● |  |  |
| `analytics.manage` — Queue analytics rollup backfills and read their runs (D-102) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| `analytics.prospectus` — Generate and download the aggregated, anonymised partner prospectus (D-102, D-044, D-160) | ● | ● | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `reports.export` — Export operational reports as XLSX / CSV and download report files (each report also needs its data permission) (D-111) | ● | ● | ● | ● | ● |  | ● |  | ● | ● | ● | ● | ● | ● | ● |  |
| `reports.schedule` — Schedule operational reports for staff recipients and see every run of the reports the user may read (D-111) | ● | ● | ● | ● | ● |  | ● |  | ● | ● |  | ● |  | ● |  |  |
| `agents.read` — Read sales agents, applications, leads, customer and factory links, commissions and statements (D-416, D-423) | ● | ● | ● | ● | ● |  |  |  | ● | ● |  |  | ● | ● |  |  |
| `agents.manage` — Approve or reject agent applications, create employee agents, change plans, suspend, reactivate or end agents, assign, transfer or end customer links, release leads and decide held commission (D-416, D-417, D-423) | ● | ● |  |  | ● |  |  |  |  |  |  |  | ● |  |  |  |
| `agent_commissions.adjust` — Add a signed manual commission adjustment with a reason (D-418) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `agent_statements.approve` — Generate, approve or void agent statements; export the payroll file and mark employee statements paid (D-420) | ◆ |  |  |  |  |  |  |  |  | ◆ |  |  |  |  |  |  |
| `agent_plans.manage` — Create commission plans and draft their versions (D-418) | ● | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `agent_plans.approve` — Approve or reject a commission plan version drafted by someone else (D-418) | ◆ | ◆ | ◆ |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `ops.read` — Read the operational signals (outbox, queues, webhooks, payouts, ledger postings, SLA breaches) (D-113) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |

| Role | Name (th) | Name (en) |
|---|---|---|
| `superadmin` | ซูเปอร์แอดมิน | Superadmin |
| `c_level` | ผู้บริหารระดับสูง | C-Level |
| `vp` | รองประธาน | VP |
| `director` | ผู้อำนวยการ | Director |
| `admin` | ผู้ดูแลระบบ | Admin |
| `cs` | ฝ่ายบริการลูกค้า | CS |
| `cs_lead` | หัวหน้าฝ่ายบริการลูกค้า | CS Lead |
| `prepress` | ฝ่ายเตรียมพิมพ์ | Prepress |
| `finance` | ฝ่ายการเงิน | Finance |
| `finance_manager` | ผู้จัดการฝ่ายการเงิน | Finance Manager |
| `logistics` | ฝ่ายขนส่ง | Logistics |
| `marketing` | ฝ่ายการตลาด | Marketing |
| `sales_manager` | ผู้จัดการฝ่ายขาย | Sales Manager |
| `partner_manager` | ผู้จัดการพันธมิตร | Partner Manager |
| `auditor` | ผู้ตรวจสอบบัญชี | Auditor (read-only) |
| `dpo` | เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล | Data Protection Officer |

## Partner factory (factory scope)

| Permission | `factory_owner` | `factory_planner` | `factory_operator` | `factory_qc` | `factory_shipping` | `factory_accountant` | `factory_storekeeper` | `factory_purchaser` | `factory_maintenance` | `factory_sales` | `factory_auditor` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `factory_style_intakes.submit` — Offer the factory’s dielines to the style library under the intake terms (D-272) (D-272) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_process_capabilities.propose` — Propose or withdraw the factory’s process capabilities (verified by the Partner team) (D-244) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_profile.read` — Read the own factory profile | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `factory_users.manage` — Manage users of the own factory | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_profile.manage` — Edit the own factory profile, addresses, contacts and KYC documents | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_onboarding.sign_off` — Sign off data getpack entered on the factory’s behalf (D-100) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_prices.read` — Read the own factory price lists (D-044) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_prices.propose` — Propose price-list changes (factory price list mode) (D-040, D-042) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_rate_card.accept` — Accept, counter or refuse a platform rate card (D-042) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_agreements.accept` — Accept the partner agreement on behalf of the factory (D-011) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_bank_account.propose` — Propose a new bank account for payouts (dual approval by getpack Finance) (D-033) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_capacity.read` — Read the own capacity and bookings (D-101) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_rfq.read` — Read the requests for a buy price getpack sent the factory (never the sell price) (D-100, D-044) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_rfq.respond` — Answer a request for a buy price per quantity tier, or decline it (D-100) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_jobs.read` — Read the own factory’s production jobs: spec, approved artwork, delivery contacts (D-142) | ● | ● | ● | ● | ● | ● | ● |  | ● | ● |  |
| `factory_jobs.respond` — Accept or reject released jobs within the acceptance time (D-074) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_samples.record_evidence` — Record a sample’s measured size, the material used and its photos before it ships (D-255) | ● | ● |  | ● |  |  |  |  |  |  |  |
| `factory_milestones.update` — Start and complete milestones with quantities and photos (D-075) | ● | ● | ● | ● | ● |  |  |  |  |  |  |
| `factory_qc.record` — Record QC checklists with photos (D-076) | ● |  |  | ● |  |  |  |  |  |  |  |
| `factory_issues.raise` — Raise production issues on own jobs | ● | ● | ● | ● | ● |  |  |  |  |  |  |
| `factory_capacity.manage` — Set weekly capacity overrides of the own factory (D-101) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_scorecard.read` — Read the own factory’s monthly scorecard (D-155) | ● | ● |  | ● |  |  |  |  |  |  |  |
| `factory_shipments.read` — Read the own factory’s shipments, labels and packing lists (D-013, D-142) | ● | ● |  |  | ● |  |  |  |  |  |  |
| `factory_claims.read` — Read the claims about the own factory’s jobs (D-083) | ● | ● |  | ● |  |  |  |  |  |  |  |
| `factory_claims.respond` — Accept or dispute a claim getpack sent for review (D-083) | ● |  |  | ● |  |  |  |  |  |  |  |
| `factory_payables.read` — Read the own factory’s POs, goods receipts, billing statements, payouts and 50 ทวิ (D-090, D-022) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_payables.manage` — Confirm or dispute billing statements and submit the factory’s tax invoices (D-090) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_shipments.manage` — Create, pack, dispatch and deliver shipments with proof of delivery (D-013) | ● |  |  |  | ● |  |  |  |  |  |  |
| `factory_trading_partners.read` — Read the factory’s own suppliers and customers (getpack Factory ERP) (D-317, D-319) | ● | ● |  | ● |  | ● | ● | ● |  | ● |  |
| `factory_trading_partners.manage` — Add and edit the factory’s own suppliers and customers (D-317, D-319) | ● |  |  |  |  | ● |  | ● |  | ● |  |
| `factory_inventory.read` — Read the factory’s items, warehouses, stock balances and stock ledger (D-319, D-324) | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● |
| `factory_inventory.manage` — Manage items and warehouses, issue, return and transfer stock, post goods receipts (D-319, D-324, D-325) | ● |  |  |  |  |  | ● |  |  |  |  |
| `factory_inventory.adjust` — Post opening balances, stock adjustments and counts (D-319, D-324) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_procurement.read` — Read the factory’s purchase orders, goods receipts and the reorder list (D-319, D-325, D-326) | ● | ● |  |  |  | ● | ● | ● |  |  |  |
| `factory_procurement.manage` — Draft, edit, cancel and close the factory’s purchase orders (D-319, D-325) | ● |  |  |  |  |  |  | ● |  |  |  |
| `factory_procurement.approve` — Issue (approve) the factory’s purchase orders (D-319, D-325) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_procurement.request` — Raise the factory’s purchase requests (from need, the reorder list or MRP) (D-319, D-336) | ● | ● |  |  |  |  | ● | ● |  |  |  |
| `factory_ap.read` — Read the factory’s supplier invoices, payments and payables aging (D-319, D-337, D-338) | ● |  |  |  |  | ● |  | ● |  |  | ● |
| `factory_ap.manage` — Record supplier invoices (3-way matched) and pay or reverse supplier payments (D-319, D-337, D-338) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_ap.approve` — Approve supplier invoices that did not match the order or the goods received (D-319, D-337) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_planning.read` — Read the factory’s recipes, production orders, the floor queue and MRP (D-319, D-339, D-340, D-342) | ● | ● | ● | ● |  |  | ● |  | ● | ● |  |
| `factory_planning.manage` — Manage recipes; plan, release, complete and cancel production orders; request MRP shortages (D-319, D-339, D-340, D-341, D-342) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_production.record` — Start, pause, resume, finish or skip operations of production orders on the floor (kiosk) (D-319, D-341) | ● | ● | ● |  |  |  |  |  |  |  |  |
| `factory_maintenance.read` — Read the factory’s machines’ maintenance: breakdowns, preventive plans and their orders (D-355, D-357) | ● | ● | ● |  |  |  | ● | ● | ● |  |  |
| `factory_maintenance.report` — Report a machine breakdown (with photos) (D-355, D-357) | ● | ● | ● |  |  |  |  |  | ● |  |  |
| `factory_maintenance.manage` — Plan, schedule, carry out and close maintenance; issue spare parts to it (D-355, D-357) | ● | ● |  |  |  |  |  |  | ● |  |  |
| `factory_documents.read` — Read the factory’s documents and their versions (D-356, D-357) | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● |
| `factory_documents.manage` — Add, version, link, file and archive the factory’s documents and folders (D-356, D-357) | ● | ● |  |  |  |  | ● | ● |  |  |  |
| `factory_sales.read` — Read the factory’s CRM, quotations, sales orders, targets and sales reports (D-359, D-360, D-361, D-370) | ● | ● |  |  |  | ● | ● |  |  | ● |  |
| `factory_sales.manage` — Work leads, opportunities and activities; draft, send and revise quotations; enter and confirm sales orders (D-359, D-360, D-361, D-370) | ● |  |  |  |  |  |  |  |  | ● |  |
| `factory_sales.approve` — Confirm a sales order over the customer’s credit limit; set sales targets and commission rates (D-361, D-369, D-370) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_delivery.manage` — Prepare, issue (take out of stock), confirm and cancel delivery notes (D-362, D-370) | ● |  |  |  |  |  | ● |  |  | ● |  |
| `factory_receivables.read` — Read the factory’s invoices, tax invoices, credit / debit notes, receipts, billing notes and receivables aging (D-363, D-364, D-365, D-370) | ● |  |  |  |  | ● |  |  |  | ● | ● |
| `factory_receivables.manage` — Issue and void the factory’s invoices / tax invoices and credit / debit notes; record and cancel receipts and refunds; issue billing notes (D-363, D-364, D-365, D-370) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_tax.read` — Read and export the factory’s VAT and withholding-tax reports and its accounting export (D-366, D-367, D-370) | ● |  |  |  |  | ● |  |  |  |  | ● |
| `factory_quality.read` — Read the factory’s quality checks, inspection templates, NCRs and certificates of analysis (D-372, D-373, D-374, D-375, D-382) | ● | ● | ● | ● |  | ● | ● |  | ● |  |  |
| `factory_quality.record` — Record quality checks and their checkpoints and photos; raise NCRs (D-372, D-374, D-382) | ● |  | ● | ● |  |  | ● |  |  |  |  |
| `factory_quality.manage` — Keep inspection templates; override a check result; dispose, verify, close and cancel NCRs (D-372, D-373, D-374, D-382) | ● |  |  | ● |  |  |  |  |  |  |  |
| `factory_insight.read` — Read the owner’s dashboard, job costs and margins, OEE; receive the daily LINE summary (D-376, D-377, D-378, D-379, D-382) | ● | ● |  |  |  | ● |  |  |  |  |  |
| `factory_people.read` — Read the factory’s shifts, operator skills and work log (D-380, D-382) | ● | ● | ● |  |  |  |  |  | ● |  |  |
| `factory_people.manage` — Keep shifts and operator skills (D-380, D-382) | ● | ● |  |  |  |  |  |  |  |  |  |
| `factory_support.grant` — Grant and revoke getpack support time-boxed read access to the factory’s ERP (D-381, D-382) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_ledger.read` — Read the factory’s general ledger: chart of accounts, periods, journals, reports, fixed assets, bank (D-385, D-396) | ● |  |  |  |  | ● |  |  |  |  | ● |
| `factory_ledger.post` — Draft and submit manual journals, keep recurring journals, match bank lines, run depreciation (D-389, D-393, D-394, D-396) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_ledger.approve` — Approve or reject manual journals and chart-of-accounts changes (D-386, D-389, D-396) | ● |  |  |  |  |  |  |  |  |  |  |
| `factory_ledger.close` — Soft-close, close, lock and reopen fiscal periods; post into a soft-closed period (D-390, D-396) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_ledger.configure` — Configure the factory’s ledger: settings, chart change and posting-rule proposals, asset categories, bank accounts (D-385, D-386, D-387, D-396, D-398) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_tax.file` — Mark the factory’s VAT and WHT returns as filed (D-392, D-396) | ● |  |  |  |  | ● |  |  |  |  |  |
| `factory_erp.configure` — Configure the factory’s ERP: modules, document prefixes, stock and receiving rules (D-318, D-322, D-323) | ● |  |  |  |  |  |  |  |  |  |  |

| Role | Name (th) | Name (en) |
|---|---|---|
| `factory_owner` | เจ้าของโรงงาน | Factory Owner |
| `factory_planner` | ผู้วางแผนการผลิต | Planner |
| `factory_operator` | ผู้ปฏิบัติงาน | Operator |
| `factory_qc` | ฝ่ายควบคุมคุณภาพ | QC |
| `factory_shipping` | ฝ่ายจัดส่ง | Shipping |
| `factory_accountant` | ฝ่ายบัญชีโรงงาน | Factory Accountant |
| `factory_storekeeper` | เจ้าหน้าที่คลังสินค้า | Storekeeper |
| `factory_purchaser` | เจ้าหน้าที่จัดซื้อ | Purchaser |
| `factory_maintenance` | ช่างซ่อมบำรุง | Maintenance |
| `factory_sales` | ฝ่ายขาย | Sales |
| `factory_auditor` | ผู้สอบบัญชี / CPA | External Auditor |

## B2B company members (company scope)

| Permission | `company_admin` | `company_buyer` | `company_approver` | `company_accountant` | `sales_agent` |
|---|:-:|:-:|:-:|:-:|:-:|
| `company_profile.read` — Read the own company profile | ● | ● | ● | ● |  |
| `company_members.manage` — Invite and remove company members | ● |  |  |  |  |
| `company_orders.place` — Place orders for the company (its branch on the tax invoice) (D-123, D-125) | ● | ● |  |  |  |
| `company_profile.manage` — Edit the own company: settings, approval threshold, branches, KYC documents (D-120, D-123, D-125) | ● |  |  |  |  |
| `company_orders.approve` — Approve company orders above the company threshold (D-123) |  |  | ● |  |  |
| `company_documents.read` — Read company invoices and statements | ● |  |  | ● |  |
| `company_assets.manage` — Add and remove the company’s brand assets (every member can use them) (D-227) | ● |  |  |  |  |
| `company_api.manage` — Issue and revoke the company’s API clients (secret shown once) (D-291) | ● |  |  |  |  |
| `b2b_orders.read` — API client scope `orders:read`: read the company’s orders (D-291) |  |  |  |  |  |
| `b2b_orders.write` — API client scope `orders:write`: place orders for the company from saved quotations (D-291) |  |  |  |  |  |
| `b2b_documents.read` — API client scope `documents:read`: read and download the company’s documents (D-291) |  |  |  |  |  |
| `b2b_webhooks.manage` — API client scope `webhooks:manage`: the company’s webhook subscriptions and deliveries (D-291) |  |  |  |  |  |
| `agent.self` — Use the agent pages: own link, leads, customers, commission and statements (D-416, D-422) |  |  |  |  | ● |

| Role | Name (th) | Name (en) |
|---|---|---|
| `company_admin` | ผู้ดูแลบัญชีบริษัท | Company Admin |
| `company_buyer` | ผู้สั่งซื้อ | Buyer |
| `company_approver` | ผู้อนุมัติ | Approver |
| `company_accountant` | ฝ่ายบัญชีบริษัท | Accountant |
| `sales_agent` | ตัวแทนขาย | Sales agent |

## Segregation of duties (`accounting-design.md` §8)

| Rule | Kind | Pair | Match | Decisions |
|---|---|---|---|---|
| The creator of a payout run cannot approve it (D-022, §8) | action_pair | `payout_run.create` → `payout_run.approve` | same_subject | D-022, D-033 |
| Whoever records a vendor bill cannot change that vendor's bank account (§8) | action_pair | `vendor_invoice.record` → `vendor_bank_account.change` | same_vendor | D-033 |
| The maker of a manual journal cannot approve it (§8) | action_pair | `journal_entry.create` → `journal_entry.approve` | same_subject | D-033 |
| Whoever requests a credit note cannot issue it (§8) | action_pair | `customer_document.request` → `customer_document.approve` | same_subject | D-033 |
| Whoever requests a refund cannot approve it (§8) | action_pair | `refund.request` → `refund.approve` | same_subject | D-033 |
| Whoever proposes a write-off cannot approve it (§8) | action_pair | `receivable_item.request` → `receivable_item.approve` | same_subject | D-033 |
| Whoever changes a bank account cannot approve the change (§8) | action_pair | `vendor_bank_account.change` → `vendor_bank_account.approve` | same_subject | D-033 |
| D-168 the time-boxed Auditor role is never combined with Finance (auditor independence, §8) | role_pair | `auditor` × `finance` | — | D-168, D-140 |
| D-168 the time-boxed Auditor role is never combined with Finance Manager (auditor independence, §8) | role_pair | `auditor` × `finance_manager` | — | D-168, D-140 |

Also enforced by code: nobody grants or revokes their own roles; staff roles can be granted only by someone
who holds all of their permissions; an approval request cannot be approved by its requester, and one person
approves at most one step of a request (ADR-0006).
