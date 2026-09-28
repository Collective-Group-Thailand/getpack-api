import { type PermissionKey } from './permissions.catalog';

/**
 * Admin-zone menu entitlements returned by `GET /v1/admin/me` (B1.3). `packio-web` renders the
 * entries it knows and localises their labels; each business module adds its own entries.
 * An entry without `permission` is visible to every staff member.
 */
export interface MenuEntry {
  key: string;
  path: string;
  permission?: PermissionKey;
}

export const ADMIN_MENU: readonly MenuEntry[] = [
  { key: 'dashboard', path: '/admin' },
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
  { key: 'audit_logs', path: '/admin/audit-logs', permission: 'audit_logs.read' },
  { key: 'outbox', path: '/admin/outbox', permission: 'outbox.manage' },
  { key: 'analytics', path: '/admin/analytics', permission: 'analytics.read' },
  { key: 'reports', path: '/admin/reports' },
];

export function menuFor(permissions: ReadonlySet<string>): Pick<MenuEntry, 'key' | 'path'>[] {
  return ADMIN_MENU.filter((e) => !e.permission || permissions.has(e.permission)).map(({ key, path }) => ({
    key,
    path,
  }));
}
