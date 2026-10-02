import { DomainException } from '../errors/domain.exception';
import { refuseUnits, unitRefusal } from './units';

describe('millimetre-only requests (D-183)', () => {
  it('turns a whitelist error on a unit key into specs.unit_not_accepted', () => {
    const refusal = unitRefusal([
      { path: 'configuration.unit', code: 'whitelistValidation', message: 'property unit should not exist' },
    ]);
    expect(refusal?.code).toBe('specs.unit_not_accepted');
    expect(refusal?.errors).toEqual([
      { path: 'configuration.unit', code: 'unit_not_accepted', message: 'sizes are millimetres only' },
    ]);
    expect(unitRefusal([{ path: 'colour', code: 'whitelistValidation', message: 'x' }])).toBeNull();
    expect(unitRefusal([{ path: 'unit', code: 'isIn', message: 'x' }])).toBeNull();
  });

  it('refuses a unit key at any depth of free JSON', () => {
    expect(() => refuseUnits({ size: { w: 10, l: 20 } }, 'spec')).not.toThrow();
    let thrown: unknown;
    try {
      refuseUnits({ parts: [{ size: { lengthUnit: 'in' } }] }, 'spec');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainException);
    expect((thrown as DomainException).code).toBe('specs.unit_not_accepted');
    expect((thrown as DomainException).errors?.[0]?.path).toBe('spec.parts[0].size.lengthUnit');
  });
});
