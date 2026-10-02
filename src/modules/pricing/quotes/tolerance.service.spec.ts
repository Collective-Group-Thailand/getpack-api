import { type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { type SettingsService } from '@platform/settings/settings.service';

import { ToleranceService } from './tolerance.service';

const SETTINGS: Record<string, unknown> = {
  'fulfilment.tolerance_default_pct': '5',
  'fulfilment.dimensional_tolerance_mm': { folding: '1', tag_sleeve: '1', corrugate: '3' },
  'fulfilment.colour_tolerance_delta_e': { standard: '3', flexo: '5' },
};
const settings = {
  at: (key: string) => Promise.resolve({ value: SETTINGS[key] }),
} as unknown as SettingsService;

type Version = { shortagePct: string; overagePct: string; dimensionalMm?: string; colourDeltaE?: string };
const version = (v: Version) => ({
  shortagePct: new Prisma.Decimal(v.shortagePct),
  overagePct: new Prisma.Decimal(v.overagePct),
  dimensionalMm: v.dimensionalMm ? new Prisma.Decimal(v.dimensionalMm) : null,
  colourDeltaE: v.colourDeltaE ? new Prisma.Decimal(v.colourDeltaE) : null,
});

/** A transaction holding the factory's versions per scope (product type 7, or null = the factory default). */
function db(byScope: { type?: Version; factory?: Version }, engineVariant = 'digital'): Tx {
  return {
    factoryTolerancePolicyVersion: {
      findFirst: ({ where }: { where: { policy: { productTypeId: bigint | null } } }) => {
        const v = where.policy.productTypeId === null ? byScope.factory : byScope.type;
        return Promise.resolve(v ? version(v) : null);
      },
    },
    plCorrugatePrintTypeTerm: { findFirst: () => Promise.resolve({ engineVariant }) },
  } as unknown as Tx;
}

const service = new ToleranceService(settings);
const at = new Date('2026-10-02T03:00:00Z');
const input = { factoryId: 1n, productTypeId: 7n, calculatorKey: 'folding' as const };

describe('ToleranceService (D-021, D-163, D-186)', () => {
  it('uses the platform defaults when the factory holds none', async () => {
    expect(await service.resolve(input, at, db({}))).toEqual({
      shortage: '5.0000',
      overage: '5.0000',
      dimensionalMm: '1.00',
      colourDeltaE: '3.00',
    });
  });

  it('resolves each value on its own: product type, then factory default, then platform', async () => {
    const tx = db({
      type: { shortagePct: '2', overagePct: '4' },
      factory: { shortagePct: '9', overagePct: '9', dimensionalMm: '0.5' },
    });
    expect(await service.resolve(input, at, tx)).toEqual({
      shortage: '2.0000',
      overage: '4.0000',
      dimensionalMm: '0.50',
      colourDeltaE: '3.00',
    });
  });

  it('gives flexo its own colour tolerance, and an unlisted calculator no dimensional one', async () => {
    const flexo = {
      ...input,
      calculatorKey: 'corrugate' as const,
      printTypePublicId: 'p',
      priceListVersionId: 3n,
    };
    expect(await service.resolve(flexo, at, db({}, 'flexo'))).toMatchObject({
      dimensionalMm: '3.00',
      colourDeltaE: '5.00',
    });
    expect(await service.resolve(flexo, at, db({}, 'digital'))).toMatchObject({ colourDeltaE: '3.00' });
    expect(await service.resolve({ ...input, calculatorKey: 'label' }, at, db({}))).toMatchObject({
      dimensionalMm: null,
      colourDeltaE: '3.00',
    });
  });

  it('publishes no colour tolerance for an unprinted product, and platform defaults without a factory (D-187)', async () => {
    expect(await service.resolve({ ...input, calculatorKey: 'service' }, at, db({}))).toMatchObject({
      dimensionalMm: null,
      colourDeltaE: null,
    });
    const tx = db({ factory: { shortagePct: '1', overagePct: '1' } });
    expect(await service.resolve({ ...input, factoryId: null, calculatorKey: null }, at, tx)).toEqual({
      shortage: '5.0000',
      overage: '5.0000',
      dimensionalMm: null,
      colourDeltaE: null,
    });
  });
});
