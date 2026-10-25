import {
  type Admission,
  admit,
  crossedThresholds,
  formatBytes,
  monthlyStorageCharge,
  type QuotaState,
  quotaState,
  type StorageCharge,
  type StoragePolicy,
  storagePolicy,
  type StorageUsage,
} from '@collective/documents';
import { systemActor } from '@common/context/actor';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { type FilePurpose } from '@platform/files/file-purposes';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';

import {
  COUNTED_RECORDS,
  type CountedRecordType,
  DEFAULT_RECORD_BYTES,
  type PerAccountType,
  PURPOSE_RETENTION,
  type StorageAccountType,
  type StoragePackSetting,
} from './storage-settings';

/** The policy of one account type at an instant, from the `storage.*` settings (D-436). */
export interface AccountPolicy {
  /** null = no free allowance set for this type: usage is still recorded, nothing is held, no notice is sent. */
  policy: StoragePolicy | null;
  freeGb: string | null;
  pricePerGbMonth: string | null;
  /** The setting version ids used, in key order — stored on each snapshot for audit. */
  settingVersionIds: string[];
}

export interface StorageStatus {
  accountType: StorageAccountType;
  usage: StorageUsage;
  state: QuotaState | null;
  policy: AccountPolicy;
}

export interface SnapshotRow {
  factoryId: bigint;
  factoryPublicId: string;
  factoryCode: string;
  factoryName: string;
  day: string;
  fileBytes: bigint;
  recordCounts: Record<string, number>;
  countedBytes: bigint;
  allowanceBytes: bigint | null;
  computedAt: Date;
}

/** Roles of a factory told when it crosses a threshold: whoever runs the account and its money. */
export const NOTICE_ROLES = ['factory_owner', 'factory_accountant'] as const;

const KEYS = [
  'storage.free_gb',
  'storage.price_per_gb_month',
  'storage.packs',
  'storage.record_bytes',
  'storage.notice_at_percent',
] as const;

/**
 * Storage metering of factory accounts (D-436) on `@collective/documents`: usage = live files the factory owns at
 * their size + the records it keeps in its getpack ERP at the counted size of their type; a daily snapshot per factory
 * (job `storage.snapshot`); a notice once per crossing of each threshold (event `storage.threshold_crossed` → in-app
 * and LINE to the owner and accountant); admission of uploads, which only ever holds optional ones; and the monthly
 * charge for the platform invoice line. Every number is a setting. Data is never deleted or locked for being over.
 */
@Injectable()
export class StorageMeteringService implements OnModuleInit {
  private readonly logger = new Logger('StorageMetering');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    this.files.registerUploadAdmission((factoryId, purpose, bytes) =>
      this.admitUpload(factoryId, purpose, bytes),
    );
  }

  /** Every factory is a `factory` account today; `partner` is configured for partner accounts that are not factories. */
  accountTypeOf(): StorageAccountType {
    return 'factory';
  }

  async policyAt(type: StorageAccountType, at: Date, tx?: Tx): Promise<AccountPolicy> {
    const [free, price, packs, recordBytes, notices] = await Promise.all(
      KEYS.map((key) => this.settings.at<unknown>(key, { at, tx }).catch(() => null)),
    );
    const freeGb = (free?.value as PerAccountType | undefined)?.[type] ?? null;
    const pricePerGbMonth = (price?.value as PerAccountType | undefined)?.[type] ?? null;
    const bytes = (recordBytes?.value as Record<string, number> | undefined) ?? DEFAULT_RECORD_BYTES;
    const { _default: defaultRecordBytes = 1024, ...perType } = bytes;
    const policy =
      freeGb === null
        ? null
        : storagePolicy({
            freeGb,
            pricePerGbMonth,
            packs: (packs?.value as StoragePackSetting[] | undefined) ?? [],
            recordBytes: perType,
            defaultRecordBytes,
            noticeAtPercent: (notices?.value as number[] | undefined) ?? [80, 100],
          });
    const settingVersionIds = [free, price, packs, recordBytes, notices].map(
      (v) => v?.versionId.toString() ?? '-',
    );
    return { policy, freeGb, pricePerGbMonth, settingVersionIds };
  }

  /** What a factory stores now: live, uploaded files it owns (thumbnails excluded) and its ERP records by type. */
  async usage(factoryId: bigint, db: Tx | PrismaService = this.prisma): Promise<StorageUsage> {
    const [files] = await db.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT coalesce(sum(size_bytes), 0)::bigint AS bytes
        FROM file_objects
       WHERE owner_factory_id = ${factoryId}
         AND upload_status = 'uploaded'
         AND purged_at IS NULL
         AND thumbnail_of_file_id IS NULL`;
    const counts = Prisma.join(
      (Object.entries(COUNTED_RECORDS) as [CountedRecordType, string][]).map(
        ([type, table]) =>
          Prisma.sql`SELECT ${type}::text AS type, count(*)::int AS n FROM ${Prisma.raw(`"${table}"`)} WHERE factory_id = ${factoryId}`,
      ),
      ' UNION ALL ',
    );
    const rows = await db.$queryRaw<{ type: string; n: number }[]>`${counts}`;
    const records: Record<string, number> = {};
    for (const row of rows) if (row.n > 0) records[row.type] = Number(row.n);
    return { fileBytes: BigInt(files?.bytes ?? 0n), records };
  }

  /** A factory's usage against its allowance now (the partner console). */
  async status(factoryId: bigint, now = new Date()): Promise<StorageStatus> {
    const accountType = this.accountTypeOf();
    const [usage, policy] = await Promise.all([this.usage(factoryId), this.policyAt(accountType, now)]);
    return { accountType, usage, policy, state: policy.policy ? quotaState(usage, policy.policy) : null };
  }

  /**
   * Whether an upload may be stored (D-436). Never refuses legal or operational files; an optional upload is held only
   * when the factory's latest snapshot plus this file would be over its allowance and overage is not sold. No snapshot
   * yet, or no allowance set: accepted.
   */
  async admitUpload(
    factoryId: bigint,
    purpose: FilePurpose,
    bytes: number,
    now = new Date(),
  ): Promise<Admission> {
    const retention = PURPOSE_RETENTION[purpose];
    if (retention !== 'optional') return { accepted: true, overage: false };
    const { policy } = await this.policyAt(this.accountTypeOf(), now);
    if (!policy) return { accepted: true, overage: false };
    const [latest] = await this.prisma.$queryRaw<{ counted_bytes: bigint }[]>`
      SELECT counted_bytes FROM storage_usage_daily WHERE factory_id = ${factoryId} ORDER BY day DESC LIMIT 1`;
    if (!latest) return { accepted: true, overage: false };
    const state = quotaState({ fileBytes: BigInt(latest.counted_bytes), records: {} }, policy);
    return admit({ retention, bytes: BigInt(bytes) }, state, policy);
  }

  /** The daily snapshot of every factory that is not offboarded; returns how many were written. */
  async snapshotAll(now = new Date()): Promise<number> {
    const day = bangkokDate(now);
    const factories = await this.prisma.factory.findMany({
      where: { status: { not: 'offboarded' } },
      select: { id: true, publicId: true },
      orderBy: { id: 'asc' },
    });
    let written = 0;
    for (const factory of factories) {
      try {
        await this.snapshot(factory, day, now);
        written += 1;
      } catch (error) {
        // One factory's failure never stops the others; the next run writes the day again.
        this.logger.warn(`storage snapshot ${factory.publicId}: ${(error as Error).message}`);
      }
    }
    return written;
  }

  /** One factory's snapshot of `day` (rewritten when the job runs again that day) and its notices. */
  async snapshot(factory: { id: bigint; publicId: string }, day: string, now = new Date()): Promise<void> {
    const type = this.accountTypeOf();
    const policy = await this.policyAt(type, now);
    const usage = await this.usage(factory.id);
    await this.prisma.withTx(async (tx) => {
      const [previous] = await tx.$queryRaw<{ counted_bytes: bigint; allowance_bytes: bigint | null }[]>`
        SELECT counted_bytes, allowance_bytes FROM storage_usage_daily
         WHERE factory_id = ${factory.id} AND day < ${day}::date ORDER BY day DESC LIMIT 1`;
      const state = policy.policy ? quotaState(usage, policy.policy) : null;
      const counted = state?.usedBytes ?? usage.fileBytes + this.defaultRecordBytes(usage);
      await tx.$executeRaw`
        INSERT INTO storage_usage_daily
          (factory_id, account_type, day, file_bytes, record_counts, counted_bytes, allowance_bytes, setting_version_ids)
        VALUES (${factory.id}, ${type}::storage_account_type, ${day}::date, ${usage.fileBytes},
                ${JSON.stringify(usage.records)}::jsonb, ${counted}, ${state?.allowanceBytes ?? null},
                ${policy.settingVersionIds})
        ON CONFLICT (factory_id, day) DO UPDATE SET
          account_type = EXCLUDED.account_type, file_bytes = EXCLUDED.file_bytes,
          record_counts = EXCLUDED.record_counts, counted_bytes = EXCLUDED.counted_bytes,
          allowance_bytes = EXCLUDED.allowance_bytes, setting_version_ids = EXCLUDED.setting_version_ids,
          computed_at = now()`;
      if (!policy.policy || !state) return;
      await this.notices(tx, factory, day, policy.policy, state, previous);
    });
  }

  /**
   * Sends each threshold once per crossing (D-436): a notice row stays open while usage is at or above it and is
   * cleared when usage drops below, so a later crossing is told again.
   */
  private async notices(
    tx: Tx,
    factory: { id: bigint; publicId: string },
    day: string,
    policy: StoragePolicy,
    state: QuotaState,
    previous: { counted_bytes: bigint } | undefined,
  ): Promise<void> {
    const open = await tx.$queryRaw<{ threshold_pct: number }[]>`
      SELECT threshold_pct FROM storage_notices WHERE factory_id = ${factory.id} AND cleared_at IS NULL`;
    const openPct = new Set(open.map((o) => o.threshold_pct));
    const before =
      previous === undefined
        ? { ...state, usedBytes: 0n, usedBasisPoints: 0 }
        : quotaState({ fileBytes: BigInt(previous.counted_bytes), records: {} }, policy);
    const crossed = new Set(crossedThresholds(before, state, policy));
    // A threshold already at or above with no open row (e.g. the allowance was lowered) is told as well.
    for (const pct of policy.noticeAtPercent) {
      if (state.usedBasisPoints >= pct * 100 && !openPct.has(pct)) crossed.add(pct);
    }
    for (const pct of openPct) {
      if (state.usedBasisPoints < pct * 100) {
        await tx.$executeRaw`
          UPDATE storage_notices SET cleared_at = now()
           WHERE factory_id = ${factory.id} AND threshold_pct = ${pct} AND cleared_at IS NULL`;
      }
    }
    for (const pct of [...crossed].sort((a, b) => a - b)) {
      if (openPct.has(pct)) continue;
      const [notice] = await tx.$queryRaw<{ public_id: string }[]>`
        INSERT INTO storage_notices (factory_id, threshold_pct, crossed_on, used_bytes, allowance_bytes)
        VALUES (${factory.id}, ${pct}, ${day}::date, ${state.usedBytes}, ${state.allowanceBytes})
        ON CONFLICT DO NOTHING
        RETURNING public_id`;
      if (!notice) continue;
      await this.events.record(
        tx,
        {
          type: 'storage.threshold_crossed',
          aggregateType: 'storage_notice',
          aggregateId: notice.public_id,
          payload: {
            factoryId: factory.publicId,
            recipientRoles: [...NOTICE_ROLES],
            thresholdPct: pct,
            usedPct: (state.usedBasisPoints / 100).toFixed(0),
            used: formatBytes(state.usedBytes),
            allowance: formatBytes(state.allowanceBytes),
            noticeId: notice.public_id,
          },
        },
        systemActor('storage-metering'),
      );
    }
  }

  /**
   * The storage line of a factory's monthly platform invoice (D-436): one value per day of the month from the daily
   * snapshots (a day without one counts as the day before; days before the first snapshot count as nothing stored),
   * above the allowance, averaged and priced per GB-month with the policy in force on the month's last day. null when no allowance is set for the type or the month
   * has no snapshot.
   */
  async monthlyCharge(
    factoryId: bigint,
    month: string,
    packKeys: string[] = [],
  ): Promise<(StorageCharge & { days: number; month: string }) | null> {
    const first = `${month}-01`;
    const next = addCalendarDays(`${month}-28`, 4).slice(0, 7);
    const last = addCalendarDays(`${next}-01`, -1);
    const policy = await this.policyAt(
      this.accountTypeOf(),
      new Date(startOfBangkokDay(addCalendarDays(last, 1)).getTime() - 1),
    );
    if (!policy.policy) return null;
    const rows = await this.prisma.$queryRaw<{ day: Date; counted_bytes: bigint }[]>`
      SELECT day, counted_bytes FROM storage_usage_daily
       WHERE factory_id = ${factoryId} AND day >= ${first}::date AND day <= ${last}::date ORDER BY day`;
    if (rows.length === 0) return null;
    const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), BigInt(r.counted_bytes)]));
    const daily: bigint[] = [];
    let carry: bigint | undefined;
    for (let d = first; d <= last; d = addCalendarDays(d, 1)) {
      carry = byDay.get(d) ?? carry;
      daily.push(carry ?? 0n);
    }
    const charge = monthlyStorageCharge({
      dailyUsedBytes: daily,
      policy: policy.policy,
      purchasedPackKeys: packKeys,
    });
    return { ...charge, days: daily.length, month };
  }

  /** Every factory's latest snapshot, largest first (the admin console). */
  async latest(limit: number, offset = 0): Promise<{ rows: SnapshotRow[]; total: number }> {
    const rows = await this.prisma.$queryRaw<
      {
        factory_id: bigint;
        public_id: string;
        code: string;
        name: string;
        day: Date;
        file_bytes: bigint;
        record_counts: Record<string, number>;
        counted_bytes: bigint;
        allowance_bytes: bigint | null;
        computed_at: Date;
        total: bigint;
      }[]
    >`
      WITH latest AS (
        SELECT DISTINCT ON (s.factory_id) s.*
          FROM storage_usage_daily s
         ORDER BY s.factory_id, s.day DESC
      )
      SELECT l.factory_id, f.public_id, f.code, coalesce(f.trade_name, f.legal_name) AS name, l.day, l.file_bytes,
             l.record_counts, l.counted_bytes, l.allowance_bytes, l.computed_at, count(*) OVER () AS total
        FROM latest l JOIN factories f ON f.id = l.factory_id
       ORDER BY l.counted_bytes DESC, f.code
       LIMIT ${limit} OFFSET ${offset}`;
    const total = rows[0] ? Number(rows[0].total) : 0;
    return {
      total,
      rows: rows.map((r) => ({
        factoryId: r.factory_id,
        factoryPublicId: r.public_id,
        factoryCode: r.code,
        factoryName: r.name,
        day: r.day.toISOString().slice(0, 10),
        fileBytes: BigInt(r.file_bytes),
        recordCounts: r.record_counts,
        countedBytes: BigInt(r.counted_bytes),
        allowanceBytes: r.allowance_bytes === null ? null : BigInt(r.allowance_bytes),
        computedAt: r.computed_at,
      })),
    };
  }

  /** Records counted at the recommended default sizes when no policy is set (the snapshot still records a size). */
  private defaultRecordBytes(usage: StorageUsage): bigint {
    let total = 0n;
    for (const [type, n] of Object.entries(usage.records)) {
      const size = (DEFAULT_RECORD_BYTES as Record<string, number>)[type] ?? DEFAULT_RECORD_BYTES._default;
      total += BigInt(n) * BigInt(size);
    }
    return total;
  }
}
