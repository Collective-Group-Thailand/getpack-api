import { databaseName, isUatDatabase } from '../../scripts/uat-guard';

describe('UAT-only scripts (pnpm uat:styles)', () => {
  it('run only against a UAT database, never in production', () => {
    expect(databaseName('postgresql://u:p@localhost:5432/packio_uat_partner?schema=public')).toBe(
      'packio_uat_partner',
    );
    expect(isUatDatabase('postgresql://u:p@localhost:5432/packio_uat_partner', 'development')).toBe(true);
    expect(isUatDatabase('postgresql://u:p@localhost:5432/packio', 'development')).toBe(false);
    expect(isUatDatabase('postgresql://u:p@db.internal:5432/packio_uat', 'production')).toBe(false);
    expect(isUatDatabase(undefined, 'development')).toBe(false);
    expect(isUatDatabase('not a url', 'development')).toBe(false);
  });
});
