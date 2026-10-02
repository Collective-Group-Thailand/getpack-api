import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type ConfigVersionStatus, type OnboardingStep, Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { FactoriesService } from '../factories/factories.service';
import { FactoryAccess } from '../factories/factory-access';
import {
  type FactoryConfigurationDto,
  type SetCapacityDto,
  type SetParticipationDto,
  type SetPayoutPolicyDto,
  type SetPricingArrangementDto,
  type SetToleranceDto,
  type VersionMetaDto,
} from './configuration.dto';
import { validatedEnvelope } from './envelope-catalogue';
import { type TierBEnvelope } from './tier-b-envelope';

/** Back-dating tolerance for clock skew; history is never rewritten (ADR-0005). */
const BACKDATE_SLACK_MS = 60_000;

interface VersionRow {
  id: bigint;
  versionNo: number;
  effectiveFrom: Date;
  status: ConfigVersionStatus;
  reason: string;
  approvalRequest?: { publicId: string } | null;
}

interface VersionTable {
  findFirst(args: object): Promise<{ versionNo: number } | null>;
  count(args: object): Promise<number>;
  create(args: object): Promise<VersionRow>;
  update(args: object): Promise<VersionRow>;
  findMany(args: object): Promise<VersionRow[]>;
}

type Kind = 'participation' | 'pricing_arrangement' | 'capacity' | 'tolerance' | 'payout';

const POLICY_OF: Partial<Record<Kind, string>> = {
  pricing_arrangement: 'partner_pricing_mode_change',
  tolerance: 'factory_tolerance_change',
  payout: 'factory_payout_policy_change',
};
/** Onboarding step a decided version completes (tiers are part of the pricing-arrangement step). */
const STEP_OF: Partial<Record<Kind, OnboardingStep>> = {
  pricing_arrangement: 'pricing_arrangement',
  capacity: 'capacity',
  tolerance: 'tolerance',
  payout: 'payout_policy',
};
const SUBJECT_OF: Partial<Record<Kind, string>> = {
  pricing_arrangement: 'factory',
  tolerance: 'factory_tolerance_policy_version',
  payout: 'factory_payout_policy_version',
};

/** Current (approved, in force) and upcoming (scheduled or awaiting a decision) versions. */
export function split<T extends VersionRow>(rows: T[], at = new Date()) {
  const approved = rows
    .filter((r) => r.status === 'approved')
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.versionNo - a.versionNo);
  const current = approved.find((r) => r.effectiveFrom.getTime() <= at.getTime()) ?? null;
  const upcoming = rows
    .filter(
      (r) => (r.status === 'approved' && r.effectiveFrom.getTime() > at.getTime()) || r.status === 'proposed',
    )
    .sort((a, b) => a.versionNo - b.versionNo);
  return { current, upcoming };
}

export const versionMeta = (r: VersionRow): VersionMetaDto => ({
  versionNo: r.versionNo,
  status: r.status,
  effectiveFrom: toBangkokIso(r.effectiveFrom),
  reason: r.reason,
  approvalRequestId: r.approvalRequest?.publicId ?? null,
});

/**
 * Effective-dated configuration of a factory (ADR-0005): participation tier per product type (D-043),
 * pricing-ownership mode (D-042), weekly capacity (D-101), tolerance override (D-021) and payout policy
 * (D-022). New values are new versions, never edits. Tiers and capacity are set by the Partner team;
 * the first pricing mode is chosen at onboarding and later changes need `partner_pricing_mode_change`
 * (D-167); factory tolerance and payout overrides need Superadmin approval (D-173).
 */
@Injectable()
export class ConfigurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
    private readonly approvals: ApprovalsService,
  ) {}

  // --- read ---------------------------------------------------------------------------------------

  async configuration(actor: Actor, factoryPublicId: string): Promise<FactoryConfigurationDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const approval = { approvalRequest: { select: { publicId: true } } };
    const [arrangement, participations, capacities, tolerances, payout] = await Promise.all([
      this.prisma.factoryPricingArrangement.findUnique({
        where: { factoryId: factory.id },
        include: { versions: { include: approval } },
      }),
      this.prisma.factoryParticipation.findMany({
        where: { factoryId: factory.id },
        include: { productType: { select: { publicId: true, code: true } }, versions: { include: approval } },
      }),
      this.prisma.factoryCapacity.findMany({
        where: { factoryId: factory.id },
        include: { productType: { select: { publicId: true, code: true } }, versions: { include: approval } },
      }),
      this.prisma.factoryTolerancePolicy.findMany({
        where: { factoryId: factory.id },
        include: { productType: { select: { publicId: true, code: true } }, versions: { include: approval } },
      }),
      this.prisma.factoryPayoutPolicy.findUnique({
        where: { factoryId: factory.id },
        include: { versions: { include: approval } },
      }),
    ]);
    const arrangementSplit = split(arrangement?.versions ?? []);
    const payoutSplit = split(payout?.versions ?? []);
    return {
      pricingArrangement: {
        current: arrangementSplit.current && {
          ...versionMeta(arrangementSplit.current),
          ownershipMode: arrangementSplit.current.ownershipMode,
        },
        upcoming: arrangementSplit.upcoming.map((v) => ({
          ...versionMeta(v),
          ownershipMode: v.ownershipMode,
        })),
      },
      participations: participations.map((p) => {
        const { current, upcoming } = split(p.versions);
        const dto = (v: (typeof p.versions)[number]) => ({
          ...versionMeta(v),
          tier: v.tier,
          envelopeNote: v.envelopeNote,
          envelope: (v.envelope as TierBEnvelope | null) ?? null,
        });
        return {
          productTypeId: p.productType.publicId,
          productTypeCode: p.productType.code,
          current: current && dto(current),
          upcoming: upcoming.map(dto),
        };
      }),
      capacities: capacities.map((c) => {
        const { current, upcoming } = split(c.versions);
        const dto = (v: (typeof c.versions)[number]) => ({
          ...versionMeta(v),
          capacityUnit: v.capacityUnit,
          weeklyCapacity: v.weeklyCapacity.toFixed(3),
        });
        return {
          productTypeId: c.productType.publicId,
          productTypeCode: c.productType.code,
          current: current && dto(current),
          upcoming: upcoming.map(dto),
        };
      }),
      tolerances: tolerances.map((t) => {
        const { current, upcoming } = split(t.versions);
        const dto = (v: (typeof t.versions)[number]) => ({
          ...versionMeta(v),
          shortagePct: v.shortagePct.toFixed(4),
          overagePct: v.overagePct.toFixed(4),
        });
        return {
          productTypeId: t.productType?.publicId ?? null,
          productTypeCode: t.productType?.code ?? null,
          current: current && dto(current),
          upcoming: upcoming.map(dto),
        };
      }),
      payoutPolicy: {
        current: payoutSplit.current && this.payoutDto(payoutSplit.current),
        upcoming: payoutSplit.upcoming.map((v) => this.payoutDto(v)),
      },
    };
  }

  private payoutDto(
    v: Prisma.FactoryPayoutPolicyVersionGetPayload<{
      include: { approvalRequest: { select: { publicId: true } } };
    }>,
  ) {
    return {
      ...versionMeta(v),
      advancePct: v.advancePct.toFixed(4),
      advanceTrigger: v.advanceTrigger,
      balanceTrigger: v.balanceTrigger,
      claimWindowDays: v.claimWindowDays,
      retentionPct: v.retentionPct.toFixed(4),
      retentionReleaseDays: v.retentionReleaseDays,
      paymentTermsDays: v.paymentTermsDays,
    };
  }

  // --- write --------------------------------------------------------------------------------------

  async setParticipation(actor: UserActor, factoryPublicId: string, input: SetParticipationDto) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const productTypeId = await this.productType(tx, input.productTypeId);
      // D-234: a tier-B path covers only its envelope; tiers A and C carry none.
      let envelope: TierBEnvelope | null = null;
      if (input.tier === 'B') {
        const type = await tx.productType.findUniqueOrThrow({ where: { id: productTypeId } });
        envelope = await validatedEnvelope(tx, type, input.envelope ?? null);
      } else if (input.envelope) {
        throw new DomainException('validation.failed', {
          errors: [
            { path: 'envelope', code: 'tier_b_only', message: 'only a tier-B participation has an envelope' },
          ],
        });
      }
      // D-043: a tier is a promise to quote, so the factory must be able to make the type.
      const capable = await tx.factoryCapability.count({
        where: { factoryId: factory.id, productTypeId, status: 'active' },
      });
      if (capable === 0) throw new DomainException('partners.not_capable');
      const identity =
        (await tx.factoryParticipation.findUnique({
          where: { factoryId_productTypeId: { factoryId: factory.id, productTypeId } },
        })) ??
        (await tx.factoryParticipation.create({
          data: { factoryId: factory.id, productTypeId, createdById: actor.userId },
        }));
      return this.write(tx, actor, factory, 'participation', tx.factoryParticipationVersion, {
        identity: { participationId: identity.id },
        values: {
          tier: input.tier,
          envelopeNote: input.envelopeNote ?? null,
          envelope: envelope ?? Prisma.DbNull,
        },
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
      });
    });
  }

  async setPricingArrangement(actor: UserActor, factoryPublicId: string, input: SetPricingArrangementDto) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const identity =
        (await tx.factoryPricingArrangement.findUnique({ where: { factoryId: factory.id } })) ??
        (await tx.factoryPricingArrangement.create({
          data: { factoryId: factory.id, createdById: actor.userId },
        }));
      // The first choice is part of onboarding; any later change goes through the approval (D-042, D-167).
      const decided = await tx.factoryPricingArrangementVersion.count({
        where: { arrangementId: identity.id, status: 'approved' },
      });
      return this.write(tx, actor, factory, 'pricing_arrangement', tx.factoryPricingArrangementVersion, {
        identity: { arrangementId: identity.id },
        values: { ownershipMode: input.ownershipMode },
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        approval: decided > 0,
      });
    });
  }

  async setCapacity(actor: UserActor, factoryPublicId: string, input: SetCapacityDto) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const productTypeId = await this.productType(tx, input.productTypeId);
      const identity =
        (await tx.factoryCapacity.findUnique({
          where: { factoryId_productTypeId: { factoryId: factory.id, productTypeId } },
        })) ??
        (await tx.factoryCapacity.create({
          data: { factoryId: factory.id, productTypeId, createdById: actor.userId },
        }));
      return this.write(tx, actor, factory, 'capacity', tx.factoryCapacityVersion, {
        identity: { capacityId: identity.id },
        values: {
          capacityUnit: input.capacityUnit,
          weeklyCapacity: new Prisma.Decimal(input.weeklyCapacity),
        },
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
      });
    });
  }

  async setTolerance(actor: UserActor, factoryPublicId: string, input: SetToleranceDto) {
    this.assertPct({ shortagePct: input.shortagePct, overagePct: input.overagePct });
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const productTypeId = input.productTypeId ? await this.productType(tx, input.productTypeId) : null;
      const identity =
        (await tx.factoryTolerancePolicy.findFirst({ where: { factoryId: factory.id, productTypeId } })) ??
        (await tx.factoryTolerancePolicy.create({
          data: { factoryId: factory.id, productTypeId, createdById: actor.userId },
        }));
      return this.write(tx, actor, factory, 'tolerance', tx.factoryTolerancePolicyVersion, {
        identity: { policyId: identity.id },
        values: {
          shortagePct: new Prisma.Decimal(input.shortagePct),
          overagePct: new Prisma.Decimal(input.overagePct),
        },
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        approval: true,
      });
    });
  }

  async setPayoutPolicy(actor: UserActor, factoryPublicId: string, input: SetPayoutPolicyDto) {
    this.assertPct({ advancePct: input.advancePct, retentionPct: input.retentionPct });
    if (input.advancePct + input.retentionPct > 100) {
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'retentionPct', code: 'max', message: 'advancePct + retentionPct must not exceed 100' },
        ],
      });
    }
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const identity =
        (await tx.factoryPayoutPolicy.findUnique({ where: { factoryId: factory.id } })) ??
        (await tx.factoryPayoutPolicy.create({ data: { factoryId: factory.id, createdById: actor.userId } }));
      return this.write(tx, actor, factory, 'payout', tx.factoryPayoutPolicyVersion, {
        identity: { policyId: identity.id },
        values: {
          advancePct: new Prisma.Decimal(input.advancePct),
          advanceTrigger: input.advanceTrigger,
          balanceTrigger: input.balanceTrigger,
          claimWindowDays: input.claimWindowDays,
          retentionPct: new Prisma.Decimal(input.retentionPct),
          retentionReleaseDays: input.retentionReleaseDays,
          paymentTermsDays: input.paymentTermsDays ?? 0,
        },
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        approval: true,
      });
    });
  }

  /**
   * Writes one version: approved at once, or proposed with an approval request (one pending change at
   * a time). Audit, activity and `factory.<kind>_changed | _change_proposed` in the same transaction.
   */
  private async write(
    tx: Tx,
    actor: UserActor,
    factory: { id: bigint; publicId: string; code: string },
    kind: Kind,
    table: VersionTable,
    change: {
      identity: Record<string, bigint>;
      values: Record<string, unknown>;
      effectiveFrom?: Date;
      reason: string;
      approval?: boolean;
    },
  ): Promise<{ versionNo: number; status: ConfigVersionStatus; approvalRequestId: string | null }> {
    const effectiveFrom = change.effectiveFrom ?? new Date();
    if (effectiveFrom.getTime() < Date.now() - BACKDATE_SLACK_MS)
      throw new DomainException('partners.backdated');
    if (change.approval && (await table.count({ where: { ...change.identity, status: 'proposed' } })) > 0) {
      throw new DomainException('partners.version_pending');
    }
    const last = await table.findFirst({ where: change.identity, orderBy: { versionNo: 'desc' } });
    const now = new Date();
    const version = await table.create({
      data: {
        ...change.identity,
        ...change.values,
        versionNo: (last?.versionNo ?? 0) + 1,
        effectiveFrom,
        reason: change.reason,
        status: change.approval ? 'proposed' : 'approved',
        createdById: actor.userId,
        ...(change.approval ? {} : { decidedAt: now, decidedById: actor.userId }),
      },
    });
    let approvalRequestId: string | null = null;
    if (change.approval) {
      const subjectType = SUBJECT_OF[kind]!;
      const request = await this.approvals.create(tx, {
        policyKey: POLICY_OF[kind]!,
        subject:
          subjectType === 'factory'
            ? { type: subjectType, id: factory.id, publicId: factory.publicId }
            : { type: subjectType, id: version.id, publicId: factory.publicId },
        requester: actor,
        payload: {
          factory: factory.code,
          kind,
          versionNo: version.versionNo,
          values: jsonSafe(change.values),
          reason: change.reason,
        },
        scope: { factoryId: factory.id },
      });
      await table.update({ where: { id: version.id }, data: { approvalRequestId: request.id } });
      approvalRequestId = request.publicId;
    } else if (STEP_OF[kind]) {
      await this.factories.markStep(tx, factory.id, STEP_OF[kind], 'approved', actor.userId);
    }
    await this.factories.record(
      tx,
      factory.publicId,
      change.approval ? `factory.${kind}_change_proposed` : `factory.${kind}_changed`,
      {
        versionNo: version.versionNo,
        effectiveFrom: effectiveFrom.toISOString(),
        approvalRequestId,
        // The tier and its envelope travel with the event (D-234): the coverage map and availability follow them.
        ...(kind === 'participation' && { values: jsonSafe(change.values) }),
      },
    );
    return {
      versionNo: version.versionNo,
      status: change.approval ? 'proposed' : 'approved',
      approvalRequestId,
    };
  }

  // --- approval outcomes ---------------------------------------------------------------------------

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'partners.factory-configuration',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const policyKey = event.payload['policyKey'];
    const kind = (Object.keys(POLICY_OF) as Kind[]).find((k) => POLICY_OF[k] === policyKey);
    if (!kind) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const table = {
      pricing_arrangement: tx.factoryPricingArrangementVersion,
      tolerance: tx.factoryTolerancePolicyVersion,
      payout: tx.factoryPayoutPolicyVersion,
    }[kind as 'pricing_arrangement' | 'tolerance' | 'payout'] as unknown as VersionTable;
    const [version] = await table.findMany({ where: { approvalRequestId: request.id, status: 'proposed' } });
    if (!version) return; // idempotent
    const status: ConfigVersionStatus =
      event.type === 'approval.approved'
        ? 'approved'
        : event.type === 'approval.withdrawn'
          ? 'withdrawn'
          : 'rejected';
    await table.update({
      where: { id: version.id },
      data: { status, decidedAt: new Date(), decidedById: null },
    });
    const factoryId =
      kind === 'pricing_arrangement'
        ? request.subjectId
        : (
            await tx.factory.findFirstOrThrow({
              where:
                kind === 'tolerance'
                  ? { tolerancePolicies: { some: { versions: { some: { id: version.id } } } } }
                  : { payoutPolicy: { versions: { some: { id: version.id } } } },
              select: { id: true },
            })
          ).id;
    const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
    const step = STEP_OF[kind];
    if (status === 'approved' && step) await this.factories.markStep(tx, factory.id, step, 'approved', null);
    await this.factories.record(
      tx,
      factory.publicId,
      `factory.${kind}_${status === 'approved' ? 'changed' : 'change_' + status}`,
      {
        versionNo: version.versionNo,
        approvalRequestId: event.aggregateId,
      },
    );
  }

  // --- resolution (used by quoting, B2.3 / B2.5) ---------------------------------------------------

  /** Tier of a factory for a product type at `at` (D-043), or null when it does not participate. */
  async tierAt(factoryId: bigint, productTypeId: bigint, at = new Date(), db: Tx = this.prisma) {
    const version = await db.factoryParticipationVersion.findFirst({
      where: { participation: { factoryId, productTypeId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    return version?.tier ?? null;
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private async productType(tx: Tx, publicId: string): Promise<bigint> {
    const row = await tx.productType.findUnique({ where: { publicId }, select: { id: true } });
    if (!row) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'productTypeId', code: 'exists', message: 'productTypeId does not exist' }],
      });
    }
    return row.id;
  }

  private assertPct(values: Record<string, number>): void {
    for (const [path, value] of Object.entries(values)) {
      if (value > 100) {
        throw new DomainException('validation.failed', {
          errors: [{ path, code: 'max', message: `${path} must not exceed 100` }],
        });
      }
    }
  }
}

/** Decimal values as strings for approval payloads (JSON). */
function jsonSafe(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      v instanceof Prisma.Decimal ? v.toString() : v === Prisma.DbNull ? null : v,
    ]),
  );
}
