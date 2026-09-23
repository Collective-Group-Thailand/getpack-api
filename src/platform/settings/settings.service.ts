import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { type SettingKey, type SettingValues } from './setting-keys';

export interface SettingScopeRef {
  type: 'entity' | 'product_type';
  id: bigint;
}

export interface ResolvedSetting<T> {
  value: T;
  settingId: bigint;
  /** Snapshot this id, not the value alone (schema-design §2.2). */
  versionId: bigint;
  versionNo: number;
  effectiveFrom: Date;
}

interface CachedSetting {
  settingId: bigint;
  /** Approved versions, newest `effective_from` first, ties by `version_no` desc. */
  versions: { id: bigint; versionNo: number; effectiveFrom: Date; value: unknown }[];
}

/** Safety net only: changes invalidate explicitly (`setting.changed`). */
const CACHE_TTL_MS = 30_000;

export class SettingNotFoundError extends Error {
  constructor(key: string, at: Date) {
    super(`Setting ${key} has no approved version effective at ${at.toISOString()}`);
    this.name = 'SettingNotFoundError';
  }
}

/**
 * Effective-dated settings (ADR-0005): `at(key, t)` returns the approved version with the greatest
 * `effective_from ≤ t`, ties broken by the greatest `version_no`. A scoped lookup (entity, product
 * type) falls back to the platform value when the scope has none.
 */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, { entry: CachedSetting | null; loadedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async at<K extends SettingKey>(
    key: K,
    options?: { at?: Date; scope?: SettingScopeRef; tx?: Tx },
  ): Promise<ResolvedSetting<SettingValues[K]>>;
  async at<T = unknown>(
    key: string,
    options?: { at?: Date; scope?: SettingScopeRef; tx?: Tx },
  ): Promise<ResolvedSetting<T>>;
  async at(
    key: string,
    options: { at?: Date; scope?: SettingScopeRef; tx?: Tx } = {},
  ): Promise<ResolvedSetting<unknown>> {
    const at = options.at ?? new Date();
    const scoped = options.scope ? await this.load(key, options.scope, options.tx) : null;
    const resolved = (scoped && pick(scoped, at)) ?? pick(await this.load(key, undefined, options.tx), at);
    if (!resolved) throw new SettingNotFoundError(key, at);
    return resolved;
  }

  /** Shorthand for the value only. */
  async value<K extends SettingKey>(key: K, at?: Date): Promise<SettingValues[K]> {
    return (await this.at(key, { at })).value;
  }

  invalidate(key?: string): void {
    if (!key) {
      this.cache.clear();
      return;
    }
    for (const cacheKey of this.cache.keys()) if (cacheKey.startsWith(`${key}|`)) this.cache.delete(cacheKey);
  }

  private async load(
    key: string,
    scope: SettingScopeRef | undefined,
    tx?: Tx,
  ): Promise<CachedSetting | null> {
    const cacheKey = `${key}|${scope?.type ?? 'platform'}|${scope?.id ?? ''}`;
    const cached = this.cache.get(cacheKey);
    // Reads inside a transaction bypass the cache so they see the transaction's own writes.
    if (!tx && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.entry;
    const setting = await (tx ?? this.prisma).setting.findFirst({
      where: { key, scopeType: scope?.type ?? 'platform', scopeId: scope?.id ?? null },
      include: {
        versions: {
          where: { status: 'approved' },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          select: { id: true, versionNo: true, effectiveFrom: true, value: true },
        },
      },
    });
    const entry = setting ? { settingId: setting.id, versions: setting.versions } : null;
    if (!tx) this.cache.set(cacheKey, { entry, loadedAt: Date.now() });
    return entry;
  }
}

function pick(entry: CachedSetting | null, at: Date): ResolvedSetting<unknown> | null {
  const version = entry?.versions.find((v) => v.effectiveFrom.getTime() <= at.getTime());
  if (!entry || !version) return null;
  return {
    value: version.value,
    settingId: entry.settingId,
    versionId: version.id,
    versionNo: version.versionNo,
    effectiveFrom: version.effectiveFrom,
  };
}
