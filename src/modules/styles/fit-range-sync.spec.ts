import { type DielineEngineIdentity } from '@integrations/dieline/dieline-engine.port';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';

import {
  checkFitRangeEngine,
  cliEngineGate,
  FIT_RANGE_SYNC_ACTIONS,
  FIT_RANGE_SYNC_JOB,
  FIT_RANGE_SYNC_PENDING_KEY,
  FitRangeSyncBusyError,
  FitRangeSyncService,
} from './fit-range-sync';
import { FIT_RANGE_SYNC_DEBOUNCE_MS, FitRangeSyncJobs } from './fit-range-sync.jobs';
import { StylesAdminService } from './styles-admin.service';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const VENDORED = (sha: string | null = SHA_A): DielineEngineIdentity => ({
  kind: 'vendored',
  bundleSha256: sha,
});

/** In-memory stand-ins for the Redis commands the sync uses. */
function fakeRedis() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const setOf = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  return {
    sets,
    strings,
    set: (k: string, v: string, ..._opts: unknown[]) => {
      if (strings.has(k)) return Promise.resolve(null);
      strings.set(k, v);
      return Promise.resolve('OK');
    },
    eval: (_script: string, _n: number, k: string, token: string) => {
      if (strings.get(k) === token) strings.delete(k);
      return Promise.resolve(1);
    },
    sadd: (k: string, ...m: string[]) => (m.forEach((x) => setOf(k).add(x)), Promise.resolve(m.length)),
    smembers: (k: string) => Promise.resolve([...setOf(k)]),
    srem: (k: string, ...m: string[]) => (m.forEach((x) => setOf(k).delete(x)), Promise.resolve(m.length)),
  };
}

const RESULT = {
  considered: 3,
  filled: ['PK-AA-01'],
  refreshed: [],
  cleared: [],
  classified: [],
  unchanged: 2,
  keptBusiness: [],
  incomplete: [],
  coverage: { applicable: 3, withRange: 3 },
};

function harness(identity: DielineEngineIdentity, lastSha: string | null = null) {
  const redis = fakeRedis();
  const audits: { action: string; data: Record<string, unknown> }[] = [];
  if (lastSha) audits.push({ action: FIT_RANGE_SYNC_ACTIONS.full, data: { bundleSha256: lastSha } });
  const backfills: { codes?: readonly string[]; dryRun?: boolean }[] = [];
  const styles = {
    backfillFitRanges: jest.fn((_actor: unknown, options: { codes?: readonly string[] }) => {
      backfills.push(options);
      return Promise.resolve(RESULT);
    }),
  };
  const prisma = {
    auditLog: {
      findFirst: ({ where }: { where: { action: string } }) =>
        Promise.resolve(audits.filter((a) => a.action === where.action).at(-1) ?? null),
    },
    withTx: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  };
  const audit = {
    record: (_tx: unknown, e: { action: string; data: Record<string, unknown> }) => (
      audits.push(e),
      Promise.resolve()
    ),
  };
  const engine = { identity: () => Promise.resolve(identity) };
  const service = new FitRangeSyncService(
    prisma as never,
    styles as never,
    audit as never,
    engine as never,
    redis as never,
  );
  return { service, redis, audits, backfills, styles };
}

describe('fit-range sync (C13, D-461)', () => {
  it('runs the full backfill when the bundle differs from the last successful run, then stores it', async () => {
    const h = harness(VENDORED(SHA_B), SHA_A);
    await expect(h.service.run()).resolves.toEqual({
      status: 'synced',
      scope: 'all',
      bundleSha256: SHA_B,
      codes: null,
    });
    expect(h.backfills).toEqual([{}]);
    expect(h.styles.backfillFitRanges.mock.calls[0]![0]).toEqual({
      type: 'system',
      name: 'styles:fit-ranges-sync',
    });
    expect(h.audits.at(-1)).toMatchObject({
      action: FIT_RANGE_SYNC_ACTIONS.full,
      data: { bundleSha256: SHA_B, bundleBefore: SHA_A, trigger: 'bundle_changed', filled: 1 },
    });
    // The next check sees the stored bundle: nothing to do.
    await expect(h.service.run()).resolves.toEqual({ status: 'unchanged', bundleSha256: SHA_B });
    expect(h.backfills).toHaveLength(1);
  });

  it('runs on the first start (no run recorded yet)', async () => {
    const h = harness(VENDORED(SHA_A));
    await expect(h.service.run()).resolves.toMatchObject({ status: 'synced', scope: 'all' });
  });

  it('skips when the bundle is the one of the last run and nothing is pending', async () => {
    const h = harness(VENDORED(SHA_A), SHA_A);
    await expect(h.service.run()).resolves.toEqual({ status: 'unchanged', bundleSha256: SHA_A });
    expect(h.backfills).toEqual([]);
    expect(h.audits).toHaveLength(1);
  });

  it('skips with the fake engine and with an unavailable one — never writes, never records a bundle', async () => {
    for (const identity of [{ kind: 'fake', bundleSha256: null } as const, VENDORED(null)]) {
      const h = harness(identity);
      await h.service.markPending(['PK-AA-01']);
      await expect(h.service.run()).resolves.toEqual({
        status: 'skipped',
        reason: identity.kind === 'fake' ? 'fake' : 'unavailable',
      });
      expect(h.backfills).toEqual([]);
      expect(h.audits).toEqual([]);
      expect(h.redis.sets.get(FIT_RANGE_SYNC_PENDING_KEY)).toEqual(new Set(['PK-AA-01'])); // kept for a real engine
    }
  });

  it('backfills only the pending codes when the bundle is unchanged, and clears them', async () => {
    const h = harness(VENDORED(SHA_A), SHA_A);
    await h.service.markPending(['PK-BB-02', 'PK-AA-01', 'PK-BB-02']);
    await expect(h.service.run()).resolves.toEqual({
      status: 'synced',
      scope: 'codes',
      bundleSha256: SHA_A,
      codes: ['PK-AA-01', 'PK-BB-02'],
    });
    expect(h.backfills).toEqual([{ codes: ['PK-AA-01', 'PK-BB-02'] }]);
    expect(h.audits.at(-1)).toMatchObject({ action: FIT_RANGE_SYNC_ACTIONS.codes });
    expect(h.redis.sets.get(FIT_RANGE_SYNC_PENDING_KEY)?.size).toBe(0);
  });

  it('a catalogue-wide change asks for a full run', async () => {
    const h = harness(VENDORED(SHA_A), SHA_A);
    await h.service.markPending('all');
    await expect(h.service.run()).resolves.toMatchObject({ status: 'synced', scope: 'all' });
    expect(h.audits.at(-1)).toMatchObject({ data: { trigger: 'catalogue_change' } });
  });

  it('a failed backfill keeps the pending codes and the old bundle (the job retries)', async () => {
    const h = harness(VENDORED(SHA_B), SHA_A);
    await h.service.markPending(['PK-AA-01']);
    h.styles.backfillFitRanges.mockRejectedValueOnce(new Error('db down'));
    await expect(h.service.run()).rejects.toThrow('db down');
    expect(h.audits).toHaveLength(1);
    expect(h.redis.sets.get(FIT_RANGE_SYNC_PENDING_KEY)).toEqual(new Set(['PK-AA-01']));
    expect(h.redis.strings.size).toBe(0); // lock released
  });

  it('refuses to run next to another run', async () => {
    const h = harness(VENDORED(SHA_B), SHA_A);
    h.redis.strings.set('styles:fit_ranges_sync:lock', 'other');
    await expect(h.service.run()).rejects.toBeInstanceOf(FitRangeSyncBusyError);
    expect(h.backfills).toEqual([]);
  });

  describe('codes a domain event touches', () => {
    const event = (type: string, over: Partial<DomainEventEnvelope> = {}): DomainEventEnvelope => ({
      id: 'e1',
      type,
      aggregateType: 'x',
      aggregateId: 'agg-1',
      entityId: null,
      actor: { type: 'user', userId: '7' },
      occurredAt: '2026-10-29T00:00:00Z',
      correlationId: 'c',
      causationId: null,
      payloadSchemaVersion: 1,
      payload: {},
      ...over,
    });
    const tx = {
      styleImportRun: { findUnique: jest.fn(() => Promise.resolve({ id: 5n })) },
      styleBase: { findMany: jest.fn((_q: unknown) => Promise.resolve([{ code: 'PK-AA-01' }])) },
    };

    it('reads an import run, a curation by a person, a pattern; ignores the sync’s own curation', async () => {
      const { service } = harness(VENDORED());
      await expect(service.codesAffectedBy(event('style_import.applied'), tx as never)).resolves.toEqual([
        'PK-AA-01',
      ]);
      expect(tx.styleBase.findMany.mock.calls[0]![0]).toMatchObject({
        where: { OR: [{ lastImportRunId: 5n }, { recipes: { some: { importRunId: 5n } } }] },
      });
      await expect(
        service.codesAffectedBy(event('style_base.curated', { payload: { code: 'PK-CC-03' } }), tx as never),
      ).resolves.toEqual(['PK-CC-03']);
      await expect(
        service.codesAffectedBy(
          event('style_base.curated', { payload: { code: 'PK-CC-03' }, actor: { type: 'system' } }),
          tx as never,
        ),
      ).resolves.toEqual([]);
      await service.codesAffectedBy(event('catalog.pattern.updated'), tx as never);
      expect(tx.styleBase.findMany.mock.calls.at(-1)![0]).toMatchObject({
        where: { pattern: { publicId: 'agg-1' } },
      });
      await expect(service.codesAffectedBy(event('catalog.import_applied'), tx as never)).resolves.toBe(
        'all',
      );
    });
  });
});

describe('fit-range sync worker job (C13)', () => {
  const service = (codes: string[] | 'all') => ({
    run: jest.fn(),
    codesAffectedBy: jest.fn(() => Promise.resolve(codes)),
    markPending: jest.fn((c: string[] | 'all') => Promise.resolve(c === 'all' ? 1 : c.length)),
  });

  it('marks the touched styles pending and queues one debounced run', async () => {
    const sync = service(['PK-AA-01']);
    const queue = { add: jest.fn(() => Promise.resolve()) };
    const jobs = new FitRangeSyncJobs(sync as never, queue as never);
    await jobs.onChange({} as never, {} as never);
    expect(sync.markPending).toHaveBeenCalledWith(['PK-AA-01']);
    expect(queue.add).toHaveBeenCalledWith(
      FIT_RANGE_SYNC_JOB,
      {},
      expect.objectContaining({
        delay: FIT_RANGE_SYNC_DEBOUNCE_MS,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        deduplication: {
          id: `${FIT_RANGE_SYNC_JOB}.changed`,
          ttl: FIT_RANGE_SYNC_DEBOUNCE_MS,
          extend: true,
          replace: true,
        },
      }),
    );
  });

  it('queues nothing when the event touches no style', async () => {
    const queue = { add: jest.fn(() => Promise.resolve()) };
    await new FitRangeSyncJobs(service([]) as never, queue as never).onChange({} as never, {} as never);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues a run at worker start and never fails the start', async () => {
    const queue = { add: jest.fn(() => Promise.reject(new Error('redis down'))) };
    await expect(
      new FitRangeSyncJobs(service([]) as never, queue as never).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledWith(
      FIT_RANGE_SYNC_JOB,
      {},
      expect.objectContaining({ deduplication: { id: `${FIT_RANGE_SYNC_JOB}.start`, ttl: 15_000 } }),
    );
  });
});

describe('backfillFitRanges codes filter (C13)', () => {
  it('limits the styles read to the given codes', async () => {
    const findMany = jest.fn((_q: unknown) => Promise.resolve([]));
    const service = new StylesAdminService(
      { styleBase: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const actor = { type: 'system', name: 'test' } as never;
    await service.backfillFitRanges(actor, { codes: ['PK-AA-01'] });
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: 'active', code: { in: ['PK-AA-01'] } },
    });
    await service.backfillFitRanges(actor);
    expect((findMany.mock.calls[1]![0] as { where: object }).where).toEqual({ status: 'active' });
  });
});

describe('pnpm styles:fit-ranges engine gate (C13)', () => {
  const fake = checkFitRangeEngine({ kind: 'fake', bundleSha256: null });
  const unavailable = checkFitRangeEngine(VENDORED(null));
  const real = checkFitRangeEngine(VENDORED(SHA_A));

  it('refuses --confirm with the fake or an unavailable engine unless --allow-fake', () => {
    expect(real).toEqual({ usable: true, bundleSha256: SHA_A });
    for (const check of [fake, unavailable]) {
      const refused = cliEngineGate(check, { confirm: true, allowFake: false });
      expect(refused.proceed).toBe(false);
      expect(refused.warning).toMatch(/WARNING: .*partial.*Refusing --confirm/);
      expect(cliEngineGate(check, { confirm: true, allowFake: true })).toMatchObject({ proceed: true });
      // A dry run only warns.
      expect(cliEngineGate(check, { confirm: false, allowFake: false })).toMatchObject({
        proceed: true,
        warning: expect.stringMatching(/WARNING/) as unknown,
      });
    }
    expect(fake).toMatchObject({ usable: false, reason: 'fake' });
    expect(cliEngineGate(real, { confirm: true, allowFake: false })).toEqual({
      proceed: true,
      warning: null,
    });
  });
});
