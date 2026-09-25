import { canTransition, FACTORY_TRANSITIONS } from './factory-status';

describe('factory lifecycle (D-011, D-041)', () => {
  it('follows applied → under_review → trial → active and never leaves offboarded', () => {
    expect(canTransition('applied', 'under_review')).toBe(true);
    expect(canTransition('under_review', 'trial')).toBe(true);
    expect(canTransition('trial', 'active')).toBe(true);
    expect(canTransition('applied', 'active')).toBe(false);
    expect(canTransition('under_review', 'active')).toBe(false);
    expect(FACTORY_TRANSITIONS.offboarded).toEqual([]);
  });

  it('can offboard from every other status and suspend only working factories', () => {
    for (const from of ['applied', 'under_review', 'trial', 'active', 'suspended'] as const) {
      expect(canTransition(from, 'offboarded')).toBe(true);
    }
    expect(canTransition('trial', 'suspended')).toBe(true);
    expect(canTransition('active', 'suspended')).toBe(true);
    expect(canTransition('applied', 'suspended')).toBe(false);
  });
});
