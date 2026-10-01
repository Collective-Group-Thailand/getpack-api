import { isRoutePattern } from './rum';

describe('RUM route patterns (U-B0.3, PDPA)', () => {
  it.each([
    '/',
    '/orders/[orderId]',
    '/account/orders/[orderId]/claims/[claimId]',
    '/admin/finance/payables',
  ])('keeps %s', (route) => expect(isRoutePattern(route)).toBe(true));

  it.each([
    '/orders/0192f3a0-7c1e-7d2a-9b1f-00000000e001',
    '/track/AbC123xyz',
    '/orders/PK-2610-0001',
    '/orders?code=1',
    'orders',
    '/orders/',
    '/search/somchai@example.com',
    '/orders/pk26100001',
  ])('refuses %s', (route) => expect(isRoutePattern(route)).toBe(false));
});
