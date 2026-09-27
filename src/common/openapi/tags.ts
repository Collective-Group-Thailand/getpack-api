/**
 * Every OpenAPI tag with its description (contract §5). An operation tag missing here fails the
 * contract build. Tags are `<surface>.<resource>` (`store.orders`) or `ops.<area>`.
 */
export const API_TAGS: Record<string, string> = {
  'store.customerProfile': 'The signed-in customer’s profile: customer type and customer code (D-020).',
  'store.addresses': 'Delivery and billing addresses of the signed-in customer; orders keep a snapshot (D-142).',
  'store.taxProfiles':
    'Buyer data for full-form tax invoices: tax id, head office / branch, withholding flag (D-092, D-174).',
  'store.cart': 'The signed-in customer’s cart: price-locked quotation options split over addresses (D-051, D-142).',
  'admin.cart': 'CS works a customer’s cart on their behalf (channel `cs`, D-051).',
  'store.checkout': 'Preview and place the order group from the cart (D-051, D-060, D-013, D-174).',
  'admin.checkout': 'CS places a customer’s order on their behalf (channel `cs`).',
  'store.orders': 'My order groups and orders: status driven by payment, artwork, production and shipping (D-060, D-073).',
  'admin.orders': 'Order groups and orders for staff: reads with D-141 masking, cancellation with a reason.',
  'admin.orderOperations': 'CS operations on orders: edit & re-price, change customer, remarks, notes, work queues.',
  'store.paymentSchedules': 'The instalments of my order group and its production / shipping gates (D-020, D-073).',
  'admin.paymentSchedules': 'Payment schedules and their templates: views with allocations per order, CS override (D-020, ADR-0008).',
  'store.payments': 'Pay instalments by SCB QR, 2C2P or bank transfer with a slip (D-061, D-176).',
  'admin.payments': 'Payments, the Finance slip queue and unidentified receipts (D-061).',
  'webhooks.payments': 'SCB, 2C2P and slip-verification callbacks, confirmed before any payment is accepted (D-061).',
  'admin.refunds': 'Refunds: request, Finance Manager approval (maker-checker), gateway or bank-transfer execution (D-169).',
  'admin.campaigns': 'Marketing campaigns with a THB budget: 80 % alert and auto-stop when spent (D-154).',
  'admin.promotions':
    'Promotions with validated conditions and benefits, coupon codes (single, bulk-unique, per-customer), CSV export and the redemption report (D-053).',
  'store.referral': 'My referral code and link; use a friend’s code before the first order (D-136).',
  'admin.referrals': 'Referrals with their fraud flags; `under_review` is Marketing’s queue (D-136).',
  'store.loyalty': 'My points, tier and points history (D-130…D-134); redeem at checkout with `redeemPoints` (D-133).',
  'admin.customers': 'CS finds or creates customers and keeps their addresses and tax profiles (D-092).',
  'store.quotes':
    'Instant price calculation per quantity (D-043, D-100); save it as a quotation with `store.savedQuotes` (D-051).',
  'store.savedQuotes':
    'Saved quotations: 15-day price lock, share links, PDF in the name of the issuing entity, re-pricing after expiry (D-051).',
  'store.rfqs': 'Requests for quote: submit, talk to Packio, accept or decline a quotation (D-100, D-043).',
  'admin.rfqs': 'Work requests for quote: assign, ask, consult factories, quote, decline (D-100, D-102).',
  'partner.rfqConsultations': 'Requests for the factory’s buy price on an RFQ; never the sell price (D-044).',
  'admin.quotes': 'Saved quotations with the staff view; CS saves, shares and exports them (D-051, D-141).',
  'admin.csFolding':
    'The CS folding calculator: catalogue choices and pricing with the staff view (D-100, D-141).',
  'admin.sellMarginTables': "Packio's sell margins, fix costs and design fees, effective-dated (D-063).",
  'partner.pricingFolding': 'A factory prices a folding configuration on its own price list (D-044).',
  'ops.health': 'Liveness and readiness of the API and its dependencies (database, Redis, object storage).',
  'auth.staff': 'Sign-in for Packio staff (e-mail + password). ADR-0004.',
  'auth.partner': 'Sign-in for partner-factory users (password or device PIN). ADR-0004.',
  'auth.customer':
    'Customer sign-in: phone OTP, Google/Apple (Firebase) and LINE with account linking. ADR-0004.',
  'auth.tokens':
    'Refresh-token rotation, logout, OAuth2 client credentials for factory systems, JWKS. ADR-0004.',
  'store.me': 'The signed-in customer.',
  'admin.me': 'The signed-in staff member, permissions and menu entitlements.',
  'admin.users': 'Staff, partner and customer accounts, role grants and sessions (D-140, D-168).',
  'admin.roles': 'The role and permission catalogue (D-140, D-141).',
  'admin.approvals': 'Generic approval engine: inbox, approve, reject, withdraw (ADR-0006).',
  'admin.approvalDelegations': "Time-boxed delegation of one's approvals (ADR-0006).",
  'admin.settings': 'Effective-dated business settings: history and dated changes (ADR-0005, D-063).',
  'admin.featureFlags': 'Operational feature flags (not business values).',
  'admin.notificationTemplates':
    'Notification templates per event and channel, th/en versions, preview, test send (D-143).',
  'admin.notificationRoutes': 'The notification routing matrix: event × audience × channel (D-143, D-144).',
  'admin.consentPurposes': 'PDPA consent purposes and their versioned texts (D-005, D-144).',
  'admin.notifications': "The signed-in staff member's in-app notifications.",
  'store.notifications': "The signed-in customer's in-app notifications.",
  'partner.notifications': "The signed-in factory user's in-app notifications.",
  'store.realtime': 'Realtime signals over SSE for customers (ids + type only, contract §6).',
  'admin.realtime': 'Realtime signals over SSE for staff (ids + type only, contract §6).',
  'partner.realtime': 'Realtime signals over SSE for factory users (ids + type only, contract §6).',
  'store.webPush': 'Web push subscriptions of the signed-in customer (D-143).',
  'admin.webPush': 'Web push subscriptions of the signed-in staff member (D-143).',
  'partner.webPush': 'Web push subscriptions of the signed-in factory user (D-143).',
  'store.files': 'Customer uploads (artwork, slips…): presign → PUT → complete → signed download.',
  'admin.files': 'Staff uploads and downloads (presign → PUT → complete → signed download).',
  'partner.files': 'Factory uploads (evidence, documents): presign → PUT → complete → signed download.',
  'admin.auditLogs': 'The audit log: search and CSV export (itself audited).',
  'admin.outbox': 'Domain-event outbox: dead-letter list and replay.',
  'partner.me': 'The signed-in factory user, their factories and device PINs.',

  // --- B2.2 partners & price governance
  'admin.factories':
    'Partner factories: registration, onboarding steps, KYC, addresses, contacts, bank accounts and lifecycle (D-011, D-041, D-171).',
  'partner.factories':
    'My factory: application data, onboarding sign-off, documents and bank accounts (own factory only, D-044).',
  'admin.agreementTemplates':
    'Versioned partner agreement texts (D-011; confidentiality both directions, D-044).',
  'admin.shippingZoneSchemes': 'Zone schemes: customer zones and one per carrier (D-013, D-114).',
  'admin.shippingZones': 'Zones and their postcodes (D-013, D-114).',
  'admin.factoryShippingRates':
    'Factory shipping payout cards: Packio drafts, the factory accepts per line; buy prices (D-013, D-042, D-141).',
  'partner.shippingRates': 'The own shipping payout card: read and accept or counter (D-013, D-042).',
  'admin.documentSeries': 'Document numbering series per entity and document type (accounting-design §4, D-169).',
  'admin.carriers': 'Delivery methods: the factory fleet and Packio-booked fallback carriers (D-013, D-114).',
  'webhooks.carriers': 'Carrier status callbacks, signature-verified and stored once (D-114).',
  'admin.customerShippingRates':
    'The customer shipping rate card: effective-dated versions approved by C-Level (D-013).',
  'admin.priceLists':
    'Factory price lists: versions, lines (every read audited, D-044) and the supported price components (D-040).',
  'admin.priceProposals':
    'Price proposals and platform rate cards: review queue, line decisions and counters (D-040, D-042, D-043).',
  'admin.priceSuggestions':
    'Staff-only suggested buy prices with their basis and impact simulations — never shown to factories (D-040, D-044).',
  'admin.indexSeries': 'Material price indices and cost-driver series behind the price suggestions (D-040).',
  'admin.partnerCoverage':
    'Which factories cover each product type, and whether an instant price path exists (D-043).',
  'partner.priceLists':
    'My price lists: versions, lines and sign-off of assisted entry (own factory only, D-044).',
  'partner.priceProposals':
    'My price proposals (factory price-list mode) and Packio rate cards to accept or negotiate (D-042).',
  'admin.vendorBankAccounts':
    'Verification calls of vendor bank-account changes (accounting-design.md §8, D-169).',

  // --- B2.1 catalogue & CMS
  'store.catalog':
    'Public catalogue and CMS reads for the storefront: products, stock products, showcase, articles, FAQs, SEO, geography, search, images and the Merchant feed — no prices or factory data (D-100, D-050).',
  'admin.catalogShowcaseCategories': 'Categories of showcase products (D-005).',
  'admin.catalogShowcaseProducts': 'Pre-configured showcase products ("Product Groups", D-005, D-100).',
  'admin.catalogSemiDesigns': 'Semi-custom designs of a catalogue product with their palette (D-005).',
  'admin.catalogSemiDesignTemplates': 'Semi-design templates per standard size, with fonts (D-005).',
  'admin.catalogDesignFonts': 'Fonts offered by semi-design templates, with their licence (D-005).',
  'admin.cmsBanners': 'Storefront banners by position and validity window (D-005).',
  'admin.cmsHomeSections': 'Home-page sections and their order (D-005).',
  'admin.cmsArticleCategories': 'Article categories (D-005).',
  'admin.cmsArticles': 'Articles with rich text, cover and categories (D-005).',
  'admin.cmsFaqCategories': 'FAQ categories (D-005).',
  'admin.cmsFaqs': 'Frequently asked questions (D-005).',
  'admin.cmsSeoPages': 'SEO meta per route or slug (D-005).',
  'admin.cmsVideos': 'Videos attached to products and articles (D-005).',
  'admin.geographyProvinces': 'Provinces — admin-maintained reference data (D-161, D-170).',
  'admin.geographyDistricts': 'Districts — admin-maintained reference data (D-161, D-170).',
  'admin.geographySubdistricts':
    'Subdistricts with postcodes — admin-maintained reference data (D-161, D-170).',
  'admin.catalogImports':
    'Excel import (preview → confirm) and export of the large catalogue tables and geography (D-005, D-170).',
  'admin.catalogProductCategories': 'Packio reporting product categories (replace legacy PH1–PH6, D-030).',
  'admin.catalogProductTypes':
    'Product types: the 7 instant types and the RFQ categories, quote mode per type (D-100, D-043).',
  'admin.catalogPrintTypes': 'Print types per product type (platform definitions, D-100).',
  'admin.catalogProducts':
    'Customer-facing catalogue products with their patterns, options and images (D-100, D-005).',
  'admin.catalogStandardSizes': 'Standard sizes offered for a catalogue product (D-005).',
  'admin.catalogPatterns': 'Box styles (patterns), size constraints and matching flute types (D-100).',
  'admin.catalogSubPatterns':
    'Parts of a pattern with their geometry factors (indicative until the calculator port, B2.3).',
  'admin.catalogMaterialFamilies': 'Material families behind the material price index (D-040 group 1).',
  'admin.catalogFluteTypes': 'Corrugated flute types (platform definitions, D-005).',
  'admin.catalogMaterials': 'Materials the customer picks — paper, board, film, foil (no prices, D-044).',
  'admin.catalogFinishGroups': 'Groups of finishes (D-005).',
  'admin.catalogFinishes': 'Finishes: coatings, laminations, foil, emboss, window (D-076 special finishes).',
  'admin.catalogFoilTypes': 'Foil types (platform definitions, D-005).',
  'admin.catalogInkColourGroups': 'Groups of ink colours (D-005).',
  'admin.catalogInkColours': 'Ink colours: process, spot, white, metallic (D-005).',
  'admin.catalogDiecutGroups': 'Groups of die-cut types (D-005).',
  'admin.catalogDiecutTypes': 'Die-cut types (platform definitions; prices are factory price lines, D-044).',
  'admin.catalogAssemblyGroups': 'Groups of assemblies (D-005).',
  'admin.catalogAssemblies': 'Assembly / gluing operations (platform definitions, D-044).',
  'admin.catalogDifficultyLevelGroups': 'Groups of difficulty levels (D-005).',
  'admin.catalogDifficultyLevels': 'Difficulty levels (platform definitions, D-044).',
  'admin.catalogPackingTypes': 'Packing types (platform definitions, D-044).',
  'admin.catalogStockAttributeValues':
    'Values of stock-product attributes: material, shape, neck, colour, size, cap type (D-005).',
  'admin.catalogStockProducts':
    'Ready-made stock products with attributes and photos; no prices here (D-100, D-044).',
  'admin.catalogSpecTitles': 'Titles of factory spec lines shown to customers (D-005).',
};
