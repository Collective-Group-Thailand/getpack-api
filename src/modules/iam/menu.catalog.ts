import { type PermissionKey } from './permissions.catalog';

/**
 * Admin-zone menu entitlements returned by `GET /v1/admin/me` (B1.3). `packio-web` renders the
 * entries it knows and localises their labels; each business module adds its own entries.
 * An entry without `permission` is visible to every staff member; a list means any one of them (U-B0.3).
 */
export interface MenuEntry {
  key: string;
  path: string;
  permission?: PermissionKey | readonly PermissionKey[];
}

export const ADMIN_MENU: readonly MenuEntry[] = [
  { key: 'dashboard', path: '/admin' },
  // Business modules (U-B0.3, the frontend's keys and paths, gated by this catalogue's permissions).
  { key: 'orders', path: '/admin/orders', permission: 'orders.read' },
  { key: 'cs_calculators', path: '/admin/cs', permission: 'quotes.calculate' },
  { key: 'quotations', path: '/admin/quotations', permission: 'quotes.read' },
  { key: 'rfq', path: '/admin/rfq', permission: 'rfqs.read' },
  { key: 'prepress', path: '/admin/prepress', permission: 'artwork.read' },
  { key: 'production', path: '/admin/production', permission: 'production.read' },
  { key: 'shipments', path: '/admin/shipments', permission: 'shipments.read' },
  { key: 'claims', path: '/admin/claims', permission: 'claims.read' },
  { key: 'partners', path: '/admin/partners', permission: 'partners.read' },
  { key: 'catalogue', path: '/admin/catalogue', permission: 'catalog.read' },
  // D-411: the style library desk and the screens the web reached only through other pages.
  { key: 'style_library', path: '/admin/style-library', permission: 'styles.read' },
  {
    key: 'structural_requests',
    path: '/admin/structural-requests',
    permission: ['structural_requests.manage', 'structural_requests.design'],
  },
  {
    key: 'style_intakes',
    path: '/admin/style-intakes',
    permission: ['styles.import', 'styles.approve_recipe'],
  },
  { key: 'samples', path: '/admin/samples', permission: 'samples.read' },
  { key: 'inbox', path: '/admin/inbox', permission: 'conversations.read' },
  { key: 'marketing', path: '/admin/marketing', permission: 'promotions.read' },
  { key: 'cms', path: '/admin/cms', permission: 'cms.manage' },
  // D-412: studio templates and elements, review moderation, LINE menus, privacy and agreements.
  {
    key: 'studio_catalog',
    path: '/admin/studio-catalog',
    permission: ['studio_catalog.manage', 'studio_catalog.approve'],
  },
  { key: 'reviews', path: '/admin/reviews', permission: ['reviews.moderate', 'reviews.reply'] },
  { key: 'line', path: '/admin/line', permission: 'line.manage' },
  { key: 'customers', path: '/admin/customers', permission: 'customers.read' },
  { key: 'companies', path: '/admin/companies', permission: 'companies.read' },
  { key: 'discount_memos', path: '/admin/discount-memos', permission: 'discount_memos.read' },
  {
    key: 'finance',
    path: '/admin/finance',
    permission: [
      'payments.verify_slip',
      'receivables.manage',
      'ledger.read',
      'payables.read',
      'banking.read',
      'tax.read',
    ],
  },
  { key: 'approvals', path: '/admin/approvals', permission: 'approvals.read' },
  { key: 'users', path: '/admin/users', permission: 'users.read' },
  { key: 'settings', path: '/admin/settings', permission: 'settings.read' },
  { key: 'feature_flags', path: '/admin/feature-flags', permission: 'feature_flags.read' },
  {
    key: 'notification_templates',
    path: '/admin/notifications/templates',
    permission: 'notification_templates.manage',
  },
  {
    key: 'notification_routes',
    path: '/admin/notifications/routes',
    permission: 'notification_routes.manage',
  },
  {
    key: 'privacy',
    path: '/admin/privacy',
    permission: ['privacy_requests.manage', 'consent_purposes.manage', 'agreements.manage'],
  },
  { key: 'audit_logs', path: '/admin/audit-logs', permission: 'audit_logs.read' },
  { key: 'outbox', path: '/admin/outbox', permission: 'outbox.manage' },
  { key: 'analytics', path: '/admin/analytics', permission: 'analytics.read' },
  { key: 'assistant', path: '/admin/assistant', permission: 'assistant.manage' },
  { key: 'reports', path: '/admin/reports' },
  { key: 'ops', path: '/admin/ops', permission: 'ops.read' },
];

const allowed = (e: MenuEntry, permissions: ReadonlySet<string>): boolean =>
  !e.permission ||
  (typeof e.permission === 'string'
    ? permissions.has(e.permission)
    : e.permission.some((p) => permissions.has(p)));

export function menuFor(permissions: ReadonlySet<string>): Pick<MenuEntry, 'key' | 'path'>[] {
  return ADMIN_MENU.filter((e) => allowed(e, permissions)).map(({ key, path }) => ({ key, path }));
}
