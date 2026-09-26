import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { QuotePathService } from '@modules/partners/quote-path/quote-path.service';
import { foldingCalculator } from '@modules/pricing/calculators/folding/folding-calculator';
import { FoldingSnapshotLoader } from '@modules/pricing/calculators/folding/folding-snapshot.loader';
import { FOLDING_PRICE_COMPONENTS } from '@modules/pricing/calculators/folding/price-components';
import { PrismaPg } from '@prisma/adapter-pg';

import { type DevFolding, seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { PrismaClient } from '../../src/generated/prisma/client';
import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

/** The folding snapshot loader and calculator on real price-list rows (B2.3, dev fixture). */
describe('folding pricing on the database (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaClient;
  let fixture: DevFolding;
  let loader: FoldingSnapshotLoader;
  let quotePath: QuotePathService;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url }) });
    await seedDev(prisma);
    fixture = (await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 })).fixture;
    const registry = new PriceComponentRegistry();
    for (const d of FOLDING_PRICE_COMPONENTS) registry.register(d);
    loader = new FoldingSnapshotLoader(prisma as never);
    quotePath = new QuotePathService(prisma as never, registry);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  const configuration = () => ({
    patternId: fixture.patternPublicId,
    w: 200,
    l: 300,
    d: 50,
    materialId: fixture.materialPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [300, 1000],
    parts: [
      {
        printFront: [1, 2, 3, 4].map(() => ({ inkColourId: fixture.inkColourPublicId, percent: 100 })),
        finish1FrontId: fixture.finishPublicId,
        diecutTypeId: fixture.diecutTypePublicId,
      },
    ],
    design: { graphic: true, structure: false },
  });

  it('seeds the fixture once', async () => {
    const again = await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
    expect(again.created).toBe(false);
    expect(await prisma.factory.count({ where: { code: 'F9001' } })).toBe(1);
  });

  it('finds the tier-A price path and loads one option per print type', async () => {
    const resolved = await loader.resolve(configuration());
    const candidates = await quotePath.instantCandidates(resolved.productTypeId);
    expect(candidates.map((c) => c.factoryPublicId)).toEqual([fixture.factoryPublicId]);
    const options = await loader.options(
      { id: candidates[0]!.factoryId, publicId: candidates[0]!.factoryPublicId },
      candidates[0]!.priceListVersionId,
      resolved,
      new Date(),
    );
    expect(options).toHaveLength(1);
    const option = options[0]!.option;
    expect(option.unavailable).toEqual([]);
    expect(option.engine).toBe('a_offset');
    expect(option.parts['main']!.geometry.sheets.map((s) => [s.sheetWIn, s.sheetLIn, s.sheetCut])).toEqual([
      [31, 43, 1],
      [21.5, 31, 2],
    ]);
    expect(option.sell).toMatchObject({
      marginFallbackPct: 30,
      designFee: 2500,
      structureDesignFee: 1500,
      vatPct: 7,
    });
  });

  it('prices the configuration end to end, the small run at the production minimum', async () => {
    const resolved = await loader.resolve(configuration());
    const [c] = await quotePath.instantCandidates(resolved.productTypeId);
    const options = await loader.options(
      { id: c!.factoryId, publicId: c!.factoryPublicId },
      c!.priceListVersionId,
      resolved,
      new Date(),
    );
    const result = foldingCalculator.calculate(
      { quantities: [300, 1000], parts: resolved.parts, design: { graphic: true, structure: false } },
      { options: options.map((o) => o.option) },
    );
    const option = result.options[0]!;
    expect(option.error).toBeNull();
    const [small, large] = option.steps;
    // 300 pieces are produced as a run of 500 (minimum for production) and charged for 300.
    expect([small!.qty, small!.boxAmount, large!.boxAmount]).toEqual([300, 500, 1000]);
    // margin tiers: run 500 → 35 %, run 1000 → 25 % (fake dev values)
    expect(small!.parts[0]!.forSale.targetMarginPct).toBe(35);
    expect(large!.parts[0]!.forSale.targetMarginPct).toBe(25);
    expect(large!.total).toBe(large!.parts[0]!.forSale.total + 2500);
    expect(large!.perPcs).toBeLessThan(small!.perPcs);
    expect(result.selection).toEqual([option.optionKey, option.optionKey]);
  });

  it('refuses a colour the factory does not print', async () => {
    const other = await prisma.inkColour.create({
      data: { code: 'dev-gold', name: '[DEV] Gold', colourKind: 'metallic', status: 'active' },
    });
    const cfg = configuration();
    cfg.parts[0]!.printFront = [{ inkColourId: other.publicId, percent: 100 }];
    const resolved = await loader.resolve(cfg);
    const [c] = await quotePath.instantCandidates(resolved.productTypeId);
    const [loaded] = await loader.options(
      { id: c!.factoryId, publicId: c!.factoryPublicId },
      c!.priceListVersionId,
      resolved,
      new Date(),
    );
    expect(loaded!.option.unavailable).toEqual([`ink_colours ${other.id}`]);
  });
});
