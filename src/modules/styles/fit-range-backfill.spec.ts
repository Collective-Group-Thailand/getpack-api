import { Prisma } from '@generated/prisma/client';
import { type RecipeInsideSizes } from '@integrations/dieline/dieline-engine.port';

import { StylesAdminService } from './styles-admin.service';

type Row = Record<string, unknown> & { publicId: string; code: string };

const EMPTY = {
  fitMinLMm: null,
  fitMaxLMm: null,
  fitMinWMm: null,
  fitMaxWMm: null,
  fitMinHMm: null,
  fitMaxHMm: null,
  fitRangeSource: null,
  fitRangeBounds: null,
};
const FULL = { minL: 60, maxL: 400, minW: 50, maxW: 300, minH: 20, maxH: 450 };

function base(code: string, over: Record<string, unknown> = {}): Row {
  return {
    id: BigInt(Number(code.slice(-2))),
    publicId: `uuid-${code}`,
    code,
    materialClass: 'paperboard',
    status: 'active',
    moqUnits: null,
    recyclable: null,
    plasticFree: null,
    certifications: [],
    nameTh: code,
    nameEn: code,
    ...EMPTY,
    sizeClass: 'box',
    recipes: [{ recipe: { engine: [{ base: code }] }, sizeRanges: { paperboard: FULL } }],
    pattern: null,
    ...over,
  };
}

/** An in-memory stand-in for the parts of Prisma the backfill touches (the curation path writes through `update`). */
function harness(rows: Row[], inside: RecipeInsideSizes = {}, rules: unknown[] = []) {
  const byId = new Map(rows.map((r) => [r.publicId, r]));
  const audits: unknown[] = [];
  const tx = {
    styleBase: {
      findUnique: ({ where }: { where: { publicId: string } }) =>
        Promise.resolve({ ...byId.get(where.publicId)! }),
      update: ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (k === 'rowVersion' || k === 'updatedById') continue;
          row[k] = v === Prisma.DbNull ? null : v;
        }
        return Promise.resolve(row);
      },
    },
  };
  const prisma = {
    styleBase: { findMany: () => Promise.resolve(rows.map((r) => ({ ...r }))) },
    withTx: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new StylesAdminService(
    prisma as never,
    {} as never,
    { recompute: () => Promise.resolve() } as never,
    { record: (_t: unknown, e: unknown) => (audits.push(e), Promise.resolve()) } as never,
    { record: () => Promise.resolve() } as never,
    {
      insideSizes: (_recipe: unknown, rule: unknown) => (rules.push(rule), Promise.resolve(inside)),
    } as never,
  );
  const actor = { type: 'system', name: 'test' } as never;
  return { service, actor, rows, audits };
}

describe('fit-range backfill (C1c, DECISIONS-STAGE-A §11.1)', () => {
  it('fills from the fallback order, records each bound, keeps business ranges, and is idempotent', async () => {
    const h = harness(
      [
        base('PK-AA-01'),
        base('PK-AA-02', {
          recipes: [
            { recipe: { engine: [{}] }, sizeRanges: { paperboard: { ...FULL, minH: null, maxH: null } } },
          ],
        }),
        base('PK-AA-03', { recipes: [], pattern: null }),
        base('PK-AA-04', { fitMinLMm: 1, fitMaxLMm: 2, fitRangeSource: 'business' }),
      ],
      {
        paperboard: {
          standard: { length: null, width: null, height: { min: 25, max: 35 } },
          limits: { length: null, width: null, height: null },
        },
      },
    );
    const dry = await h.service.backfillFitRanges(h.actor, { dryRun: true });
    expect(dry.filled).toEqual(['PK-AA-01', 'PK-AA-02']);
    expect(dry.keptBusiness).toEqual(['PK-AA-04']);
    expect(dry.incomplete).toEqual([
      {
        code: 'PK-AA-03',
        missing: ['fitMinLMm', 'fitMaxLMm', 'fitMinWMm', 'fitMaxWMm', 'fitMinHMm', 'fitMaxHMm'],
        conflicting: [],
      },
    ]);
    expect(dry.bySource).toEqual({ recipe: 1, standard_sizes: 0, production_envelope: 0, combined: 1 });
    expect(dry.changes[1]).toMatchObject({
      code: 'PK-AA-02',
      source: 'combined',
      after: { fitMinHMm: 25, fitMaxHMm: 35 },
    });
    expect(h.rows[0]!['fitRangeSource']).toBeNull(); // dry run writes nothing

    const run = await h.service.backfillFitRanges(h.actor);
    expect(run.filled).toEqual(['PK-AA-01', 'PK-AA-02']);
    expect(h.rows[1]).toMatchObject({ fitRangeSource: 'combined', fitMinHMm: 25, fitMaxHMm: 35 });
    expect((h.rows[1]!['fitRangeBounds'] as Record<string, { source: string }>)['fitMaxHMm']!.source).toBe(
      'standard_sizes',
    );
    expect(h.rows[3]).toMatchObject({ fitMinLMm: 1, fitRangeSource: 'business' });
    expect(h.audits).toHaveLength(2);

    const again = await h.service.backfillFitRanges(h.actor);
    expect(again.filled).toEqual([]);
    expect(again.refreshed).toEqual([]);
    expect(again.unchanged).toBe(2);
    expect(h.audits).toHaveLength(2);
  });

  it('treats a C0b recipe range without per-bound record as already in place', async () => {
    const h = harness([
      base('PK-AA-01', {
        fitMinLMm: 60,
        fitMaxLMm: 400,
        fitMinWMm: 50,
        fitMaxWMm: 300,
        fitMinHMm: 20,
        fitMaxHMm: 450,
        fitRangeSource: 'recipe',
      }),
    ]);
    const run = await h.service.backfillFitRanges(h.actor);
    expect(run.unchanged).toBe(1);
    expect(h.audits).toHaveLength(0);
  });
});

describe('size classes in the backfill (C1e, DECISIONS-STAGE-A §13.2)', () => {
  const BAG_RANGE = { minL: null, maxL: null, minW: 120, maxW: 600, minH: 150, maxH: 700 };
  const bagRecipe = { engine: [{ params: [{ ref: 'width' }, { ref: 'gusset' }, { ref: 'height' }] }] };
  const cupRecipe = {
    engine: [{ params: [{ ref: 'topDiameter' }, { ref: 'bottomDiameter' }, { ref: 'height' }] }],
  };

  it('reads a bag as width × gusset × height and a cup as its diameter square × height', async () => {
    const rules: unknown[] = [];
    const h = harness(
      [
        base('PK-PG-01', { recipes: [{ recipe: bagRecipe, sizeRanges: { paperboard: BAG_RANGE } }] }),
        base('PK-SP-23', {
          recipes: [
            {
              recipe: cupRecipe,
              sizeRanges: { paperboard: { ...BAG_RANGE, minW: null, maxW: null, minH: 30, maxH: 200 } },
            },
          ],
        }),
      ],
      {
        paperboard: {
          // What the engine reads through the rule (inside-rules.ts) — presets: gusset 80–120 / diameter 56–60;
          // solver limits: diameter 30–89 (C1f: a cylinder's diameter comes from these, §14.2).
          standard: {
            length: { min: 56, max: 60 },
            width: { min: 80, max: 120 },
            height: { min: 93, max: 135 },
          },
          limits: { length: { min: 30, max: 89 }, width: { min: 30, max: 89 }, height: null },
        },
      },
      rules,
    );
    const run = await h.service.backfillFitRanges(h.actor);
    expect(rules).toEqual(['bag', 'cylinder']);
    expect(run.bySizeClass).toEqual({ box: 0, bag: 1, cylinder: 1, not_applicable: 0 });
    // The bag: L = the recipe's width range, W = the gusset from the presets, H = the recipe's height.
    expect(h.rows[0]).toMatchObject({
      sizeClass: 'bag',
      fitMinLMm: 120,
      fitMaxLMm: 600,
      fitMinWMm: 80,
      fitMaxWMm: 120,
      fitMinHMm: 150,
      fitMaxHMm: 700,
      fitRangeSource: 'combined',
    });
    // The cup: ⌀ from the engine's limits (not the 56–60 presets), H = the recipe's height.
    expect(h.rows[1]).toMatchObject({
      sizeClass: 'cylinder',
      fitMinLMm: 30,
      fitMaxLMm: 89,
      fitMinWMm: 30,
      fitMaxWMm: 89,
      fitMinHMm: 30,
      fitMaxHMm: 200,
    });
    const cupBounds = h.rows[1]!['fitRangeBounds'] as Record<string, { source: string; basis: string[] }>;
    expect(cupBounds['fitMinLMm']).toEqual({ source: 'production_envelope', basis: ['engine_limits'] });
    expect(cupBounds['fitMaxWMm']).toEqual({ source: 'production_envelope', basis: ['engine_limits'] });
    expect(cupBounds['fitMaxHMm']!.source).toBe('recipe');
    expect(run.coverage).toEqual({ applicable: 2, withRange: 2 });
    expect(run.changes.map((c) => [c.code, c.action, c.sizeClassBefore, c.sizeClass])).toEqual([
      ['PK-PG-01', 'filled', 'box', 'bag'],
      ['PK-SP-23', 'filled', 'box', 'cylinder'],
    ]);
    const again = await h.service.backfillFitRanges(h.actor);
    expect(again.changes).toEqual([]);
    expect(again.unchanged).toBe(2);
  });

  it('reads PK-TG-03 (cup carrier) as a box again: its recipe range is filled back (C1f, §14.1)', async () => {
    const h = harness([base('PK-TG-03', { sizeClass: 'not_applicable' })]);
    const run = await h.service.backfillFitRanges(h.actor);
    expect(run.notApplicable).toEqual([]);
    expect(run.changes.map((c) => [c.code, c.action, c.sizeClassBefore, c.sizeClass])).toEqual([
      ['PK-TG-03', 'filled', 'not_applicable', 'box'],
    ]);
    expect(h.rows[0]).toMatchObject({
      sizeClass: 'box',
      fitMinLMm: 60,
      fitMaxHMm: 450,
      fitRangeSource: 'recipe',
    });
  });

  it('marks labels, tags, sleeves, inserts and flat folders not applicable: clears a backfilled range, never a business one', async () => {
    const SP12 = {
      fitMinLMm: 150,
      fitMaxLMm: 330,
      fitMinWMm: 4,
      fitMaxWMm: 4,
      fitMinHMm: 200,
      fitMaxHMm: 450,
    };
    const h = harness([
      base('PK-LA-01', { recipes: [] }),
      base('PK-SP-12', { ...SP12, fitRangeSource: 'combined', fitRangeBounds: {} }),
      base('PK-TG-04', { ...SP12, fitRangeSource: 'business' }),
      base('PK-AA-05'), // harness ids come from the code's last two digits
    ]);
    const dry = await h.service.backfillFitRanges(h.actor, { dryRun: true });
    expect(dry.notApplicable).toEqual(['PK-LA-01', 'PK-SP-12', 'PK-TG-04']);
    expect(dry.incomplete).toEqual([]);
    expect(dry.cleared).toEqual(['PK-SP-12']);
    expect(dry.classified).toEqual(['PK-LA-01', 'PK-TG-04']);
    expect(dry.coverage).toEqual({ applicable: 1, withRange: 1 });
    expect(h.rows[1]!['fitMinLMm']).toBe(150);

    await h.service.backfillFitRanges(h.actor);
    expect(h.rows[0]).toMatchObject({ sizeClass: 'not_applicable', fitMinLMm: null });
    expect(h.rows[1]).toMatchObject({
      sizeClass: 'not_applicable',
      fitMinLMm: null,
      fitRangeSource: null,
      fitRangeBounds: null,
    });
    expect(h.rows[2]).toMatchObject({
      sizeClass: 'not_applicable',
      fitMinLMm: 150,
      fitRangeSource: 'business',
    });

    const again = await h.service.backfillFitRanges(h.actor);
    expect(again.changes).toEqual([]);
    expect(again.notApplicable).toHaveLength(3);
  });

  it('refuses a business fit range on a style whose size search does not apply', async () => {
    const h = harness([base('PK-LA-02', { sizeClass: 'not_applicable', recipes: [] })]);
    const curate = (
      h.service as unknown as {
        curate: (tx: unknown, actor: unknown, base: unknown, input: unknown) => Promise<void>;
      }
    ).curate.bind(h.service);
    await expect(
      curate({ styleBase: { update: () => Promise.resolve() } }, h.actor, h.rows[0], {
        commercial: {
          fitMinLMm: 10,
          fitMaxLMm: 20,
          fitMinWMm: 10,
          fitMaxWMm: 20,
          fitMinHMm: 10,
          fitMaxHMm: 20,
          certifications: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'validation.failed' });
  });
});
