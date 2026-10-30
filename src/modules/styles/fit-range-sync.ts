import { type Actor, systemActor } from '@common/context/actor';
import { PrismaService, type Tx } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import {
  DIELINE_ENGINE,
  type DielineEngine,
  type DielineEngineIdentity,
} from '@integrations/dieline/dieline-engine.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { type Redis } from 'ioredis';

import { type FitRangeBackfillResult } from './styles-admin.dto';
import { StylesAdminService } from './styles-admin.service';

/** C13 (D-461) the worker job (`@ScheduledJob` name, also used for the start-up and debounced runs). */
export const FIT_RANGE_SYNC_JOB = 'styles.fit_ranges_sync';
/** The system actor of every automatic backfill (audited per style through the curation path). */
export const FIT_RANGE_SYNC_ACTOR = 'styles:fit-ranges-sync';
/**
 * The sync's own audit rows (one fixed resource, so "the last successful run" is one indexed lookup): a full run
 * records the engine bundle it ran with — the state the next check compares against (no business setting, no table).
 */
export const FIT_RANGE_SYNC_RESOURCE = {
  type: 'styles_fit_range_sync',
  publicId: '00000000-0000-0000-0000-000000000c13',
} as const;
export const FIT_RANGE_SYNC_ACTIONS = {
  full: 'styles.fit_ranges_synced',
  codes: 'styles.fit_ranges_synced_codes',
} as const;
/** Style codes waiting for a limited run (a Redis set); `*` asks for a full run. */
export const FIT_RANGE_SYNC_PENDING_KEY = 'styles:fit_ranges_sync:pending';
const ALL = '*';
const LOCK_KEY = 'styles:fit_ranges_sync:lock';
/** Technical bound: longer than any backfill (the engine walks each recipe's limits grid). */
const LOCK_TTL_MS = 30 * 60_000;

/** Domain events after which the styles they touch are backfilled again (debounced, C13 1b). */
export const FIT_RANGE_SYNC_EVENTS = [
  'style_import.applied',
  'style_base.curated',
  'style_base.recipe_approved',
  'catalog.pattern.created',
  'catalog.pattern.updated',
  'catalog.pattern.deleted',
  'catalog.standard_size.created',
  'catalog.standard_size.updated',
  'catalog.standard_size.deleted',
  'catalog.import_applied',
] as const;

export type FitRangeEngineCheck =
  { usable: true; bundleSha256: string } | { usable: false; reason: 'fake' | 'unavailable'; message: string };

/**
 * C13 (D-461): only the vendored engine, loaded and matching its recorded hash, may fill fit ranges — the fake
 * (`INTEGRATIONS_MODE=fake`) has no presets or limits and an unavailable engine none at all, so a run with either
 * would write partial ranges (the 81/102 instead of 94/102 of 2026-10-29).
 */
export function checkFitRangeEngine(identity: DielineEngineIdentity): FitRangeEngineCheck {
  if (identity.kind === 'fake')
    return {
      usable: false,
      reason: 'fake',
      message:
        'the fake dieline engine is active (INTEGRATIONS_MODE=fake): it has no recipe presets or solver limits, ' +
        'so fit ranges would come out partial',
    };
  if (!identity.bundleSha256)
    return {
      usable: false,
      reason: 'unavailable',
      message:
        'the dieline engine is unavailable (vendor/getpack-dieline missing or not matching VERSION.json): ' +
        'fit ranges would come out partial',
    };
  return { usable: true, bundleSha256: identity.bundleSha256 };
}

/**
 * C13 (D-461) `pnpm styles:fit-ranges`: may this run write? A dry run always may (it warns); `--confirm` with the fake
 * or an unavailable engine only with `--allow-fake`.
 */
export function cliEngineGate(
  check: FitRangeEngineCheck,
  flags: { confirm: boolean; allowFake: boolean },
): { proceed: boolean; warning: string | null } {
  if (check.usable) return { proceed: true, warning: null };
  const warning = `WARNING: ${check.message}.`;
  if (!flags.confirm || flags.allowFake) return { proceed: true, warning };
  return {
    proceed: false,
    warning:
      `${warning} Refusing --confirm. Run it where the real engine is vendored (INTEGRATIONS_MODE=real), ` +
      'or add --allow-fake if you really mean to write these ranges.',
  };
}

export type FitRangeSyncOutcome =
  | { status: 'skipped'; reason: 'fake' | 'unavailable' }
  | { status: 'unchanged'; bundleSha256: string }
  | { status: 'synced'; scope: 'all' | 'codes'; bundleSha256: string; codes: string[] | null };

export class FitRangeSyncBusyError extends Error {
  constructor() {
    super('another fit-range sync is running');
    this.name = 'FitRangeSyncBusyError';
  }
}

const summary = (r: FitRangeBackfillResult) => ({
  considered: r.considered,
  filled: r.filled.length,
  refreshed: r.refreshed.length,
  cleared: r.cleared.length,
  classified: r.classified.length,
  unchanged: r.unchanged,
  keptBusiness: r.keptBusiness.length,
  incomplete: r.incomplete.length,
  coverage: r.coverage,
});

/**
 * C13 (D-461, DECISIONS-STAGE-A §18) — keeps the styles' inside fit ranges in step with the dieline engine without
 * anyone running `pnpm styles:fit-ranges`: when the vendored bundle (`VERSION.json` `bundleSha256`) differs from the one
 * of the last successful full run, the whole backfill runs (same service path as the CLI and
 * `admin.styles.backfillFitRanges`, confirm mode, actor `styles:fit-ranges-sync`); styles touched by an import or a
 * curation change wait in a pending set and are backfilled alone. With the fake or an unavailable engine nothing is
 * written. Failures throw — the job framework retries with backoff — and leave the pending set and the recorded
 * bundle untouched.
 */
@Injectable()
export class FitRangeSyncService {
  private readonly logger = new Logger(FitRangeSyncService.name);
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly styles: StylesAdminService,
    private readonly audit: AuditService,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(): Promise<FitRangeSyncOutcome> {
    const check = checkFitRangeEngine(await this.engine.identity());
    if (!check.usable) {
      // Once per process and reason: the hourly check would otherwise repeat it all day in `pnpm dev`.
      if (!this.warned.has(check.reason)) this.logger.warn(`fit-range sync skipped: ${check.message}`);
      this.warned.add(check.reason);
      return { status: 'skipped', reason: check.reason };
    }
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;
    if ((await this.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')) !== 'OK')
      throw new FitRangeSyncBusyError();
    try {
      return await this.sync(check.bundleSha256);
    } catch (error) {
      this.logger.error(`fit-range sync failed (retried): ${(error as Error).message}`);
      throw error;
    } finally {
      await this.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          token,
        )
        .catch(() => undefined);
    }
  }

  /** Queues style codes (or `'all'`) for the next run; the caller schedules that run (debounced). */
  async markPending(codes: readonly string[] | 'all'): Promise<number> {
    const members = codes === 'all' ? [ALL] : [...new Set(codes)];
    if (members.length === 0) return 0;
    await this.redis.sadd(FIT_RANGE_SYNC_PENDING_KEY, ...members);
    return members.length;
  }

  /** The style codes a domain event touches; `'all'` for a catalogue import; none for the sync's own writes. */
  async codesAffectedBy(event: DomainEventEnvelope, tx: Tx): Promise<string[] | 'all'> {
    const id = event.aggregateId;
    const codes = async (where: Parameters<Tx['styleBase']['findMany']>[0]) =>
      (await tx.styleBase.findMany({ ...where, select: { code: true } })).map((b) => b.code);
    switch (event.type) {
      case 'style_import.applied': {
        const run = await tx.styleImportRun.findUnique({ where: { publicId: id }, select: { id: true } });
        if (!run) return [];
        return codes({
          where: { OR: [{ lastImportRunId: run.id }, { recipes: { some: { importRunId: run.id } } }] },
        });
      }
      case 'style_base.curated':
      case 'style_base.recipe_approved': {
        // A system actor's curation is a backfill (this sync, the CLI): following it would loop.
        if (event.actor.type === 'system') return [];
        const code = event.payload['code'];
        return typeof code === 'string' ? [code] : [];
      }
      case 'catalog.pattern.created':
      case 'catalog.pattern.updated':
      case 'catalog.pattern.deleted':
        return codes({ where: { pattern: { publicId: id } } });
      case 'catalog.standard_size.created':
      case 'catalog.standard_size.updated':
      case 'catalog.standard_size.deleted':
        return codes({
          where: {
            pattern: {
              catalogProducts: { some: { catalogProduct: { standardSizes: { some: { publicId: id } } } } },
            },
          },
        });
      case 'catalog.import_applied':
        return 'all';
      default:
        return [];
    }
  }

  private async sync(bundleSha256: string): Promise<FitRangeSyncOutcome> {
    const actor = systemActor(FIT_RANGE_SYNC_ACTOR);
    const pending = await this.redis.smembers(FIT_RANGE_SYNC_PENDING_KEY);
    const last = await this.lastSyncedBundle();
    if (last !== bundleSha256 || pending.includes(ALL)) {
      const result = await this.styles.backfillFitRanges(actor, {});
      await this.record(actor, FIT_RANGE_SYNC_ACTIONS.full, {
        bundleSha256,
        bundleBefore: last,
        trigger: last !== bundleSha256 ? 'bundle_changed' : 'catalogue_change',
        ...summary(result),
      });
      if (pending.length) await this.redis.srem(FIT_RANGE_SYNC_PENDING_KEY, ...pending);
      this.logger.log(
        `fit ranges synced with bundle ${bundleSha256.slice(0, 8)}: ${result.filled.length} filled, ` +
          `${result.refreshed.length} refreshed, coverage ${result.coverage.withRange}/${result.coverage.applicable}`,
      );
      return { status: 'synced', scope: 'all', bundleSha256, codes: null };
    }
    if (pending.length === 0) return { status: 'unchanged', bundleSha256 };
    const codes = [...pending].sort();
    const result = await this.styles.backfillFitRanges(actor, { codes });
    await this.record(actor, FIT_RANGE_SYNC_ACTIONS.codes, { bundleSha256, codes, ...summary(result) });
    // Only the codes this run read: any added meanwhile wait for the next (debounced) run.
    await this.redis.srem(FIT_RANGE_SYNC_PENDING_KEY, ...pending);
    return { status: 'synced', scope: 'codes', bundleSha256, codes };
  }

  /** The bundle of the last successful full run (its audit row), null before the first. */
  private async lastSyncedBundle(): Promise<string | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: {
        resourceType: FIT_RANGE_SYNC_RESOURCE.type,
        resourcePublicId: FIT_RANGE_SYNC_RESOURCE.publicId,
        action: FIT_RANGE_SYNC_ACTIONS.full,
        outcome: 'success',
      },
      orderBy: { occurredAt: 'desc' },
      select: { data: true },
    });
    const sha = (row?.data as { bundleSha256?: unknown } | undefined)?.bundleSha256;
    return typeof sha === 'string' ? sha : null;
  }

  private record(actor: Actor, action: string, data: Record<string, unknown>): Promise<void> {
    return this.prisma.withTx((tx) =>
      this.audit.record(tx, {
        actor,
        category: 'config',
        action,
        resourceType: FIT_RANGE_SYNC_RESOURCE.type,
        resourcePublicId: FIT_RANGE_SYNC_RESOURCE.publicId,
        data,
      }),
    );
  }
}
