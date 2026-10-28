import { mayActAsOwner } from './settings-admin.service';

/** DECISIONS-STAGE-A §11.6 (owner, 2026-10-28): Superadmin may change any setting on the owner role's behalf. */
describe('mayActAsOwner', () => {
  it('lets the owner role and Superadmin change a setting', () => {
    expect(mayActAsOwner(['marketing'], 'marketing')).toBe(true);
    expect(mayActAsOwner(['superadmin'], 'marketing')).toBe(true);
    expect(mayActAsOwner(['superadmin'], 'cs_lead')).toBe(true);
  });

  it('refuses every other role', () => {
    expect(mayActAsOwner(['admin'], 'marketing')).toBe(false);
    expect(mayActAsOwner(['cs', 'marketing'], 'cs_lead')).toBe(false);
    expect(mayActAsOwner([], 'superadmin')).toBe(false);
  });
});
