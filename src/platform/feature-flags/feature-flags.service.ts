import { createHash } from 'node:crypto';

import { type Actor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/** `feature_flags.rules` (schema-design §3.1). All present conditions must hold. */
export interface FeatureFlagRules {
  audiences?: ('customer' | 'staff' | 'partner')[];
  /** Public user ids always included. */
  userIds?: string[];
  /** 0–100: stable share of principals (hash of flag key + public id). */
  percentage?: number;
}

const CACHE_TTL_MS = 30_000;

/**
 * Operational toggles (e.g. an R2 adapter switched off, D-111) — not business values, which are
 * effective-dated settings (ADR-0005). Evaluated per actor.
 */
@Injectable()
export class FeatureFlagsService {
  private cache?: { flags: { key: string; enabled: boolean; rules: FeatureFlagRules }[]; loadedAt: number };

  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string, actor?: Actor): Promise<boolean> {
    const flag = (await this.flags()).find((f) => f.key === key);
    return flag ? evaluateFlag(flag.key, flag.enabled, flag.rules, actor) : false;
  }

  async enabledFor(actor?: Actor): Promise<string[]> {
    return (await this.flags())
      .filter((f) => evaluateFlag(f.key, f.enabled, f.rules, actor))
      .map((f) => f.key)
      .sort();
  }

  invalidate(): void {
    this.cache = undefined;
  }

  private async flags() {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.flags;
    const rows = await this.prisma.featureFlag.findMany({
      select: { key: true, enabled: true, rules: true },
    });
    const flags = rows.map((r) => ({
      key: r.key,
      enabled: r.enabled,
      rules: (r.rules ?? {}) as FeatureFlagRules,
    }));
    this.cache = { flags, loadedAt: Date.now() };
    return flags;
  }
}

export function evaluateFlag(key: string, enabled: boolean, rules: FeatureFlagRules, actor?: Actor): boolean {
  if (!enabled) return false;
  const principal = actor && (actor.type === 'user' || actor.type === 'api_client') ? actor : undefined;
  if (principal && rules.userIds?.includes(principal.publicId)) return true;
  if (rules.audiences && (!principal || !rules.audiences.includes(principal.audience))) return false;
  if (rules.percentage !== undefined) {
    if (!principal) return rules.percentage >= 100;
    const bucket = createHash('sha256').update(`${key}:${principal.publicId}`).digest().readUInt32BE(0) % 100;
    return bucket < rules.percentage;
  }
  return !rules.userIds || rules.audiences !== undefined;
}
