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
    description: 'Hide or re-publish order reviews',
    decisionRefs: ['D-135'],
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
    description: 'Book fallback carriers, correct shipment statuses, record proofs of delivery and cancel shipments',
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
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
