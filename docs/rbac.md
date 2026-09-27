# RBAC matrix — packio-api

> **Generated** by `pnpm rbac:build` from `src/modules/iam/roles.catalog.ts`, `permissions.catalog.ts` and
> `prisma/seed/data/reference.ts`. Do not edit by hand. Roles per D-140; cost and margin visibility per D-141;
> factories see only delivery contact data of customers (D-142, enforced in projections, not by a permission).
> Grants where a decision is silent are the narrowest that lets the role work (docs/PROGRESS.md, B1.2) — **review**.

Legend: ● granted · ◆ granted and sensitive (cost/margin data, D-141).

## Packio staff (platform scope)

| Permission | `superadmin` | `c_level` | `vp` | `director` | `admin` | `cs` | `cs_lead` | `prepress` | `finance` | `finance_manager` | `logistics` | `marketing` | `partner_manager` | `auditor` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `settings.read` — Read platform settings and their history | ● | ● | ● | ● | ● |  |  |  | ● | ● |  |  | ● | ● |
| `settings.read_sensitive` — Read settings flagged sensitive | ◆ | ◆ |  |  |  |  |  |  |  | ◆ |  |  |  |  |
| `settings.change` — Create a new effective-dated setting version (D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `feature_flags.read` — Read feature flags | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `feature_flags.manage` — Change feature flags | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `entities.manage` — Manage legal entities (D-092) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `calendars.read` — Read business calendars | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `calendars.manage` — Key in public holidays and factory closures (D-161) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `consent_purposes.manage` — Manage consent purposes and their texts | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `approvals.read` — Read approval requests | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `approvals.act` — Approve or reject requests routed to the role | ● | ● | ● | ● |  |  |  |  | ● | ● |  | ● | ● |  |
| `approvals.delegate` — Delegate own approvals for a period | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `approval_policies.manage` — Create approval policy versions (D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `users.read` — Read staff, partner and customer accounts | ● |  |  |  | ● |  |  |  |  |  |  |  |  | ● |
| `users.manage` — Create, deactivate and edit accounts | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `roles.assign` — Grant and revoke roles (D-140) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `roles.manage` — Edit roles and their permissions (D-140) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `sod_rules.manage` — Edit segregation-of-duties rules | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `audit_logs.read` — Read the audit log | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  | ● |
| `audit_logs.export` — Export the audit log (itself audited) | ● |  |  |  |  |  |  |  |  | ● |  |  |  | ● |
| `files.upload` — Upload files | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `files.read` — Download files of records the user can see | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `notification_templates.manage` — Edit and publish notification templates | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `notification_routes.manage` — Edit the notification routing matrix (D-143) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `outbox.manage` — List dead-lettered domain events and replay them | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `catalog.read` — Read the platform catalogue in the admin zone | ● |  |  |  | ● | ● | ● | ● |  |  |  | ● | ● |  |
| `catalog.manage` — Create and edit catalogue rows (product types, patterns, materials, stock products …) (D-005, D-100) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `catalog.import` — Import and export catalogue tables with Excel (preview → confirm) (D-005) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `cms.manage` — Edit banners, home sections, articles, FAQs and videos | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |
| `seo.manage` — Edit SEO meta per page | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |
| `geography.manage` — Maintain provinces, districts, subdistricts and postcodes (D-161, D-170) | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `partners.read` — Read partner factories and their onboarding | ● | ● | ● |  | ● |  |  |  | ● | ● |  |  | ● | ● |
| `partners.manage` — Create factories, run onboarding, capability, tiers, capacity and status changes (D-011, D-041, D-171) | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `partners.site_visits.record` — Record site visits of partner factories (D-041) | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `price_proposals.review` — Review price proposals, draft platform rate cards and decide lines (D-040, D-042) | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `price_suggestions.read` — See staff-only price suggestions, benchmarks and impact simulations (D-040, D-044) | ◆ | ◆ |  |  |  |  |  |  |  |  |  |  | ◆ |  |
| `index_series.manage` — Maintain material and cost-driver index series (D-040) | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `agreements.manage` — Publish partner agreement texts (D-011) | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `zones.manage` — Maintain zone schemes, zones and postcodes (D-013) | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `vendor_bank_accounts.verify` — Record the verification call of a vendor bank-account change (D-033) | ● |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| `factory_cost.read` — See full factory buy prices and costs (D-141, D-044) | ◆ | ◆ | ◆ |  |  |  |  |  | ◆ | ◆ |  |  | ◆ |  |
| `margin.read` — See margins in amounts and percent (D-141) | ◆ | ◆ | ◆ |  |  |  |  |  | ◆ | ◆ |  |  | ◆ |  |
| `margin.read_pct_when_discounting` — See the resulting margin % while applying a discount (D-141, D-052) | ◆ |  |  |  |  | ◆ | ◆ |  |  |  |  |  |  |  |
| `quotes.calculate` — Price a configuration for a customer in the admin zone (CS calculator) (D-100, D-043) | ● | ● |  |  | ● | ● | ● |  |  |  |  |  | ● |  |
| `quotes.read` — Read saved quotations (D-051) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  |  |  | ● |
| `quotes.manage` — Save quotations for a customer, share them and issue their PDF (D-051) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |
| `rfqs.read` — Read requests for quote and their conversation (D-100) | ● | ● |  |  | ● | ● | ● |  |  |  |  |  | ● | ● |
| `rfqs.manage` — Work requests for quote: assign, ask for information, consult factories, quote, decline (D-100, D-043, D-102) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |
| `document_series.read` — Read document numbering series (D-092) | ● |  |  |  | ● |  |  |  | ● | ● |  |  |  | ● |
| `document_series.manage` — Create document numbering series (D-092, D-169) | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `shipping_rates.read` — Read the customer shipping rate card and its versions (D-013) | ● | ● |  |  | ● | ● | ● |  | ● | ● | ● |  | ● | ● |
| `shipping_rates.manage` — Draft customer shipping rate-card versions and submit them for C-Level approval (D-013) | ● |  |  |  | ● |  |  |  |  |  | ● |  |  |  |
| `factory_shipping_rates.manage` — Draft factory shipping payout cards, send them to the factory and answer counters (D-013, D-042, D-141) | ◆ |  |  |  |  |  |  |  |  |  |  |  | ◆ |  |
| `carriers.read` — Read fallback carriers and Packio’s carrier accounts | ● | ● |  |  | ● |  |  |  |  |  | ● |  | ● | ● |
| `carriers.manage` — Enable or disable fallback carriers and register Packio’s carrier accounts (D-114, D-005) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `sell_margins.manage` — Maintain Packio's sell margins, fix costs and design fees (effective-dated) (D-063) | ◆ | ◆ |  |  |  |  |  |  |  |  |  |  |  |  |
| `customers.read` — Find customers and read their profile, addresses and tax profiles (D-092) | ● |  |  |  | ● | ● | ● |  | ● | ● |  |  |  | ● |
| `customers.manage` — Create customer accounts and keep their addresses and tax profiles (CS) (D-092) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |
| `carts.manage_on_behalf` — Build a cart for a customer and check it out on their behalf (CS) (D-051) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |
| `orders.read` — Read order groups, orders and their queues (D-060) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  | ● |
| `orders.cancel` — Cancel order groups or orders before production, with a reason (D-060) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |
| `orders.manage` — CS operations on orders: change customer, remarks, cc e-mails, PO number, notes (D-125) | ● |  |  |  | ● | ● | ● |  |  |  |  |  |  |  |
| `orders.reprice` — Edit & re-price an order before production (D-051) | ● |  |  |  | ● |  | ● |  |  |  |  |  |  |  |
| `payment_schedules.override` — Choose or replace the payment schedule of an order group, with a reason (D-020) | ● |  |  |  | ● |  | ● |  |  | ● |  |  |  |  |
| `payment_schedule_templates.manage` — Add effective-dated versions of payment schedule templates (D-020, D-063) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `payments.read` — Read payments, slips and unidentified receipts (D-061) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  |  |  | ● |
| `payments.verify_slip` — Approve or reject slips that failed automatic verification (D-061) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |
| `payments.allocate` — Attach unidentified receipts to order groups (D-061) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |
| `refunds.request` — Request refunds (approved by the Finance Manager, maker-checker) (D-169) | ● |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `refunds.complete` — Record that an approved refund was paid out (bank transfer) (D-169) | ● |  |  |  |  |  |  |  | ● | ● |  |  |  |  |
| `promotions.read` — Read campaigns, promotions, coupon codes and the redemption report (D-053, D-154) | ● | ● |  |  | ● |  | ● |  |  | ● |  | ● |  | ● |
| `promotions.manage` — Create, edit, activate and end promotions; generate, disable and export coupon codes (D-053) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |
| `campaigns.manage` — Create campaigns, set their THB budget, activate, pause and end them (D-154) | ● |  |  |  | ● |  |  |  |  |  |  | ● |  |  |
| `loyalty.read` — Read customers’ points, tiers and points history (D-130, D-134) | ● | ● |  |  | ● | ● | ● |  | ● | ● |  | ● |  | ● |
| `loyalty.adjust` — Add or remove a customer’s points with a reason (audited) (D-131, D-132) | ● |  |  |  | ● |  | ● |  |  |  |  | ● |  |  |
| `reviews.moderate` — Hide or re-publish order reviews (D-135) | ● |  |  |  | ● |  | ● |  |  |  |  | ● |  |  |

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
| `partner_manager` | ผู้จัดการพันธมิตร | Partner Manager |
| `auditor` | ผู้ตรวจสอบบัญชี | Auditor (read-only) |

## Partner factory (factory scope)

| Permission | `factory_owner` | `factory_planner` | `factory_operator` | `factory_qc` | `factory_shipping` | `factory_accountant` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `factory_profile.read` — Read the own factory profile | ● | ● | ● | ● | ● | ● |
| `factory_users.manage` — Manage users of the own factory | ● |  |  |  |  |  |
| `factory_profile.manage` — Edit the own factory profile, addresses, contacts and KYC documents | ● |  |  |  |  |  |
| `factory_onboarding.sign_off` — Sign off data Packio entered on the factory’s behalf (D-100) | ● |  |  |  |  |  |
| `factory_prices.read` — Read the own factory price lists (D-044) | ● |  |  |  |  | ● |
| `factory_prices.propose` — Propose price-list changes (factory price list mode) (D-040, D-042) | ● |  |  |  |  |  |
| `factory_rate_card.accept` — Accept, counter or refuse a platform rate card (D-042) | ● |  |  |  |  |  |
| `factory_agreements.accept` — Accept the partner agreement on behalf of the factory (D-011) | ● |  |  |  |  |  |
| `factory_bank_account.propose` — Propose a new bank account for payouts (dual approval by Packio Finance) (D-033) | ● |  |  |  |  | ● |
| `factory_capacity.read` — Read the own capacity and bookings (D-101) | ● | ● |  |  |  |  |
| `factory_rfq.read` — Read the requests for a buy price Packio sent the factory (never the sell price) (D-100, D-044) | ● | ● |  |  |  |  |
| `factory_rfq.respond` — Answer a request for a buy price per quantity tier, or decline it (D-100) | ● | ● |  |  |  |  |

| Role | Name (th) | Name (en) |
|---|---|---|
| `factory_owner` | เจ้าของโรงงาน | Factory Owner |
| `factory_planner` | ผู้วางแผนการผลิต | Planner |
| `factory_operator` | ผู้ปฏิบัติงาน | Operator |
| `factory_qc` | ฝ่ายควบคุมคุณภาพ | QC |
| `factory_shipping` | ฝ่ายจัดส่ง | Shipping |
| `factory_accountant` | ฝ่ายบัญชีโรงงาน | Factory Accountant |

## B2B company members (company scope)

| Permission | `company_admin` | `company_buyer` | `company_approver` | `company_accountant` |
|---|:-:|:-:|:-:|:-:|
| `company_profile.read` — Read the own company profile | ● | ● | ● | ● |
| `company_members.manage` — Invite and remove company members | ● |  |  |  |
| `company_orders.approve` — Approve company orders above the company threshold (D-123) |  |  | ● |  |
| `company_documents.read` — Read company invoices and statements | ● |  |  | ● |

| Role | Name (th) | Name (en) |
|---|---|---|
| `company_admin` | ผู้ดูแลบัญชีบริษัท | Company Admin |
| `company_buyer` | ผู้สั่งซื้อ | Buyer |
| `company_approver` | ผู้อนุมัติ | Approver |
| `company_accountant` | ฝ่ายบัญชีบริษัท | Accountant |

## Segregation of duties (`accounting-design.md` §8)

| Rule | Kind | Pair | Match | Decisions |
|---|---|---|---|---|
| The creator of a payout run cannot approve it (D-022, §8) | action_pair | `payout_run.create` → `payout_run.approve` | same_subject | D-022, D-033 |
| Whoever records a vendor bill cannot change that vendor's bank account (§8) | action_pair | `vendor_invoice.record` → `vendor_bank_account.change` | same_vendor | D-033 |
| The maker of a manual journal cannot approve it (§8) | action_pair | `journal.create` → `journal.approve` | same_subject | D-033 |
| Whoever requests a credit note cannot issue it (§8) | action_pair | `credit_note.request` → `credit_note.issue` | same_subject | D-033 |
| Whoever requests a refund cannot approve it (§8) | action_pair | `refund.request` → `refund.approve` | same_subject | D-033 |
| Whoever proposes a write-off cannot approve it (§8) | action_pair | `write_off.request` → `write_off.approve` | same_subject | D-033 |
| Whoever changes a bank account cannot approve the change (§8) | action_pair | `vendor_bank_account.change` → `vendor_bank_account.approve` | same_subject | D-033 |
| D-168 the time-boxed Auditor role is never combined with Finance (auditor independence, §8) | role_pair | `auditor` × `finance` | — | D-168, D-140 |
| D-168 the time-boxed Auditor role is never combined with Finance Manager (auditor independence, §8) | role_pair | `auditor` × `finance_manager` | — | D-168, D-140 |

Also enforced by code: nobody grants or revokes their own roles; staff roles can be granted only by someone
who holds all of their permissions; an approval request cannot be approved by its requester, and one person
approves at most one step of a request (ADR-0006).
