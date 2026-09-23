/**
 * Every OpenAPI tag with its description (contract §5). An operation tag missing here fails the
 * contract build. Tags are `<surface>.<resource>` (`store.orders`) or `ops.<area>`.
 */
export const API_TAGS: Record<string, string> = {
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
  'admin.outbox': 'Domain-event outbox: dead-letter list and replay.',
  'partner.me': 'The signed-in factory user, their factories and device PINs.',
};
