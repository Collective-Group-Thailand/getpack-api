import { matchesUseCaseGroups, useCaseGroupsOf } from './use-case-groups';

describe('useCase groups (styles redesign C0 wizard)', () => {
  it('reads one value as one group', () => {
    expect(useCaseGroupsOf('cosmetics')).toEqual([['cosmetics']]);
    expect(useCaseGroupsOf(undefined)).toEqual([]);
  });

  it('ORs within a group and ANDs across groups', () => {
    const groups = useCaseGroupsOf('food,snack;shipping,ecommerce');
    expect(matchesUseCaseGroups(['snack', 'ecommerce'], groups)).toBe(true);
    expect(matchesUseCaseGroups(['snack', 'gift'], groups)).toBe(false);
    expect(matchesUseCaseGroups(['gift'], [])).toBe(true);
  });
});
