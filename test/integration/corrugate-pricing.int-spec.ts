import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { QuotePathService } from '@modules/partners/quote-path/quote-path.service';
import { CalculatorRegistry } from '@modules/pricing/calculators/calculator';
import { CorrugateQuoteAdapter } from '@modules/pricing/calculators/corrugate/corrugate.adapter';
import { CorrugateSnapshotLoader } from '@modules/pricing/calculators/corrugate/corrugate-snapshot.loader';
import { CORRUGATE_PRICE_COMPONENTS } from '@modules/pricing/calculators/corrugate/price-components';
import { FOLDING_PRICE_COMPONENTS } from '@modules/pricing/calculators/folding/price-components';
import { PrismaPg } from '@prisma/adapter-pg';

import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { PrismaClient } from '../../src/generated/prisma/client';
import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

/** The corrugate loader, adapter and calculator on real price-list rows (U-B6 slice 6, dev fixture). */
describe('corrugate pricing on the database (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaClient;
  let fixture: DevCorrugate;
  let adapter: CorrugateQuoteAdapter;
  let quotePath: QuotePathService;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url }) });
    await seedDev(prisma);
    await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
    fixture = (await prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })).fixture;
    const registry = new PriceComponentRegistry();
    for (const d of [...FOLDING_PRICE_COMPONENTS, ...CORRUGATE_PRICE_COMPONENTS]) registry.register(d);
    adapter = new CorrugateQuoteAdapter(
      new CorrugateSnapshotLoader(prisma as never),
      new CalculatorRegistry(),
    );
    quotePath = new QuotePathService(prisma as never, registry);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  const rsc = (over: Record<string, unknown> = {}, part: Record<string, unknown> = {}) => ({
    patternId: fixture.rscPatternPublicId,
    w: 300,
    l: 400,
    d: 250,
    materialId: fixture.boardPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [200, 1000],
    parts: [{ printFront: [{ inkColourId: fixture.inkColourPublicId, area: 'top' as const }], ...part }],
    design: { graphic: true, structure: false },
    ...over,
  });

  async function price(cfg: ReturnType<typeof rsc>) {
    const at = new Date();
    const resolved = await adapter.resolve(cfg, prisma);
    const candidates = await quotePath.instantCandidates(resolved.productTypeId, at, prisma);
    const loaded = (
      await Promise.all(
        candidates.map((c) =>
          adapter.options(
            { id: c.factoryId, publicId: c.factoryPublicId },
            c.priceListVersionId,
            resolved,
            at,
            prisma as never,
          ),
        ),
      )
    ).flat();
    return { resolved, loaded, options: adapter.calculate(resolved, loaded, { withDesign: true }) };
  }

  it('seeds the fixture once', async () => {
    const again = await prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 });
    expect(again.created).toBe(false);
  });

  it('loads one option per corrugate print type of the tier-A price list', async () => {
    const { loaded } = await price(rsc());
    expect(loaded.map((l) => l.printTypePublicId).sort()).toEqual(
      [fixture.flexoPrintTypePublicId, fixture.digitalPrintTypePublicId].sort(),
    );
    const flexo = loaded.find((l) => l.printTypePublicId === fixture.flexoPrintTypePublicId)!.option;
    expect(flexo).toMatchObject({ engine: 'flexo', minOrderAmount: 300, maxColours: 3 });
    expect(flexo.rollWidthsIn).toEqual([40, 48, 56, 64, 72, 80]);
    expect(flexo.boardPrices.map((b) => b.minSheet)).toEqual([null, 500, 2000]);
    expect(flexo.sell.priceMaxInclusive).toBe(true);
  });

  it('prices an RSC on flexo and digital, the automatic packing on every part, tooling on flexo only', async () => {
    const { options, resolved } = await price(rsc());
    expect(resolved.autoAssemblies).toHaveLength(1);
    expect(resolved.standardSize).toBe(false);
    const flexo = options.find(
      (o) => o.printTypeId !== undefined && o.optionKey.endsWith(fixture.flexoPrintTypePublicId),
    )!;
    const digital = options.find((o) => o.optionKey.endsWith(fixture.digitalPrintTypePublicId))!;
    // 200 is under the flexo minimum order (300); digital prices it.
    expect(flexo.steps[0]).toBeNull();
    expect(digital.steps[0]).not.toBeNull();
    const f = flexo.steps[1]!;
    const d = digital.steps[1]!;
    expect(f.toolingAmount).toBeGreaterThan(0);
    expect(d.toolingAmount).toBe(0);
    for (const s of [f, d]) {
      // Total = product + tooling + design fee once (quirk C14).
      expect(s.total).toBeCloseTo(s.productAmount + s.toolingAmount + s.designFee, 6);
      expect(s.designFee).toBe(2000);
      expect(s.buyPrice).toBeGreaterThan(0);
      expect(s.marginPct).toBeGreaterThan(0);
    }
  });

  it('prices both parts of a Tele box and sums them, design fee once', async () => {
    const colour = [{ inkColourId: fixture.inkColourPublicId, area: 'all_round' as const }];
    const { options } = await price(
      rsc({
        patternId: fixture.telePatternPublicId,
        // A Tele box is die-cut (only pattern 19 can be RSC): sized to fit the fixture's 60 × 40 in die block.
        w: 150,
        l: 200,
        d: 80,
        parts: [
          { subPatternId: fixture.teleBodyPublicId, printFront: colour },
          { subPatternId: fixture.teleLidPublicId, printFront: colour },
        ],
      }),
    );
    const flexo = options.find((o) => o.optionKey.endsWith(fixture.flexoPrintTypePublicId))!;
    const step = flexo.steps[1]!;
    expect(step.parts.map((p) => p.partKey)).toEqual([fixture.teleBodyPublicId, fixture.teleLidPublicId]);
    expect(step.designFee).toBe(2000);
    // The lid is sized over the body (`:411-414`): a larger blank.
    expect(step.parts[1]!.blankAreaSqm).toBeGreaterThan(step.parts[0]!.blankAreaSqm);
  });

  it('reads the open-top condition bands from the pattern', async () => {
    const { resolved } = await price(rsc({ patternId: fixture.openTopPatternPublicId, w: 180, d: 120 }));
    expect(Object.keys(resolved.conditions).sort()).toEqual(['i', 'j', 'k', 'm']);
  });

  it('refuses a coating on flexo (quirk C5) and prices it on digital', async () => {
    const { options } = await price(rsc({ quantities: [1000] }, { coatingFrontId: fixture.coatingPublicId }));
    const flexo = options.find((o) => o.optionKey.endsWith(fixture.flexoPrintTypePublicId))!;
    const digital = options.find((o) => o.optionKey.endsWith(fixture.digitalPrintTypePublicId))!;
    expect(flexo.error).toEqual({ code: 'process_not_possible', detail: 'main: flexo prints no coating' });
    expect(digital.steps[0]).not.toBeNull();
  });

  it('recognises a standard size of the catalogue product: no die block on it', async () => {
    const { resolved } = await price(rsc({ catalogProductId: fixture.catalogProductPublicId }));
    expect(resolved.standardSize).toBe(true);
  });

  it('packs the flat blank without the factory adjustment', async () => {
    const { resolved } = await price(rsc());
    const [part] = adapter.shipmentParts(resolved);
    // RSC 300×400×250 on the fake B flute: dW = 300 + 8 + 250 + 5 = 563, dL = 35 + 806 + 606 − 3 = 1444.
    expect(part).toMatchObject({ kind: 'corrugate', formula: 'rsc', dw: 563, dl: 1444, gsm: 450 });
  });
});
