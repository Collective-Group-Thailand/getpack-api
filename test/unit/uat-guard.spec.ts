import { databaseName, isUatDatabase } from '../../scripts/uat-guard';

describe('UAT-only scripts (pnpm uat:styles)', () => {
  it('run only against a UAT database, never in production', () => {
    expect(databaseName('postgresql://u:p@localhost:5432/getpack_uat_partner?schema=public')).toBe(
      'getpack_uat_partner',
    );
    expect(isUatDatabase('postgresql://u:p@localhost:5432/getpack_uat_partner', 'development')).toBe(true);
    expect(isUatDatabase('postgresql://u:p@localhost:5432/getpack', 'development')).toBe(false);
    expect(isUatDatabase('postgresql://u:p@db.internal:5432/getpack_uat', 'production')).toBe(false);
    expect(isUatDatabase(undefined, 'development')).toBe(false);
    expect(isUatDatabase('not a url', 'development')).toBe(false);
  });

  it('on the hosted UAT stack only with the explicit UAT_TARGET_CONFIRM opt-in', () => {
    const url = 'postgresql://u:p@postgres:5432/getpack';
    expect(isUatDatabase(url, 'production', undefined)).toBe(false);
    expect(isUatDatabase(url, 'production', 'yes')).toBe(false);
    expect(isUatDatabase(url, 'production', 'uat-only')).toBe(true);
  });
});
