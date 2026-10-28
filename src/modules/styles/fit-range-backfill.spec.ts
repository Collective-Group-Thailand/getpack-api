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
    recipes: [{ recipe: { engine: [{ base: code }] }, sizeRanges: { paperboard: FULL } }],
    pattern: null,
    ...over,
  };
}

/** An in-memory stand-in for the parts of Prisma the backfill touches (the curation path writes through `update`). */
function harness(rows: Row[], inside: RecipeInsideSizes = {}) {
  const byId = new Map(rows.map((r) => [r.publicId, r]));
  const audits: unknown[] = [];
  const tx = {
    styleBase: {
      findUnique: ({ where }: { where: { publicId: string } }) => Promise.resolve({ ...byId.get(where.publicId)! }),
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
    { insideSizes: () => Promise.resolve(inside) } as never,
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
          recipes: [{ recipe: { engine: [{}] }, sizeRanges: { paperboard: { ...FULL, minH: null, maxH: null } } }],
        }),
        base('PK-AA-03', { recipes: [], pattern: null }),
        base('PK-AA-04', { fitMinLMm: 1, fitMaxLMm: 2, fitRangeSource: 'business' }),
      ],
      { paperboard: { standard: { length: null, width: null, height: { min: 25, max: 35 } }, limits: { length: null, width: null, height: null } } },
    );
    const dry = await h.service.backfillFitRanges(h.actor, { dryRun: true });
    expect(dry.filled).toEqual(['PK-AA-01', 'PK-AA-02']);
    expect(dry.keptBusiness).toEqual(['PK-AA-04']);
    expect(dry.incomplete).toEqual([
      { code: 'PK-AA-03', missing: ['fitMinLMm', 'fitMaxLMm', 'fitMinWMm', 'fitMaxWMm', 'fitMinHMm', 'fitMaxHMm'], conflicting: [] },
    ]);
    expect(dry.bySource).toEqual({ recipe: 1, standard_sizes: 0, production_envelope: 0, combined: 1 });
    expect(dry.changes[1]).toMatchObject({ code: 'PK-AA-02', source: 'combined', after: { fitMinHMm: 25, fitMaxHMm: 35 } });
    expect(h.rows[0]!['fitRangeSource']).toBeNull(); // dry run writes nothing

    const run = await h.service.backfillFitRanges(h.actor);
    expect(run.filled).toEqual(['PK-AA-01', 'PK-AA-02']);
    expect(h.rows[1]).toMatchObject({ fitRangeSource: 'combined', fitMinHMm: 25, fitMaxHMm: 35 });
    expect((h.rows[1]!['fitRangeBounds'] as Record<string, { source: string }>)['fitMaxHMm']!.source).toBe('standard_sizes');
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
      base('PK-AA-01', { fitMinLMm: 60, fitMaxLMm: 400, fitMinWMm: 50, fitMaxWMm: 300, fitMinHMm: 20, fitMaxHMm: 450, fitRangeSource: 'recipe' }),
    ]);
    const run = await h.service.backfillFitRanges(h.actor);
    expect(run.unchanged).toBe(1);
    expect(h.audits).toHaveLength(0);
  });
});
