import { type Actor } from '@common/context/actor';

import { evaluateFlag } from './feature-flags.service';

const staff: Actor = { type: 'user', userId: 1n, publicId: 'u-1', audience: 'staff', scopes: [] };
const customer: Actor = { type: 'user', userId: 2n, publicId: 'u-2', audience: 'customer', scopes: [] };

describe('evaluateFlag', () => {
  it('is off when disabled, whatever the rules', () => {
    expect(evaluateFlag('f', false, {}, staff)).toBe(false);
  });

  it('is on for everyone without rules', () => {
    expect(evaluateFlag('f', true, {}, staff)).toBe(true);
    expect(evaluateFlag('f', true, {})).toBe(true);
  });

  it('limits by audience and allow-list', () => {
    expect(evaluateFlag('f', true, { audiences: ['staff'] }, staff)).toBe(true);
    expect(evaluateFlag('f', true, { audiences: ['staff'] }, customer)).toBe(false);
    expect(evaluateFlag('f', true, { userIds: ['u-2'] }, customer)).toBe(true);
    expect(evaluateFlag('f', true, { userIds: ['u-2'] }, staff)).toBe(false);
  });

  it('rolls out a stable percentage', () => {
    const actors = Array.from({ length: 1000 }, (_, i): Actor => ({ ...customer, publicId: `u-${i}` }));
    const on = actors.filter((a) => evaluateFlag('rollout', true, { percentage: 30 }, a)).length;
    expect(on).toBeGreaterThan(220);
    expect(on).toBeLessThan(380);
    expect(evaluateFlag('rollout', true, { percentage: 30 }, actors[7])).toBe(
      evaluateFlag('rollout', true, { percentage: 30 }, actors[7]),
    );
    expect(evaluateFlag('rollout', true, { percentage: 0 }, staff)).toBe(false);
  });
});
