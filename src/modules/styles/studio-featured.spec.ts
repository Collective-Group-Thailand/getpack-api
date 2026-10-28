import { SettingNotFoundError } from '@platform/settings/settings.service';

import { StylesStoreService } from './styles-store.service';

/** D-455 (C7, DECISIONS-STAGE-A §2): admins pick the Studio's featured styles until usage reaches the threshold. */
describe('studio featured styles', () => {
  const rows = ['PK-A-01', 'PK-B-01', 'PK-C-01'].map((code, i) => ({ id: BigInt(i + 1), code }));
  const setup = (value: unknown, usage: { id: bigint; n: bigint }[] = []) => {
    const settings = {
      at: jest.fn(() => (value instanceof Error ? Promise.reject(value) : Promise.resolve({ value }))),
    };
    const prisma = {
      styleBase: { findMany: jest.fn().mockResolvedValue(rows) },
      $queryRaw: jest.fn().mockResolvedValue(usage),
    };
    const s = new StylesStoreService(prisma as never, {} as never, {} as never, settings as never);
    jest.spyOn(s as never, 'card').mockImplementation((r) => Promise.resolve({ code: r.code }));
    return { s, prisma };
  };
  const curated = (minDesigns: number | null) => ({
    styles: [
      { code: 'PK-C-01', enabled: true },
      { code: 'PK-B-01', enabled: false },
      { code: 'PK-GONE-01', enabled: true },
      { code: 'PK-A-01', enabled: true },
    ],
    usage: { minDesigns, windowDays: 90 },
  });

  it('hides the section when nothing is set', async () => {
    for (const value of [new SettingNotFoundError('studio.featured_styles', new Date()), null]) {
      const { s, prisma } = setup(value);
      await expect(s.studioFeatured(null)).resolves.toEqual({ source: 'none', data: [] });
      expect(prisma.styleBase.findMany).not.toHaveBeenCalled();
    }
  });

  it("keeps the admins' order, only styles that are on and published", async () => {
    const { s, prisma } = setup(curated(null));
    await expect(s.studioFeatured(null)).resolves.toEqual({
      source: 'curated',
      data: [{ code: 'PK-C-01' }, { code: 'PK-A-01' }],
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('stays curated below the usage threshold and ranks by usage once it is reached', async () => {
    const usage = [
      { id: 2n, n: 7n },
      { id: 1n, n: 3n },
    ];
    await expect(setup(curated(11), usage).s.studioFeatured(null)).resolves.toMatchObject({
      source: 'curated',
    });
    await expect(setup(curated(10), usage).s.studioFeatured(null)).resolves.toEqual({
      source: 'usage',
      data: [{ code: 'PK-B-01' }, { code: 'PK-A-01' }],
    });
  });
});
