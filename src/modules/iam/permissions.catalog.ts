/**
 * Permission catalogue (`resource.action`) — the code is the source of truth; `pnpm db:seed` writes it
 * to `permissions`. Each business module adds its own permissions when it lands (B2–B6).
 */
export type PermissionAudience = 'staff' | 'partner' | 'customer';

export interface PermissionDefinition {
  key: string;
  audience: PermissionAudience;
  description: string;
  /** Cost / margin and similar data restricted by D-141. */
  sensitive?: boolean;
  decisionRefs?: string[];
}

export const PERMISSIONS = [
  // --- Platform configuration (D-063, ADR-0005)
  { key: 'settings.read', audience: 'staff', description: 'Read platform settings and their history' },
  {
    key: 'settings.read_sensitive',
    audience: 'staff',
    description: 'Read settings flagged sensitive',
    sensitive: true,
  },
  {
    key: 'settings.change',
    audience: 'staff',
    description: 'Create a new effective-dated setting version',
    decisionRefs: ['D-063'],
  },
  { key: 'feature_flags.read', audience: 'staff', description: 'Read feature flags' },
  { key: 'feature_flags.manage', audience: 'staff', description: 'Change feature flags' },
  {
    key: 'entities.manage',
    audience: 'staff',
    description: 'Manage legal entities',
    decisionRefs: ['D-092'],
  },
  { key: 'calendars.read', audience: 'staff', description: 'Read business calendars' },
  {
    key: 'calendars.manage',
    audience: 'staff',
    description: 'Key in public holidays and factory closures',
    decisionRefs: ['D-161'],
  },
  {
    key: 'consent_purposes.manage',
    audience: 'staff',
    description: 'Manage consent purposes and their texts',
  },

  // --- Approvals (ADR-0006)
  { key: 'approvals.read', audience: 'staff', description: 'Read approval requests' },
  { key: 'approvals.act', audience: 'staff', description: 'Approve or reject requests routed to the role' },
  { key: 'approvals.delegate', audience: 'staff', description: 'Delegate own approvals for a period' },
  {
    key: 'approval_policies.manage',
    audience: 'staff',
    description: 'Create approval policy versions',
    decisionRefs: ['D-063'],
  },

  // --- IAM (D-140)
  { key: 'users.read', audience: 'staff', description: 'Read staff, partner and customer accounts' },
  { key: 'users.manage', audience: 'staff', description: 'Create, deactivate and edit accounts' },
  { key: 'roles.assign', audience: 'staff', description: 'Grant and revoke roles', decisionRefs: ['D-140'] },
  {
    key: 'roles.manage',
    audience: 'staff',
    description: 'Edit roles and their permissions',
    decisionRefs: ['D-140'],
  },
  { key: 'sod_rules.manage', audience: 'staff', description: 'Edit segregation-of-duties rules' },

  // --- Audit, files, notifications
  { key: 'audit_logs.read', audience: 'staff', description: 'Read the audit log' },
  { key: 'audit_logs.export', audience: 'staff', description: 'Export the audit log (itself audited)' },
  { key: 'files.upload', audience: 'staff', description: 'Upload files' },
  { key: 'files.read', audience: 'staff', description: 'Download files of records the user can see' },
  {
    key: 'notification_templates.manage',
    audience: 'staff',
    description: 'Edit and publish notification templates',
  },
  {
    key: 'notification_routes.manage',
    audience: 'staff',
    description: 'Edit the notification routing matrix',
    decisionRefs: ['D-143'],
  },

  {
    key: 'outbox.manage',
    audience: 'staff',
    description: 'List dead-lettered domain events and replay them',
  },

  // --- Catalogue & CMS (B2.1, D-005: created by admins; D-100)
  { key: 'catalog.read', audience: 'staff', description: 'Read the platform catalogue in the admin zone' },
  {
    key: 'catalog.manage',
    audience: 'staff',
    description: 'Create and edit catalogue rows (product types, patterns, materials, stock products …)',
    decisionRefs: ['D-005', 'D-100'],
  },
  {
    key: 'catalog.import',
    audience: 'staff',
    description: 'Import and export catalogue tables with Excel (preview → confirm)',
    decisionRefs: ['D-005'],
  },
  {
    key: 'cms.manage',
    audience: 'staff',
    description: 'Edit banners, home sections, articles, FAQs and videos',
  },
  { key: 'seo.manage', audience: 'staff', description: 'Edit SEO meta per page' },
  {
    key: 'business_calendar.manage',
    audience: 'staff',
    description: 'Key in the national holidays once a year, by form or Excel import',
    decisionRefs: ['D-161', 'D-170'],
  },
  {
    key: 'geography.manage',
    audience: 'staff',
    description: 'Maintain provinces, districts, subdistricts and postcodes',
    decisionRefs: ['D-161', 'D-170'],
  },

  // --- Partners & price governance (B2.2, D-011, D-040…D-044, D-101)
  { key: 'partners.read', audience: 'staff', description: 'Read partner factories and their onboarding' },
  {
    key: 'partners.manage',
    audience: 'staff',
    description: 'Create factories, run onboarding, capability, tiers, capacity and status changes',
    decisionRefs: ['D-011', 'D-041', 'D-171'],
  },

  // --- Style library (U3, D-241–D-246)
  {
    key: 'styles.read',
    audience: 'staff',
    description: 'Read the style library: bases, variants, recipes, imports',
  },
  {
    key: 'styles.import',
    audience: 'staff',
    description: 'Import the style master file and recipe bundles (dry run, then confirm)',
    decisionRefs: ['D-242'],
  },
  {
    key: 'styles.curate',
    audience: 'staff',
    description: 'Curate the style library: featured, hidden, order, copy, product type',
    decisionRefs: ['D-246'],
  },
  {
    key: 'styles.approve_recipe',
    audience: 'staff',
    description: 'Approve a style recipe version (Prepress)',
    decisionRefs: ['D-243'],
  },
  {
    key: 'styles.approve_names',
    audience: 'staff',
    description:
      'Approve the Thai / English names of a style (Marketing: wording, Prepress: technical terms)',
    decisionRefs: ['D-212'],
  },
  {
    key: 'styles.verify_reference',
    audience: 'staff',
    description:
      'Verify an industry reference code (FEFCO / ECMA) against the edition Packio holds (Prepress)',
    decisionRefs: ['D-211'],
  },

  {
    key: 'styles.process_rules',
    audience: 'staff',
    description: 'Maintain which processes a style needs (style process rules, Prepress)',
    decisionRefs: ['D-244'],
  },
  {
    key: 'factory_process_capabilities.propose',
    audience: 'partner',
    description: 'Propose or withdraw the factory’s process capabilities (verified by the Partner team)',
    decisionRefs: ['D-244'],
  },

  // --- Structure Advisor (U2.2, D-188, D-189, D-235–D-240)
  {
    key: 'advisory.read',
    audience: 'staff',
    description:
      'Read Structure Advisor recommendations (inputs, rule set, board data, choices) and replay them',
    decisionRefs: ['D-240'],
  },
  {
    key: 'advisory.evaluate',
    audience: 'staff',
    description: 'Run the Structure Advisor for a configuration, also while it is off for customers',
    decisionRefs: ['D-237', 'D-239'],
  },
  {
    key: 'partners.site_visits.record',
    audience: 'staff',
    description: 'Record site visits of partner factories',
    decisionRefs: ['D-041'],
  },
  {
    key: 'price_proposals.review',
    audience: 'staff',
    description: 'Review price proposals, draft platform rate cards and decide lines',
    decisionRefs: ['D-040', 'D-042'],
  },
  {
    key: 'price_suggestions.read',
    audience: 'staff',
    description: 'See staff-only price suggestions, benchmarks and impact simulations',
    sensitive: true,
    decisionRefs: ['D-040', 'D-044'],
  },
  {
    key: 'index_series.manage',
    audience: 'staff',
    description: 'Maintain material and cost-driver index series',
    decisionRefs: ['D-040'],
  },
  {
    key: 'agreements.manage',
    audience: 'staff',
    description: 'Publish partner agreement texts',
    decisionRefs: ['D-011'],
  },
  {
    key: 'zones.manage',
    audience: 'staff',
    description: 'Maintain zone schemes, zones and postcodes',
    decisionRefs: ['D-013'],
  },
  {
    key: 'vendor_bank_accounts.verify',
    audience: 'staff',
    description: 'Record the verification call of a vendor bank-account change',
    decisionRefs: ['D-033'],
  },

  // --- Cost & margin visibility (D-141)
  {
    key: 'factory_cost.read',
    audience: 'staff',
    description: 'See full factory buy prices and costs',
    sensitive: true,
    decisionRefs: ['D-141', 'D-044'],
  },
  {
    key: 'margin.read',
    audience: 'staff',
    description: 'See margins in amounts and percent',
    sensitive: true,
    decisionRefs: ['D-141'],
  },
  {
    key: 'margin.read_pct_when_discounting',
    audience: 'staff',
    description: 'See the resulting margin % while applying a discount',
    sensitive: true,
    decisionRefs: ['D-141', 'D-052'],
  },

  // --- Pricing (B2.3)
  {
    key: 'quotes.calculate',
    audience: 'staff',
    description: 'Price a configuration for a customer in the admin zone (CS calculator)',
    decisionRefs: ['D-100', 'D-043'],
  },
  {
    key: 'quotes.read',
    audience: 'staff',
    description: 'Read saved quotations',
    decisionRefs: ['D-051'],
  },
  {
    key: 'quotes.manage',
    audience: 'staff',
    description: 'Save quotations for a customer, share them and issue their PDF',
    decisionRefs: ['D-051'],
  },
  {
    key: 'rfqs.read',
    audience: 'staff',
    description: 'Read requests for quote and their conversation',
    decisionRefs: ['D-100'],
  },
  {
    key: 'rfqs.manage',
    audience: 'staff',
    description: 'Work requests for quote: assign, ask for information, consult factories, quote, decline',
    decisionRefs: ['D-100', 'D-043', 'D-102'],
  },
  {
    key: 'document_series.read',
    audience: 'staff',
    description: 'Read document numbering series',
    decisionRefs: ['D-092'],
  },
  {
    key: 'document_series.manage',
    audience: 'staff',
    description: 'Create document numbering series',
    decisionRefs: ['D-092', 'D-169'],
  },
  {
    key: 'shipping_rates.read',
    audience: 'staff',
    description: 'Read the customer shipping rate card and its versions',
    decisionRefs: ['D-013'],
  },
  {
    key: 'shipping_rates.manage',
    audience: 'staff',
    description: 'Draft customer shipping rate-card versions and submit them for C-Level approval',
    decisionRefs: ['D-013'],
  },
  {
    key: 'factory_shipping_rates.manage',
    audience: 'staff',
    description: 'Draft factory shipping payout cards, send them to the factory and answer counters',
    sensitive: true,
    decisionRefs: ['D-013', 'D-042', 'D-141'],
  },
  {
    key: 'carriers.read',
    audience: 'staff',
    description: 'Read fallback carriers and Packio’s carrier accounts',
  },
  {
    key: 'carriers.manage',
    audience: 'staff',
    description: 'Enable or disable fallback carriers and register Packio’s carrier accounts',
    decisionRefs: ['D-114', 'D-005'],
  },
  {
    key: 'sell_margins.manage',
    audience: 'staff',
    description: "Maintain Packio's sell margins, fix costs and design fees (effective-dated)",
    sensitive: true,
    decisionRefs: ['D-063'],
  },

  // --- Commerce (B3)
  {
    key: 'customers.read',
    audience: 'staff',
    description: 'Find customers and read their profile, addresses and tax profiles',
    decisionRefs: ['D-092'],
  },
  {
    key: 'privacy_requests.manage',
    audience: 'staff',
    description: "Answer customers' PDPA requests: export their data or anonymise them",
    decisionRefs: ['D-222'],
  },
  {
    key: 'customers.manage',
    audience: 'staff',
    description: 'Create customer accounts and keep their addresses and tax profiles (CS)',
    decisionRefs: ['D-092'],
  },

  {
    key: 'carts.manage_on_behalf',
    audience: 'staff',
    description: 'Build a cart for a customer and check it out on their behalf (CS)',
    decisionRefs: ['D-051'],
  },

  {
    key: 'orders.read',
    audience: 'staff',
    description: 'Read order groups, orders and their queues',
    decisionRefs: ['D-060'],
  },
  {
    key: 'orders.cancel',
    audience: 'staff',
    description: 'Cancel order groups or orders before production, with a reason',
    decisionRefs: ['D-060'],
  },

  {
    key: 'orders.manage',
    audience: 'staff',
    description: 'CS operations on orders: change customer, remarks, cc e-mails, PO number, notes',
    decisionRefs: ['D-125'],
  },
  {
    key: 'orders.reprice',
    audience: 'staff',
    description: 'Edit & re-price an order before production',
    decisionRefs: ['D-051'],
  },

  {
    key: 'payment_schedules.override',
    audience: 'staff',
    description: 'Choose or replace the payment schedule of an order group, with a reason',
    decisionRefs: ['D-020'],
  },
  {
    key: 'payment_schedule_templates.manage',
    audience: 'staff',
    description: 'Add effective-dated versions of payment schedule templates',
    decisionRefs: ['D-020', 'D-063'],
  },

  {
    key: 'payments.read',
    audience: 'staff',
    description: 'Read payments, slips and unidentified receipts',
    decisionRefs: ['D-061'],
  },
  {
    key: 'payments.verify_slip',
    audience: 'staff',
    description: 'Approve or reject slips that failed automatic verification',
    decisionRefs: ['D-061'],
  },
  {
    key: 'payments.allocate',
    audience: 'staff',
    description: 'Attach unidentified receipts to order groups',
    decisionRefs: ['D-061'],
  },

  {
    key: 'refunds.request',
    audience: 'staff',
    description: 'Request refunds (approved by the Finance Manager, maker-checker)',
    decisionRefs: ['D-169'],
  },
  {
    key: 'refunds.complete',
    audience: 'staff',
    description: 'Record that an approved refund was paid out (bank transfer)',
    decisionRefs: ['D-169'],
  },

  {
    key: 'promotions.read',
    audience: 'staff',
    description: 'Read campaigns, promotions, coupon codes and the redemption report',
    decisionRefs: ['D-053', 'D-154'],
  },
  {
    key: 'promotions.manage',
    audience: 'staff',
    description: 'Create, edit, activate and end promotions; generate, disable and export coupon codes',
    decisionRefs: ['D-053'],
  },
  {
    key: 'campaigns.manage',
    audience: 'staff',
    description: 'Create campaigns, set their THB budget, activate, pause and end them',
    decisionRefs: ['D-154'],
  },

  {
    key: 'loyalty.read',
    audience: 'staff',
    description: 'Read customers’ points, tiers and points history',
    decisionRefs: ['D-130', 'D-134'],
  },
  {
    key: 'loyalty.adjust',
    audience: 'staff',
    description: 'Add or remove a customer’s points with a reason (audited)',
    decisionRefs: ['D-131', 'D-132'],
  },
  {
    key: 'reviews.moderate',
    audience: 'staff',
    description: 'Hide or re-publish order reviews (Marketing, D-202)',
    decisionRefs: ['D-135', 'D-202', 'D-265'],
  },
  {
    key: 'reviews.reply',
    audience: 'staff',
    description: 'Write or edit the one reply to a review (CS, D-202)',
    decisionRefs: ['D-202', 'D-265'],
  },
  {
    key: 'guarantee_policies.read',
    audience: 'staff',
    description: 'See guarantee policy versions and their remedy matrix',
    decisionRefs: ['D-260'],
  },
  {
    key: 'guarantee_policies.manage',
    audience: 'staff',
    description: 'Draft a new guarantee policy version for C-Level approval (CS Lead, D-200)',
    decisionRefs: ['D-200', 'D-260'],
  },

  {
    key: 'companies.read',
    audience: 'staff',
    description: 'Read B2B companies, their members, branches and KYC documents',
    decisionRefs: ['D-120', 'D-125'],
  },
  {
    key: 'companies.manage',
    audience: 'staff',
    description: 'Suspend, reactivate or close B2B companies',
    decisionRefs: ['D-120'],
  },
  {
    key: 'companies.kyc_review',
    audience: 'staff',
    description: 'Verify company KYC documents and approve or reject applications',
    decisionRefs: ['D-120'],
  },

  {
    key: 'company_credit.manage',
    audience: 'staff',
    description: 'Request B2B credit limits and terms (approved by Finance / C-Level)',
    decisionRefs: ['D-121'],
  },

  {
    key: 'discount_memos.request',
    audience: 'staff',
    description: 'Give CS discounts within the limit and raise discount memos above it',
    decisionRefs: ['D-052', 'D-124'],
  },
  {
    key: 'discount_memos.read',
    audience: 'staff',
    description: 'Read discount memos and where they were used',
    decisionRefs: ['D-052'],
  },

  // --- B4.1 artwork, proofs, design services, designs & drawings
  {
    key: 'artwork.read',
    audience: 'staff',
    description: 'Read artwork submissions, preflight reports, proofs and design services of orders',
    decisionRefs: ['D-070', 'D-071'],
  },
  {
    key: 'artwork.submit_on_behalf',
    audience: 'staff',
    description: 'Upload artwork for a customer’s order',
    decisionRefs: ['D-070'],
  },
  {
    key: 'prepress.review',
    audience: 'staff',
    description: 'Accept or reject submissions, send proofs and templates, answer proof annotations',
    decisionRefs: ['D-070'],
  },
  {
    key: 'proofs.decide_on_behalf',
    audience: 'staff',
    description: 'Approve a proof or request changes for the customer, with a reason (audited)',
    decisionRefs: ['D-070', 'D-073'],
  },
  {
    key: 'design_services.manage',
    audience: 'staff',
    description: 'Assign designers, deliver design rounds and re-quote structure or concept changes',
    decisionRefs: ['D-071'],
  },
  {
    key: 'mockups.manage',
    audience: 'staff',
    description: 'Add a paid mockup / physical proof to an order at a CS-quoted price (audited)',
    decisionRefs: ['D-072'],
  },
  {
    key: 'samples.read',
    audience: 'staff',
    description: 'See samples (attached and standalone), their evidence and the customer’s decision',
    decisionRefs: ['D-253', 'D-255'],
  },
  {
    key: 'samples.manage',
    audience: 'staff',
    description: 'Create, quote and cancel samples at a CS-entered price; record their evidence (audited)',
    decisionRefs: ['D-253', 'D-254', 'D-194'],
  },
  {
    key: 'drawings.generate',
    audience: 'staff',
    description: 'Generate dieline drawings and send templates to customers',
    decisionRefs: ['D-070'],
  },

  // --- B4.2 production
  {
    key: 'production.read',
    audience: 'staff',
    description: 'Read production jobs, milestones, QC, inspections and factory scorecards',
    decisionRefs: ['D-073', 'D-155'],
  },
  {
    key: 'production.start_manual',
    audience: 'staff',
    description: 'Start production as an exception, with a reason (audited)',
    decisionRefs: ['D-073'],
  },
  {
    key: 'production.manage',
    audience: 'staff',
    description: 'Reassign jobs to another factory, hold and resume jobs, resolve escalations',
    decisionRefs: ['D-012', 'D-074', 'D-101'],
  },
  {
    key: 'milestone_routes.manage',
    audience: 'staff',
    description: 'Edit milestone routes per product type as new versions',
    decisionRefs: ['D-075'],
  },
  {
    key: 'inspections.perform',
    audience: 'staff',
    description: 'Carry out Packio inspections and record their results',
    decisionRefs: ['D-076'],
  },
  {
    key: 'shipments.read',
    audience: 'staff',
    description: 'Read shipments, carrier events, proofs of delivery and delivery reconciliations',
    decisionRefs: ['D-013', 'D-080'],
  },
  {
    key: 'conversations.read',
    audience: 'staff',
    description: 'Read the CS inbox: LINE and web conversations',
    decisionRefs: ['D-151'],
  },
  {
    key: 'conversations.reply',
    audience: 'staff',
    description: 'Reply to customers, assign and close conversations',
    decisionRefs: ['D-151'],
  },
  {
    key: 'line.manage',
    audience: 'staff',
    description: 'Register the LINE official account rich menus',
    decisionRefs: ['D-151'],
  },
  {
    key: 'claims.read',
    audience: 'staff',
    description: 'Read claims, their evidence and resolutions',
    decisionRefs: ['D-082'],
  },
  {
    key: 'claims.manage',
    audience: 'staff',
    description: 'Open, review, ask for information, send to the factory, decide and close claims',
    decisionRefs: ['D-082', 'D-083'],
  },
  {
    key: 'claims.override_liability',
    audience: 'staff',
    description: 'Override the liability rule of a claim with a reason',
    decisionRefs: ['D-083'],
  },
  {
    key: 'claims.resolve',
    audience: 'staff',
    description: 'Resolve approved claims: re-production, refund request, credit, deductions',
    decisionRefs: ['D-083', 'D-022'],
  },
  {
    key: 'shipments.manage',
    audience: 'staff',
    description:
      'Book fallback carriers, correct shipment statuses, record proofs of delivery and cancel shipments',
    decisionRefs: ['D-013', 'D-114'],
  },

  // --- Partner zone (factory-scoped)
  { key: 'factory_profile.read', audience: 'partner', description: 'Read the own factory profile' },
  { key: 'factory_users.manage', audience: 'partner', description: 'Manage users of the own factory' },

  {
    key: 'factory_profile.manage',
    audience: 'partner',
    description: 'Edit the own factory profile, addresses, contacts and KYC documents',
  },
  {
    key: 'factory_onboarding.sign_off',
    audience: 'partner',
    description: 'Sign off data Packio entered on the factory’s behalf',
    decisionRefs: ['D-100'],
  },
  {
    key: 'factory_prices.read',
    audience: 'partner',
    description: 'Read the own factory price lists',
    decisionRefs: ['D-044'],
  },
  {
    key: 'factory_prices.propose',
    audience: 'partner',
    description: 'Propose price-list changes (factory price list mode)',
    decisionRefs: ['D-040', 'D-042'],
  },
  {
    key: 'factory_rate_card.accept',
    audience: 'partner',
    description: 'Accept, counter or refuse a platform rate card',
    decisionRefs: ['D-042'],
  },
  {
    key: 'factory_agreements.accept',
    audience: 'partner',
    description: 'Accept the partner agreement on behalf of the factory',
    decisionRefs: ['D-011'],
  },
  {
    key: 'factory_bank_account.propose',
    audience: 'partner',
    description: 'Propose a new bank account for payouts (dual approval by Packio Finance)',
    decisionRefs: ['D-033'],
  },
  {
    key: 'factory_capacity.read',
    audience: 'partner',
    description: 'Read the own capacity and bookings',
    decisionRefs: ['D-101'],
  },

  {
    key: 'factory_rfq.read',
    audience: 'partner',
    description: 'Read the requests for a buy price Packio sent the factory (never the sell price)',
    decisionRefs: ['D-100', 'D-044'],
  },
  {
    key: 'factory_rfq.respond',
    audience: 'partner',
    description: 'Answer a request for a buy price per quantity tier, or decline it',
    decisionRefs: ['D-100'],
  },
  {
    key: 'factory_jobs.read',
    audience: 'partner',
    description: 'Read the own factory’s production jobs: spec, approved artwork, delivery contacts',
    decisionRefs: ['D-142'],
  },
  {
    key: 'factory_jobs.respond',
    audience: 'partner',
    description: 'Accept or reject released jobs within the acceptance time',
    decisionRefs: ['D-074'],
  },
  {
    key: 'factory_samples.record_evidence',
    audience: 'partner',
    description: 'Record a sample’s measured size, the material used and its photos before it ships',
    decisionRefs: ['D-255'],
  },
  {
    key: 'factory_milestones.update',
    audience: 'partner',
    description: 'Start and complete milestones with quantities and photos',
    decisionRefs: ['D-075'],
  },
  {
    key: 'factory_qc.record',
    audience: 'partner',
    description: 'Record QC checklists with photos',
    decisionRefs: ['D-076'],
  },
  {
    key: 'factory_issues.raise',
    audience: 'partner',
    description: 'Raise production issues on own jobs',
  },
  {
    key: 'factory_capacity.manage',
    audience: 'partner',
    description: 'Set weekly capacity overrides of the own factory',
    decisionRefs: ['D-101'],
  },
  {
    key: 'factory_scorecard.read',
    audience: 'partner',
    description: 'Read the own factory’s monthly scorecard',
    decisionRefs: ['D-155'],
  },
  {
    key: 'factory_shipments.read',
    audience: 'partner',
    description: 'Read the own factory’s shipments, labels and packing lists',
    decisionRefs: ['D-013', 'D-142'],
  },
  {
    key: 'factory_claims.read',
    audience: 'partner',
    description: 'Read the claims about the own factory’s jobs',
    decisionRefs: ['D-083'],
  },
  {
    key: 'factory_claims.respond',
    audience: 'partner',
    description: 'Accept or dispute a claim Packio sent for review',
    decisionRefs: ['D-083'],
  },
  {
    key: 'factory_payables.read',
    audience: 'partner',
    description: 'Read the own factory’s POs, goods receipts, billing statements, payouts and 50 ทวิ',
    decisionRefs: ['D-090', 'D-022'],
  },
  {
    key: 'factory_payables.manage',
    audience: 'partner',
    description: 'Confirm or dispute billing statements and submit the factory’s tax invoices',
    decisionRefs: ['D-090'],
  },
  {
    key: 'factory_shipments.manage',
    audience: 'partner',
    description: 'Create, pack, dispatch and deliver shipments with proof of delivery',
    decisionRefs: ['D-013'],
  },

  // --- B2B company (company-scoped)
  { key: 'company_profile.read', audience: 'customer', description: 'Read the own company profile' },
  { key: 'company_members.manage', audience: 'customer', description: 'Invite and remove company members' },
  {
    key: 'company_orders.place',
    audience: 'customer',
    description: 'Place orders for the company (its branch on the tax invoice)',
    decisionRefs: ['D-123', 'D-125'],
  },
  {
    key: 'company_profile.manage',
    audience: 'customer',
    description: 'Edit the own company: settings, approval threshold, branches, KYC documents',
    decisionRefs: ['D-120', 'D-123', 'D-125'],
  },
  {
    key: 'company_orders.approve',
    audience: 'customer',
    description: 'Approve company orders above the company threshold',
    decisionRefs: ['D-123'],
  },
  {
    key: 'company_documents.read',
    audience: 'customer',
    description: 'Read company invoices and statements',
  },
  {
    key: 'company_assets.manage',
    audience: 'customer',
    description: 'Add and remove the company’s brand assets (every member can use them)',
    decisionRefs: ['D-227'],
  },

  // --- Finance: ledger (B5.1, accounting-design §1, §8)
  {
    key: 'ledger.read',
    audience: 'staff',
    description:
      'Read the chart of accounts, periods, journals with their lines, posting rules and tax rates',
    decisionRefs: ['D-031'],
  },
  {
    key: 'ledger.journals.manage',
    audience: 'staff',
    description: 'Draft and submit manual, recurring and reversing journals (approved by another person, §8)',
    decisionRefs: ['D-033', 'D-169'],
  },
  {
    key: 'ledger.periods.manage',
    audience: 'staff',
    description: 'Soft-close, reopen, close and lock fiscal periods (§1.4, §7)',
    decisionRefs: ['D-033'],
  },
  {
    key: 'ledger.post_soft_closed',
    audience: 'staff',
    description: 'Post into a soft-closed period (§1.4)',
    decisionRefs: ['D-033'],
  },
  {
    key: 'ledger.config.propose',
    audience: 'staff',
    description:
      'Propose chart-of-accounts changes, posting-rule and tax-rate versions and cost centres (maker-checker, §8)',
    decisionRefs: ['D-033', 'D-169'],
  },

  // --- Finance: receivables (B5.2, accounting-design §2, §4, §6)
  {
    key: 'receivables.read',
    audience: 'staff',
    description:
      'Read customer documents, receivables and aging, 50 ทวิ certificates, credit balances and statements',
    decisionRefs: ['D-010', 'D-033'],
  },
  {
    key: 'receivables.manage',
    audience: 'staff',
    description:
      'Void invoices / debit notes, record or waive 50 ทวิ, update the allowance for doubtful accounts',
    decisionRefs: ['D-033'],
  },
  {
    key: 'credit_notes.request',
    audience: 'staff',
    description: 'Request credit notes (issued after a Finance Manager approves, §8)',
    decisionRefs: ['D-033', 'D-169'],
  },
  {
    key: 'receivables.write_off.request',
    audience: 'staff',
    description: 'Request bad-debt write-offs (approved by a Finance Manager, §8)',
    decisionRefs: ['D-033', 'D-169'],
  },
  {
    key: 'receivables.debit_notes.issue',
    audience: 'staff',
    description: 'Issue debit notes',
    decisionRefs: ['D-033'],
  },

  // --- Finance: payables, payouts, banking (B5.3, accounting-design §2, §6, §8)
  {
    key: 'payables.read',
    audience: 'staff',
    description:
      'Read POs, goods receipts, billing statements, vendor invoices, payables, vendors and payout runs',
    decisionRefs: ['D-022', 'D-090'],
  },
  {
    key: 'payables.manage',
    audience: 'staff',
    description: 'Capture and validate factory tax invoices (input VAT only with a valid document, §2)',
    decisionRefs: ['D-090'],
  },
  {
    key: 'payables.vendors.manage',
    audience: 'staff',
    description: 'Create non-factory vendors and propose their bank accounts (dual approval, §8)',
    decisionRefs: ['D-033', 'D-169'],
  },
  {
    key: 'payables.bills.record',
    audience: 'staff',
    description: 'Record vendor bills (the recorder cannot change that vendor’s bank account, §8)',
    decisionRefs: ['D-033', 'D-169'],
  },
  {
    key: 'payouts.manage',
    audience: 'staff',
    description:
      'Create, propose and cancel payout runs (approved by a C-Level other than the proposer, D-166)',
    decisionRefs: ['D-022', 'D-166'],
  },
  {
    key: 'payouts.execute',
    audience: 'staff',
    description: 'Generate the bank file of an approved run and record the bank’s confirmation',
    decisionRefs: ['D-093'],
  },
  {
    key: 'banking.read',
    audience: 'staff',
    description: 'Read company bank accounts, statement lines, unidentified receipts and the cash position',
    decisionRefs: ['D-061', 'D-093'],
  },
  {
    key: 'banking.manage',
    audience: 'staff',
    description: 'Import statements and settlements, match, ignore and identify statement lines',
    decisionRefs: ['D-061', 'D-093'],
  },
  {
    key: 'banking.accounts.propose',
    audience: 'staff',
    description: 'Propose company bank accounts (approved by Finance then Finance Manager, §8)',
    decisionRefs: ['D-093', 'D-169'],
  },

  // --- Finance: tax (B5.4, accounting-design §2, §6, §7)
  {
    key: 'tax.read',
    audience: 'staff',
    description: 'Read tax reports, working papers, WHT registers and the tax calendar',
    decisionRefs: ['D-033'],
  },
  {
    key: 'tax.manage',
    audience: 'staff',
    description: 'Generate and finalise tax reports (GL difference must be 0) and record filings',
    decisionRefs: ['D-033'],
  },
  {
    key: 'tax.pay',
    audience: 'staff',
    description: 'Record VAT and withholding-tax payments to the Revenue Department',
    decisionRefs: ['D-033'],
  },

  // --- Finance: fixed assets (B5.5, D-150)
  {
    key: 'fixed_assets.read',
    audience: 'staff',
    description: 'Read asset categories, the fixed-asset register, depreciation and roll-forward',
    decisionRefs: ['D-150'],
  },
  {
    key: 'fixed_assets.manage',
    audience: 'staff',
    description: 'Manage asset categories, register assets and run the monthly depreciation',
    decisionRefs: ['D-150'],
  },
  {
    key: 'fixed_assets.dispose',
    audience: 'staff',
    description: 'Dispose of or write off fixed assets',
    decisionRefs: ['D-150'],
  },

  // --- Finance: period close & audit support (B5.6, accounting-design §7, §8)
  {
    key: 'close.read',
    audience: 'staff',
    description: 'Read close checklists, their checks and evidence',
    decisionRefs: ['D-033'],
  },
  {
    key: 'close.manage',
    audience: 'staff',
    description: 'Open close checklists, run checks, complete tasks, attach evidence and submit for review',
    decisionRefs: ['D-033'],
  },
  {
    key: 'close.approve',
    audience: 'staff',
    description: 'Waive close tasks, approve and close a month (not the submitter), return it, lock it',
    decisionRefs: ['D-033', 'D-169'],
  },
  {
    key: 'audit_support.read',
    audience: 'staff',
    description: 'Read the §8 exception reports and audit samples',
    decisionRefs: ['D-033'],
  },
  {
    key: 'audit_support.sample',
    audience: 'staff',
    description: 'Draw audit samples',
    decisionRefs: ['D-033'],
  },
  {
    key: 'audit_support.export',
    audience: 'staff',
    description: 'Generate and download the prepared-by-client pack of a month',
    decisionRefs: ['D-033'],
  },
  {
    key: 'close.audit_sign_off',
    audience: 'staff',
    description: 'Sign off a closed month as the auditor (required to lock the fiscal year end)',
    decisionRefs: ['D-033'],
  },
  // --- B6.1 analytics (D-102, D-044, D-160)
  {
    key: 'analytics.read',
    audience: 'staff',
    description:
      'Read the demand & growth dashboards: traffic, funnel, demand, sales, sensitivity, unmet demand, campaigns',
    decisionRefs: ['D-102'],
  },
  {
    key: 'analytics.read_factories',
    audience: 'staff',
    description: 'Read factory utilisation and on-time performance by named factory (staff-only)',
    decisionRefs: ['D-102', 'D-044'],
  },
  {
    key: 'analytics.manage',
    audience: 'staff',
    description: 'Queue analytics rollup backfills and read their runs',
    decisionRefs: ['D-102'],
  },
  {
    key: 'analytics.prospectus',
    audience: 'staff',
    description: 'Generate and download the aggregated, anonymised partner prospectus',
    decisionRefs: ['D-102', 'D-044', 'D-160'],
  },
  // --- B6.2 reports (D-111)
  {
    key: 'reports.export',
    audience: 'staff',
    description:
      'Export operational reports as XLSX / CSV and download report files (each report also needs its data permission)',
    decisionRefs: ['D-111'],
  },
  {
    key: 'reports.schedule',
    audience: 'staff',
    description:
      'Schedule operational reports for staff recipients and see every run of the reports the user may read',
    decisionRefs: ['D-111'],
  },
  // --- B6.3 launch readiness (D-113)
  {
    key: 'ops.read',
    audience: 'staff',
    description:
      'Read the operational signals (outbox, queues, webhooks, payouts, ledger postings, SLA breaches)',
    decisionRefs: ['D-113'],
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
