import { audienceForPath, bearerOf } from './auth.guard';

describe('audienceForPath (contract §2)', () => {
  it.each([
    ['/v1/store/me', 'customer'],
    ['/v1/admin/approvals/x', 'staff'],
    ['/v1/partner', 'partner'],
    ['/v2/admin/me', 'staff'],
  ])('%s requires %s', (path, audience) => {
    expect(audienceForPath(path)).toBe(audience);
  });

  it.each(['/v1/auth/staff/login', '/webhooks/scb', '/health', '/docs', '/v1/storefront', '/v1/administer'])(
    '%s requires no audience',
    (path) => {
      expect(audienceForPath(path)).toBeUndefined();
    },
  );

  it('reads only Bearer credentials', () => {
    expect(bearerOf({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(bearerOf({ headers: { authorization: 'bearer abc' } })).toBe('abc');
    expect(bearerOf({ headers: { authorization: 'Basic abc' } })).toBeUndefined();
    expect(bearerOf({ headers: {} })).toBeUndefined();
  });
});
