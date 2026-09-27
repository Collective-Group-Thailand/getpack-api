import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type EvidenceRequirement, type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

export interface RouteStepInput {
  key: string;
  nameTh: string;
  nameEn: string;
  customerLabelTh?: string;
  customerLabelEn?: string;
  evidence?: EvidenceRequirement;
  tracksQuantity?: boolean;
  plannedSharePct?: string;
}

export const ROUTE_INCLUDE = {
  productType: { select: { code: true } },
  printType: { select: { publicId: true } },
  versions: { orderBy: { versionNo: 'desc' }, include: { steps: { orderBy: { seq: 'asc' } } } },
} satisfies Prisma.MilestoneRouteInclude;
export type RouteRow = Prisma.MilestoneRouteGetPayload<{ include: typeof ROUTE_INCLUDE }>;

/**
 * Milestone routes are editable data (D-075): a route per product type (optionally per print type) and
 * variant; every change is a new version effective from a date (§2.1) — jobs keep the version they were
 * released with. No decision names an approver, so the editor (`milestone_routes.manage`) approves the
 * version it writes; the change is audited.
 */
@Injectable()
export class MilestoneRoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  list() {
    return this.prisma.milestoneRoute.findMany({
      include: ROUTE_INCLUDE,
      orderBy: [{ productTypeId: 'asc' }, { variant: 'asc' }],
    });
  }

  async create(
    actor: UserActor,
    input: { productTypeCode: string; printTypeId?: string; variant: string; name: string },
  ) {
    const type = await this.prisma.productType.findUnique({ where: { code: input.productTypeCode } });
    const printType = input.printTypeId
      ? await this.prisma.printType.findUnique({ where: { publicId: input.printTypeId } })
      : null;
    if (!type || (input.printTypeId && !printType)) throw new DomainException('http.not_found');
    try {
      return await this.prisma.milestoneRoute.create({
        data: {
          productTypeId: type.id,
          printTypeId: printType?.id ?? null,
          variant: input.variant,
          name: input.name,
          createdById: actor.userId,
        },
        include: ROUTE_INCLUDE,
      });
    } catch (error) {
      if (String(error).includes('ux_milestone_routes')) throw new DomainException('http.conflict');
      throw error;
    }
  }

  async addVersion(
    actor: UserActor,
    routePublicId: string,
    input: { effectiveFrom: Date; reason: string; steps: RouteStepInput[] },
  ) {
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) throw new DomainException('settings.backdated');
    const keys = new Set(input.steps.map((s) => s.key));
    if (keys.size !== input.steps.length)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'steps', code: 'unique', message: 'step keys must be unique' }],
      });
    return this.prisma.withTx(async (tx) => {
      const route = await tx.milestoneRoute.findUnique({ where: { publicId: routePublicId } });
      if (!route) throw new DomainException('http.not_found');
      const last = await tx.milestoneRouteVersion.findFirst({
        where: { routeId: route.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.milestoneRouteVersion.create({
        data: {
          routeId: route.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          reason: input.reason,
          createdById: actor.userId,
          steps: {
            create: input.steps.map((s, i) => ({
              seq: i + 1,
              key: s.key,
              nameTh: s.nameTh,
              nameEn: s.nameEn,
              customerVisible: s.customerLabelTh !== undefined,
              customerLabelTh: s.customerLabelTh ?? null,
              customerLabelEn: s.customerLabelEn ?? (s.customerLabelTh ? s.nameEn : null),
              evidence: s.evidence ?? 'none',
              tracksQuantity: s.tracksQuantity ?? false,
              plannedSharePct: s.plannedSharePct ?? null,
            })),
          },
        },
      });
      await tx.milestoneRouteVersion.update({
        where: { id: version.id },
        data: { status: 'approved', decidedAt: new Date(), decidedById: actor.userId },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'milestone_route.version_approved',
        resourceType: 'milestone_route',
        resourcePublicId: route.publicId,
        data: {
          versionNo: version.versionNo,
          effectiveFrom: input.effectiveFrom.toISOString(),
          steps: input.steps.map((s) => s.key),
          reason: input.reason,
        },
      });
      await this.events.record(tx, {
        type: 'milestone_route.version_approved',
        aggregateType: 'milestone_route',
        aggregateId: route.publicId,
        payload: { routeId: route.publicId, versionNo: version.versionNo },
      });
      return tx.milestoneRoute.findUniqueOrThrow({ where: { id: route.id }, include: ROUTE_INCLUDE });
    });
  }
}
