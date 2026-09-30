# Production settings review — packio-api

> **Generated** by `pnpm launch:settings` from `prisma/seed/data/settings.ts`, `approval-policies.ts`, `commerce.ts`,
> `fulfilment.ts` and `receivables.ts`. Do not edit by hand. Each owner confirms or changes every value **in production**
> (a new effective-dated version, audited — D-063) and signs item 5 of `docs/LAUNCH-CHECKLIST.md`. A *proposed* or
> *pending* value is not a decision: it goes live only once its owner confirms it.

**67 settings** — 36 confirmed · 16 proposed · 4 pending the CPA (⚖) · 1 pending the business · 10 defined without a value (not set until their owner sets them).

## Settings

| Key | Seeded value | Status | Owner | Decisions | What it controls |
|---|---|---|---|---|---|
| `analytics.prospectus_min_group_size` | `3` | confirmed | superadmin | D-160, D-044 | D-160 minimum factories per breakdown in anonymised exports and the partner prospectus |
| `artwork.preflight_rules` | `{"severities":{"size_mismatch":"block","missing_bleed":"block","low_resolution":"warn","rgb_colour":"warn","fonts_not_embedded":"info","safe_zone":"info","thin_lines":"info","overprint":"info","ink_coverage":"info"},"bleedMm":"3","sizeToleranceMm":"1","minEffectivePpi":300,"safeZoneMm":"3","minLineWidthPt":"0.25","maxInkCoveragePct":300}` | proposed | superadmin | D-070 | D-070 preflight: block on size mismatch or missing bleed, warn on low resolution or RGB; other checks report only; technical thresholds proposed (ADR-0009) |
| `artwork.prepress_sla_business_hours` | `— (not set)` | not set | superadmin | D-070 | D-070 prepress queue: business hours to answer a submission; no decision gives it, no due time until set |
| `audit.business_hours` | `{"start":"08:00","end":"18:00","weekdays":[1,2,3,4,5]}` | proposed | finance_manager | D-033 | D-033 / accounting-design §8 exception report: manual journals posted outside these hours (Asia/Bangkok, ISO weekdays) are listed for the auditor (proposed) |
| `auth.access_token_ttl_seconds` | `600` | proposed | superadmin | D-063 | D-063 / ADR-0004 access-token lifetime in seconds (contract §4: 10–15 minutes) |
| `auth.device_pin_policy` | `{"length":6,"maxAttempts":5,"lockMinutes":15}` | proposed | superadmin | D-063 | D-063 / ADR-0004 optional partner device PIN: length and attempt limit |
| `auth.otp_policy` | `{"codeLength":6,"expirySeconds":300,"maxAttempts":5,"resendCooldownSeconds":60,"maxPerPhonePerHour":5,"maxPerIpPerHour":20}` | proposed | superadmin | D-063 | D-063 / ADR-0004 customer phone OTP: expiry, attempts and rate limits |
| `auth.password_lockout` | `{"maxFailedAttempts":5,"lockMinutes":15}` | proposed | superadmin | D-063 | D-063 / ADR-0004 staff and partner password lockout after failed logins |
| `auth.refresh_token_lifetimes` | `{"staff":{"absoluteHours":12,"idleHours":2},"partner":{"absoluteHours":168,"idleHours":24},"customer":{"absoluteHours":720,"idleHours":168}}` | proposed | superadmin | D-063 | D-063 / ADR-0004 refresh-token absolute and idle lifetimes per audience (hours) |
| `b2b.credit_eligibility_paid_orders` | `3` | confirmed | superadmin | D-121 | D-121 paid orders after which a prepaid company becomes eligible for credit |
| `b2b.credit_terms` | `{"allowedDays":[15,30,45,60],"defaultDays":30}` | confirmed | superadmin | D-121 | D-121 credit terms a company may be given |
| `b2b.kyc_certificate_max_age_months` | `6` | confirmed | superadmin | D-120 | D-120 a company certificate is accepted only when issued within this many months |
| `b2b.overdue_rules` | `{"reminderDaysBeforeDue":7,"blockCreditOrdersAfterDaysOverdue":7}` | confirmed | superadmin | D-122 | D-122 overdue reminders and credit-order blocking |
| `banking.auto_match` | `{"dateWindowDays":3,"amountTolerance":"0.00"}` | proposed | finance_manager | D-093, D-061 | D-093 / accounting-design §6 bank auto-matching: exact amount (± tolerance) + reference + date window (proposed) |
| `calendar.business_hours` | `{"from":"09:00","to":"18:00","timezone":"Asia/Bangkok"}` | proposed | superadmin | D-175, D-061 | D-175 business hours of working days (national calendar) for business-hour SLAs such as the D-061 slip review |
| `campaigns.budget_alert_pct` | `80` | confirmed | superadmin | D-154 | D-154 Marketing is alerted when a campaign has used this share of its budget |
| `claims.window_days` | `7` | confirmed | superadmin | D-082 | D-082 claim window after receipt (days) |
| `close.unmatched_items_threshold` | `0` | proposed | finance_manager | D-033 | D-033 / accounting-design §7 step 1: unmatched bank / gateway items allowed at close before each must be explained (proposed: none) |
| `design.extra_revision_fee` | `{"minimumAmount":"500.00","pctOfDesignFee":"20"}` | confirmed | superadmin | D-071 | D-071 fee per revision round from round 4: max(minimum, % of the design fee) |
| `design.free_revision_rounds` | `3` | confirmed | superadmin | D-071 | D-071 free revision rounds per hired design |
| `design.hired_design_sla` | `{"targetBusinessDays":5,"maxBusinessDays":10}` | confirmed | superadmin | D-071 | D-071 hired design delivery target and maximum |
| `discounts.cs_limit_pct` | `5` | confirmed | superadmin | D-052 | D-052 discount CS may give without a discount memo |
| `documents.retention_years` | `10` | confirmed | finance_manager | D-033 | D-033 / accounting-design §2 record retention of documents and ledgers (≥ 10 years, above the 5-year statutory minimum) |
| `fixed_assets.depreciation_start` | `acquisition_month` | pending_cpa | finance_manager | D-150 | D-150 first month of straight-line depreciation: the month the asset is acquired (full month) or the month after (⚖ pro-rata by days is not used) |
| `fulfilment.tolerance_default_pct` | `5` | confirmed | superadmin | D-163, D-021 | D-163 default quantity tolerance ± % (shortage and overage) until a factory sets its own |
| `loyalty.activity_rewards` | `{"signupBaht":"50.00","lineLinkingBaht":"20.00","reviewBaht":"10.00"}` | confirmed | superadmin | D-135, D-131 | D-135 activity rewards in baht, converted to points at the point value (rounded down) |
| `loyalty.earn_rate` | `{"bahtPerPoint":"500.00","basis":"paid_before_vat_excluding_shipping"}` | confirmed | superadmin | D-130 | D-130 one point per THB 500 paid (before VAT, excluding shipping) |
| `loyalty.expected_redemption_rate_pct` | `100` | pending_cpa | superadmin | D-131, D-033 | D-131 / P10 expected redemption rate for the points liability (accounting-design.md §5, ⚖ points liability method) |
| `loyalty.point_value` | `2.50` | confirmed | superadmin | D-131 | D-131 value of one point (THB); posting rule P10 |
| `loyalty.points_expiry` | `{"monthsPerEarning":12,"reminderDaysBefore":30}` | confirmed | superadmin | D-132 | D-132 points expire 12 months per earning, reminder 30 days before |
| `loyalty.redemption_limits` | `{"minimumBaht":"10.00","maxPctOfOrder":"20"}` | confirmed | superadmin | D-133 | D-133 minimum redemption (THB equivalent) and maximum share of the order value |
| `loyalty.tiers` | `[{"tier":"member","minSpend12m":"0.00","multiplier":"1"},{"tier":"silver","minSpend12m":"50000.00","multiplier":"1.25"},{"tier":"gold","minSpend12m":"200000.00","multiplier":"1.5"}]` | confirmed | superadmin | D-134 | D-134 tiers by 12-month spend with earn multipliers |
| `notifications.marketing_window` | `{"from":"09:00","to":"20:00","timezone":"Asia/Bangkok"}` | confirmed | superadmin | D-144 | D-144 marketing messages are sent only inside this window (transactional anytime) |
| `ops.alert_thresholds` | `{"outbox_dead_letters":1,"outbox_backlog_minutes":15,"queue_depth":1000,"webhook_failures_24h":5,"payout_item_failures_7d":1,"ledger_posting_failures":1,"acceptance_overdue":1,"production_at_risk":5,"rfq_first_response_overdue":1,"approvals_overdue":5,"slip_verification_wait_hours":4}` | proposed | superadmin | D-113, D-061, D-074 | D-113 launch monitoring: value at which each operational signal raises an alert to superadmins and admins (slip wait mirrors the D-061 4-hour SLA in wall-clock hours; the rest proposed) |
| `orders.auto_complete_days` | `7` | confirmed | superadmin | D-081 | D-081 days after delivery until an order completes automatically |
| `orders.unpaid_expiry_days` | `7` | proposed | superadmin | D-060 | D-060 calendar days after placement until an unpaid order group is cancelled; legacy reads the value from a secret not in the repository, so its 7-day fallback is seeded (B3.1, 2026-09-27) |
| `partners.auto_selection_min_factories` | `2` | confirmed | superadmin | D-101, D-012 | D-101 active factories per product type before auto-selection and auto-reassignment switch on |
| `partners.impact_simulation_window_days` | `90` | confirmed | superadmin | D-040 | D-040 note: the impact simulation re-prices the factory quotes of the last 90 days |
| `partners.peer_benchmark_min_factories` | `3` | confirmed | superadmin | D-101, D-044 | D-101 / D-044 active factories per product type before peer benchmarks are computed |
| `partners.suggestion_deviation_band_pct` | `— (not set)` | not set | superadmin | D-172, D-040 | D-040 / D-172 band above which a proposed buy price is flagged against its suggestion; not seeded (D-172) — no above_band flag until a superadmin sets it |
| `payments.method_fees` | `— (not set)` | not set | finance_manager | D-176 | D-176 fee Packio expects per payment method ({method: {pct, fixedAmount}}), recorded on each payment for P04; not seeded — fee 0 until Finance sets it |
| `payments.qr_validity_minutes` | `1440` | proposed | superadmin | D-060, D-176 | D-060 / D-176 lifetime of one SCB QR payment attempt (minutes); legacy used SCB_DAYS_UNTIL_EXPIRATION (sample 1 day); never shortens the order expiry |
| `payments.schedule_split_threshold` | `20000.00` | confirmed | superadmin | D-020 | D-020 order value (THB) from which the 50 % deposit + 50 % before shipping schedule applies |
| `payments.slip_receiver_accounts` | `— (not set)` | not set | finance_manager | D-061 | D-061 collection accounts a slip must pay into ([{accountType, accountNumber}] in the Slip2Go form); not seeded — until set, no slip passes automatically (all go to Finance) |
| `payments.slip_review_sla_business_hours` | `4` | confirmed | superadmin | D-061 | D-061 Finance SLA for slips that fail automatic verification (business hours) |
| `payouts.advance_pct` | `30` | confirmed | superadmin | D-022 | D-022 default factory advance paid on job acceptance |
| `payouts.balance_trigger` | `after_pod_and_claim_window` | confirmed | superadmin | D-022 | D-022 default trigger of the factory balance payout |
| `payouts.retention_pct` | `5` | confirmed | superadmin | D-022 | D-022 default retention held from the factory balance payout |
| `payouts.retention_release_days` | `30` | confirmed | superadmin | D-164, D-022 | D-164 days after the claim window closes until the retention is released |
| `pricing.margin_floor_pct` | `10` | confirmed | superadmin | D-012, D-063 | D-012 margin floor: reassignment, discounts and promotions never go below it |
| `production.factory_acceptance_sla_business_days` | `1` | confirmed | superadmin | D-074 | D-074 time a factory has to accept a released job (business days) |
| `promotions.code_attempt_limits` | `{"perCustomerPerHour":10,"perIpPerHour":30,"perDevicePerHour":10}` | proposed | superadmin | D-053 | D-053 abuse control: coupon code attempts allowed per customer, IP and device each hour |
| `qc.inspection_sampling` | `{"fullInspectionFromValue":"300000.00","sampledBandFromValue":"100000.00","sampledBandRatePct":"20","trialFactoryJobs":3,"trialFactoryRatePct":"100","highDefectRateThresholdPct":"3","highDefectWindowDays":90,"highDefectRatePct":"50","specialFinishOrFoodUpliftPp":"20","isoInspectionLevel":"II","aql":{"critical":"0","major":"2.5","minor":"4.0"}}` | confirmed | superadmin | D-076 | D-076 Packio risk-based inspection sampling (ISO 2859-1) |
| `quotes.validity_days` | `15` | confirmed | superadmin | D-051 | D-051 quotation validity with price lock (days) |
| `receivables.allowance_rates` | `— (not set)` | not set | finance_manager | D-033 | D-033 / accounting-design §10 allowance method (⚖): % of open receivables per days-overdue band for P30; not seeded — until set, Finance enters the allowance amount |
| `receivables.forfeited_deposit_policy` | `{"forfeitPct":"0"}` | pending_business | finance_manager | D-033, D-020 | D-033 / accounting-design §10 forfeited deposit policy (⚖): % of the paid deposit kept when an order is cancelled before production; 0 until the business decides (P23) |
| `referral.rules` | `{"refereeDiscountPct":"5","refereeDiscountMaxBaht":"500.00","referrerRewardBaht":"500.00","maxRewardedReferralsPerMonth":10}` | confirmed | superadmin | D-136 | D-136 referral rewards and monthly cap |
| `rfq.sla_business_hours` | `— (not set)` | not set | superadmin | D-100 | D-100 first-response SLA of a request for quote, in business hours; scoped per product type (RFQ category) with a platform fallback; not seeded — no SLA due date until set |
| `shipping.carton_spec` | `— (not set)` | not set | superadmin | D-013 | D-013 shipping carton used by the packing helper (legacy parcel logic: square footprint grid, stack height, weight limit); not seeded — no carton count until set |
| `shipping.pallet_spec` | `— (not set)` | not set | superadmin | D-013 | D-013 pallet used to count cartons per pallet (no legacy rule exists); not seeded — no pallet count until set |
| `shipping.target_margin_pct` | `— (not set)` | not set | superadmin | D-040, D-013 | D-040 group 5 target shipping margin: suggested factory payout = customer rate × (1 − margin); not seeded — no group-5 suggestion until set |
| `storefront.support_channels` | `— (not set)` | not set | cs_lead | D-221, D-005 | D-221 Packio support contacts on the storefront (LINE OA id, phone, e-mail, opening hours); Packio’s own accounts (D-005) — not seeded, every field null until the CS Lead sets it |
| `support.first_response_business_days` | `1` | confirmed | cs_lead | D-221, D-175 | D-221 first-response target of a contact-form or guided-help conversation, in business days (business hours D-175, calendar D-161) |
| `tax.calendar` | `{"pp30":{"dayOfNextMonth":15},"pnd3":{"dayOfNextMonth":7},"pnd53":{"dayOfNextMonth":7},"reminderDaysBefore":3}` | proposed | finance_manager | D-033 | D-033 / accounting-design §6 tax calendar: filing due day of the following month per form (paper-filing days; e-filing extensions are a Finance choice) and the reminder lead time (proposed) |
| `tax.gl_accounts` | `{"output_vat":["2210"],"input_vat":["1241"],"wht_pnd3":["2232"],"wht_pnd53":["2231"],"wht_receivable":["1230"]}` | proposed | finance_manager | D-033 | D-033 / accounting-design §7 step 7: GL control accounts each tax report and working paper reconciles to (difference must be 0); follows the chart of accounts (proposed) |
| `tax.nature_by_product_type` | `{"default":"hire_of_work","overrides":{"standard_product":"sale_of_goods"}}` | pending_cpa | finance_manager | D-033 | D-033 / accounting-design §2 nature of the sale per product type code (⚖): hire of work for made-to-order packaging, sale of goods for standard products; snapshotted on every order |
| `tax.rounding_mode` | `line` | pending_cpa | finance_manager | D-033 | D-033 / accounting-design §1.5 VAT and WHT rounding per line or per document (⚖); a document-level difference is an explicit rounding amount |

## Legal entity data (D-092)

Seeded per entity from the `SEED_ENTITY_*` environment variables — never from code. Finance Manager checks each value against the company certificate and ภ.พ.20.

| Key | What it is |
|---|---|
| `entity.legal_name_th` | D-092 registered legal name (Thai) of the issuing entity |
| `entity.legal_name_en` | D-092 registered legal name (English) of the issuing entity |
| `entity.tax_id` | D-092 tax id (13 digits) of the issuing entity |
| `entity.branch_code` | D-092 branch code of the issuing entity (00000 = head office) |
| `entity.address_th` | D-092 registered address (Thai) printed on documents of the issuing entity |
| `entity.phone` | D-092 contact phone printed on documents of the issuing entity |

## Approval matrices (ADR-0006)

| Policy | Subject | Steps (role — condition) | Decisions | Note |
|---|---|---|---|---|
| `discount_memo` | discount_memo | Director (> 5–10 %): **director**<br>VP (> 10–15 %): **vp**<br>C-Level (> 15 % or below the margin floor): **c_level** | D-052, D-162, D-124 | Seed from D-052 / D-162 — tier boundaries are Proposed in D-052 |
| `credit_limit` | company_credit_limit | Finance (≤ THB 100,000): **finance**<br>C-Level (> THB 100,000): **c_level** | D-121 | Seed from D-121 |
| `payout_run` | payout_run | Executive approval: **c_level** | D-022, D-166 | Seed from D-022 / D-166 — the executive approver is C-Level |
| `price_proposal` | price_proposal | Partner Manager review: **partner_manager** | D-040, D-042 | Seed from D-040 — reviewed by the Partner team |
| `partner_activation` | factory | Partner Manager approval: **partner_manager** | D-041, D-011 | Seed from D-041 |
| `partner_pricing_mode_change` | factory | Partner Manager approval: **partner_manager** | D-042, D-167 | Seed from D-042 / D-167 — Partner Manager approves |
| `factory_tolerance_change` | factory_tolerance_policy_version | Superadmin approval: **superadmin** | D-173, D-021, D-063 | Seed from D-173 — Superadmin approves (proposed default) |
| `factory_payout_policy_change` | factory_payout_policy_version | Superadmin approval: **superadmin** | D-173, D-022, D-063 | Seed from D-173 — Superadmin approves (proposed default) |
| `customer_shipping_rate_change` | customer_shipping_rate_card_version | C-Level approval: **c_level** | D-013, D-063 | Chosen at B2.4 planning (2026-09-26) — no decision names the approver; C-Level (proposed default) |
| `vendor_bank_account_change` | vendor_bank_account | Finance verification: **finance**<br>Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves; dual approval by two different people |
| `company_bank_account_change` | company_bank_account | Finance verification: **finance**<br>Finance Manager approval: **finance_manager** | D-093, D-033, D-169 | Seed from D-169 — Finance Manager approves; dual approval by two different people |
| `manual_journal` | journal_entry | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `recurring_journal` | recurring_journal | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `credit_note` | customer_document | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `refund` | refund | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `write_off` | receivable_item | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `posting_rule_change` | posting_rule_version | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `coa_change` | account_change | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `tax_setting_change` | tax_rate_version | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `document_series_change` | document_series | Finance Manager approval: **finance_manager** | D-033, D-169 | Seed from D-169 — Finance Manager approves |
| `company_order_approval` | order_group | Company approver: **company_approver** (subject_company) | D-123 | Seed from D-123 |
| `referral_review` | referral_attribution | Marketing review: **marketing** | D-136 | Seed from D-136 |

## Feature flags (seeded off)

Every integration flag is seeded **off** and switched on by a superadmin once its account exists and its UAT scenario passed (`docs/launch/INTEGRATIONS.md`).

| Flag | What it switches |
|---|---|
| `payments.scb` | SCB QR payments (PromptPay QR 30, QR CS) — D-176, on once the merchant account exists |
| `payments.twoc2p` | 2C2P card and online banking — D-176, on once the merchant account exists |
| `payments.slip_verify` | Automatic slip verification (Slip2Go) — D-061 / D-176; off: slips go to Finance |
| `payments.twoc2p_ipp` | 2C2P card instalments (IPP) — R2 (D-111), adapter stubbed |
| `payments.scb_direct_debit` | SCB direct debit — R2 (D-111), adapter stubbed |
| `drawing.engine` | Dieline drawing engine @packio/dieline (B4.1) — off until the package is published; drawings answer 501 |
| `e_tax.sending` | Send e-Tax invoices / e-Receipts to the Revenue Department (D-091): XML and PDF are generated in R1; sending is enabled in R2 after registration |
