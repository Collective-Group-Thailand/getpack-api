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
  'admin.outbox': 'Domain-event outbox: dead-letter list and replay.',
  'partner.me': 'The signed-in factory user, their factories and device PINs.',
};
