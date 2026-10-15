import { randomBytes } from 'node:crypto';

import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgentPlanVersion } from '@generated/prisma/client';
import { type ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEvents } from '@platform/domain-events/domain-events.service';

/** Shared helpers of the sales agent programme (D-416 – D-423). */

export const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
export const ZERO = (): MoneyValue => new MoneyDecimal(0);
export const DAY_MS = 86_400_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** An 8-character agent code (no 0/O/1/I), unique by the caller's check. */
export function newAgentCode(): string {
  return [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** A person's name as an agent may see it when they did not supply it themselves (D-422). */
export function maskName(name: string | null | undefined): string {
  const first = [...(name ?? '').trim()][0];
  return first ? `${first}•••` : '•••';
}

/** E.164 for Thai numbers typed locally (0812345678 → +66810005678); other input unchanged. */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9+]/g, '');
  if (/^0\d{8,9}$/.test(digits)) return `+66${digits.slice(1)}`;
  return digits || null;
}

/** The approved plan version in force at `at` (D-418). */
export async function planVersionAt(db: Tx, planId: bigint, at: Date): Promise<SalesAgentPlanVersion | null> {
  return db.salesAgentPlanVersion.findFirst({
    where: { planId, status: 'approved', effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
  });
}

export function termsOf(v: SalesAgentPlanVersion | null) {
  if (!v) return null;
  return {
    firstOrderPct: D(v.firstOrderPct).toString(),
    repeatOrderPct: D(v.repeatOrderPct).toString(),
    attributionMonths: v.attributionMonths,
    marginCapPct: D(v.marginCapPct).toString(),
    minBaseAmount: v.minBaseAmount.toFixed(2),
    factoryBountyAmount: v.factoryBountyAmount.toFixed(2),
    factoryQualifyJobs: v.factoryQualifyJobs,
    factoryQualifyDays: v.factoryQualifyDays,
  };
}

export function invalid(path: string, message: string, code = 'invalid'): never {
  throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
}

/** One state change: an outbox event and an activity row in the caller's transaction (CLAUDE.md). */
export async function recordAgentEvent(
  deps: { events: DomainEvents; activity: ActivityLogService },
  tx: Tx,
  input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    actor: Actor;
    entityId?: bigint;
  },
): Promise<void> {
  const event = await deps.events.record(
    tx,
    {
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      ...(input.entityId !== undefined && { entityId: input.entityId }),
      payload: input.payload,
    },
    input.actor,
  );
  await deps.activity.record(tx, {
    aggregateType: input.aggregateType,
    aggregatePublicId: input.aggregateId,
    action: input.type,
    messageKey: `activity.${input.type}`,
    messageParams: input.payload,
    visibility: ['internal'],
    domainEventId: event.id,
    actor: input.actor,
  });
}

export const AGENT_REF_SELECT = {
  publicId: true,
  code: true,
  legalName: true,
  kind: true,
} as const satisfies Prisma.SalesAgentSelect;

export function agentRef(a: { publicId: string; code: string; legalName: string; kind: string }) {
  return { id: a.publicId, code: a.code, legalName: a.legalName, kind: a.kind };
}

export function userRef(u: { publicId: string; displayName: string } | null | undefined) {
  return u ? { id: u.publicId, displayName: u.displayName } : null;
}
