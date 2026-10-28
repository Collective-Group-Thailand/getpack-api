import { InvalidationBus } from '@common/cache/invalidation-bus';
import { systemActor } from '@common/context/actor';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';
import Decimal from 'decimal.js';

/**
 * D-449 (owner decisions 2026-10-28, C1d, DECISIONS-STAGE-A §12) — Superadmin powers in the approval engine.
 *
 * A. Solo-owner mode (`approvals.solo_owner_mode`, effective-dated, audited, Superadmin only): while it is on and not
 *    expired, a Superadmin may approve their own maker-checker request with a typed reason; the approval is flagged
 *    "อนุมัติด้วยตนเอง" and listed in a daily digest to Superadmins. It turns itself off at expiry and never applies to a
 *    step that another active user could approve (holds the step's role, or Superadmin).
 * B. Approval threshold: a policy version's `autoApproveMaxAmount` approves a request at or below it at creation
 *    ("below threshold", audited, `approval.approved` with `autoApproved: true`); only versions with an amount
 *    condition carry one.
 */
export const SOLO_OWNER_SETTING = 'approvals.solo_owner_mode';
export const SOLO_OWNER_MAX_DAYS_SETTING = 'approvals.solo_owner_mode_max_days';
/** The shortest typed reason of a self-approval or a Superadmin file download (the existing 10-character rule). */
export const TYPED_REASON_MIN_LENGTH = 10;
export const BELOW_THRESHOLD = 'below_threshold';

export interface SoloOwnerModeValue {
  enabled: boolean;
  expiresAt: string | null;
}

/** On = enabled with an expiry still in the future. Pure. */
export function soloOwnerModeOn(value: SoloOwnerModeValue | null | undefined, now: Date): boolean {
  if (!value?.enabled || !value.expiresAt) return false;
  const expires = Date.parse(value.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime();
}

/**
 * Problems of a solo-owner-mode value a Superadmin sets (empty = valid): on needs an expiry after now and no later
 * than `maxDays` from now; off carries no rule. Pure.
 */
export function soloOwnerValueProblem(value: unknown, maxDays: number, now: Date): string | null {
  if (!value || typeof value !== 'object') return 'an object { enabled, expiresAt }';
  const v = value as Partial<SoloOwnerModeValue>;
  if (typeof v.enabled !== 'boolean') return 'enabled: true or false';
  if (!v.enabled) return null;
  if (typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt)))
    return 'expiresAt: an ISO date-time when enabled';
  const expires = Date.parse(v.expiresAt);
  if (expires <= now.getTime()) return 'expiresAt: after now';
  if (expires > now.getTime() + maxDays * 86_400_000) return `expiresAt: at most ${maxDays} days from now`;
  return null;
}

/** Whether an amount (2-decimal string) is at or below a version's auto-approve amount. Pure; missing → false. */
export function belowThreshold(
  amount: string | null | undefined,
  max: Prisma.Decimal | Decimal | string | null | undefined,
): boolean {
  if (amount === null || amount === undefined || max === null || max === undefined) return false;
  if (!/^\d+(\.\d+)?$/.test(amount)) return false;
  return new Decimal(amount).lte(new Decimal(max.toString()));
}

/** Whether a step condition (ADR-0006 shape) references the request amount anywhere. Pure. */
export function conditionUsesAmount(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') return false;
  const c = condition as Record<string, unknown>;
  for (const group of ['all', 'any'])
    if (Array.isArray(c[group])) return (c[group] as unknown[]).some(conditionUsesAmount);
  return c['field'] === 'amount';
}

export interface SoloOwnerState {
  enabled: boolean;
  expiresAt: string | null;
  /** Enabled and not expired. */
  active: boolean;
  maxDays: number | null;
  /** When the value in force took effect, and who set it. */
  changedAt: Date | null;
  changedBy: { publicId: string; displayName: string } | null;
  settingPublicId: string | null;
}

@Injectable()
export class SoloOwnerModeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly bus: InvalidationBus,
  ) {}

  async value(tx?: Tx): Promise<SoloOwnerModeValue | null> {
    try {
      return (await this.settings.at(SOLO_OWNER_SETTING, tx ? { tx } : {})).value;
    } catch {
      return null; // unset = off
    }
  }

  async maxDays(): Promise<number | null> {
    try {
      return (await this.settings.at(SOLO_OWNER_MAX_DAYS_SETTING)).value;
    } catch {
      return null;
    }
  }

  async isOn(tx?: Tx, now: Date = new Date()): Promise<boolean> {
    return soloOwnerModeOn(await this.value(tx), now);
  }

  async state(now: Date = new Date()): Promise<SoloOwnerState> {
    const setting = await this.prisma.setting.findFirst({
      where: { key: SOLO_OWNER_SETTING, scopeType: 'platform', scopeId: null },
      select: { id: true, publicId: true },
    });
    const version = setting
      ? await this.prisma.settingVersion.findFirst({
          where: { settingId: setting.id, status: 'approved', effectiveFrom: { lte: now } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        })
      : null;
    const changedBy = version?.createdById
      ? await this.prisma.user.findUnique({
          where: { id: version.createdById },
          select: { publicId: true, displayName: true },
        })
      : null;
    const value = (version?.value ?? null) as SoloOwnerModeValue | null;
    return {
      enabled: value?.enabled ?? false,
      expiresAt: value?.expiresAt ?? null,
      active: soloOwnerModeOn(value, now),
      maxDays: await this.maxDays(),
      changedAt: version?.effectiveFrom ?? null,
      changedBy,
      settingPublicId: setting?.publicId ?? null,
    };
  }

  /**
   * Another active user who could decide this step: a holder of the step's role (in its scope) or a Superadmin
   * (who may act for any staff role), other than `userId`. While one exists, solo-owner mode does not apply.
   */
  async otherApproverExists(
    tx: Tx,
    userId: bigint,
    step: { approverRoleId: bigint; approverScopeId: bigint | null },
    now: Date = new Date(),
  ): Promise<boolean> {
    const live = {
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      userId: { not: userId },
      user: { status: 'active' as const, anonymisedAt: null, deletedAt: null },
    };
    const count = await tx.userRole.count({
      where: {
        AND: [
          live,
          {
            OR: [
              {
                roleId: step.approverRoleId,
                ...(step.approverScopeId !== null && { scopeId: step.approverScopeId }),
              },
              { role: { key: 'superadmin' } },
            ],
          },
        ],
      },
    });
    return count > 0;
  }

  /**
   * Worker: once solo-owner mode has expired, records it as off (a new approved version, system actor) with an audit
   * row and the `setting.changed` event, so the back office and the log show it ended. Idempotent.
   */
  async turnOffExpired(now: Date = new Date()): Promise<boolean> {
    const value = await this.value();
    if (!value?.enabled || soloOwnerModeOn(value, now)) return false;
    const actor = systemActor('approvals.solo_owner_mode_expiry');
    const done = await this.prisma.withTx(async (tx) => {
      const setting = await tx.setting.findFirst({
        where: { key: SOLO_OWNER_SETTING, scopeType: 'platform', scopeId: null },
      });
      if (!setting) return false;
      await tx.$queryRaw`SELECT id FROM settings WHERE id = ${setting.id} FOR UPDATE`;
      const current = await this.value(tx);
      if (!current?.enabled || soloOwnerModeOn(current, now)) return false;
      const last = await tx.settingVersion.findFirst({
        where: { settingId: setting.id },
        orderBy: { versionNo: 'desc' },
      });
      const off: SoloOwnerModeValue = { enabled: false, expiresAt: current.expiresAt };
      const reason = 'Solo-owner mode expired (D-449 A)';
      const version = await tx.settingVersion.create({
        data: {
          settingId: setting.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: now,
          status: 'approved',
          value: off as unknown as Prisma.InputJsonValue,
          reason,
          decidedAt: now,
        },
      });
      const change = {
        key: setting.key,
        versionNo: version.versionNo,
        effectiveFrom: now.toISOString(),
        before: current,
        after: off,
        reason,
      };
      await this.audit.record(tx, {
        category: 'config',
        action: 'setting.changed',
        actor,
        resourceType: 'setting',
        resourcePublicId: setting.publicId,
        data: change,
      });
      await this.events.record(
        tx,
        {
          type: 'setting.changed',
          aggregateType: 'setting',
          aggregateId: setting.publicId,
          payload: { key: setting.key, versionNo: version.versionNo, effectiveFrom: change.effectiveFrom },
        },
        actor,
      );
      return true;
    });
    if (done) await this.bus.publish('settings', SOLO_OWNER_SETTING);
    return done;
  }
}
